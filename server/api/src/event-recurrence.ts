import type { FamilyEvent } from "./domain.js";

const dayMilliseconds = 24 * 60 * 60 * 1_000;
const zonedPartFormatters = new Map<string, Intl.DateTimeFormat>();

/** Expands a native event's bounded recurrence into occurrence start instants. */
export function eventOccurrenceStarts(event: FamilyEvent, through: Date): Date[] {
  const first = new Date(event.startTime);
  if (!event.recurrence) return [first];
  const end = new Date(Math.min(new Date(event.recurrence.endDate).getTime(), through.getTime()));
  if (event.recurrence.frequency === "weekly" && event.recurrence.weekdays?.length) {
    return weeklyOccurrenceStarts(
      first,
      end,
      event.recurrence.interval,
      event.recurrence.weekdays,
      event.recurrence.timeZone,
    );
  }

  if (event.recurrence.timeZone) {
    return zonedRegularOccurrenceStarts(
      first,
      end,
      event.recurrence.frequency,
      event.recurrence.interval,
      event.recurrence.timeZone,
    );
  }

  const starts: Date[] = [];
  let current = first;
  while (current <= end) {
    starts.push(current);
    const next = new Date(current);
    switch (event.recurrence.frequency) {
      case "daily": next.setUTCDate(next.getUTCDate() + event.recurrence.interval); break;
      case "weekly": next.setUTCDate(next.getUTCDate() + 7 * event.recurrence.interval); break;
      case "monthly": next.setUTCMonth(next.getUTCMonth() + event.recurrence.interval); break;
    }
    if (next <= current) break;
    current = next;
  }
  return starts;
}

function weeklyOccurrenceStarts(
  first: Date,
  end: Date,
  interval: number,
  weekdays: number[],
  timeZone?: string,
): Date[] {
  if (timeZone) return zonedWeeklyOccurrenceStarts(first, end, interval, weekdays, timeZone);

  // Legacy series did not record a time zone. Keep expansion available for mutation
  // compatibility; notification claimers separately reject these ambiguous series.
  const selected = new Set(weekdays);
  const firstISOWeekday = first.getUTCDay() || 7;
  const anchorDate = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  const anchorWeekStart = anchorDate - (firstISOWeekday - 1) * dayMilliseconds;
  const starts: Date[] = [];
  let candidate = new Date(first);
  while (candidate <= end) {
    const candidateDate = Date.UTC(
      candidate.getUTCFullYear(),
      candidate.getUTCMonth(),
      candidate.getUTCDate(),
    );
    const elapsedWeeks = Math.floor((candidateDate - anchorWeekStart) / (7 * dayMilliseconds));
    const isoWeekday = candidate.getUTCDay() || 7;
    if (elapsedWeeks % interval === 0 && selected.has(isoWeekday)) starts.push(candidate);
    candidate = new Date(candidate.getTime() + dayMilliseconds);
  }
  return starts;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedRegularOccurrenceStarts(
  first: Date,
  end: Date,
  frequency: "daily" | "weekly" | "monthly",
  interval: number,
  timeZone: string,
): Date[] {
  const firstParts = zonedParts(first, timeZone);
  const endParts = zonedParts(end, timeZone);
  let localDate = Date.UTC(firstParts.year, firstParts.month - 1, firstParts.day);
  const endLocalDate = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  const starts: Date[] = [];
  while (localDate <= endLocalDate) {
    const date = new Date(localDate);
    const occurrence = instantForZonedParts({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: firstParts.hour,
      minute: firstParts.minute,
      second: firstParts.second,
    }, first.getUTCMilliseconds(), timeZone);
    if (occurrence && occurrence >= first && occurrence <= end) starts.push(occurrence);

    const next = new Date(localDate);
    switch (frequency) {
      case "daily": next.setUTCDate(next.getUTCDate() + interval); break;
      case "weekly": next.setUTCDate(next.getUTCDate() + 7 * interval); break;
      case "monthly": next.setUTCMonth(next.getUTCMonth() + interval); break;
    }
    const nextLocalDate = next.getTime();
    if (nextLocalDate <= localDate) break;
    localDate = nextLocalDate;
  }
  return starts;
}

function zonedWeeklyOccurrenceStarts(
  first: Date,
  end: Date,
  interval: number,
  weekdays: number[],
  timeZone: string,
): Date[] {
  const firstParts = zonedParts(first, timeZone);
  const endParts = zonedParts(end, timeZone);
  const firstDate = Date.UTC(firstParts.year, firstParts.month - 1, firstParts.day);
  const endDate = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  const firstISOWeekday = new Date(firstDate).getUTCDay() || 7;
  const anchorWeekStart = firstDate - (firstISOWeekday - 1) * dayMilliseconds;
  const selected = new Set(weekdays);
  const starts: Date[] = [];

  for (let localDate = firstDate; localDate <= endDate; localDate += dayMilliseconds) {
    const date = new Date(localDate);
    const isoWeekday = date.getUTCDay() || 7;
    const elapsedWeeks = Math.floor((localDate - anchorWeekStart) / (7 * dayMilliseconds));
    if (elapsedWeeks % interval !== 0 || !selected.has(isoWeekday)) continue;

    const occurrence = instantForZonedParts({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: firstParts.hour,
      minute: firstParts.minute,
      second: firstParts.second,
    }, first.getUTCMilliseconds(), timeZone);
    if (occurrence && occurrence >= first && occurrence <= end) starts.push(occurrence);
  }
  return starts;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  let formatter = zonedPartFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedPartFormatters.set(timeZone, formatter);
  }
  for (const part of formatter.formatToParts(date)) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function instantForZonedParts(parts: ZonedParts, millisecond: number, timeZone: string): Date | null {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    millisecond,
  );
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      millisecond,
    );
    const adjustment = desired - represented;
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }
  return null;
}
