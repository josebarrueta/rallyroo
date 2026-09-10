import { createHash } from "node:crypto";
import type { CaltrainStaticScheduleSnapshot, CaltrainScheduledJourney, CaltrainScheduleService } from "./caltrain-static-schedule.js";

export interface ScheduleSearchOptions {
  fromStopID: string;
  toStopID: string;
  directionID: string;
  weekday: number;
  routeID?: string;
}

export interface JourneyOption {
  departureMinutes: number;
  arrivalMinutes: number;
  journeyId: string;
  serviceId: string;
}

function secondsToMinutes(seconds: number): number {
  return Math.floor(seconds / 60);
}

function sameSchedule(
  a: CaltrainScheduledJourney,
  b: CaltrainScheduledJourney,
): boolean {
  if (a.calls.length !== b.calls.length) return false;
  for (let i = 0; i < a.calls.length; i++) {
    if (a.calls[i]!.stopID !== b.calls[i]!.stopID) return false;
    if (a.calls[i]!.arrivalSeconds !== b.calls[i]!.arrivalSeconds) return false;
    if (a.calls[i]!.departureSeconds !== b.calls[i]!.departureSeconds) return false;
  }
  return true;
}

function stableSha256(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export function findJourneys(
  schedule: CaltrainStaticScheduleSnapshot,
  options: ScheduleSearchOptions,
): JourneyOption[] {
  const targetDate = new Date(`${schedule.validFrom}T00:00:00Z`).toISOString();
  const servicesByWeekday = new Map<number, CaltrainScheduleService[]>();
  for (const s of schedule.services) {
    for (const d of s.weekdays) {
      const list = servicesByWeekday.get(d) ?? [];
      list.push(s);
      servicesByWeekday.set(d, list);
    }
  }
  const services = servicesByWeekday.get(options.weekday) ?? [];
  const resultMap = new Map<string, JourneyOption>();
  for (const service of services) {
    const inRange = schedule.validFrom <= targetDate
      && targetDate <= schedule.validUntil;
    if (!inRange) continue;
    const weekServices = schedule.services.filter((svc) => svc.id === service.id);
    const activeServices = weekServices.length;
    if (activeServices === 0) continue;
    for (const journey of schedule.journeys) {
      if (journey.serviceID !== service.id) continue;
      if (options.routeID && journey.routeID !== options.routeID) continue;
      const directionMatch = journey.direction === (options.directionID === "1" ? "northbound" : "southbound");
      if (!directionMatch) continue;
      const originIdx = journey.calls.findIndex((c) => c.stopID === options.fromStopID);
      const destIdx = journey.calls.findIndex((c) => c.stopID === options.toStopID);
      if (originIdx < 0 || destIdx <= originIdx) continue;
      const departureMinutes = secondsToMinutes(journey.calls[originIdx]!.departureSeconds);
      const arrivalMinutes = secondsToMinutes(journey.calls[destIdx]!.arrivalSeconds);
      const scheduleKey = stableSha256(journey.id, options.fromStopID, options.toStopID);
      const signature = JSON.stringify({
        journeyId: journey.id,
        departureMinutes,
        arrivalMinutes,
        calls: journey.calls.map((c) => ({ stopID: c.stopID, arrivalSeconds: c.arrivalSeconds, departureSeconds: c.departureSeconds })),
      });
      const existing = resultMap.get(scheduleKey);
      if (!existing || signature !== JSON.stringify(existing)) {
        const serviceId = journey.serviceID;
        const journeyId = journey.id;
        resultMap.set(scheduleKey, { departureMinutes, arrivalMinutes, journeyId, serviceId });
      }
    }
  }
  const optionsList = [...resultMap.values()];
  optionsList.sort((a, b) => a.departureMinutes - b.departureMinutes);
  return optionsList;
}
