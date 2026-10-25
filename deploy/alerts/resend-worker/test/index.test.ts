import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupMonitorState, handleRequest, type Environment } from "../src/index.js";

const environment: Environment = {
  FLUX_HMAC_SECRET: "test-hmac-secret",
  RESEND_API_KEY: "test-resend-key",
  ALERT_RECIPIENT: "operator@example.com",
};

const fluxEvent = {
  involvedObject: {
    apiVersion: "helm.toolkit.fluxcd.io/v2",
    kind: "HelmRelease",
    name: "rallyroo",
    namespace: "rallyroo",
    uid: "00000000-0000-4000-8000-000000000001",
  },
  metadata: {
    "helm.toolkit.fluxcd.io/revision": "0.1.4+abc123",
    application: "rallyroo",
    environment: "home-production",
  },
  severity: "error",
  reason: "UpgradeFailed",
  message: "pre-upgrade migration hook failed",
  reportingController: "helm-controller",
  timestamp: "2026-08-29T01:00:00Z",
};

async function signature(body: string, secret = environment.FLUX_HMAC_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function fluxRequest(event: unknown = fluxEvent, suppliedSignature?: string): Promise<Request> {
  const body = JSON.stringify(event);
  return new Request("https://alerts.example/flux", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": suppliedSignature ?? await signature(body),
    },
    body,
  });
}

async function backupRequest(value: unknown, suppliedSignature?: string): Promise<Request> {
  const request = await fluxRequest(value, suppliedSignature);
  return new Request("https://alerts.example/backup", { method: "POST", headers: request.headers, body: await request.text() });
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function alarmState() {
  const values = new Map<string, unknown>();
  return {
    values,
    storage: {
      async get<T>(key: string) { return values.get(key) as T | undefined; },
      async put<T>(key: string, value: T) { values.set(key, value); },
      setAlarm: vi.fn(async (_time: number) => {}),
    },
  };
}

describe("independent backup heartbeat alarm", () => {
  it("alerts after the production monitor disappears, rate-limits repeats and rearms after recovery", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const state = alarmState();
    const send = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 202 }));
    const monitor = new BackupMonitorState(state, environment, send);
    await monitor.fetch(new Request("https://internal/heartbeat", { method: "POST" }));
    await monitor.alarm();
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61 * 60_000);
    await monitor.alarm();
    expect(JSON.parse(String(send.mock.calls[0]![1]?.body))).toMatchObject({
      payload: { object: "BackupMonitor/rallyroo", message: "monitor_heartbeat_overdue" },
    });
    await monitor.alarm();
    expect(send).toHaveBeenCalledTimes(1);
    await monitor.fetch(new Request("https://internal/heartbeat", { method: "POST" }));
    vi.advanceTimersByTime(61 * 60_000);
    await monitor.alarm();
    expect(send).toHaveBeenCalledTimes(2);
    expect(state.storage.setAlarm).toHaveBeenCalled();
  });

  it("retries failed delivery without losing durable scheduling", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const state = alarmState();
    const send = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response(null, { status: 202 }));
    const monitor = new BackupMonitorState(state, environment, send);
    await monitor.fetch(new Request("https://internal/heartbeat", { method: "POST" }));
    vi.advanceTimersByTime(61 * 60_000);
    await expect(monitor.alarm()).rejects.toThrow("backup_monitor_alert_failed");
    expect(state.values.get("lastAlertAt")).toBe(0);
    await monitor.alarm();
    expect(send).toHaveBeenCalledTimes(2);
    expect(state.values.get("lastAlertAt")).toBe(Date.now());
  });

  it("requires a signed valid heartbeat and a configured durable binding", async () => {
    const body = { problems: [], timestamp: new Date().toISOString() };
    const signed = async (value: unknown, suppliedSignature?: string) => {
      const req = await fluxRequest(value, suppliedSignature);
      return new Request("https://alerts.example/backup-heartbeat", { method: "POST", headers: req.headers, body: await req.text() });
    };
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    const env = { ...environment, BACKUP_MONITOR_STATE: { idFromName: () => "production", get: () => ({ fetch }) } } as unknown as Environment;
    expect((await handleRequest(await signed(body, "sha256=00"), env)).status).toBe(401);
    expect((await handleRequest(await signed({ ...body, problems: ["arbitrary"] }), env)).status).toBe(422);
    expect((await handleRequest(await signed(body), environment)).status).toBe(503);
    expect((await handleRequest(await signed(body), env)).status).toBe(202);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("backup monitoring endpoint", () => {
  it("uses the configured operator automation with an explicit BackupMonitor source", async () => {
    const resend = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const response = await handleRequest(await backupRequest({ problems: ["upload_overdue", "verify_service_failed"],
      timestamp: new Date().toISOString() }), environment, resend);
    expect(response.status).toBe(202);
    expect(JSON.parse(String(resend.mock.calls[0]![1].body))).toMatchObject({
      event: "deployment.failed", email: "operator@example.com", payload: {
        application: "rallyroo-backups", object: "BackupMonitor/rallyroo", reason: "BackupVerificationFailed",
        message: "upload_overdue, verify_service_failed",
      },
    });
  });
  it("requires authentication and rejects arbitrary messages, stale timestamps and unknown reason codes", async () => {
    const resend = vi.fn();
    const valid = { problems: ["upload_overdue"], timestamp: new Date().toISOString() };
    expect((await handleRequest(await backupRequest(valid, "sha256=00"), environment, resend)).status).toBe(401);
    for (const value of [{ ...valid, message: "private details" }, { ...valid, problems: ["unknown"] },
      { ...valid, timestamp: "2000-01-01T00:00:00Z" }, { ...valid, problems: [] }]) {
      expect((await handleRequest(await backupRequest(value), environment, resend)).status).toBe(422);
    }
    expect(resend).not.toHaveBeenCalled();
  });
  it("returns a retryable delivery failure", async () => {
    const resend = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    expect((await handleRequest(await backupRequest({ problems: ["monitor_test"], timestamp: new Date().toISOString() }),
      environment, resend)).status).toBe(502);
  });
});

describe("deployment alert HTTP endpoint", () => {
  it("forwards an authenticated Rallyroo Helm failure as a Resend automation event", async () => {
    const resend = vi.fn().mockResolvedValue(new Response(JSON.stringify({ object: "event" }), { status: 202 }));

    const response = await handleRequest(await fluxRequest(), environment, resend);

    expect(response.status).toBe(202);
    expect(resend).toHaveBeenCalledOnce();
    const [url, init] = resend.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/events/send");
    expect(init.headers).toEqual({
      Authorization: "Bearer test-resend-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      event: "deployment.failed",
      email: "operator@example.com",
      payload: {
        application: "rallyroo",
        environment: "home-production",
        object: "HelmRelease/rallyroo",
        namespace: "rallyroo",
        reason: "UpgradeFailed",
        message: "pre-upgrade migration hook failed",
        revision: "0.1.4+abc123",
        timestamp: "2026-08-29T01:00:00Z",
      },
    });
  });

  it("rejects an invalid HMAC without contacting Resend", async () => {
    const resend = vi.fn();
    const response = await handleRequest(await fluxRequest(fluxEvent, "sha256=00"), environment, resend);

    expect(response.status).toBe(401);
    expect(resend).not.toHaveBeenCalled();
  });

  it("rejects events outside the Rallyroo HelmRelease error boundary", async () => {
    const resend = vi.fn();
    const response = await handleRequest(
      await fluxRequest({ ...fluxEvent, severity: "info" }),
      environment,
      resend,
    );

    expect(response.status).toBe(422);
    expect(resend).not.toHaveBeenCalled();
  });

  it("returns a retryable error when Resend does not accept the event", async () => {
    const resend = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const response = await handleRequest(await fluxRequest(), environment, resend);

    expect(response.status).toBe(502);
  });

  it("exposes only a shallow health endpoint to unauthenticated requests", async () => {
    expect((await handleRequest(new Request("https://alerts.example/health"), environment, vi.fn())).status).toBe(204);
    expect((await handleRequest(new Request("https://alerts.example/flux"), environment, vi.fn())).status).toBe(405);
    expect((await handleRequest(new Request("https://alerts.example/unknown"), environment, vi.fn())).status).toBe(404);
  });
});
