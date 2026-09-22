import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CachedLocationSearchProvider } from "../src/cached-location-search-provider.js";
import { CachedCaltrainVehiclePositionStore } from "../src/caltrain-vehicle-position-store.js";
import type { LocationSearchProvider } from "../src/location-search-provider.js";
import { RedisCache } from "../src/redis-cache.js";

const redisURL = process.env.INTEGRATION_REDIS_URL;

describe.skipIf(!redisURL)("Redis cache integration", () => {
  it("round trips JSON, deletes values, and expires TTLs", async () => {
    const cache = await RedisCache.connect(redisURL!);
    const prefix = `integration:${randomUUID()}`;
    const deletedKey = `${prefix}:deleted`;
    const expiringKey = `${prefix}:expiring`;
    try {
      await cache.set(deletedKey, { familyID: "family-1", roles: ["parent", "kid"] }, 30);
      expect(await cache.get(deletedKey)).toEqual({ familyID: "family-1", roles: ["parent", "kid"] });
      await cache.delete(deletedKey);
      expect(await cache.get(deletedKey)).toBeNull();

      await cache.set(expiringKey, ["soccer", "music"], 1);
      expect(await cache.get(expiringKey)).toEqual(["soccer", "music"]);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect(await cache.get(expiringKey)).toBeNull();
    } finally {
      await cache.delete(deletedKey);
      await cache.delete(expiringKey);
      await cache.close();
    }
  });

  it("serves live Caltrain positions through the production Redis read path", async () => {
    const cache = await RedisCache.connect(redisURL!);
    const store = new CachedCaltrainVehiclePositionStore(cache);
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
    try {
      await store.replace(snapshot);
      await expect(store.current()).resolves.toEqual(snapshot);
    } finally {
      await cache.delete("caltrain:vehicle-positions");
      await cache.close();
    }
  });

  it("falls through to the provider when Redis is unavailable", async () => {
    const cache = await RedisCache.connect(redisURL!);
    await cache.close();
    let searches = 0;
    const provider: LocationSearchProvider = {
      async search() {
        searches += 1;
        return [{ id: "place-1", address: "123 Main St, Springfield, IL, USA" }];
      },
    };
    const cached = new CachedLocationSearchProvider(provider, cache);

    const suggestions = await cached.search("123 Main");

    expect(suggestions).toHaveLength(1);
    expect(searches).toBe(1);
  });
});
