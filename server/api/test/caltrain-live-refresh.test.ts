import { describe, expect, it, vi } from "vitest";
import { InMemoryCache } from "../src/cache.js";
import { CaltrainLiveRefresh } from "../src/caltrain-live-refresh.js";
import { CachedCaltrainVehiclePositionStore } from "../src/caltrain-vehicle-position-store.js";

const snapshotAt = (observedAt: string) => ({
  observedAt,
  validUntil: new Date(Date.parse(observedAt) + 3 * 60 * 1_000).toISOString(),
  positions: [],
});

describe("CaltrainLiveRefresh", () => {
  it("refreshes a stale snapshot when a viewer opens Live Trains and records demand", async () => {
    const cache = new InMemoryCache();
    const store = new CachedCaltrainVehiclePositionStore(cache);
    await store.replace(snapshotAt("2026-09-21T16:50:00.000Z"));
    const refresh = vi.fn(async (now: Date) => {
      await store.replace(snapshotAt(now.toISOString()));
    });
    const live = new CaltrainLiveRefresh(cache, store, refresh);
    const now = new Date("2026-09-21T17:00:00.000Z");

    await live.request(now);

    expect(refresh).toHaveBeenCalledWith(now);
    await expect(live.viewerDemandIsActive(now)).resolves.toBe(true);
  });

  it("reuses a snapshot fetched less than two minutes ago", async () => {
    const cache = new InMemoryCache();
    const store = new CachedCaltrainVehiclePositionStore(cache);
    await store.replace(snapshotAt("2026-09-21T16:59:00.000Z"));
    const refresh = vi.fn(async () => undefined);
    const live = new CaltrainLiveRefresh(cache, store, refresh);

    await live.request(new Date("2026-09-21T17:00:00.000Z"));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("rate limits repeated manual refreshes to one attempt every two minutes", async () => {
    const cache = new InMemoryCache();
    const store = new CachedCaltrainVehiclePositionStore(cache);
    const refresh = vi.fn(async () => undefined);
    const live = new CaltrainLiveRefresh(cache, store, refresh);

    await live.force(new Date("2026-09-21T17:00:00.000Z"));
    await live.force(new Date("2026-09-21T17:01:59.000Z"));
    await live.force(new Date("2026-09-21T17:02:00.000Z"));

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("rate limits stale viewer requests after a failed provider call", async () => {
    const cache = new InMemoryCache();
    const store = new CachedCaltrainVehiclePositionStore(cache);
    await store.replace(snapshotAt("2026-09-21T16:30:00.000Z"));
    const refresh = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const live = new CaltrainLiveRefresh(cache, store, refresh);

    await expect(live.request(new Date("2026-09-21T17:00:00.000Z"))).rejects.toThrow();
    await live.request(new Date("2026-09-21T17:01:00.000Z"));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(live.lastRefreshAttempt()!.toISOString()).toBe("2026-09-21T17:00:00.000Z");
  });
});
