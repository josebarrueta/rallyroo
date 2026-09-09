import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import { decodeCaltrainTripUpdates } from "../src/sf511-gtfs-realtime.js";

const { transit_realtime: gtfs } = GtfsRealtimeBindings;

function encodeFeed(value: Record<string, unknown>): Uint8Array {
  const message = gtfs.FeedMessage.fromObject(value);
  return gtfs.FeedMessage.encode(message).finish();
}

describe("decodeCaltrainTripUpdates", () => {
  it("normalizes trip updates without requiring the optional start_date", () => {
    const body = encodeFeed({
      header: { gtfsRealtimeVersion: "1.0", timestamp: 1_788_966_000 },
      entity: [{
        id: "entity-1",
        tripUpdate: {
          trip: { tripId: "trip-1", routeId: "L1", directionId: 0 },
          stopTimeUpdate: [{
            stopSequence: 1,
            stopId: "70171",
            arrival: { delay: 1_200, time: 1_788_966_000 },
          }, {
            stopSequence: 2,
            stopId: "70011",
            arrival: { delay: 1_200, time: 1_788_967_800 },
          }],
        },
      }],
    });

    expect(decodeCaltrainTripUpdates(body)).toEqual({
      observedAt: "2026-09-09T15:00:00.000Z",
      validUntil: "2026-09-09T15:03:00.000Z",
      trips: [{
        id: "entity-1",
        tripID: "trip-1",
        routeID: "L1",
        directionID: 0,
        startDate: null,
        startTime: null,
        status: "scheduled",
        stops: [{ stopID: "70171", stopSequence: 1, delaySeconds: 1_200, eventTime: "2026-09-09T15:00:00.000Z" },
          { stopID: "70011", stopSequence: 2, delaySeconds: 1_200, eventTime: "2026-09-09T15:30:00.000Z" }],
      }],
    });
  });

  it("normalizes canceled trips and rejects empty or malformed feeds", () => {
    const canceled = encodeFeed({
      header: { gtfsRealtimeVersion: "2.0", timestamp: 1_788_966_000 },
      entity: [{
        id: "cancel-1",
        tripUpdate: {
          trip: {
            tripId: "trip-2",
            routeId: "L2",
            startDate: "20260909",
            scheduleRelationship: "CANCELED",
          },
        },
      }],
    });
    expect(decodeCaltrainTripUpdates(canceled).trips[0]).toMatchObject({
      id: "cancel-1",
      startDate: "20260909",
      status: "canceled",
      stops: [],
    });
    expect(() => decodeCaltrainTripUpdates(new Uint8Array()))
      .toThrow("Invalid Caltrain Trip Updates feed");
  });
});
