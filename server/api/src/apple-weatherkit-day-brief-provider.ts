import { createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import type { Cache } from "./cache.js";
import type { DayBriefWeatherFact, DayBriefWeatherProvider } from "./day-brief.js";
import type { SavedPlace, TravelPlanningRepository } from "./travel-planning.js";
import type { TravelWaypoint } from "./travel-preview.js";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface Configuration {
  repository: Pick<TravelPlanningRepository, "savedPlacesForFamily">;
  cache: Cache;
  teamID: string;
  serviceID: string;
  keyID: string;
  privateKey: string;
  googlePlacesAPIKey?: string;
  fetch?: Fetch;
  now?: () => Date;
}

const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const weatherSchema = z.object({
  forecastDaily: z.object({
    metadata: z.object({ attributionURL: z.string().url().optional() }).passthrough(),
    days: z.array(z.object({
      forecastStart: z.string(),
      conditionCode: z.string().min(1),
      temperatureMin: z.number(),
      temperatureMax: z.number(),
      precipitationChance: z.number().min(0).max(1),
    }).passthrough()),
  }).passthrough(),
  forecastHourly: z.object({
    hours: z.array(z.object({
      forecastStart: z.string(),
      temperature: z.number(),
    }).passthrough()),
  }).passthrough(),
});

export class AppleWeatherKitDayBriefProvider implements DayBriefWeatherProvider {
  private readonly fetch: Fetch;
  private readonly now: () => Date;
  private readonly keyPromise;

  constructor(private readonly configuration: Configuration) {
    this.fetch = configuration.fetch ?? globalThis.fetch;
    this.now = configuration.now ?? (() => new Date());
    this.keyPromise = importPKCS8(configuration.privateKey, "ES256");
  }

  async forecast(
    familyID: string,
    memberID: string,
    localDate: string,
    timeZone: string,
  ): Promise<DayBriefWeatherFact | null> {
    const home = selectHome(
      await this.configuration.repository.savedPlacesForFamily(familyID), memberID,
    );
    if (!home) return null;
    const coordinate = await this.coordinate(home.waypoint);
    if (!coordinate) return null;
    const cacheKey = `day-brief-weather:v1:${createHash("sha256").update(
      `${coordinate.latitude.toFixed(3)},${coordinate.longitude.toFixed(3)}:${localDate}:${timeZone}`,
    ).digest("hex")}`;
    try {
      const cached = await this.configuration.cache.get<DayBriefWeatherFact>(cacheKey);
      if (cached) return cached;
    } catch { /* Weather remains available when the optional cache is unavailable. */ }

    const token = await this.developerToken();
    const url = new URL(
      `/api/v1/weather/en-US/${coordinate.latitude}/${coordinate.longitude}`,
      "https://weatherkit.apple.com",
    );
    url.searchParams.set("dataSets", "forecastHourly,forecastDaily");
    url.searchParams.set("timezone", timeZone);
    const response = await this.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("weatherkit_unavailable");
    const payload = weatherSchema.parse(await response.json());
    const day = payload.forecastDaily.days.find(
      (candidate) => localDateFor(candidate.forecastStart, timeZone) === localDate,
    );
    if (!day) return null;
    const localHours = payload.forecastHourly.hours.filter(
      (hour) => localDateFor(hour.forecastStart, timeZone) === localDate,
    );
    const fact: DayBriefWeatherFact = {
      source: "apple_weather",
      locationLabel: "Home",
      conditionCode: day.conditionCode,
      lowTemperatureCelsius: day.temperatureMin,
      highTemperatureCelsius: day.temperatureMax,
      ...averageTemperature(localHours, timeZone, 6, 12, "morningTemperatureCelsius"),
      ...averageTemperature(localHours, timeZone, 12, 17, "afternoonTemperatureCelsius"),
      precipitationChance: day.precipitationChance,
      attribution: {
        serviceName: "Weather",
        legalPageURL: payload.forecastDaily.metadata.attributionURL
          ?? "https://developer.apple.com/weatherkit/data-source-attribution/",
      },
    };
    try {
      await this.configuration.cache.set(cacheKey, fact, 6 * 60 * 60);
    } catch { /* A successful forecast does not depend on cache population. */ }
    return fact;
  }

  private async developerToken(): Promise<string> {
    const issuedAt = Math.floor(this.now().getTime() / 1_000);
    return new SignJWT({})
      .setProtectedHeader({
        alg: "ES256",
        kid: this.configuration.keyID,
        id: `${this.configuration.teamID}.${this.configuration.serviceID}`,
      })
      .setIssuer(this.configuration.teamID)
      .setSubject(this.configuration.serviceID)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 5 * 60)
      .sign(await this.keyPromise);
  }

  private async coordinate(waypoint: TravelWaypoint): Promise<z.infer<typeof coordinateSchema> | null> {
    if (waypoint.coordinates) return coordinateSchema.parse(waypoint.coordinates);
    if (!this.configuration.googlePlacesAPIKey) return null;
    if (waypoint.placeID) {
      const url = new URL(`/v1/places/${encodeURIComponent(waypoint.placeID)}`, "https://places.googleapis.com");
      const response = await this.fetch(url, {
        headers: {
          "X-Goog-Api-Key": this.configuration.googlePlacesAPIKey,
          "X-Goog-FieldMask": "location",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("home_location_unavailable");
      return coordinateSchema.parse(z.object({ location: coordinateSchema }).parse(
        await response.json(),
      ).location);
    }
    if (waypoint.address) {
      const response = await this.fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.configuration.googlePlacesAPIKey,
          "X-Goog-FieldMask": "places.location",
        },
        body: JSON.stringify({ textQuery: waypoint.address, maxResultCount: 1 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("home_location_unavailable");
      const parsed = z.object({ places: z.array(z.object({ location: coordinateSchema })) })
        .parse(await response.json());
      return parsed.places[0]?.location ?? null;
    }
    return null;
  }
}

function selectHome(places: readonly SavedPlace[], memberID: string): SavedPlace | null {
  return places
    .filter((place) => place.label.trim().toLocaleLowerCase("en-US") === "home"
      && (place.visibility === "family" || place.ownerMemberID === memberID))
    .sort((left, right) => Number(right.ownerMemberID === memberID) - Number(left.ownerMemberID === memberID))[0]
    ?? null;
}

function localDateFor(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone,
  }).format(new Date(instant));
}

function localHour(instant: string, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", {
    hour: "numeric", hourCycle: "h23", timeZone,
  }).format(new Date(instant)));
}

function averageTemperature<Key extends "morningTemperatureCelsius" | "afternoonTemperatureCelsius">(
  hours: ReadonlyArray<{ forecastStart: string; temperature: number }>,
  timeZone: string,
  startHour: number,
  endHour: number,
  key: Key,
): Partial<Record<Key, number>> {
  const temperatures = hours
    .filter((hour) => {
      const value = localHour(hour.forecastStart, timeZone);
      return value >= startHour && value < endHour;
    })
    .map((hour) => hour.temperature);
  if (temperatures.length === 0) return {};
  return { [key]: temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length } as Record<Key, number>;
}
