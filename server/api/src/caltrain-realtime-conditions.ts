import { createHash } from "node:crypto";
import type { CaltrainStop, TransitCondition } from "./commuter-module.js";
import type { CaltrainRealtimeSnapshot } from "./caltrain-realtime-refresher.js";

const caltrainTimeZone = "America/Los_Angeles";

export function caltrainRealtimeConditions(
  snapshot: CaltrainRealtimeSnapshot,
  catalog: CaltrainStop[],
  now: Date,
): TransitCondition[] {
  const stopDirections = new Map(catalog.map((stop) => [stop.id, stop.direction]));
  const conditions: TransitCondition[] = [];
  for (const trip of snapshot.tripUpdates.trips) {
    const firstTimedStop = trip.stops.find((stop) => stop.eventTime);
    const direction = trip.stops.map((stop) => stopDirections.get(stop.stopID))
      .find((value) => value === "northbound" || value === "southbound");
    if (!firstTimedStop?.eventTime || !direction) continue;
    const maximumDelay = Math.max(0, ...trip.stops.map((stop) => stop.delaySeconds));
    if (trip.status !== "canceled" && maximumDelay < 60) continue;
    const scheduledAt = new Date(
      new Date(firstTimedStop.eventTime).getTime() - firstTimedStop.delaySeconds * 1_000,
    );
    const local = localSchedule(scheduledAt);
    conditions.push({
      scope: "trip",
      id: stableConditionID("trip", trip.id, local.date),
      agencyID: "CT",
      routeID: trip.routeID,
      directionID: direction,
      stopIDs: trip.stops.map((stop) => stop.stopID),
      serviceWeekday: local.weekday,
      scheduledMinutes: local.minutes,
      kind: trip.status === "canceled" ? "cancellation" : "delay",
      delayMinutes: Math.floor(maximumDelay / 60),
      observedAt: snapshot.tripUpdates.observedAt,
      validUntil: snapshot.tripUpdates.validUntil,
    });
  }

  const current = now.getTime();
  const currentLocal = localSchedule(now);
  for (const alert of snapshot.serviceAlerts.alerts) {
    if (alert.effect === "advisory" || !isActive(alert.activePeriods, current)) continue;
    const kind = alert.effect === "cancellation" ? "cancellation" : "delay";
    const activePeriod = alert.activePeriods.find((period) => (
      (period.startsAt === null || new Date(period.startsAt).getTime() <= current)
      && (period.endsAt === null || new Date(period.endsAt).getTime() >= current)
    ));
    const activationKey = activePeriod?.startsAt ?? currentLocal.date;
    const selectors = (alert.selectors.length > 0
      ? alert.selectors
      : [{ routeID: null, stopID: null, tripID: null, directionID: null }])
      .filter((selector) => !selector.tripID || Boolean(selector.routeID || selector.stopID));
    selectors.forEach((selector) => {
      const stopDirection = selector.stopID ? stopDirections.get(selector.stopID) : undefined;
      conditions.push({
        scope: "disruption",
        id: stableConditionID(
          "alert",
          alert.id,
          selector.routeID ?? "",
          selector.stopID ?? "",
          selector.tripID ?? "",
          String(selector.directionID ?? ""),
          activationKey,
        ),
        agencyID: "CT",
        routeID: selector.routeID ?? "*",
        directionID: stopDirection === "northbound" || stopDirection === "southbound"
          ? stopDirection
          : "*",
        stopIDs: selector.stopID ? [selector.stopID] : [],
        serviceWeekday: currentLocal.weekday,
        scheduledMinutes: currentLocal.minutes,
        kind,
        delayMinutes: 0,
        observedAt: snapshot.serviceAlerts.observedAt,
        validUntil: boundedAlertExpiry(
          snapshot.serviceAlerts.validUntil,
          alert.activePeriods,
          current,
        ),
      });
    });
  }
  if (conditions.length > 5_000) throw new Error("Caltrain condition limit exceeded");
  return conditions;
}

function stableConditionID(kind: "trip" | "alert", ...parts: string[]): string {
  return `${kind}:${createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex")}`;
}

function isActive(
  periods: Array<{ startsAt: string | null; endsAt: string | null }>,
  now: number,
): boolean {
  return periods.length === 0 || periods.some((period) => (
    (period.startsAt === null || new Date(period.startsAt).getTime() <= now)
    && (period.endsAt === null || new Date(period.endsAt).getTime() >= now)
  ));
}

function boundedAlertExpiry(
  feedExpiry: string,
  periods: Array<{ startsAt: string | null; endsAt: string | null }>,
  now: number,
): string {
  const activeEnds = periods
    .filter((period) => period.startsAt === null || new Date(period.startsAt).getTime() <= now)
    .map((period) => period.endsAt ? new Date(period.endsAt).getTime() : Number.POSITIVE_INFINITY)
    .filter((value) => value >= now);
  return new Date(Math.min(new Date(feedExpiry).getTime(), ...activeEnds)).toISOString();
}

function localSchedule(date: Date): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: caltrainTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  const weekdays: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: weekdays[value("weekday")]!,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}
