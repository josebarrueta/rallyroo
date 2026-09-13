import { describe, expect, it } from "vitest";
import {
  maxProviderCalls,
  minimumProviderDepartureLeadSeconds,
  previewDrivingTravel,
  TravelPreviewError,
  type Clock,
  type RouteEstimateRequest,
  type RoutingProvider,
  type TravelPreviewInput,
} from "../src/travel-preview.js";

const now = new Date("2026-08-01T09:00:00.000Z");
const clock: Clock = { now: () => now };

function input(overrides: Partial<TravelPreviewInput> = {}): TravelPreviewInput {
  return {
    origin: { address: "1 Market St, San Francisco, CA" },
    destination: { placeID: "ChIJ_destination" },
    arrivalTime: new Date("2026-08-01T12:00:00.000Z"),
    preparationMinutes: 30,
    trafficPreference: "best_guess",
    ...overrides,
  };
}

function fixedProvider(estimate = { durationSeconds: 1_532, distanceMeters: 48_200 }): {
  provider: RoutingProvider;
  requests: RouteEstimateRequest[];
} {
  const requests: RouteEstimateRequest[] = [];
  return {
    requests,
    provider: {
      async estimate(request) {
        requests.push(request);
        return estimate;
      },
    },
  };
}

describe("previewDrivingTravel", () => {
  it("converges, includes preparation, and reports generation attribution", async () => {
    const { provider, requests } = fixedProvider();
    const preview = await previewDrivingTravel(input(), provider, clock);

    expect(preview).toEqual({
      leaveTime: new Date("2026-08-01T11:04:28.000Z"),
      durationSeconds: 1_532,
      distanceMeters: 48_200,
      estimatedAt: now,
      leaveNow: false,
      provider: "google_routes",
      attribution: "Google Maps",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.departureTime).toEqual(new Date("2026-08-01T11:00:00.000Z"));
    expect(requests[1]!.departureTime).toEqual(new Date("2026-08-01T11:04:28.000Z"));
    expect(requests[0]!.origin).toEqual({
      kind: "address",
      address: "1 Market St, San Francisco, CA",
    });
    expect(requests[0]!.destination).toEqual({
      kind: "place_id",
      placeID: "ChIJ_destination",
    });
  });

  it("uses no more than three estimates when traffic does not converge", async () => {
    const durations = [1_000, 2_000, 1_500];
    let call = 0;
    const provider: RoutingProvider = {
      async estimate() {
        return { durationSeconds: durations[call++]!, distanceMeters: 1_000 };
      },
    };
    const preview = await previewDrivingTravel(input(), provider, clock);
    expect(call).toBe(maxProviderCalls);
    expect(preview.durationSeconds).toBe(1_500);
  });

  it("clamps provider departures into the future and reports leave now", async () => {
    const { provider, requests } = fixedProvider({ durationSeconds: 900, distanceMeters: 5_000 });
    const preview = await previewDrivingTravel(
      input({ arrivalTime: new Date("2026-08-01T09:05:00.000Z") }),
      provider,
      clock,
    );
    expect(preview.leaveTime).toEqual(new Date("2026-08-01T08:20:00.000Z"));
    expect(preview.leaveNow).toBe(true);
    expect(requests.every((request) => request.departureTime.getTime()
      === now.getTime() + minimumProviderDepartureLeadSeconds * 1_000)).toBe(true);
  });

  it("moves leave time by the preparation allowance", async () => {
    const short = await previewDrivingTravel(
      input({ preparationMinutes: 10 }), fixedProvider({ durationSeconds: 1_200, distanceMeters: 1_000 }).provider, clock,
    );
    const long = await previewDrivingTravel(
      input({ preparationMinutes: 30 }), fixedProvider({ durationSeconds: 1_200, distanceMeters: 1_000 }).provider, clock,
    );
    expect(long.leaveTime.getTime() - short.leaveTime.getTime()).toBe(-20 * 60 * 1_000);
  });

  it.each([
    { origin: {} },
    { origin: { address: " " } },
    { origin: { address: "secret", placeID: "also-secret" } },
    { destination: { placeID: " ", address: " " } },
  ])("rejects invalid waypoints without leaking them", async (override) => {
    const { provider, requests } = fixedProvider();
    let caught: unknown;
    try {
      await previewDrivingTravel(input(override), provider, clock);
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(new TravelPreviewError("invalid_waypoint"));
    expect(String(caught)).not.toContain("secret");
    expect(requests).toHaveLength(0);
  });

  it.each([-1, 181, 1.5, Number.NaN])("rejects invalid preparation %s", async (value) => {
    await expect(previewDrivingTravel(
      input({ preparationMinutes: value }), fixedProvider().provider, clock,
    )).rejects.toEqual(new TravelPreviewError("invalid_preparation"));
  });

  it("rejects invalid dates, traffic preferences, and clocks", async () => {
    await expect(previewDrivingTravel(
      input({ arrivalTime: new Date("invalid") }), fixedProvider().provider, clock,
    )).rejects.toEqual(new TravelPreviewError("invalid_arrival_time"));
    await expect(previewDrivingTravel(
      input({ trafficPreference: "fast" as never }), fixedProvider().provider, clock,
    )).rejects.toEqual(new TravelPreviewError("invalid_traffic_preference"));
    await expect(previewDrivingTravel(
      input(), fixedProvider().provider, { now: () => new Date("invalid") },
    )).rejects.toEqual(new TravelPreviewError("invalid_clock"));
  });

  it.each([
    { durationSeconds: 0, distanceMeters: 1 },
    { durationSeconds: Number.NaN, distanceMeters: 1 },
    { durationSeconds: 1, distanceMeters: 0 },
    { durationSeconds: 1, distanceMeters: Number.POSITIVE_INFINITY },
  ])("rejects invalid estimates without leaking waypoints", async (estimate) => {
    await expect(previewDrivingTravel(
      input(), fixedProvider(estimate).provider, clock,
    )).rejects.toEqual(new TravelPreviewError("invalid_estimate"));
  });
});
