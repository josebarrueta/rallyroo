import { createHash, randomUUID } from "node:crypto";
import ICAL from "ical.js";
import { CalendarFeedError } from "./calendar-source-adapters.js";
import type { FamilyEvent } from "./domain.js";

const MAX_IMPORTED_EVENTS = 5_000;

export type CalendarSourceVisibility = "personal" | "family";

export interface CalendarSource {
  id: string;
  familyID: string;
  ownerMemberID: string;
  visibility: CalendarSourceVisibility;
  name: string;
  protectedURL: string;
  participantIDs: string[];
  status: "pending" | "ready" | "error";
  lastSyncedAt: string | null;
  lastError: string | null;
  etag: string | null;
  lastModified: string | null;
}

export interface PublicCalendarSource {
  id: string;
  ownerMemberID: string;
  visibility: CalendarSourceVisibility;
  name: string;
  participantIDs: string[];
  status: CalendarSource["status"];
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface ImportedCalendarEvent {
  familyID: string;
  sourceID: string;
  sourceName: string;
  sourceOwnerMemberID: string;
  sourceVisibility: CalendarSourceVisibility;
  externalUID: string;
  title: string;
  startTime: string;
  endTime: string;
  arrivalTime: string | null;
  location: string | null;
  notes: string | null;
  participantIDs: string[];
  fingerprint: string;
}

export interface ImportedEventSettings {
  familyID: string;
  eventID: string;
  arrivalTime: string | null;
  alertLeadTimeMinutes: 0 | 5 | 15 | 30 | 45 | 60 | 1440 | null;
  driver: string | null;
  driverMemberID: string | null;
}

export interface CalendarSourceRepository {
  saveCalendarSource(source: CalendarSource): Promise<void>;
  calendarSource(familyID: string, sourceID: string): Promise<CalendarSource | null>;
  calendarSourcesForFamily(familyID: string): Promise<CalendarSource[]>;
  deleteCalendarSource(familyID: string, sourceID: string): Promise<boolean>;
  replaceCalendarEvents(source: CalendarSource, events: ImportedCalendarEvent[]): Promise<void>;
  calendarEventsForFamily(familyID: string): Promise<ImportedCalendarEvent[]>;
  importedEventSettingsForFamily(familyID: string): Promise<ImportedEventSettings[]>;
  familyIDsWithImportedEventSettings(): Promise<string[]>;
  saveImportedEventSettings(settings: ImportedEventSettings): Promise<void>;
}

export interface CalendarFeedResponse {
  body: string;
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
}

export interface CalendarFeedValidators {
  etag?: string;
  lastModified?: string;
}

export class CalendarSourceSyncError extends Error {
  readonly statusCode = 502;

  constructor(detail?: string) {
    super(detail ?? "Calendar source synchronization failed");
    this.name = "CalendarSourceSyncError";
  }
}

interface CalendarSourceModuleDependencies {
  repository: CalendarSourceRepository;
  protectURL: (url: string) => string;
  revealURL: (protectedURL: string) => string;
  fetchFeed: (url: string, validators?: CalendarFeedValidators) => Promise<CalendarFeedResponse>;
}

export class CalendarSourceModule {
  constructor(private readonly dependencies: CalendarSourceModuleDependencies) {}

  async connect(input: {
    familyID: string;
    ownerMemberID: string;
    visibility: CalendarSourceVisibility;
    name: string;
    url: string;
    participantIDs: string[];
  }): Promise<PublicCalendarSource> {
    const source: CalendarSource = {
      id: randomUUID(),
      familyID: input.familyID,
      ownerMemberID: input.ownerMemberID,
      visibility: input.visibility,
      name: input.name,
      protectedURL: this.dependencies.protectURL(input.url),
      participantIDs: [...new Set(input.participantIDs)].sort(),
      status: "pending",
      lastSyncedAt: null,
      lastError: null,
      etag: null,
      lastModified: null,
    };
    await this.dependencies.repository.saveCalendarSource(source);
    try {
      return (await this.sync(source.familyID, source.id, source.ownerMemberID))!;
    } catch {
      const failed = await this.dependencies.repository.calendarSource(source.familyID, source.id);
      return publicCalendarSource(failed ?? { ...source, status: "error", lastError: "sync_failed" });
    }
  }

  async list(familyID: string, viewerMemberID: string): Promise<PublicCalendarSource[]> {
    return (await this.dependencies.repository.calendarSourcesForFamily(familyID))
      .filter((source) => canAccessSource(source, viewerMemberID))
      .map(publicCalendarSource);
  }

  async update(
    familyID: string,
    sourceID: string,
    requesterMemberID: string,
    settings: Pick<CalendarSource, "visibility"> & { name?: string | undefined },
  ): Promise<PublicCalendarSource | null> {
    const source = await this.dependencies.repository.calendarSource(familyID, sourceID);
    if (!source || source.ownerMemberID !== requesterMemberID) return null;
    const updated = { ...source, ...settings, name: settings.name ?? source.name };
    await this.dependencies.repository.saveCalendarSource(updated);
    return publicCalendarSource(updated);
  }

  async delete(
    familyID: string,
    sourceID: string,
    requesterMemberID: string,
  ): Promise<PublicCalendarSource | null> {
    const source = await this.dependencies.repository.calendarSource(familyID, sourceID);
    if (!source || !canAccessSource(source, requesterMemberID)) return null;
    const deleted = await this.dependencies.repository.deleteCalendarSource(familyID, sourceID);
    return deleted ? publicCalendarSource(source) : null;
  }

  async sync(
    familyID: string,
    sourceID: string,
    requesterMemberID: string,
  ): Promise<PublicCalendarSource | null> {
    const source = await this.dependencies.repository.calendarSource(familyID, sourceID);
    if (!source || !canAccessSource(source, requesterMemberID)) return null;
    try {
      const response = await this.dependencies.fetchFeed(
        this.dependencies.revealURL(source.protectedURL),
        {
          ...(source.etag ? { etag: source.etag } : {}),
          ...(source.lastModified ? { lastModified: source.lastModified } : {}),
        },
      );
      const synchronized: CalendarSource = {
        ...source,
        status: "ready",
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
        etag: response.etag ?? source.etag,
        lastModified: response.lastModified ?? source.lastModified,
      };
      if (response.notModified) {
        await this.dependencies.repository.saveCalendarSource(synchronized);
        return publicCalendarSource(synchronized);
      }
      const events = parseCalendar(response.body).map((event) => ({
        ...event,
        familyID,
        sourceID: source.id,
        sourceName: source.name,
        sourceOwnerMemberID: source.ownerMemberID,
        sourceVisibility: source.visibility,
        participantIDs: source.participantIDs,
        fingerprint: eventFingerprint(event),
      }));
      await this.dependencies.repository.replaceCalendarEvents(synchronized, events);
      return publicCalendarSource(synchronized);
    } catch (error) {
      // Network and parser exceptions can contain subscription URLs or Family data.
      // Only our own fixed, safe feed errors may reach logs, persistence or clients.
      const message = error instanceof CalendarFeedError
        ? error.message : "Calendar feed could not be synchronized";
      console.error("[CalendarSync] Failed to sync source %s: %s", source.id, message);
      await this.dependencies.repository.saveCalendarSource({
        ...source,
        status: "error",
        lastError: message,
      });
      throw new CalendarSourceSyncError(message);
     }
  }

  async events(familyID: string, viewerMemberID: string): Promise<FamilyEvent[]> {
    const visibleEvents = (await this.dependencies.repository.calendarEventsForFamily(familyID))
      .filter((event) => event.sourceVisibility === "family"
        || event.sourceOwnerMemberID === viewerMemberID);
    return this.withSettings(familyID, deduplicateEvents(familyID, visibleEvents));
  }

  async sharedEvents(familyID: string): Promise<FamilyEvent[]> {
    const sharedEvents = (await this.dependencies.repository.calendarEventsForFamily(familyID))
      .filter((event) => event.sourceVisibility === "family");
    return this.withSettings(familyID, deduplicateEvents(familyID, sharedEvents));
  }

  async allEvents(familyID: string): Promise<FamilyEvent[]> {
    const events = await this.dependencies.repository.calendarEventsForFamily(familyID);
    return this.withSettings(familyID, deduplicateEvents(familyID, events));
  }

  async alertEvents(): Promise<FamilyEvent[]> {
    const familyIDs = await this.dependencies.repository.familyIDsWithImportedEventSettings();
    return (await Promise.all(familyIDs.map((familyID) => this.allEvents(familyID))))
      .flat()
      .filter((event) => event.alertLeadTimeMinutes !== null
        && event.alertLeadTimeMinutes !== undefined);
  }

  async updateEventSettings(
    familyID: string,
    viewerMemberID: string,
    eventID: string,
    settings: Pick<ImportedEventSettings, "arrivalTime" | "alertLeadTimeMinutes"> & {
      driver?: string | null | undefined;
      driverMemberID?: string | null | undefined;
    },
  ): Promise<FamilyEvent | null> {
    const event = (await this.events(familyID, viewerMemberID))
      .find((candidate) => candidate.id.toLowerCase() === eventID.toLowerCase());
    if (!event) return null;
    if (settings.arrivalTime !== null) {
      const arrival = new Date(settings.arrivalTime);
      if (!Number.isFinite(arrival.getTime()) || arrival > new Date(event.startTime)) {
        throw new CalendarSourceSyncError("Imported event arrival time is invalid");
      }
    }
    const customized = {
      familyID,
      eventID: event.id,
      arrivalTime: settings.arrivalTime,
      alertLeadTimeMinutes: settings.alertLeadTimeMinutes,
      driver: settings.driver !== undefined
        ? settings.driver
        : (settings.driverMemberID !== undefined ? null : event.driver),
      driverMemberID: settings.driverMemberID !== undefined
        ? settings.driverMemberID
        : (settings.driver !== undefined ? null : (event.driverMemberID ?? null)),
    };
    await this.dependencies.repository.saveImportedEventSettings(customized);
    return {
      ...event,
      arrivalTime: customized.arrivalTime,
      alertLeadTimeMinutes: customized.alertLeadTimeMinutes,
      driver: customized.driver,
      driverMemberID: customized.driverMemberID,
    };
  }

  private async withSettings(familyID: string, events: FamilyEvent[]): Promise<FamilyEvent[]> {
    const settings = new Map(
      (await this.dependencies.repository.importedEventSettingsForFamily(familyID))
        .map((item) => [item.eventID.toLowerCase(), item]),
    );
    return events.map((event) => {
      const customized = settings.get(event.id.toLowerCase());
      return customized ? {
        ...event,
        arrivalTime: customized.arrivalTime,
        alertLeadTimeMinutes: customized.alertLeadTimeMinutes,
        driver: customized.driver,
        driverMemberID: customized.driverMemberID,
      } : event;
    });
  }
}

function parseCalendar(body: string): Array<Pick<
  ImportedCalendarEvent,
  "externalUID" | "title" | "startTime" | "endTime" | "arrivalTime" | "location" | "notes"
>> {
  const text = body.replace(/^\uFEFF/, "").trim();
  if (!/^BEGIN:VCALENDAR\r?\n/.test(text) || !/\r?\nEND:VCALENDAR$/.test(text)) {
    throw new CalendarFeedError("Calendar feed is not an iCalendar file");
  }
  const calendar = new ICAL.Component(ICAL.parse(text));
  if (calendar.name !== "vcalendar") throw new CalendarFeedError("Calendar feed is not an iCalendar file");
  const components = calendar.getAllSubcomponents("vevent");
  const events = components
    .map((component) => new ICAL.Event(component))
    .filter((event) => !event.isRecurrenceException());
  const rangeStart = new Date();
  rangeStart.setUTCFullYear(rangeStart.getUTCFullYear() - 1);
  const rangeEnd = new Date();
  rangeEnd.setUTCFullYear(rangeEnd.getUTCFullYear() + 2);
  const result: Array<Pick<
    ImportedCalendarEvent,
    "externalUID" | "title" | "startTime" | "endTime" | "arrivalTime" | "location" | "notes"
  >> = [];
  let iterationCount = 0;

  for (const event of events) {
    if (!event.uid || !event.summary?.trim()) {
      throw new Error("Calendar contains an invalid event");
    }
    if (!event.isRecurring()) {
      appendOccurrence(
        result,
        event.uid,
        event,
        calendarInstant(event.startDate, calendarTimeZone(event, "dtstart")),
        calendarInstant(event.endDate, calendarTimeZone(event, "dtend")),
      );
      continue;
    }

    const iterator = event.iterator();
    let recurrence;
    while ((recurrence = iterator.next())) {
      iterationCount += 1;
      if (iterationCount > 50_000) {
        throw new Error("Calendar recurrence exceeds the expansion limit");
      }
      const details = event.getOccurrenceDetails(recurrence);
      const start = calendarInstant(details.startDate, calendarTimeZone(details.item, "dtstart"));
      const end = calendarInstant(details.endDate, calendarTimeZone(details.item, "dtend"));
      if (start > rangeEnd) break;
      if (start < rangeStart) continue;
      if (details.item.component.getFirstPropertyValue("status") === "CANCELLED") continue;
      appendOccurrence(
        result,
        `${event.uid}::${details.recurrenceId.toString()}`,
        details.item,
        start,
        end,
      );
    }
  }
  return result;
}

function appendOccurrence(
  result: Array<Pick<
    ImportedCalendarEvent,
    "externalUID" | "title" | "startTime" | "endTime" | "arrivalTime" | "location" | "notes"
  >>,
  externalUID: string,
  event: InstanceType<typeof ICAL.Event>,
  start: Date,
  end: Date,
): void {
  if (!event.summary?.trim() || end <= start) {
    throw new Error("Calendar contains an invalid event");
  }
  if (result.length >= MAX_IMPORTED_EVENTS) {
    throw new Error("Calendar exceeds the event import limit");
  }
  result.push({
    externalUID,
    title: event.summary.trim(),
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    arrivalTime: teamSnapArrivalTime(event, start),
    location: event.location?.trim() || null,
    notes: importedEventDescription(event),
  });
}

function importedEventDescription(event: InstanceType<typeof ICAL.Event>): string | null {
  const description = event.component.getFirstPropertyValue("description");
  return typeof description === "string" && description.trim() ? description.trim() : null;
}

function calendarTimeZone(event: InstanceType<typeof ICAL.Event>, propertyName: "dtstart" | "dtend"): string | null {
  const value = event.component.getFirstProperty(propertyName)?.getParameter("tzid");
  if (typeof value !== "string") return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

function calendarInstant(time: InstanceType<typeof ICAL.Time>, timeZone: string | null): Date {
  if (!timeZone) return time.toJSDate();
  return instantForZonedParts({
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  }, timeZone) ?? time.toJSDate();
}

// RFC 5545 has DTSTART/DTEND but no event arrival-time property. TeamSnap places
// this optional value in DESCRIPTION, so keep the adapter deliberately narrow.
function teamSnapArrivalTime(event: InstanceType<typeof ICAL.Event>, start: Date): string | null {
  const description = event.component.getFirstPropertyValue("description");
  if (typeof description !== "string") return null;
  const match = description.match(/\(Arrival Time:\s*(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  hour %= 12;
  if (match[3]!.toUpperCase() === "PM") hour += 12;

  const sourceTimeZone = calendarTimeZone(event, "dtstart");
  const describedTimeZone = description.match(/Pacific Time \(US & Canada\)/i)
    ? "America/Los_Angeles"
    : null;
  const timeZone = describedTimeZone ?? sourceTimeZone;
  const date = sourceTimeZone && sourceTimeZone === timeZone
    ? { year: event.startDate.year, month: event.startDate.month, day: event.startDate.day }
    : zonedParts(start, timeZone ?? "UTC");
  const arrival = timeZone
    ? instantForZonedParts({ ...date, hour, minute, second: 0 }, timeZone)
    : new Date(Date.UTC(date.year, date.month - 1, date.day, hour, minute));
  return arrival && arrival <= start ? arrival.toISOString() : null;
}

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): CalendarDateParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function instantForZonedParts(parts: CalendarDateParts, timeZone: string): Date | null {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second,
    );
    const adjustment = desired - represented;
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }
  return null;
}

function eventFingerprint(event: {
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
}): string {
  return [
    normalizeText(event.title),
    new Date(event.startTime).toISOString(),
    new Date(event.endTime).toISOString(),
    normalizeText(event.location ?? ""),
  ].join("\u001f");
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function deduplicateEvents(familyID: string, events: ImportedCalendarEvent[]): FamilyEvent[] {
  const groups: ImportedCalendarEvent[][] = [];
  for (const event of events) {
    const group = groups.find((candidate) => candidate.some((existing) =>
      existing.externalUID === event.externalUID || existing.fingerprint === event.fingerprint
    ));
    if (group) group.push(event);
    else groups.push([event]);
  }

  return groups.map((group) => {
    const selected = [...group].sort((left, right) =>
      presentationPenalty(left.title) - presentationPenalty(right.title)
      || left.sourceID.localeCompare(right.sourceID)
    )[0]!;
    const allSameFingerprint = group.every((event) => event.fingerprint === selected.fingerprint);
    const stableKey = group.length === 1
      ? `uid:${selected.sourceID}:${selected.externalUID}`
      : allSameFingerprint
        ? `fingerprint:${selected.fingerprint}`
        : `uid:${[...group].map((event) => `${event.sourceID}:${event.externalUID}`).sort()[0]}`;
    return {
      id: deterministicUUID(`${familyID}\u001f${stableKey}`),
      familyID,
      title: selected.title,
      kidID: null,
      participantIDs: [...new Set(group.flatMap((event) => event.participantIDs))].sort(),
      startTime: selected.startTime,
      endTime: selected.endTime,
      arrivalTime: selected.arrivalTime,
      location: selected.location,
      notes: selected.notes,
      driver: null,
      source: "calendar",
      status: "confirmed",
      readOnly: true,
      provenance: group
        .map((event) => ({
          sourceID: event.sourceID,
          sourceName: event.sourceName,
          externalUID: event.externalUID,
        }))
        .sort((left, right) => left.sourceID.localeCompare(right.sourceID)),
    };
  });
}

function presentationPenalty(title: string): number {
  const letters = title.replace(/[^\p{L}]/gu, "");
  return letters.length > 1 && letters === letters.toLocaleUpperCase("en-US") ? 1 : 0;
}

function deterministicUUID(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canAccessSource(source: CalendarSource, memberID: string): boolean {
  return source.visibility === "family" || source.ownerMemberID === memberID;
}

function publicCalendarSource(source: CalendarSource): PublicCalendarSource {
  return {
    id: source.id,
    ownerMemberID: source.ownerMemberID,
    visibility: source.visibility,
    name: source.name,
    participantIDs: source.participantIDs,
    status: source.status,
    lastSyncedAt: source.lastSyncedAt,
    lastError: safeCalendarError(source.lastError),
  };
}

// Older versions persisted raw network exceptions. Never echo those historical
// strings (which may contain bearer-style subscription URLs) back to clients.
const knownCalendarErrors = new Set([
    "Calendar feed must use a valid HTTPS link",
    "Calendar feed redirected too many times",
    "Calendar feed host must resolve only to public addresses",
    "Calendar feed redirect omitted its location",
    "Calendar feed redirect has an invalid location",
    "Calendar feed returned HTTP 304 without a cached snapshot",
    "Calendar feed is not an iCalendar file",
    "Calendar feed exceeds the size limit",
    "Calendar feed request timed out",
    "Calendar feed could not be synchronized",
]);
function safeCalendarError(message: string | null): string | null {
  if (message === null) return null;
  return knownCalendarErrors.has(message) || /^Calendar feed returned HTTP [1-5][0-9]{2}$/.test(message)
    ? message : "Calendar feed could not be synchronized";
}
