import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it, vi } from "vitest";
import { CaltrainVehiclePositionRefresher } from "../src/caltrain-vehicle-position-refresher.js";

const { transit_realtime: gtfs } = GtfsRealtimeBindings;

const encode = (value: Record<string, unknown>): Uint8Array => (
  gtfs.FeedMessage.encode(gtfs.FeedMessage.fromObject(value)).finish()
);

describe("CaltrainVehiclePositionRefresher", () => {
  it("caches every live train even when no subscribed journey is active", async () => {
    const body = encode({
      header: { gtfsRealtimeVersion: "2.0", timestamp: 1_789_998_000 },
      entity: [
        vehicle("tracked", "train-7", 37.5, -122.2),
        vehicle("other", "train-9", 37.7, -122.4),
      ],
    });
    const replaceVehiclePositions = vi.fn(async () => undefined);
    const refresher = new CaltrainVehiclePositionRefresher(
      { vehiclePositions: async () => body },
      { replaceVehiclePositions } as never,
    );

    const result = await refresher.refresh(new Date("2026-09-21T14:00:00Z"));

    expect(result.positions.map((position) => position.tripID)).toEqual(["train-7", "train-9"]);
    expect(replaceVehiclePositions).toHaveBeenCalledWith(
      expect.objectContaining({
        positions: [
          expect.objectContaining({ tripID: "train-7" }),
          expect.objectContaining({ tripID: "train-9" }),
        ],
      }),
      new Date("2026-09-21T14:00:00Z"),
    );
  });
});

function vehicle(id: string, tripID: string, latitude: number, longitude: number) {
  return {
    id,
    vehicle: {
      trip: { tripId: tripID, routeId: "CT" },
      position: { latitude, longitude },
      timestamp: 1_789_998_000,
    },
  };
}
