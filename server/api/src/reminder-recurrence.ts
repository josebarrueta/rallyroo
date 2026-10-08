import type { FamilyReminder } from "./domain.js";

const dayMilliseconds = 24 * 60 * 60 * 1_000;
const zonedPartFormatters = new Map<string, Intl.DateTimeFormat>();

/** Expands a Reminder series into its stable occurrence due instants. */
export function reminderOccurrenceDueDates(reminder: FamilyReminder, through: Date): Date[] {
  const first = new Date(reminder.dueAt);
  if (!reminder.recurrenceFrequency) return first <= through ? [first] : [];
  const configuredEnd = reminder.recurrenceEndDate
    ? new Date(reminder.recurrenceEndDate).getTime()
    : through.getTime();
  const end = new Date(Math.min(configuredEnd, through.getTime()));
  if (end < first) return [];

  switch (reminder.recurrenceFrequency) {
    case "weekly":
    case "biweekly":
      return weeklyDueDates(reminder, first, end);
    case "monthly":
      return calendarDueDates(reminder, first, end, "monthly");
    case "yearly":
      return calendarDueDates(reminder, first, end, "yearly");
  }
}

function weeklyDueDates(reminder: FamilyReminder, first: Date, end: Date): Date[] {
  const selected = new Set(reminder.recurrenceWeekdays ?? []);
  if (selected.size === 0) return [];
  const baseInterval = Math.max(1, reminder.recurrenceInterval ?? 1);
  const intervalWeeks = reminder.recurrenceFrequency === "biweekly"
    ? baseInterval * 2
    : baseInterval;
  const timeZone = reminder.recurrenceTimeZone ?? undefined;
  if (!timeZone) {
    // Legacy iOS clients stored a local weekday but no time zone. Treat the
    // authored due instant as the first selected local weekday, allowing the
    // common ±1-day UTC boundary to be inferred without guessing an offset.
    const utcWeekday = first.getUTCDay() || 7;
    const previousWeekday = utcWeekday === 1 ? 7 : utcWeekday - 1;
    const nextWeekday = utcWeekday === 7 ? 1 : utcWeekday + 1;
    const logicalDayOffset = selected.has(utcWeekday) ? 0
      : selected.has(previousWeekday) ? -1
      : selected.has(nextWeekday) ? 1
      : 0;
    const firstDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate())
      + logicalDayOffset * dayMilliseconds;
    const firstWeekday = new Date(firstDay).getUTCDay() || 7;
    const anchorWeek = firstDay - (firstWeekday - 1) * dayMilliseconds;
    const results: Date[] = [];
    for (let candidate = first; candidate <= end; candidate = new Date(candidate.getTime() + dayMilliseconds)) {
      const utcDay = Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate());
      const logicalDay = utcDay + logicalDayOffset * dayMilliseconds;
      const elapsedWeeks = Math.floor((logicalDay - anchorWeek) / (7 * dayMilliseconds));
      const logicalWeekday = new Date(logicalDay).getUTCDay() || 7;
      if (elapsedWeeks % intervalWeeks === 0 && selected.has(logicalWeekday)) results.push(candidate);
    }
    return results;
  }

  const firstParts = zonedParts(first, timeZone);
  const endParts = zonedParts(end, timeZone);
  const firstDay = Date.UTC(firstParts.year, firstParts.month - 1, firstParts.day);
  const endDay = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  const firstWeekday = new Date(firstDay).getUTCDay() || 7;
  const anchorWeek = firstDay - (firstWeekday - 1) * dayMilliseconds;
  const results: Date[] = [];
  for (let localDay = firstDay; localDay <= endDay; localDay += dayMilliseconds) {
    const date = new Date(localDay);
    const elapsedWeeks = Math.floor((localDay - anchorWeek) / (7 * dayMilliseconds));
    if (elapsedWeeks % intervalWeeks !== 0 || !selected.has(date.getUTCDay() || 7)) continue;
    const occurrence = instantForZonedParts({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: firstParts.hour,
      minute: firstParts.minute,
      second: firstParts.second,
    }, first.getUTCMilliseconds(), timeZone);
    if (occurrence && occurrence >= first && occurrence <= end) results.push(occurrence);
  }
  return results;
}

function calendarDueDates(
  reminder: FamilyReminder,
  first: Date,
  end: Date,
  frequency: "monthly" | "yearly",
): Date[] {
  const timeZone = reminder.recurrenceTimeZone ?? "UTC";
  const anchor = zonedParts(first, timeZone);
  const interval = Math.max(1, reminder.recurrenceInterval ?? 1);
  const results: Date[] = [];
  for (let offset = 0; ; offset += interval) {
    const monthIndex = frequency === "monthly"
      ? anchor.year * 12 + anchor.month - 1 + offset
      : (anchor.year + offset) * 12 + anchor.month - 1;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12 + 1;
    const day = Math.min(anchor.day, daysInMonth(year, month));
    const occurrence = instantForZonedParts({
      year, month, day,
      hour: anchor.hour,
      minute: anchor.minute,
      second: anchor.second,
    }, first.getUTCMilliseconds(), timeZone);
    if (!occurrence || occurrence > end) break;
    if (occurrence >= first) results.push(occurrence);
  }
  return results;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
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
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
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
    parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second, millisecond,
  );
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      actual.year, actual.month - 1, actual.day,
      actual.hour, actual.minute, actual.second, millisecond,
    );
    const adjustment = desired - represented;
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }
  return null;
}
