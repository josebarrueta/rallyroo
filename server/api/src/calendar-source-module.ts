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
  location: string | null;
  participantIDs: string[];
  fingerprint: string;
}

export interface CalendarSourceRepository {
  saveCalendarSource(source: CalendarSource): Promise<void>;
  calendarSource(familyID: string, sourceID: string): Promise<CalendarSource | null>;
  calendarSourcesForFamily(familyID: string): Promise<CalendarSource[]>;
  deleteCalendarSource(familyID: string, sourceID: string): Promise<boolean>;
  replaceCalendarEvents(source: CalendarSource, events: ImportedCalendarEvent[]): Promise<void>;
  calendarEventsForFamily(familyID: string): Promise<ImportedCalendarEvent[]>;
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

  async updateVisibility(
    familyID: string,
    sourceID: string,
    requesterMemberID: string,
    visibility: CalendarSourceVisibility,
  ): Promise<PublicCalendarSource | null> {
    const source = await this.dependencies.repository.calendarSource(familyID, sourceID);
    if (!source || source.ownerMemberID !== requesterMemberID) return null;
    const updated = { ...source, visibility };
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
    return deduplicateEvents(familyID, visibleEvents);
  }

  async sharedEvents(familyID: string): Promise<FamilyEvent[]> {
    const sharedEvents = (await this.dependencies.repository.calendarEventsForFamily(familyID))
      .filter((event) => event.sourceVisibility === "family");
    return deduplicateEvents(familyID, sharedEvents);
  }
}

function parseCalendar(body: string): Array<Pick<
  ImportedCalendarEvent,
  "externalUID" | "title" | "startTime" | "endTime" | "location"
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
    "externalUID" | "title" | "startTime" | "endTime" | "location"
  >> = [];
  let iterationCount = 0;

  for (const event of events) {
    if (!event.uid || !event.summary?.trim()) {
      throw new Error("Calendar contains an invalid event");
    }
    if (!event.isRecurring()) {
      appendOccurrence(result, event.uid, event, event.startDate.toJSDate(), event.endDate.toJSDate());
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
      const start = details.startDate.toJSDate();
      if (start > rangeEnd) break;
      if (start < rangeStart) continue;
      if (details.item.component.getFirstPropertyValue("status") === "CANCELLED") continue;
      appendOccurrence(
        result,
        `${event.uid}::${details.recurrenceId.toString()}`,
        details.item,
        start,
        details.endDate.toJSDate(),
      );
    }
  }
  return result;
}

function appendOccurrence(
  result: Array<Pick<
    ImportedCalendarEvent,
    "externalUID" | "title" | "startTime" | "endTime" | "location"
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
    location: event.location?.trim() || null,
  });
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
    const stableKey = allSameFingerprint
      ? `fingerprint:${selected.fingerprint}`
      : `uid:${[...group].map((event) => event.externalUID).sort()[0]}`;
    return {
      id: deterministicUUID(`${familyID}\u001f${stableKey}`),
      familyID,
      title: selected.title,
      kidID: null,
      participantIDs: [...new Set(group.flatMap((event) => event.participantIDs))].sort(),
      startTime: selected.startTime,
      endTime: selected.endTime,
      location: selected.location,
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
