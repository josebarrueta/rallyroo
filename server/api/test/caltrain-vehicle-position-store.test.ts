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
  it("retains the last useful positions when a provider snapshot is temporarily empty", async () => {
    const store = new CachedCaltrainVehiclePositionStore(new InMemoryCache());

    await store.replace(snapshot);
    await store.replace({
      observedAt: "2026-09-21T14:01:55.000Z",
      validUntil: "2026-09-21T14:04:55.000Z",
      positions: [],
    });

    await expect(store.current()).resolves.toEqual(snapshot);
  });

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

    await writer.replaceVehiclePositions({
      observedAt: "2026-09-21T14:07:55.000Z",
      validUntil: "2026-09-21T14:10:55.000Z",
      positions: [],
    }, new Date("2026-09-21T14:08:00Z"));
    const stale = await reader.liveTrains(new Date("2026-09-21T14:08:30Z"));
    expect(stale.status.state).toBe("stale");
    expect(stale.positions).toEqual(snapshot.positions);
  });
});
