import { createHash } from "node:crypto";
import ICAL from "ical.js";
import type { EventAllDay, FamilyEvent } from "./domain.js";
import { allDayTimes, dateOnlyIsValid } from "./all-day-event.js";
import { CalendarError, type CalendarCondition, type CalendarResource, type CalendarWrite } from "./caldav-persistence.js";

export const maximumCalendarBytes = 64 * 1024;
export const calendarETag = (data: string) => `"${createHash("sha256").update(data).digest("hex")}"`;
export const nativeCalendarName = (id: string) => `rallyroo-${id.toLowerCase()}.ics`;
export const nativeCalendarUID = (id: string) => `${id.toLowerCase()}@rallyroo`;

export interface CalendarEventFields {
  uid: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: EventAllDay | null;
  location: string | null;
}

/** Experimental writable profile: one non-recurring Event per resource.
 * Unsupported semantics fail closed; this is deliberately not a general CalDAV codec.
 */
export function parseCalendarEvent(data: string, timeZone = "UTC"): CalendarEventFields {
  try {
    if (Buffer.byteLength(data) > maximumCalendarBytes || data.includes("\0")) throw new Error();
    // Bound nesting before ICAL's recursive parser; never include payloads in errors.
    let depth = 0;
    for (const line of data.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
      if (/^BEGIN:/i.test(line) && ++depth > 8) throw new Error();
      if (/^END:/i.test(line) && --depth < 0) throw new Error();
    }
    if (depth !== 0) throw new Error();
    const root = new ICAL.Component(ICAL.parse(data));
    if (root.name !== "vcalendar" || root.getFirstPropertyValue("version") !== "2.0"
      || root.hasProperty("method")) throw new Error();
    const events = root.getAllSubcomponents("vevent");
    if (events.length !== 1 || root.getAllSubcomponents().some((c) => !["vevent", "vtimezone"].includes(c.name))) {
      throw new CalendarError(403, "supported-calendar-component");
    }
    validateTimeZones(root);
    const component = events[0]!;
    for (const name of ["rrule", "rdate", "exdate", "exrule", "recurrence-id", "attendee", "organizer"]) {
      if (component.hasProperty(name)) throw new CalendarError(403, "supported-calendar-data");
    }
    if ((component.hasProperty("class") && String(component.getFirstPropertyValue("class")).toUpperCase() !== "PUBLIC")
      || (component.hasProperty("transp") && String(component.getFirstPropertyValue("transp")).toUpperCase() !== "OPAQUE")) {
      // Native Family Events are shared with the Family and occupy Schedule time.
      throw new CalendarError(403, "supported-calendar-data");
    }
    const alarms = component.getAllSubcomponents("valarm");
    if (alarms.length > 16 || component.getAllSubcomponents().some((c) => c.name !== "valarm" && !c.name.startsWith("x-"))) {
      throw new CalendarError(403, "supported-calendar-component");
    }
    for (const alarm of alarms) {
      const repeat = Number(alarm.getFirstPropertyValue("repeat") ?? 0);
      if (alarm.getAllProperties("action").length !== 1 || String(alarm.getFirstPropertyValue("action")).toUpperCase() !== "DISPLAY"
        || alarm.getAllProperties("trigger").length !== 1 || alarm.getAllProperties("duration").length > 1
        || !Number.isInteger(repeat) || repeat < 0 || repeat > 10) {
        throw new CalendarError(403, "supported-calendar-data");
      }
      const trigger = alarm.getFirstProperty("trigger")!;
      if (trigger.type === "duration") validateDuration(alarm, "trigger", false);
      else {
        validateDateTime(alarm, "trigger");
        if (!String(trigger.toJSON()[3]).endsWith("Z")) throw new Error();
      }
      if (alarm.hasProperty("duration")) validateDuration(alarm, "duration");
    }
    for (const name of ["uid", "dtstart", "dtstamp", "summary"]) {
      if (component.getAllProperties(name).length !== 1) throw new Error();
    }
    if (component.getAllProperties("dtend").length > 1 || component.getAllProperties("duration").length > 1
      || (component.hasProperty("dtend") && component.hasProperty("duration"))) throw new Error();
    const uid = String(component.getFirstPropertyValue("uid"));
    const title = String(component.getFirstPropertyValue("summary")).trim();
    if (!uid || uid.length > 1024 || /[\x00-\x1f\x7f]/.test(uid) || !title || title.length > 1000) throw new Error();
    validateDateTime(component, "dtstamp");
    const dateOnly = component.getFirstProperty("dtstart")!.type === "date";
    for (const name of ["dtstart", "dtend"]) {
      const property = component.getFirstProperty(name);
      if (!property) continue;
      if (dateOnly) {
        if (property.type !== "date" || property.getParameter("tzid") !== undefined
          || !dateOnlyIsValid(String(property.toJSON()[3]))) throw new Error();
      } else validateDateTime(component, name);
    }
    // ICAL normalizes duration-derived endpoints using calendar arithmetic.
    // Bound numeric duration values BEFORE reading endDate: enormous values
    // otherwise run an effectively unbounded normalization loop.
    if (component.hasProperty("duration")) validateDuration(component, "duration");
    const event = new ICAL.Event(component);
    const start = event.startDate;
    const end = event.endDate;
    if (end.year < 1 || end.year > 9999) throw new Error();
    let allDay: EventAllDay | null = null;
    let startTime: string;
    let endTime: string;
    if (dateOnly) {
      const duration = component.getFirstPropertyValue("duration") as ICAL.Duration | null;
      if (!start.isDate || !end.isDate || (duration && (duration.hours || duration.minutes || duration.seconds))) throw new Error();
      allDay = { startDate: start.toString(), endDate: end.toString(), timeZone };
      const times = allDayTimes(allDay);
      if (!times) throw new Error();
      ({ startTime, endTime } = times);
    } else {
      for (const time of [start, end]) {
        if (!time || time.isDate || time.zone === ICAL.Timezone.localTimezone) throw new CalendarError(403, "supported-calendar-data");
      }
      startTime = start.toJSDate().toISOString();
      endTime = end.toJSDate().toISOString();
    }
    if (new Date(endTime) <= new Date(startTime)) throw new Error();
    const status = component.getFirstPropertyValue("status");
    if (status && String(status).toUpperCase() !== "CONFIRMED") throw new CalendarError(403, "supported-calendar-data");
    return { uid, title, startTime, endTime, allDay,
      location: component.getFirstPropertyValue("location") == null ? null : String(component.getFirstPropertyValue("location")),
    };
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError(403, "valid-calendar-data");
  }
}

function validateDuration(component: ICAL.Component, name: string, positive = true): void {
  const property = component.getFirstProperty(name);
  if (property?.type !== "duration") throw new CalendarError(403, "supported-calendar-data");
  const seconds = (property.getFirstValue() as ICAL.Duration).toSeconds();
  // A deliberately bounded interoperability profile (at most 3660 nominal days).
  // Alarm triggers may be signed/zero; Event and repeated-alarm durations must be positive.
  if (!Number.isSafeInteger(seconds) || Math.abs(seconds) > 3660 * 86400 || (positive && seconds <= 0)) {
    throw new CalendarError(403, "valid-calendar-data");
  }
}

function validateDateTime(component: ICAL.Component, name: string): void {
  const property = component.getFirstProperty(name);
  if (!property) return;
  const value = String(property.toJSON()[3]);
  if (property.type !== "date-time") throw new CalendarError(403, "supported-calendar-data");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z?$/.test(value)
    || value.startsWith("0000") || (name === "dtstamp" && !value.endsWith("Z"))) {
    throw new CalendarError(403, "valid-calendar-data");
  }
  const utc = value.endsWith("Z") ? value : value + "Z";
  if (new Date(utc).toISOString().replace(".000Z", "Z") !== utc) throw new CalendarError(403, "valid-calendar-data");
}

function validateTimeZones(root: ICAL.Component): void {
  const zones = root.getAllSubcomponents("vtimezone");
  if (zones.length > 4) throw new CalendarError(403, "supported-calendar-data");
  for (const zone of zones) {
    const periods = zone.getAllSubcomponents();
    if (periods.length > 8) throw new CalendarError(403, "supported-calendar-data");
    for (const period of periods) {
      if (!["standard", "daylight"].includes(period.name) || period.getAllProperties("rrule").length > 1
        || period.getAllProperties("rdate").reduce((n, p) => n + p.getValues().length, 0) > 64) {
        throw new CalendarError(403, "supported-calendar-data");
      }
      const rule = period.getFirstPropertyValue("rrule");
      if (rule) {
        // Time-zone rules must not become an unbounded secondly/minutely expansion.
        // A deliberately small annual-rule profile covers ordinary Apple zones.
        for (const part of String(rule).split(";")) {
          if (!/^(FREQ=YEARLY|INTERVAL=[1-9][0-9]?|COUNT=[1-9][0-9]{0,2}|UNTIL=[0-9]{8}T[0-9]{6}Z|BYMONTH=(?:[1-9]|1[0-2])|BYMONTHDAY=-?(?:[1-9]|[12][0-9]|3[01])|BYDAY=-?[1-5]?(?:MO|TU|WE|TH|FR|SA|SU))$/.test(part)) {
            throw new CalendarError(403, "supported-calendar-data");
          }
        }
        if (!String(rule).includes("FREQ=YEARLY")) throw new CalendarError(403, "supported-calendar-data");
      }
    }
  }
}

export function calendarEventIsSupported(event: FamilyEvent): boolean {
  return event.source !== "calendar" && !event.readOnly && !event.recurrence
    && !event.recurrenceSeriesID && event.status === "confirmed";
}

export function renderCalendarEvent(event: FamilyEvent, binding?: CalendarResource): CalendarResource {
  if (!calendarEventIsSupported(event)) throw new CalendarError(403, "supported-calendar-data");
  const root = binding ? new ICAL.Component(ICAL.parse(binding.data)) : new ICAL.Component("vcalendar");
  let component = root.getFirstSubcomponent("vevent");
  let changed = !binding;
  if (!component) {
    root.updatePropertyWithValue("version", "2.0");
    root.updatePropertyWithValue("prodid", "-//Rallyroo//Family Calendar//EN");
    component = new ICAL.Component("vevent");
    root.addSubcomponent(component);
    component.updatePropertyWithValue("uid", nativeCalendarUID(event.id));
    component.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(event.startTime), true));
  }
  const fields = binding ? parseCalendarEvent(binding.data, event.allDay?.timeZone ?? "UTC") : null;
  if (fields?.title !== event.title) {
    component.updatePropertyWithValue("summary", event.title); changed = true;
  }
  if (!fields || new Date(fields.startTime).getTime() !== new Date(event.startTime).getTime()
    || new Date(fields.endTime).getTime() !== new Date(event.endTime).getTime()
    || Boolean(fields.allDay) !== Boolean(event.allDay)
    || fields.allDay?.startDate !== event.allDay?.startDate || fields.allDay?.endDate !== event.allDay?.endDate) {
    // Replace both endpoints together: removing DURATION while updating just one
    // endpoint would otherwise leave the resource with no effective end time.
    component.removeAllProperties("duration");
    for (const [property, value] of [["dtstart", event.startTime], ["dtend", event.endTime]] as const) {
      component.removeAllProperties(property);
      const dateOnly = event.allDay && (property === "dtstart" ? event.allDay.startDate : event.allDay.endDate);
      component.updatePropertyWithValue(property, dateOnly ? ICAL.Time.fromDateString(dateOnly) : ICAL.Time.fromJSDate(new Date(value), true));
    }
    changed = true;
  }
  if ((fields?.location ?? null) !== event.location) {
    component.removeAllProperties("location");
    if (event.location !== null) component.updatePropertyWithValue("location", event.location);
    changed = true;
  }
  return { eventID: event.id, name: binding?.name ?? nativeCalendarName(event.id),
    uid: binding?.uid ?? nativeCalendarUID(event.id), data: changed ? root.toString() + "\r\n" : binding!.data };
}

export function calendarResourcesForEvents(events: FamilyEvent[], bindings: CalendarResource[]): CalendarResource[] {
  return events.filter(calendarEventIsSupported).map((event) => renderCalendarEvent(event, bindings.find((b) => b.eventID === event.id)));
}

export function requireCalendarCondition(current: CalendarResource | undefined, condition: CalendarCondition): void {
  // Lists and weak tags are legal HTTP syntax but unsupported by this experimental profile.
  for (const value of [condition.ifMatch, condition.ifNoneMatch]) {
    if (value !== undefined && value !== "*" && !/^"[0-9a-f]{64}"$/.test(value)) throw new CalendarError(400, "invalid-precondition");
  }
  const etag = current ? calendarETag(current.data) : null;
  if ((condition.ifMatch !== undefined && (etag === null || (condition.ifMatch !== "*" && condition.ifMatch !== etag)))
    || (condition.ifNoneMatch !== undefined && etag !== null && (condition.ifNoneMatch === "*" || condition.ifNoneMatch === etag))) {
    throw new CalendarError(412, "precondition-failed");
  }
}

export function prepareCalendarSave(
  events: FamilyEvent[], bindings: CalendarResource[], write: CalendarWrite, draft: FamilyEvent,
): { event: FamilyEvent; resource: CalendarResource } {
  if (events.length > 1000 || bindings.reduce((n, r) => n + Buffer.byteLength(r.data), 0) > 1024 * 1024) {
    throw new CalendarError(507, "number-of-matches-within-limits");
  }
  const resources = calendarResourcesForEvents(events, bindings);
  const current = resources.find((r) => r.name === write.name);
  if ((!current && events.length >= 1000)
    || resources.reduce((n, r) => n + (r.name === write.name ? 0 : Buffer.byteLength(r.data)), Buffer.byteLength(write.data)) > 1024 * 1024) {
    throw new CalendarError(507, "number-of-matches-within-limits");
  }
  requireCalendarCondition(current, write);
  if (current && current.uid !== write.uid) throw new CalendarError(403, "no-uid-conflict");
  if ([...resources, ...bindings].some((r) => r.uid === write.uid && r.name !== write.name)) throw new CalendarError(403, "no-uid-conflict");
  // A previously bound native Event may have become unsupported; never overwrite it through a stale calendar URL.
  const bound = bindings.find((r) => r.name === write.name);
  if (bound && !current) throw new CalendarError(403, "supported-calendar-data");
  // Reserve the server-generated namespace so future native Events cannot collide
  // with an earlier client-chosen href or UID.
  if (!current && (write.name.startsWith("rallyroo-") || write.uid.endsWith("@rallyroo"))) {
    throw new CalendarError(403, "supported-calendar-data");
  }
  const existing = current ? events.find((e) => e.id === current.eventID) : undefined;
  const fields = parseCalendarEvent(write.data, existing?.allDay?.timeZone ?? write.timeZone ?? "UTC");
  const event: FamilyEvent = { ...draft, ...existing, title: fields.title, startTime: fields.startTime,
    endTime: fields.endTime, allDay: fields.allDay, location: fields.location };
  // Arrival targets cannot become invalid after a calendar time edit.
  if (event.arrivalTime && new Date(event.arrivalTime) > new Date(event.startTime)) throw new CalendarError(409, "arrival-target-conflict");
  return { event, resource: { eventID: event.id, name: write.name, uid: fields.uid, data: write.data } };
}
