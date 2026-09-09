import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import { decodeCaltrainServiceAlerts } from "../src/sf511-service-alerts.js";

const { transit_realtime: gtfs } = GtfsRealtimeBindings;

function encode(value: Record<string, unknown>): Uint8Array {
  return gtfs.FeedMessage.encode(gtfs.FeedMessage.fromObject(value)).finish();
}

describe("decodeCaltrainServiceAlerts", () => {
  it("normalizes effect, active periods, selectors, and bounded English text", () => {
    const body = encode({
      header: { gtfsRealtimeVersion: "2.0", timestamp: 1_788_966_000 },
      entity: [{
        id: "alert-1",
        alert: {
          cause: "MAINTENANCE",
          effect: "NO_SERVICE",
          severityLevel: "SEVERE",
          activePeriod: [{ start: 1_788_962_400, end: 1_788_969_600 }],
          informedEntity: [
            { agencyId: "CT", routeId: "L1", directionId: 0 },
            { agencyId: "CT", stopId: "70171" },
          ],
          headerText: { translation: [
            { text: "Servicio cancelado", language: "es" },
            { text: "Service canceled", language: "en" },
          ] },
          descriptionText: { translation: [{ text: "Use alternate transportation.", language: "en" }] },
        },
      }],
    });

    expect(decodeCaltrainServiceAlerts(body)).toEqual({
      observedAt: "2026-09-09T15:00:00.000Z",
      validUntil: "2026-09-09T15:03:00.000Z",
      alerts: [{
        id: "alert-1",
        effect: "cancellation",
        cause: "maintenance",
        severity: "severe",
        activePeriods: [{
          startsAt: "2026-09-09T14:00:00.000Z",
          endsAt: "2026-09-09T16:00:00.000Z",
        }],
        routeIDs: ["L1"],
        stopIDs: ["70171"],
        tripIDs: [],
        directionIDs: [0],
        selectors: [
          { routeID: "L1", stopID: null, tripID: null, directionID: 0 },
          { routeID: null, stopID: "70171", tripID: null, directionID: null },
        ],
        header: "Service canceled",
        description: "Use alternate transportation.",
      }],
    });
  });

  it("accepts a valid empty feed and rejects malformed alert entities", () => {
    const empty = encode({
      header: { gtfsRealtimeVersion: "1.0", timestamp: 1_788_966_000 },
      entity: [],
    });
    expect(decodeCaltrainServiceAlerts(empty).alerts).toEqual([]);

    const invalid = encode({
      header: { gtfsRealtimeVersion: "1.0", timestamp: 1_788_966_000 },
      entity: [{ id: "missing-alert" }],
    });
    expect(() => decodeCaltrainServiceAlerts(invalid))
      .toThrow("Invalid Caltrain Service Alerts feed");
  });
});
