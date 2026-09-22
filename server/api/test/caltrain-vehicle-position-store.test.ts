import { describe, expect, it } from "vitest";
import { InMemoryCache } from "../src/cache.js";
import { CachedCaltrainVehiclePositionStore } from "../src/caltrain-vehicle-position-store.js";
import { CommuterModule } from "../src/commuter-module.js";
import { InMemoryCommuterRepository } from "../src/in-memory-commuter-repository.js";

const attemptedAt = new Date("2026-09-21T14:00:00Z");
const snapshot = {
  observedAt: "2026-09-21T13:59:55.000Z",
  validUntil: "2026-09-21T14:02:55.000Z",
  positions: [{
    id: "vehicle-1",
    tripID: "train-7",
    routeID: "CT",
    directionID: 1,
    latitude: 37.5,
    longitude: -122.2,
    bearing: 350,
    currentStopID: "stop-1",
    currentStopSequence: 3,
    status: "IN_TRANSIT_TO",
    timestamp: "2026-09-21T13:59:55.000Z",
  }],
};

describe("CachedCaltrainVehiclePositionStore", () => {
  it("provides the production cache write-to-read path without PostgreSQL storage", async () => {
    const repository = new InMemoryCommuterRepository();
    Object.assign(repository, {
      replaceCaltrainVehiclePositions: undefined,
      caltrainVehiclePositions: undefined,
    });
    const store = new CachedCaltrainVehiclePositionStore(new InMemoryCache());
    const writer = new CommuterModule(repository, store);
    const reader = new CommuterModule(repository, store);

    await writer.replaceVehiclePositions(snapshot, attemptedAt);
    const live = await reader.liveTrains(new Date("2026-09-21T14:00:30Z"));

    expect(live.status.state).toBe("healthy");
    expect(live.observedAt).toBe(snapshot.observedAt);
    expect(live.positions).toEqual(snapshot.positions);
  });
});
