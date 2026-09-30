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
