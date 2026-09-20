import { createHash } from "node:crypto";
import type { CommuteSubscription } from "./commuter-module.js";
import type {
  CaltrainScheduledJourney,
  CaltrainStaticScheduleSnapshot,
} from "./caltrain-static-schedule.js";

export interface CaltrainTrackingPlan {
  pollRealtime: boolean;
  trackedJourneyIDs: string[];
  nextWakeAt: string | null;
}

const timeZone = "America/Los_Angeles";
const localPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function caltrainTrackingPlan(
  subscriptions: readonly CommuteSubscription[],
  schedule: CaltrainStaticScheduleSnapshot | null,
  now: Date,
): CaltrainTrackingPlan {
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "active");
  const trackedJourneyIDs = new Set<string>();
  let pollRealtime = false;
  let nextWakeAt: Date | null = null;
  const currentServiceDate = caltrainServiceDate(now);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const serviceDate = addDays(currentServiceDate, dayOffset);
    const weekday = isoWeekday(serviceDate);
    for (const subscription of activeSubscriptions) {
      if (!subscription.serviceWeekdays.includes(weekday)) continue;
      const windows = trackingWindows(subscription, schedule, serviceDate, weekday);
      for (const window of windows) {
        const startsAt = dateAtCaltrainMinutes(serviceDate, window.startMinutes);
        const endsAt = dateAtCaltrainMinutes(serviceDate, window.endMinutes);
        if (now >= startsAt && now <= endsAt) {
          pollRealtime = true;
          if (window.journeyID) trackedJourneyIDs.add(window.journeyID);
        } else if (startsAt > now && (nextWakeAt === null || startsAt < nextWakeAt)) {
          nextWakeAt = startsAt;
        }
      }
    }
  }

  return {
    pollRealtime,
    trackedJourneyIDs: [...trackedJourneyIDs].sort(),
    nextWakeAt: nextWakeAt?.toISOString() ?? null,
  };
}

interface TrackingWindow {
  startMinutes: number;
  endMinutes: number;
  journeyID?: string;
}

function trackingWindows(
  subscription: CommuteSubscription,
  schedule: CaltrainStaticScheduleSnapshot | null,
  serviceDate: string,
  weekday: number,
): TrackingWindow[] {
  if (!subscription.scheduleOptionID || !schedule) {
    return [{
      startMinutes: subscription.windowStartMinutes,
      endMinutes: subscription.windowEndMinutes,
    }];
  }
  if (subscription.scheduleVersion !== schedule.version) return [];

  return schedule.journeys
    .filter((journey) => journeyRuns(journey, schedule, serviceDate, weekday))
    .filter((journey) => journeyOptionID(journey, subscription) === subscription.scheduleOptionID)
    .map((journey) => ({
      startMinutes: subscription.scheduledDepartureMinutes ?? subscription.windowStartMinutes,
      endMinutes: Math.floor(journey.calls.at(-1)!.arrivalSeconds / 60),
      journeyID: journey.id,
    }));
}

function journeyRuns(
  journey: CaltrainScheduledJourney,
  schedule: CaltrainStaticScheduleSnapshot,
  serviceDate: string,
  weekday: number,
): boolean {
  const service = schedule.services.find((candidate) => candidate.id === journey.serviceID);
  if (!service || serviceDate < service.startsOn || serviceDate > service.endsOn) return false;
  if (service.removedDates.includes(serviceDate)) return false;
  return service.addedDates.includes(serviceDate) || service.weekdays.includes(weekday);
}

function journeyOptionID(
  journey: CaltrainScheduledJourney,
  subscription: CommuteSubscription,
): string | null {
  const originIndex = journey.calls.findIndex((call) => call.stopID === subscription.originStopID);
  const destinationIndex = journey.calls.findIndex((call, index) => (
    index > originIndex && call.stopID === subscription.destinationStopID
  ));
  if (originIndex < 0 || destinationIndex < 0 || journey.direction !== subscription.directionID) return null;
  const origin = journey.calls[originIndex]!;
  const destination = journey.calls[destinationIndex]!;
  const departureMinutes = Math.floor(origin.departureSeconds / 60) % 1_440;
  const arrivalMinutes = Math.floor(destination.arrivalSeconds / 60) % 1_440;
  const key = [
    journey.direction,
    origin.stopID,
    destination.stopID,
    String(departureMinutes),
    String(arrivalMinutes),
  ].join("\u0000");
  return createHash("sha256").update(`schedule\u0000${key}`, "utf8").digest("hex");
}

function caltrainServiceDate(date: Date): string {
  const parts = localParts(date);
  return `${parts.year}-${twoDigits(parts.month)}-${twoDigits(parts.day)}`;
}

function isoWeekday(serviceDate: string): number {
  const [year, month, day] = serviceDate.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function addDays(serviceDate: string, count: number): string {
  const [year, month, day] = serviceDate.split("-").map(Number) as [number, number, number];
  const result = new Date(Date.UTC(year, month - 1, day + count));
  return `${result.getUTCFullYear()}-${twoDigits(result.getUTCMonth() + 1)}-${twoDigits(result.getUTCDate())}`;
}

function dateAtCaltrainMinutes(serviceDate: string, minutes: number): Date {
  const [year, month, day] = serviceDate.split("-").map(Number) as [number, number, number];
  const desired = new Date(Date.UTC(year, month - 1, day, 0, minutes));
  let candidate = desired;
  for (let index = 0; index < 2; index += 1) {
    const represented = localParts(candidate);
    const representedMilliseconds = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
    );
    candidate = new Date(candidate.getTime() + desired.getTime() - representedMilliseconds);
  }
  return candidate;
}

function localParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const values = Object.fromEntries(
    localPartsFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}
