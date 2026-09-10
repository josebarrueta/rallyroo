import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import type { CaltrainStop } from "./commuter-module.js";

const requiredFiles = [
  "agency.txt",
  "feed_info.txt",
  "stops.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
] as const;
const selectedFiles = new Set<string>([...requiredFiles, "calendar_dates.txt"]);
const maximumArchiveBytes = 5 * 1024 * 1024;
const maximumExpandedBytes = 25 * 1024 * 1024;
const maximumRows = 50_000;

export interface CaltrainScheduleService {
  id: string;
  weekdays: number[];
  startsOn: string;
  endsOn: string;
  addedDates: string[];
  removedDates: string[];
}

export interface CaltrainScheduledCall {
  stopID: string;
  sequence: number;
  arrivalSeconds: number;
  departureSeconds: number;
}

export interface CaltrainScheduledJourney {
  id: string;
  serviceID: string;
  routeID: string;
  direction: "northbound" | "southbound";
  calls: CaltrainScheduledCall[];
}

export interface CaltrainStaticScheduleSnapshot {
  observedAt: string;
  version: string;
  timeZone: "America/Los_Angeles";
  validFrom: string;
  validUntil: string;
  stops: CaltrainStop[];
  services: CaltrainScheduleService[];
  journeys: CaltrainScheduledJourney[];
}

type CSVRow = Record<string, string>;

export function parseCaltrainStaticSchedule(
  archive: Uint8Array,
  observedAt: Date,
): CaltrainStaticScheduleSnapshot {
  try {
    if (archive.byteLength < 1 || archive.byteLength > maximumArchiveBytes
      || !Number.isFinite(observedAt.getTime())) throw new Error("invalid archive");
    let expandedBytes = 0;
    const files = unzipSync(archive, {
      filter: (file) => {
        if (!selectedFiles.has(file.name) || file.name.includes("/")) return false;
        expandedBytes += file.originalSize;
        if (file.originalSize > maximumExpandedBytes || expandedBytes > maximumExpandedBytes) {
          throw new Error("expanded archive too large");
        }
        return true;
      },
    });
    for (const name of requiredFiles) if (!files[name]) throw new Error(`missing ${name}`);

    const agencies = csv(files["agency.txt"]!, 10);
    const agencyRow = agencies[0] ?? {} as CSVRow;
    const agencyTimezone = (agencyRow.agency_timezone ?? "").toString().trim();
    if (agencyTimezone !== "America/Los_Angeles") throw new Error("invalid agency timezone");
    const feedRows = csv(files["feed_info.txt"]!, 10);
    const feedRow = feedRows[0] ?? {} as CSVRow;
    const feedVersion = feedRow.feed_version ?? "";
    const feedStartDate = feedRow.feed_start_date ?? "";
    const feedEndDate = feedRow.feed_end_date ?? "";
    if (feedRows.length !== 1 || !feedVersion || feedVersion.length > 200) throw new Error("invalid feed info");
    const validFrom = gtfsDate(feedStartDate);
    const validUntil = gtfsDate(feedEndDate);
    if (validUntil < validFrom) throw new Error("invalid feed range");

    const csvRows = (rows: Uint8Array, maximum: number) => csv(rows, maximum);
    const serviceRows = csvRows(files["calendar.txt"]!, 5_000);
    const exceptionsRows = files["calendar_dates.txt"] ? csvRows(files["calendar_dates.txt"]!, 20_000) : [];
    const exceptionsByService = new Map<string, { addedDates: string[]; removedDates: string[] }>();
    for (const row of exceptionsRows) {
      const serviceId = row.service_id ?? "";
      if (!serviceId) throw new Error("invalid service exception");
      const dates = exceptionsByService.get(serviceId) ?? { addedDates: [] as string[], removedDates: [] as string[] };
      const dateVal = row.date ?? "";
      const excType = row.exception_type ?? "";
      if (!dateVal || !excType) throw new Error("invalid service exception");
      const date = gtfsDate(dateVal);
      if (excType === "1") dates.addedDates.push(date);
      else if (excType === "2") dates.removedDates.push(date);
      else throw new Error("invalid service exception");
      exceptionsByService.set(serviceId, dates);
    }
    const rawToHashedService = new Map<string, string>();
    const services = serviceRows.map((row): CaltrainScheduleService => {
      const serviceId = row.service_id ?? "";
      requireIdentifier(serviceId);
      const id = stableID("service", serviceId);
      rawToHashedService.set(serviceId, id);
      const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        .flatMap((name, index): number[] => {
          const v = row[name] ?? "";
          if (v === "1") return [index + 1];
          if (v === "0") return [];
          throw new Error("invalid weekday");
        });
      const dates = exceptionsByService.get(serviceId) ?? { addedDates: [] as string[], removedDates: [] as string[] };
      return {
        id,
        weekdays,
        startsOn: gtfsDate(row.start_date ?? ""),
        endsOn: gtfsDate(row.end_date ?? ""),
        addedDates: [...dates.addedDates].sort(),
        removedDates: [...dates.removedDates].sort(),
      };
    });

    const stopRows = csvRows(files["stops.txt"]!, 5_000);
    const stopByID = new Map<string, CSVRow>();
    for (const row of stopRows) {
      const stopId = row.stop_id ?? "";
      requireIdentifier(stopId);
      if (stopByID.has(stopId)) throw new Error("duplicate stop");
      stopByID.set(stopId, row);
    }
    const tripRows = csvRows(files["trips.txt"]!, 10_000);
    const tripByID = new Map<string, CSVRow>();
    for (const row of tripRows) {
      const tripId = row.trip_id ?? "";
      const routeId = row.route_id ?? "";
      const serviceId = row.service_id ?? "";
      requireIdentifier(tripId);
      requireIdentifier(routeId);
      if (!rawToHashedService.has(serviceId) || tripByID.has(tripId)) throw new Error("invalid trip");
      const directionId = row.direction_id ?? "";
      if (directionId !== "0" && directionId !== "1") throw new Error("invalid trip");
      tripByID.set(tripId, row);
    }
    const callsByTrip = new Map<string, CaltrainScheduledCall[]>();
    for (const row of csvRows(files["stop_times.txt"]!, maximumRows)) {
      const tripId = row.trip_id ?? "";
      const stopId = row.stop_id ?? "";
      if (!tripByID.has(tripId) || !stopByID.has(stopId)) throw new Error("unknown call reference");
      const seq = row.stop_sequence ?? "";
      const arr = row.arrival_time ?? "";
      const dep = row.departure_time ?? "";
      const call: CaltrainScheduledCall = {
        stopID: stopId,
        sequence: boundedInteger(seq, 0, 10_000),
        arrivalSeconds: gtfsTime(arr),
        departureSeconds: gtfsTime(dep),
      };
      const calls = callsByTrip.get(tripId) ?? [];
      calls.push(call);
      callsByTrip.set(tripId, calls);
    }

    const stopDirections = new Map<string, Set<"northbound" | "southbound">>();
    const journeys: CaltrainScheduledJourney[] = [];
    for (const row of tripRows) {
      const tripId = row.trip_id ?? "";
      const serviceId = row.service_id ?? "";
      const routeId = row.route_id ?? "";
      const directionId = row.direction_id ?? "";
      if (!tripId || !serviceId || !routeId || !directionId) throw new Error("invalid trip");
      const direction = directionId === "1" ? "northbound" : "southbound";
      const calls = (callsByTrip.get(tripId) ?? [])
        .sort((left, right) => left.sequence - right.sequence);
      if (calls.length < 2 || new Set(calls.map((c) => c.sequence)).size !== calls.length) {
        throw new Error("invalid journey calls");
      }
      for (const call of calls) {
        const dirs = stopDirections.get(call.stopID) ?? new Set<"northbound" | "southbound">();
        dirs.add(direction);
        stopDirections.set(call.stopID, dirs);
      }
      journeys.push({
        id: stableID("trip", tripId),
        serviceID: rawToHashedService.get(serviceId)!,
        routeID: stableID("route", routeId),
        direction,
        calls,
      });
    }

    const stops: CaltrainStop[] = [];
    for (const row of stopRows) {
      const stopId = row.stop_id ?? "";
      const locationType = row.location_type ?? "";
      if (locationType === "1") continue;
      if (!callsReferenceStop(stopId, callsByTrip)) continue;
      const latitude = Number(row.stop_lat ?? "");
      const longitude = Number(row.stop_lon ?? "");
      const stopName = row.stop_name ?? "";
      const parentStation = row.parent_station ?? "";
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
        || !stopName || stopName.length > 300) throw new Error("invalid stop");
      const dirs = stopDirections.get(stopId) ?? new Set();
      const direction = dirs.size === 1 ? [...dirs][0]! : "unknown";
      stops.push({
        id: stopId,
        stationID: parentStation || stopId,
        stationName: stopName.replace(/ Caltrain Station$/, "").trim(),
        direction,
        latitude,
        longitude,
        validFrom: `${validFrom}T00:00:00.000Z`,
        validUntil: `${validUntil}T23:59:59.999Z`,
      });
    }
    if (stops.length < 2 || stops.length > 500 || journeys.length < 1 || journeys.length > 10_000) {
      throw new Error("invalid schedule bounds");
    }
    return {
      observedAt: observedAt.toISOString(),
      version: feedVersion,
      timeZone: "America/Los_Angeles",
      validFrom,
      validUntil,
      stops,
      services,
      journeys,
    };
  } catch {
    throw new Error("Invalid Caltrain static schedule");
  }
}

function csv(bytes: Uint8Array, maximum: number): CSVRow[] {
  const rows = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    max_record_size: 10_000,
  }) as CSVRow[];
  if (rows.length < 1 || rows.length > maximum) throw new Error("invalid CSV row count");
  return rows;
}

function stableID(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}\u0000${value}`, "utf8").digest("hex");
}

function requireIdentifier(value: string): void {
  if (!value || value.length > 300 || /[\u0000-\u001f]/.test(value)) throw new Error("invalid identifier");
}

function gtfsDate(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new Error("invalid GTFS date");
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function gtfsTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("invalid GTFS time");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 47 || minutes > 59 || seconds > 59) throw new Error("invalid GTFS time");
  return hours * 3_600 + minutes * 60 + seconds;
}

function boundedInteger(value: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error("invalid integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("invalid integer");
  }
  return parsed;
}

function callsReferenceStop(
  stopID: string,
  callsByTrip: Map<string, CaltrainScheduledCall[]>,
): boolean {
  return [...callsByTrip.values()].some((calls) => calls.some((call) => call.stopID === stopID));
}
