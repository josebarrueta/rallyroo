import type { EventAllDay } from "./domain.js";

const formatters = new Map<string, Intl.DateTimeFormat>();

export function canonicalCalendarTimeZone(timeZone: string): string | null {
  if (!timeZone || timeZone.length > 100) return null;
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
    // Use named IANA zones (including UTC), not offset-only identifiers that
    // Foundation cannot reliably decode as a persisted TimeZone identifier.
    return /^[+-]/.test(name) ? null : name;
  } catch { return null; }
}

export function calendarTimeZoneIsValid(timeZone: string): boolean {
  return canonicalCalendarTimeZone(timeZone) !== null;
}

export function dateOnlyIsValid(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The first real instant of a Gregorian local date, including midnight DST gaps/folds.
 * Probe the bounded set of nearby UTC offsets, not every recurrence or minute.
 * An entirely skipped date (e.g. Apia 2011-12-30) has no valid anchor.
 */
function startOfCalendarDate(value: string, timeZone: string): string | null {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone, era: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    if (formatters.size >= 128) formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, formatter);
  }
  const represented = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    const date = new Date(0);
    const year = parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year);
    date.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day));
    date.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), 0);
    return date;
  };
  const target = Date.parse(`${value}T00:00:00.000Z`);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = target + hours * 3_600_000;
    offsets.add(represented(sample).getTime() - sample);
  }
  const candidates = [...offsets].map((offset) => target - offset)
    .filter((candidate) => represented(candidate).toISOString().slice(0, 10) === value);
  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null;
}

export function allDayTimes(allDay: EventAllDay): { startTime: string; endTime: string } | null {
  const timeZone = canonicalCalendarTimeZone(allDay.timeZone);
  if (!dateOnlyIsValid(allDay.startDate) || !dateOnlyIsValid(allDay.endDate)
    || allDay.endDate <= allDay.startDate || !timeZone) return null;
  const startTime = startOfCalendarDate(allDay.startDate, timeZone);
  const endTime = startOfCalendarDate(allDay.endDate, timeZone);
  return startTime && endTime && endTime > startTime ? { startTime, endTime } : null;
}
