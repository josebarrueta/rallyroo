const providerOrigin = "https://api.511.org";
const maximumResponseBytes = 5 * 1024 * 1024;
const requestTimeoutMilliseconds = 15_000;

export type SF511ProviderErrorReason =
  | "invalid_configuration"
  | "http_error"
  | "network_error"
  | "response_too_large";

export class SF511ProviderError extends Error {
  constructor(
    public readonly reason: SF511ProviderErrorReason,
    public readonly statusCode?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(statusCode === undefined ? reason : `${reason}:${statusCode}`);
    this.name = "SF511ProviderError";
  }
}

type ProviderFetch = (url: URL, init: RequestInit) => Promise<Response>;

export class SF511Client {
  private readonly apiKey: string;

  constructor(
    apiKey: string,
    private readonly fetcher: ProviderFetch = fetch,
  ) {
    if (apiKey.trim().length < 1 || apiKey.length > 500) {
      throw new SF511ProviderError("invalid_configuration");
    }
    this.apiKey = apiKey;
  }

  async tripUpdates(): Promise<Uint8Array> {
    return this.request("/Transit/TripUpdates", { agency: "CT" });
  }

  async serviceAlerts(): Promise<Uint8Array> {
    return this.request("/transit/servicealerts", { agency: "CT" });
  }

  async stops(): Promise<Uint8Array> {
    return this.request("/transit/stops", { operator_id: "CT", format: "json" });
  }

  async staticSchedule(): Promise<Uint8Array> {
    return this.request("/transit/datafeeds", { operator_id: "CT" });
  }

  private async request(path: string, parameters: Record<string, string>): Promise<Uint8Array> {
    const url = new URL(path, providerOrigin);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    url.searchParams.set("api_key", this.apiKey);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), requestTimeoutMilliseconds);
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        redirect: "error",
        signal: abort.signal,
        headers: {
          accept: "application/zip, application/x-protobuf, application/octet-stream, application/json;q=0.5",
          "accept-encoding": "gzip, deflate",
          "user-agent": "Rallyroo-Commuter/1.0",
        },
      });
      if (!response.ok) {
        throw new SF511ProviderError(
          "http_error",
          response.status,
          response.status === 429 ? retryAfterSeconds(response.headers.get("retry-after")) : undefined,
        );
      }
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maximumResponseBytes) {
        throw new SF511ProviderError("response_too_large");
      }
      return readBoundedBody(response);
    } catch (error) {
      if (error instanceof SF511ProviderError) throw error;
      throw new SF511ProviderError("network_error");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^[0-9]+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) && seconds >= 1
      ? Math.min(seconds, 21_600)
      : undefined;
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(Math.ceil((date - Date.now()) / 1_000), 1), 21_600);
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) {
        await reader.cancel();
        throw new SF511ProviderError("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
