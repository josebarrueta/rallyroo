import { exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { InMemoryCache } from "../src/cache.js";
import { AppleWeatherKitDayBriefProvider } from "../src/apple-weatherkit-day-brief-provider.js";
import type { SavedPlace } from "../src/travel-planning.js";

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: "home", familyID: "family", ownerMemberID: null, visibility: "family",
    label: "Home", waypoint: { coordinates: { latitude: 37.3, longitude: -122 } },
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function configuration(fetch: typeof globalThis.fetch, places = [place()]) {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return {
    repository: { async savedPlacesForFamily() { return places; } },
    cache: new InMemoryCache(),
    teamID: "ABCDE12345",
    serviceID: "dev.rallyroo.weatherkit",
    keyID: "12345ABCDE",
    privateKey: await exportPKCS8(privateKey),
    googlePlacesAPIKey: "places-key",
    fetch,
    now: () => new Date("2026-10-05T14:00:00Z"),
  };
}

function weatherResponse() {
  return {
    forecastDaily: {
      metadata: { attributionURL: "https://weather.example/legal" },
      days: [{
        forecastStart: "2026-10-05T07:00:00Z", conditionCode: "MostlyClear",
        temperatureMin: 12, temperatureMax: 24, precipitationChance: 0.1,
      }],
    },
    forecastHourly: {
      hours: [
        { forecastStart: "2026-10-05T16:00:00Z", temperature: 13 },
        { forecastStart: "2026-10-05T21:00:00Z", temperature: 22 },
      ],
    },
  };
}

describe("AppleWeatherKitDayBriefProvider", () => {
  it("reuses Home coordinates across Members and forecast days, then refreshes after 24 hours", async () => {
    let placesCalls = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (new URL(input.toString()).hostname === "places.googleapis.com") {
        placesCalls += 1;
        return Response.json({ location: { latitude: 37.3, longitude: -122 } });
      }
      return Response.json(weatherResponse());
    });
    const config = await configuration(fetch, [place({ waypoint: { placeID: "home-id" } })]);
    const provider = new AppleWeatherKitDayBriefProvider(config);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-05T00:00:00Z"));
    try {
      await provider.forecast("family", "parent", "2026-10-05", "UTC");
      // A new provider shares the cache, as API processes do with Redis.
      await new AppleWeatherKitDayBriefProvider(config)
        .forecast("family", "other-parent", "2026-10-05", "UTC");
      await provider.forecast("family", "parent", "2026-10-06", "UTC");
      expect(placesCalls).toBe(1);
      clock.mockReturnValue(Date.parse("2026-10-06T00:00:00Z"));
      await provider.forecast("family", "parent", "2026-10-06", "UTC");
      expect(placesCalls).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    [{ placeID: "home-id" }, { placeID: "new-home-id" }],
    [{ address: "123 Main Street" }, { address: "456 Oak Street" }],
  ])("invalidates cached coordinates when Home changes from %j to %j", async (original, changed) => {
    let placesCalls = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      if (url.hostname === "places.googleapis.com") {
        placesCalls += 1;
        const location = { latitude: 37.3, longitude: -122 };
        return Response.json(url.pathname.endsWith(":searchText")
          ? { places: [{ location }] } : { location });
      }
      return Response.json(weatherResponse());
    });
    const home = place({ waypoint: original });
    const provider = new AppleWeatherKitDayBriefProvider(await configuration(fetch, [home]));
    await provider.forecast("family", "parent", "2026-10-05", "UTC");
    await provider.forecast("family", "parent", "2026-10-05", "UTC");
    expect(placesCalls).toBe(1);
    home.waypoint = changed;
    await provider.forecast("family", "parent", "2026-10-05", "UTC");
    expect(placesCalls).toBe(2);
  });

  it("still resolves Home and returns weather when the optional cache is unavailable", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) =>
      Response.json(new URL(input.toString()).hostname === "places.googleapis.com"
        ? { location: { latitude: 37.3, longitude: -122 } } : weatherResponse()));
    const config = await configuration(fetch, [place({ waypoint: { placeID: "home-id" } })]);
    vi.spyOn(config.cache, "get").mockRejectedValue(new Error("cache unavailable"));
    vi.spyOn(config.cache, "set").mockRejectedValue(new Error("cache unavailable"));
    const provider = new AppleWeatherKitDayBriefProvider(config);
    expect(await provider.forecast("family", "parent", "2026-10-05", "UTC"))
      .toMatchObject({ conditionCode: "MostlyClear" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns a bounded forecast for an accessible saved Home", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      expect(url.hostname).toBe("weatherkit.apple.com");
      expect(url.searchParams.get("dataSets")).toBe("forecastHourly,forecastDaily");
      const token = String((init?.headers as Record<string, string>).Authorization).replace("Bearer ", "");
      const [encodedHeader, encodedClaims] = token.split(".");
      expect(JSON.parse(Buffer.from(encodedHeader!, "base64url").toString())).toMatchObject({
        alg: "ES256", kid: "12345ABCDE", id: "ABCDE12345.dev.rallyroo.weatherkit",
      });
      expect(JSON.parse(Buffer.from(encodedClaims!, "base64url").toString())).toMatchObject({
        iss: "ABCDE12345", sub: "dev.rallyroo.weatherkit",
      });
      return Response.json(weatherResponse());
    });
    const provider = new AppleWeatherKitDayBriefProvider(await configuration(fetch));

    await expect(provider.forecast(
      "family", "parent", "2026-10-05", "America/Los_Angeles",
    )).resolves.toEqual({
      source: "apple_weather",
      locationLabel: "Home",
      conditionCode: "MostlyClear",
      lowTemperatureCelsius: 12,
      highTemperatureCelsius: 24,
      morningTemperatureCelsius: 13,
      afternoonTemperatureCelsius: 22,
      precipitationChance: 0.1,
      attribution: { serviceName: "Weather", legalPageURL: "https://weather.example/legal" },
    });
  });

  it("does not use another Member's personal Home", async () => {
    const fetch = vi.fn();
    const provider = new AppleWeatherKitDayBriefProvider(await configuration(fetch, [place({
      ownerMemberID: "other", visibility: "personal",
    })]));

    await expect(provider.forecast("family", "parent", "2026-10-05", "UTC"))
      .resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves a Home place ID without sending its address to WeatherKit", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      if (url.hostname === "places.googleapis.com") {
        expect(url.pathname).toContain("home-place-id");
        return Response.json({ location: { latitude: 37.3, longitude: -122 } });
      }
      expect(url.hostname).toBe("weatherkit.apple.com");
      expect(url.pathname).toContain("/37.3/-122");
      return Response.json(weatherResponse());
    });
    const provider = new AppleWeatherKitDayBriefProvider(await configuration(fetch, [place({
      waypoint: { placeID: "home-place-id" },
    })]));

    expect(await provider.forecast("family", "parent", "2026-10-05", "America/Los_Angeles"))
      .not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
