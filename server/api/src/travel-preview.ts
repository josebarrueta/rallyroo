export type TrafficPreference = "best_guess" | "pessimistic";
export type TravelProviderAttribution = "google_routes";

export interface TravelWaypoint {
  placeID?: string;
  address?: string;
}

export type RouteWaypoint =
  | { kind: "place_id"; placeID: string }
  | { kind: "address"; address: string };

export interface TravelPreviewInput {
  origin: TravelWaypoint;
  destination: TravelWaypoint;
  arrivalTime: Date;
  preparationMinutes: number;
  trafficPreference: TrafficPreference;
}

export interface RouteEstimateRequest {
  origin: RouteWaypoint;
  destination: RouteWaypoint;
  departureTime: Date;
  trafficPreference: TrafficPreference;
}

export interface RouteEstimate {
  durationSeconds: number;
  distanceMeters: number;
}

export interface RoutingProvider {
  estimate(request: RouteEstimateRequest): Promise<RouteEstimate>;
}

export class RoutingUnavailableError extends Error {
  constructor() {
    super("routing_unavailable");
    this.name = "RoutingUnavailableError";
  }
}

export class UnavailableRoutingProvider implements RoutingProvider {
  async estimate(): Promise<RouteEstimate> {
    throw new RoutingUnavailableError();
  }
}

export interface TravelPreview {
  leaveTime: Date;
  durationSeconds: number;
  distanceMeters: number;
  estimatedAt: Date;
  leaveNow: boolean;
  provider: TravelProviderAttribution;
  attribution: "Google Maps";
}

export interface Clock {
  now(): Date;
}

const systemClock: Clock = { now: () => new Date() };
export const initialDurationSeconds = 30 * 60;
export const maxProviderCalls = 3;
export const convergenceThresholdSeconds = 60;
export const minimumProviderDepartureLeadSeconds = 60;

export type TravelPreviewFailureReason =
  | "invalid_waypoint"
  | "invalid_arrival_time"
  | "invalid_preparation"
  | "invalid_traffic_preference"
  | "invalid_estimate"
  | "invalid_clock";

export class TravelPreviewError extends Error {
  constructor(public readonly reason: TravelPreviewFailureReason) {
    super(reason);
    this.name = "TravelPreviewError";
  }
}

export async function previewDrivingTravel(
  input: TravelPreviewInput,
  provider: RoutingProvider,
  clock: Clock = systemClock,
): Promise<TravelPreview> {
  const origin = resolveWaypoint(input.origin);
  const destination = resolveWaypoint(input.destination);
  const arrivalMilliseconds = validDateMilliseconds(input.arrivalTime, "invalid_arrival_time");
  if (!Number.isInteger(input.preparationMinutes)
    || input.preparationMinutes < 0
    || input.preparationMinutes > 180) {
    throw new TravelPreviewError("invalid_preparation");
  }
  if (input.trafficPreference !== "best_guess" && input.trafficPreference !== "pessimistic") {
    throw new TravelPreviewError("invalid_traffic_preference");
  }

  const estimatedAt = new Date(validDateMilliseconds(clock.now(), "invalid_clock"));
  const nowMilliseconds = estimatedAt.getTime();
  const earliestProviderDeparture = nowMilliseconds + minimumProviderDepartureLeadSeconds * 1_000;
  const preparationMilliseconds = input.preparationMinutes * 60 * 1_000;
  let previousDurationSeconds = initialDurationSeconds;
  let estimate: RouteEstimate | undefined;

  for (let call = 0; call < maxProviderCalls; call += 1) {
    const proposedDeparture = arrivalMilliseconds
      - preparationMilliseconds
      - previousDurationSeconds * 1_000;
    estimate = await provider.estimate({
      origin,
      destination,
      departureTime: new Date(Math.max(earliestProviderDeparture, proposedDeparture)),
      trafficPreference: input.trafficPreference,
    });
    validateEstimate(estimate);
    const movementSeconds = Math.abs(estimate.durationSeconds - previousDurationSeconds);
    previousDurationSeconds = estimate.durationSeconds;
    if (movementSeconds <= convergenceThresholdSeconds) break;
  }

  if (!estimate) throw new TravelPreviewError("invalid_estimate");
  const leaveTime = new Date(
    arrivalMilliseconds - preparationMilliseconds - estimate.durationSeconds * 1_000,
  );
  return {
    leaveTime,
    durationSeconds: estimate.durationSeconds,
    distanceMeters: estimate.distanceMeters,
    estimatedAt,
    leaveNow: leaveTime.getTime() <= nowMilliseconds,
    provider: "google_routes",
    attribution: "Google Maps",
  };
}

function resolveWaypoint(waypoint: TravelWaypoint): RouteWaypoint {
  const placeID = typeof waypoint.placeID === "string" ? waypoint.placeID.trim() : "";
  const address = typeof waypoint.address === "string" ? waypoint.address.trim() : "";
  if ((placeID.length > 0) === (address.length > 0)
    || placeID.length > 500
    || address.length > 500) {
    throw new TravelPreviewError("invalid_waypoint");
  }
  return placeID.length > 0
    ? { kind: "place_id", placeID }
    : { kind: "address", address };
}

function validDateMilliseconds(
  value: unknown,
  reason: "invalid_arrival_time" | "invalid_clock",
): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TravelPreviewError(reason);
  }
  return value.getTime();
}

function validateEstimate(estimate: unknown): asserts estimate is RouteEstimate {
  if (typeof estimate !== "object" || estimate === null) {
    throw new TravelPreviewError("invalid_estimate");
  }
  const candidate = estimate as Partial<RouteEstimate>;
  if (!Number.isFinite(candidate.durationSeconds)
    || (candidate.durationSeconds ?? 0) <= 0
    || !Number.isFinite(candidate.distanceMeters)
    || (candidate.distanceMeters ?? 0) <= 0) {
    throw new TravelPreviewError("invalid_estimate");
  }
}
