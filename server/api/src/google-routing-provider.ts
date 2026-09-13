import type {
  RouteEstimate,
  RouteEstimateRequest,
  RouteWaypoint,
  RoutingProvider,
} from "./travel-preview.js";

const routesEndpoint = new URL("https://routes.googleapis.com/directions/v2:computeRoutes");
const fieldMask = "routes.duration,routes.distanceMeters";
const defaultRequestTimeoutMilliseconds = 15_000;
type ProviderFetch = (url: URL, init: RequestInit) => Promise<Response>;

export type GoogleRoutingErrorReason =
  | "invalid_configuration"
  | "http_error"
  | "network_error"
  | "no_route"
  | "invalid_estimate";

export class GoogleRoutingError extends Error {
  constructor(
    public readonly reason: GoogleRoutingErrorReason,
    public readonly statusCode?: number,
  ) {
    super(statusCode === undefined ? reason : `${reason}:${statusCode}`);
    this.name = "GoogleRoutingError";
  }
}

interface GoogleRoutingProviderOptions {
  fetch?: ProviderFetch;
  requestTimeoutMilliseconds?: number;
}

export class GoogleRoutingProvider implements RoutingProvider {
  private readonly fetch: ProviderFetch;
  private readonly requestTimeoutMilliseconds: number;

  constructor(
    private readonly apiKey: string,
    options: GoogleRoutingProviderOptions = {},
  ) {
    if (apiKey.trim().length === 0 || apiKey.length > 500) {
      throw new GoogleRoutingError("invalid_configuration");
    }
    const timeout = options.requestTimeoutMilliseconds ?? defaultRequestTimeoutMilliseconds;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new GoogleRoutingError("invalid_configuration");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    this.requestTimeoutMilliseconds = timeout;
  }

  async estimate(request: RouteEstimateRequest): Promise<RouteEstimate> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMilliseconds);
    try {
      const response = await this.fetch(routesEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify({
          origin: googleWaypoint(request.origin),
          destination: googleWaypoint(request.destination),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE_OPTIMAL",
          departureTime: request.departureTime.toISOString(),
          computeAlternativeRoutes: false,
          languageCode: "en-US",
          units: "IMPERIAL",
          trafficModel: request.trafficPreference === "pessimistic"
            ? "PESSIMISTIC"
            : "BEST_GUESS",
        }),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) throw new GoogleRoutingError("http_error", response.status);
      return extractRoute(await response.json() as unknown);
    } catch (error) {
      if (error instanceof GoogleRoutingError) throw error;
      throw new GoogleRoutingError("network_error");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function googleWaypoint(waypoint: RouteWaypoint): { placeId: string } | { address: string } {
  return waypoint.kind === "place_id"
    ? { placeId: waypoint.placeID }
    : { address: waypoint.address };
}

function extractRoute(payload: unknown): RouteEstimate {
  if (typeof payload !== "object" || payload === null) throw new GoogleRoutingError("no_route");
  const routes = (payload as Record<string, unknown>).routes;
  if (!Array.isArray(routes) || routes.length === 0) throw new GoogleRoutingError("no_route");
  const route = routes[0];
  if (typeof route !== "object" || route === null) throw new GoogleRoutingError("no_route");
  const candidate = route as Record<string, unknown>;
  const durationSeconds = parseDurationSeconds(candidate.duration);
  const distanceMeters = candidate.distanceMeters;
  if (!Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || typeof distanceMeters !== "number"
    || !Number.isFinite(distanceMeters)
    || distanceMeters <= 0) {
    throw new GoogleRoutingError("invalid_estimate");
  }
  return { durationSeconds, distanceMeters };
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  const match = /^(?:0|[1-9]\d*)(?:\.\d{1,9})?s$/.exec(value);
  return match ? Number(value.slice(0, -1)) : Number.NaN;
}
