import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { gtfsEpochSeconds, safeGTFSInteger } from "./gtfs-realtime-values.js";

const { transit_realtime: gtfs } = GtfsRealtimeBindings;

export interface CaltrainServiceAlertSelector {
  routeID: string | null;
  stopID: string | null;
  tripID: string | null;
  directionID: number | null;
}

export interface CaltrainServiceAlert {
  id: string;
  effect: "cancellation" | "delay" | "advisory";
  cause: string;
  severity: "info" | "warning" | "severe" | "unknown";
  activePeriods: Array<{ startsAt: string | null; endsAt: string | null }>;
  routeIDs: string[];
  stopIDs: string[];
  tripIDs: string[];
  directionIDs: number[];
  selectors: CaltrainServiceAlertSelector[];
  header: string | null;
  description: string | null;
}

export interface CaltrainServiceAlertsSnapshot {
  observedAt: string;
  validUntil: string;
  alerts: CaltrainServiceAlert[];
}

export function decodeCaltrainServiceAlerts(body: Uint8Array): CaltrainServiceAlertsSnapshot {
  try {
    if (body.byteLength < 1) throw new Error("empty feed");
    const feed = gtfs.FeedMessage.decode(body);
    const timestamp = safeGTFSInteger(feed.header.timestamp);
    if (timestamp < 1 || feed.entity.length > 500) throw new Error("invalid header");
    const ids = new Set<string>();
    const alerts: CaltrainServiceAlert[] = [];
    for (const entity of feed.entity) {
      if (entity.isDeleted) continue;
      if (!entity.id || entity.id.length > 300 || ids.has(entity.id) || !entity.alert) {
        throw new Error("invalid alert entity");
      }
      ids.add(entity.id);
      const alert = entity.alert;
      const periods = alert.activePeriod ?? [];
      const selectors = alert.informedEntity ?? [];
      if (periods.length > 100 || selectors.length > 100) throw new Error("alert limit exceeded");
      const routeIDs = new Set<string>();
      const stopIDs = new Set<string>();
      const tripIDs = new Set<string>();
      const directionIDs = new Set<number>();
      const normalizedSelectors: CaltrainServiceAlertSelector[] = [];
      for (const selector of selectors) {
        if (selector.agencyId && selector.agencyId !== "CT") {
          throw new Error("unexpected agency");
        }
        addBounded(selector.routeId, routeIDs);
        addBounded(selector.stopId, stopIDs);
        addBounded(selector.trip?.tripId, tripIDs);
        let normalizedDirection: number | null = null;
        if (Object.prototype.hasOwnProperty.call(selector, "directionId")) {
          const direction = Number(selector.directionId);
          if (!Number.isSafeInteger(direction) || direction < 0 || direction > 1) {
            throw new Error("invalid direction");
          }
          directionIDs.add(direction);
          normalizedDirection = direction;
        }
        normalizedSelectors.push({
          routeID: selector.routeId || null,
          stopID: selector.stopId || null,
          tripID: selector.trip?.tripId || null,
          directionID: normalizedDirection,
        });
      }
      alerts.push({
        id: entity.id,
        effect: normalizedEffect(alert.effect),
        cause: enumName(gtfs.Alert.Cause, alert.cause, "unknown_cause"),
        severity: normalizedSeverity(alert.severityLevel),
        activePeriods: periods.map(normalizedPeriod),
        routeIDs: [...routeIDs],
        stopIDs: [...stopIDs],
        tripIDs: [...tripIDs],
        directionIDs: [...directionIDs],
        selectors: normalizedSelectors,
        header: translatedText(alert.headerText, 500),
        description: translatedText(alert.descriptionText, 2_000),
      });
    }
    return {
      observedAt: gtfsEpochSeconds(timestamp),
      validUntil: gtfsEpochSeconds(timestamp + 3 * 60),
      alerts,
    };
  } catch {
    throw new Error("Invalid Caltrain Service Alerts feed");
  }
}

function normalizedPeriod(value: object): { startsAt: string | null; endsAt: string | null } {
  const startsAt = optionalEpoch(value, "start");
  const endsAt = optionalEpoch(value, "end");
  if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
    throw new Error("invalid active period");
  }
  return { startsAt, endsAt };
}

function optionalEpoch(value: object, property: "start" | "end"): string | null {
  if (!Object.prototype.hasOwnProperty.call(value, property)) return null;
  const seconds = safeGTFSInteger((value as Record<string, unknown>)[property]);
  return seconds > 0 ? gtfsEpochSeconds(seconds) : null;
}

function addBounded(value: string | null | undefined, destination: Set<string>): void {
  if (!value) return;
  if (value.length > 300) throw new Error("identifier too long");
  destination.add(value);
}

function translatedText(
  value: { translation?: Array<{ text?: string | null; language?: string | null }> | null } | null | undefined,
  maximumLength: number,
): string | null {
  const translations = value?.translation ?? [];
  if (translations.length > 20) throw new Error("too many translations");
  const selected = translations.find((item) => item.language?.toLowerCase().startsWith("en"))
    ?? translations[0];
  const text = selected?.text?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return null;
  if (text.length > maximumLength) throw new Error("translated text too long");
  return text;
}

function normalizedEffect(effect: number | null | undefined): CaltrainServiceAlert["effect"] {
  switch (effect) {
  case gtfs.Alert.Effect.NO_SERVICE:
    return "cancellation";
  case gtfs.Alert.Effect.SIGNIFICANT_DELAYS:
    return "delay";
  default:
    return "advisory";
  }
}

function normalizedSeverity(level: number | null | undefined): CaltrainServiceAlert["severity"] {
  switch (level) {
  case gtfs.Alert.SeverityLevel.INFO: return "info";
  case gtfs.Alert.SeverityLevel.WARNING: return "warning";
  case gtfs.Alert.SeverityLevel.SEVERE: return "severe";
  default: return "unknown";
  }
}

function enumName(
  values: object,
  value: number | null | undefined,
  fallback: string,
): string {
  if (value === null || value === undefined) return fallback;
  const name = (values as Record<number, string>)[value];
  return name ? name.toLowerCase() : fallback;
}
