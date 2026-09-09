import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import { CaltrainRealtimeRefresher } from "../src/caltrain-realtime-refresher.js";
import { CommuterModule } from "../src/commuter-module.js";
import { InMemoryCommuterRepository } from "../src/in-memory-commuter-repository.js";

const { transit_realtime: gtfs } = GtfsRealtimeBindings;
const emptyHealthyFeed = gtfs.FeedMessage.encode(gtfs.FeedMessage.fromObject({
  header: { gtfsRealtimeVersion: "1.0", timestamp: 1_788_966_000 },
  entity: [],
})).finish();

describe("CaltrainRealtimeRefresher", () => {
  it("treats an empty valid feed as healthy and malformed data as degraded", async () => {
    const commuter = new CommuterModule(new InMemoryCommuterRepository());
    let body = emptyHealthyFeed;
    const refresher = new CaltrainRealtimeRefresher({ tripUpdates: async () => body }, commuter);

    await expect(refresher.refresh(new Date("2026-09-09T15:00:01Z")))
      .resolves.toMatchObject({ trips: [] });
    expect((await commuter.providerStatus(new Date("2026-09-09T15:00:01Z"))).realtime.state)
      .toBe("healthy");

    body = new Uint8Array();
    await expect(refresher.refresh(new Date("2026-09-09T15:01:00Z"))).rejects.toThrow();
    expect((await commuter.providerStatus(new Date("2026-09-09T15:01:00Z"))).realtime.state)
      .toBe("degraded");
  });
});
