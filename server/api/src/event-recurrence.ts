import type { FamilyEvent } from "./domain.js";

const dayMilliseconds = 24 * 60 * 60 * 1_000;

/** Expands a native event's bounded recurrence into occurrence start instants. */
export function eventOccurrenceStarts(event: FamilyEvent, through: Date): Date[] {
  const first = new Date(event.startTime);
  if (!event.recurrence) return [first];
  const end = new Date(Math.min(new Date(event.recurrence.endDate).getTime(), through.getTime()));
  if (event.recurrence.frequency === "weekly" && event.recurrence.weekdays?.length) {
    return weeklyOccurrenceStarts(first, end, event.recurrence.interval, event.recurrence.weekdays);
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
): Date[] {
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
