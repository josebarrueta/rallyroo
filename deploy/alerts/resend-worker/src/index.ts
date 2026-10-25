export interface Environment {
  FLUX_HMAC_SECRET: string;
  RESEND_API_KEY: string;
  ALERT_RECIPIENT: string;
  BACKUP_MONITOR_STATE?: DurableObjectNamespace;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type FluxEvent = {
  involvedObject: {
    kind: string;
    name: string;
    namespace: string;
  };
  metadata: Record<string, string>;
  severity: string;
  reason: string;
  message: string;
  timestamp: string;
};

const encoder = new TextEncoder();
const maximumBodyLength = 64 * 1024;
const maximumMessageLength = 4_000;

function response(status: number): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function parseFluxEvent(value: unknown): FluxEvent | undefined {
  if (!isRecord(value) || !isRecord(value.involvedObject) || !isStringRecord(value.metadata)) return undefined;
  const involvedObject = value.involvedObject;
  const stringFields = [
    involvedObject.kind,
    involvedObject.name,
    involvedObject.namespace,
    value.severity,
    value.reason,
    value.message,
    value.timestamp,
  ];
  if (!stringFields.every((field) => typeof field === "string")) return undefined;

  return {
    involvedObject: {
      kind: involvedObject.kind as string,
      name: involvedObject.name as string,
      namespace: involvedObject.namespace as string,
    },
    metadata: value.metadata,
    severity: value.severity as string,
    reason: value.reason as string,
    message: value.message as string,
    timestamp: value.timestamp as string,
  };
}

function hexToBytes(value: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/i.test(value)) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hasValidSignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  const supplied = hexToBytes(signature.slice("sha256=".length));
  if (!supplied) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return equalBytes(expected, supplied);
}

function revision(metadata: Record<string, string>): string {
  return metadata["helm.toolkit.fluxcd.io/revision"]
    ?? metadata["source.toolkit.fluxcd.io/revision"]
    ?? metadata.revision
    ?? "unknown";
}

export async function handleRequest(
  request: Request,
  environment: Environment,
  send: Fetcher = fetch,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/health") return request.method === "GET" ? response(204) : response(405);
  if (pathname !== "/flux" && pathname !== "/backup" && pathname !== "/backup-heartbeat") return response(404);
  if (request.method !== "POST") return response(405);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return response(415);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maximumBodyLength) return response(413);
  const body = await request.text();
  if (body.length > maximumBodyLength) return response(413);
  if (!await hasValidSignature(body, request.headers.get("x-signature"), environment.FLUX_HMAC_SECRET)) {
    return response(401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return response(400);
  }
  if (pathname === "/backup-heartbeat") {
    if (!isRecord(parsed) || Object.keys(parsed).sort().join(",") !== "problems,timestamp"
        || !Array.isArray(parsed.problems) || parsed.problems.length !== 0 || !validBackupTimestamp(parsed.timestamp)) {
      return response(422);
    }
    if (!environment.BACKUP_MONITOR_STATE) return response(503);
    const namespace = environment.BACKUP_MONITOR_STATE;
    return namespace.get(namespace.idFromName("production")).fetch(new Request("https://internal/heartbeat", {
      method: "POST", body: JSON.stringify(parsed), headers: { "Content-Type": "application/json" },
    }));
  }
  if (pathname === "/backup") return handleBackupEvent(parsed, environment, send);
  const event = parseFluxEvent(parsed);
  if (
    !event
    || event.severity !== "error"
    || event.involvedObject.kind !== "HelmRelease"
    || event.involvedObject.name !== "rallyroo"
    || event.involvedObject.namespace !== "rallyroo"
  ) {
    return response(422);
  }

  const resendResponse = await send("https://api.resend.com/events/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event: "deployment.failed",
      email: environment.ALERT_RECIPIENT,
      payload: {
        application: event.metadata.application ?? "rallyroo",
        environment: event.metadata.environment ?? "unknown",
        object: `${event.involvedObject.kind}/${event.involvedObject.name}`,
        namespace: event.involvedObject.namespace,
        reason: event.reason,
        message: event.message.slice(0, maximumMessageLength),
        revision: revision(event.metadata),
        timestamp: event.timestamp,
      },
    }),
  });

  if (!resendResponse.ok) {
    console.error("Resend rejected deployment alert", { status: resendResponse.status });
    return response(502);
  }
  return response(202);
}

async function handleBackupEvent(value: unknown, environment: Environment, send: Fetcher): Promise<Response> {
  const allowed = new Set([
    "upload_overdue", "excess_live_objects", "inventory_unavailable", "backup_service_failed",
    "verify_service_failed", "backup_verification_overdue", "verify_verification_overdue", "monitor_test", "monitor_heartbeat_overdue",
  ]);
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "problems,timestamp"
      || !Array.isArray(value.problems) || value.problems.length < 1 || value.problems.length > 9
      || !value.problems.every((problem) => typeof problem === "string" && allowed.has(problem))
      || !validBackupTimestamp(value.timestamp)) return response(422);
  // Reuse the already configured operator automation, but identify the source
  // explicitly as BackupMonitor, not as a fabricated HelmRelease failure.
  const sent = await send("https://api.resend.com/events/send", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${environment.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ event: "deployment.failed", email: environment.ALERT_RECIPIENT, payload: {
      application: "rallyroo-backups", environment: "production", object: "BackupMonitor/rallyroo",
      namespace: "rallyroo", reason: value.problems.includes("monitor_test") ? "BackupMonitorTest" : "BackupVerificationFailed",
      message: [...new Set(value.problems)].join(", "), revision: "not-applicable", timestamp: value.timestamp,
    } }),
  });
  return response(sent.ok ? 202 : 502);
}

function validBackupTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)
    && Number.isFinite(Date.parse(value)) && Math.abs(Date.now() - Date.parse(value)) <= 5 * 60_000;
}

interface BackupStateContext {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    setAlarm(time: number): Promise<void>;
  };
}

/** Cloudflare-hosted alarm survives production VM loss. Stores no Family data or secrets. */
export class BackupMonitorState {
  constructor(private readonly state: BackupStateContext, private readonly environment: Environment,
    private readonly send: Fetcher = fetch) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/heartbeat") return response(404);
    const now = Date.now();
    // Receipt time is authoritative; a sender cannot postpone detection using a future timestamp.
    await this.state.storage.put("lastReceivedAt", now);
    await this.state.storage.put("lastAlertAt", 0);
    await this.state.storage.setAlarm(now + 15 * 60_000);
    return response(202);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    try {
      const receivedAt = await this.state.storage.get<number>("lastReceivedAt");
      const lastAlertAt = await this.state.storage.get<number>("lastAlertAt") ?? 0;
      if (receivedAt !== undefined && now - receivedAt > 60 * 60_000
          && (lastAlertAt === 0 || now - lastAlertAt >= 6 * 60 * 60_000)) {
        const sent = await handleBackupEvent({ problems: ["monitor_heartbeat_overdue"], timestamp: new Date(now).toISOString() },
          this.environment, this.send);
        if (sent.status !== 202) throw new Error("backup_monitor_alert_failed");
        if (await this.state.storage.get<number>("lastReceivedAt") === receivedAt) {
          await this.state.storage.put("lastAlertAt", now);
        }
      }
    } finally {
      await this.state.storage.setAlarm(Date.now() + 15 * 60_000);
    }
  }
}

export default {
  fetch(request: Request, environment: Environment): Promise<Response> {
    return handleRequest(request, environment);
  },
};
