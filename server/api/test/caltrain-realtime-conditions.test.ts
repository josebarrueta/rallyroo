import { describe, expect, it } from "vitest";
import { caltrainRealtimeConditions } from "../src/caltrain-realtime-conditions.js";

const catalog = [{
  id: "70171", stationID: "palo_alto", stationName: "Palo Alto",
  direction: "northbound" as const, latitude: 1, longitude: 1,
  validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z",
}];

describe("caltrainRealtimeConditions", () => {
  it("enriches trip delays from the directional catalog and provider timestamps", () => {
    const conditions = caltrainRealtimeConditions({
      tripUpdates: {
        observedAt: "2026-09-09T15:00:00Z", validUntil: "2026-09-09T15:03:00Z",
        trips: [{
          id: "entity-1", tripID: "trip-1", routeID: "L1", directionID: 0,
          startDate: null, startTime: null, status: "scheduled",
          stops: [{ stopID: "70171", stopSequence: 1, delaySeconds: 1200, eventTime: "2026-09-09T15:00:00Z" }],
        }],
      },
      serviceAlerts: { observedAt: "2026-09-09T15:00:00Z", validUntil: "2026-09-09T15:03:00Z", alerts: [] },
    }, catalog, new Date("2026-09-09T15:01:00Z"));
    expect(conditions).toEqual([expect.objectContaining({
      scope: "trip", id: expect.stringMatching(/^trip:[a-f0-9]{64}$/), routeID: "L1",
      directionID: "northbound", serviceWeekday: 3, scheduledMinutes: 460,
      kind: "delay", delayMinutes: 20,
    })]);
  });

  it("turns active route or stop disruptions into scoped conditions without guessing delay minutes", () => {
    const conditions = caltrainRealtimeConditions({
      tripUpdates: { observedAt: "2026-09-09T15:00:00Z", validUntil: "2026-09-09T15:03:00Z", trips: [] },
      serviceAlerts: {
        observedAt: "2026-09-09T15:00:00Z", validUntil: "2026-09-09T15:03:00Z",
        alerts: [{
          id: "alert-1", effect: "cancellation", cause: "maintenance", severity: "warning",
          activePeriods: [{ startsAt: "2026-09-09T14:00:00Z", endsAt: "2026-09-09T16:00:00Z" }],
          routeIDs: ["L1"], stopIDs: [], tripIDs: [], directionIDs: [],
          selectors: [{ routeID: "L1", stopID: null, tripID: null, directionID: null }],
          header: null, description: null,
        }],
      },
    }, catalog, new Date("2026-09-09T15:01:00Z"));
    expect(conditions).toEqual([expect.objectContaining({
      scope: "disruption", id: expect.stringMatching(/^alert:[a-f0-9]{64}$/), routeID: "L1",
      directionID: "*", stopIDs: [], kind: "cancellation", delayMinutes: 0,
    })]);
  });
});
