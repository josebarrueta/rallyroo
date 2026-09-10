import { createHash } from "node:crypto";
import type { CaltrainStaticScheduleSnapshot } from "./caltrain-static-schedule.js";

export interface CaltrainJourneySearch {
  originStationID: string;
  destinationStationID: string;
  serviceWeekdays: number[];
}

export interface CaltrainJourneyOption {
  id: string;
  directionID: "northbound" | "southbound";
  originStopID: string;
  destinationStopID: string;
  departureMinutes: number;
  arrivalMinutes: number;
  operatingWeekdays: number[];
}

interface MutableJourneyOption extends Omit<CaltrainJourneyOption, "id" | "operatingWeekdays"> {
  weekdays: Set<number>;
}

export function searchCaltrainJourneys(
  schedule: CaltrainStaticScheduleSnapshot,
  search: CaltrainJourneySearch,
  serviceDate: string = schedule.validFrom,
): CaltrainJourneyOption[] {
  try {
    const selectedDays = [...new Set(search.serviceWeekdays)].sort((left, right) => left - right);
    if (!search.originStationID || search.originStationID.length > 300
      || !search.destinationStationID || search.destinationStationID.length > 300
      || search.originStationID === search.destinationStationID
      || selectedDays.length < 1
      || selectedDays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
      || (selectedDays.some((day) => day <= 5) && selectedDays.some((day) => day >= 6))) {
      throw new Error("invalid search");
    }
    const stopsByStation = new Map<string, Set<string>>();
    for (const stop of schedule.stops) {
      const ids = stopsByStation.get(stop.stationID) ?? new Set<string>();
      ids.add(stop.id);
      stopsByStation.set(stop.stationID, ids);
    }
    const originStopIDs = stopsByStation.get(search.originStationID);
    const destinationStopIDs = stopsByStation.get(search.destinationStationID);
    if (!originStopIDs || !destinationStopIDs) throw new Error("unknown station");

    const servicesByID = new Map(
      schedule.services.map((service) => [service.id, service] as const),
    );
    const grouped = new Map<string, MutableJourneyOption>();
    for (const journey of schedule.journeys) {
      const originIndex = journey.calls.findIndex((call) => originStopIDs.has(call.stopID));
      if (originIndex < 0) continue;
      const destinationIndex = journey.calls.findIndex((call, index) => (
        index > originIndex && destinationStopIDs.has(call.stopID)
      ));
      if (destinationIndex < 0) continue;
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
      const service = servicesByID.get(journey.serviceID);
      if (!service || serviceDate < service.startsOn || serviceDate > service.endsOn) continue;
      const option = grouped.get(key) ?? {
        directionID: journey.direction,
        originStopID: origin.stopID,
        destinationStopID: destination.stopID,
        departureMinutes,
        arrivalMinutes,
        weekdays: new Set<number>(),
      };
      for (const weekday of service.weekdays) {
        option.weekdays.add(weekday);
      }
      grouped.set(key, option);
    }

    const options = [...grouped.entries()]
      .filter(([, option]) => selectedDays.every((day) => option.weekdays.has(day)))
      .map(([key, option]): CaltrainJourneyOption => ({
        id: createHash("sha256").update(`schedule\u0000${key}`, "utf8").digest("hex"),
        directionID: option.directionID,
        originStopID: option.originStopID,
        destinationStopID: option.destinationStopID,
        departureMinutes: option.departureMinutes,
        arrivalMinutes: option.arrivalMinutes,
        operatingWeekdays: [...option.weekdays].sort((left, right) => left - right),
      }))
      .sort((left, right) => left.departureMinutes - right.departureMinutes
        || left.arrivalMinutes - right.arrivalMinutes
        || left.id.localeCompare(right.id));
    if (options.length > 500) throw new Error("too many options");
    return options;
  } catch {
    throw new Error("Invalid Caltrain journey search");
  }
}
