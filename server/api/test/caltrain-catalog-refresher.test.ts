import { describe, expect, it } from "vitest";
import { CaltrainCatalogRefresher } from "../src/caltrain-catalog-refresher.js";
import { CommuterModule } from "../src/commuter-module.js";
import { InMemoryCommuterRepository } from "../src/in-memory-commuter-repository.js";
import { SF511ProviderError } from "../src/sf511-client.js";

const validBody = JSON.stringify({
  Contents: {
    ResponseTimestamp: "2026-09-09T07:00:00Z",
    dataObjects: {
      ScheduledStopPoint: [{
        id: "70171",
        Extensions: {
          ParentStation: "palo_alto",
          ValidBetween: {
            FromDate: "2026-01-31T00:00:00-08:00",
            ToDate: "2027-01-31T23:59:00-08:00",
          },
        },
        Name: "Palo Alto Caltrain Station Northbound",
        Location: { Longitude: "-122.1649", Latitude: "37.443" },
      }],
    },
  },
});

describe("CaltrainCatalogRefresher", () => {
  it("atomically replaces the catalog and records provider success", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    const refresher = new CaltrainCatalogRefresher(
      { stops: async () => new TextEncoder().encode(validBody) },
      module,
    );

    await refresher.refresh(new Date("2026-09-09T07:01:00Z"));

    const catalog = await module.catalog(new Date("2026-09-09T07:01:00Z"));
    expect(catalog.status.state).toBe("healthy");
    expect(catalog.stops).toEqual([
      expect.objectContaining({ id: "70171", stationName: "Palo Alto" }),
    ]);
  });

  it("marks a failed attempt while preserving the last-good catalog", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    let body = validBody;
    const refresher = new CaltrainCatalogRefresher(
      { stops: async () => new TextEncoder().encode(body) },
      module,
    );
    await refresher.refresh(new Date("2026-09-09T07:01:00Z"));
    body = "{}";

    await expect(refresher.refresh(new Date("2026-09-09T08:01:00Z"))).rejects.toThrow();

    const catalog = await module.catalog(new Date("2026-09-09T08:01:00Z"));
    expect(catalog.status.state).toBe("degraded");
    expect(catalog.stops.map((stop) => stop.id)).toEqual(["70171"]);
  });

  it("preserves provider throttle metadata for the polling scheduler", async () => {
    const providerError = new SF511ProviderError("http_error", 429, 300);
    const refresher = new CaltrainCatalogRefresher(
      { stops: async () => { throw providerError; } },
      new CommuterModule(new InMemoryCommuterRepository()),
    );

    let caught: unknown;
    try {
      await refresher.refresh(new Date("2026-09-09T07:01:00Z"));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBe(providerError);
  });
});
