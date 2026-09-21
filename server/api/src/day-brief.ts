import type {
  Account,
  FamilyEvent,
  FamilyReminder,
  ScheduleOccurrenceState,
} from "./domain.js";
import { eventOccurrenceStarts } from "./event-recurrence.js";
import type { NotificationCenterModule } from "./notification-center.js";

export interface DayBriefPreferences {
  familyID: string;
  memberID: string;
  enabled: boolean;
  timeZone: string;
  weekdayTime: string;
  weekendHolidayTime: string;
  earlyEventLeadMinutes: number;
  holidayRegion: string;
}

export interface DayBriefRecord extends DayBrief {
  familyID: string;
  memberID: string;
  generatedAt: string;
}

export interface DayBriefPersistence {
  preferences(familyID: string, memberID: string): Promise<DayBriefPreferences | null>;
  savePreferences(preferences: DayBriefPreferences): Promise<void>;
  enabledPreferences(limit: number): Promise<DayBriefPreferences[]>;
  saveDayBriefIfAbsent(record: DayBriefRecord): Promise<boolean>;
  dayBrief(familyID: string, memberID: string, localDate: string): Promise<DayBriefRecord | null>;
}

export interface DayBriefRepository {
  eventsForFamily(familyID: string): Promise<FamilyEvent[]>;
  importedEventsForMember(familyID: string, memberID: string): Promise<FamilyEvent[]>;
  remindersForFamily(familyID: string): Promise<FamilyReminder[]>;
  occurrenceStatesForFamily(familyID: string): Promise<ScheduleOccurrenceState[]>;
  enabledPreferences(limit: number): Promise<DayBriefPreferences[]>;
  saveDayBriefIfAbsent(record: DayBriefRecord): Promise<boolean>;
  dayBrief(familyID: string, memberID: string, localDate: string): Promise<DayBriefRecord | null>;
}

export type DayBriefEventRole = "driver" | "participant" | "personal_calendar";

export interface DayBriefEventFact {
  id: string;
  title: string;
  scheduledAt: string;
  startTime: string;
  endTime: string;
  location: string | null;
  roles: DayBriefEventRole[];
}

export interface DayBriefReminderFact {
  id: string;
  title: string;
  dueAt: string;
}

export interface DayBrief {
  localDate: string;
  timeZone: string;
  facts: {
    events: DayBriefEventFact[];
    reminders: DayBriefReminderFact[];
  };
  title: string;
  body: string;
}

export interface DayBriefNarratorInput {
  localDate: string;
  timeZone: string;
  facts: DayBrief["facts"];
  deterministicTitle: string;
  deterministicBody: string;
}

export interface DayBriefNarrator {
  narrate(input: DayBriefNarratorInput): Promise<{ title: string; body: string }>;
}

export interface DayBriefDispatchResult {
  evaluated: number;
  recorded: number;
  failed: number;
}

export class DayBriefModule {
  constructor(
    private readonly repository: DayBriefRepository,
    private readonly notificationCenter?: NotificationCenterModule,
    private readonly narrator?: DayBriefNarrator,
  ) {}

  async generate(account: Account, localDate: string, timeZone: string): Promise<DayBrief> {
    return this.buildBrief(account, localDate, timeZone, true);
  }

  private async buildBrief(
    account: Account,
    localDate: string,
    timeZone: string,
    allowNarration: boolean,
  ): Promise<DayBrief> {
    const [familyEvents, importedEvents, familyReminders, occurrenceStates] = await Promise.all([
      this.repository.eventsForFamily(account.familyID),
      this.repository.importedEventsForMember(account.familyID, account.memberID),
      this.repository.remindersForFamily(account.familyID),
      this.repository.occurrenceStatesForFamily(account.familyID),
    ]);

    const events = [
      ...familyEvents.flatMap((event): DayBriefEventFact[] => {
        const roles: DayBriefEventRole[] = [];
        if (event.driverMemberID === account.memberID) roles.push("driver");
        if (event.participantIDs.includes(account.memberID)) roles.push("participant");
        if (roles.length === 0) return [];
        return eventFactsForDay(event, roles, localDate, timeZone)
          .map((fact) => stableOccurrenceFact(event, fact, occurrenceStates))
          .filter((fact) => occurrenceIsScheduled(event, fact.scheduledAt, occurrenceStates));
      }),
      ...importedEvents
        .filter((event) => localDateFor(event.startTime, timeZone) === localDate)
        .map((event) => eventFact(event, ["personal_calendar"], new Date(event.startTime))),
    ].sort((left, right) => left.startTime.localeCompare(right.startTime));

    const reminders = familyReminders
      .filter((reminder) => reminder.status === "open"
        && reminder.assigneeIDs.includes(account.memberID)
        && localDateFor(reminder.dueAt, timeZone) === localDate)
      .map((reminder): DayBriefReminderFact => ({
        id: reminder.id,
        title: reminder.title,
        dueAt: reminder.dueAt,
      }))
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));

    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone,
    }).format(new Date(`${localDate}T12:00:00Z`));
    const title = `Your ${weekday}: ${events.length} ${plural(events.length, "event")}, ${reminders.length} ${plural(reminders.length, "reminder")}`;
    const eventSummary = events.map((event) => {
      const time = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }).format(new Date(event.startTime));
      return `${time} ${event.title}${event.roles.includes("driver") ? " (you drive)" : ""}`;
    }).join("; ");
    const reminderSummary = reminders.length > 0
      ? `Reminder: ${reminders.map((reminder) => reminder.title).join(", ")}.`
      : "";
    const body = [eventSummary ? `${eventSummary}.` : "No events scheduled.", reminderSummary]
      .filter(Boolean)
      .join(" ");

    const brief = { localDate, timeZone, facts: { events, reminders }, title, body };
    return allowNarration ? this.narrate(brief) : brief;
  }

  async dispatchDue(now = new Date(), limit = 100): Promise<DayBriefDispatchResult> {
    if (!this.notificationCenter) throw new Error("day_brief_notifications_unavailable");
    if (!Number.isFinite(now.getTime())) throw new Error("invalid_day_brief_dispatch_time");
    const result: DayBriefDispatchResult = { evaluated: 0, recorded: 0, failed: 0 };
    const preferences = await this.repository.enabledPreferences(Math.min(Math.max(limit, 1), 200));

    for (const preference of preferences) {
      if (!preference.enabled) continue;
      const local = localParts(now, preference.timeZone);
      const localDate = `${local.year}-${twoDigits(local.month)}-${twoDigits(local.day)}`;
      const usesDayOffTime = local.weekday === 0 || local.weekday === 6
        || isPublicHoliday(localDate, preference.holidayRegion);
      const baseline = usesDayOffTime
        ? preference.weekendHolidayTime
        : preference.weekdayTime;
      const account: Account = {
        identitySubject: "",
        familyID: preference.familyID,
        memberID: preference.memberID,
        role: "parent",
      };
      try {
        const preliminaryBrief = await this.buildBrief(
          account, localDate, preference.timeZone, false,
        );
        const baselineMinute = minuteOfDay(baseline);
        const firstEventMinute = preliminaryBrief.facts.events.length > 0
          ? minuteForInstant(preliminaryBrief.facts.events[0]!.startTime, preference.timeZone)
          : Number.POSITIVE_INFINITY;
        const triggerMinute = Math.min(
          baselineMinute,
          Math.max(0, firstEventMinute - preference.earlyEventLeadMinutes),
        );
        if (local.hour * 60 + local.minute < triggerMinute) continue;
        result.evaluated += 1;
        const existing = await this.repository.dayBrief(
          preference.familyID, preference.memberID, localDate,
        );
        let brief: DayBrief = existing ?? (this.narrator
          ? await this.narrate(preliminaryBrief)
          : preliminaryBrief);
        if (!existing) {
          const inserted = await this.repository.saveDayBriefIfAbsent({
            ...brief,
            familyID: preference.familyID,
            memberID: preference.memberID,
            generatedAt: now.toISOString(),
          });
          if (!inserted) {
            brief = await this.repository.dayBrief(
              preference.familyID, preference.memberID, localDate,
            ) ?? brief;
          }
        }
        const records = await this.notificationCenter.record({
          familyID: preference.familyID,
          recipientMemberIDs: [preference.memberID],
          kind: "day_brief",
          deduplicationKey: `${preference.memberID}:${localDate}`,
          title: brief.title,
          body: brief.body,
          destination: { kind: "day_brief", id: localDate },
          occurredAt: now,
        });
        result.recorded += records.length;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  private async narrate(brief: DayBrief): Promise<DayBrief> {
    if (!this.narrator) return brief;
    try {
      const narrative = await this.narrator.narrate({
        localDate: brief.localDate,
        timeZone: brief.timeZone,
        facts: brief.facts,
        deterministicTitle: brief.title,
        deterministicBody: brief.body,
      });
      if (narrative.title.trim().length > 0 && narrative.title.length <= 300
        && narrative.body.trim().length > 0 && narrative.body.length <= 1_000) {
        return { ...brief, title: narrative.title, body: narrative.body };
      }
    } catch {
      // The verified deterministic brief remains useful when AI is unavailable or invalid.
    }
    return brief;
  }
}

function stableOccurrenceFact(
  event: FamilyEvent,
  fact: DayBriefEventFact,
  states: ScheduleOccurrenceState[],
): DayBriefEventFact {
  const seriesID = (event.recurrenceSeriesID ?? event.id).toLowerCase();
  const override = states.find((state) => state.reference.kind === "event"
    && state.reference.seriesID.toLowerCase() === seriesID
    && state.overrideEntityID?.toLowerCase() === event.id.toLowerCase());
  return override ? { ...fact, scheduledAt: override.reference.scheduledAt } : fact;
}

function occurrenceIsScheduled(
  event: FamilyEvent,
  scheduledAt: string,
  states: ScheduleOccurrenceState[],
): boolean {
  const seriesID = (event.recurrenceSeriesID ?? event.id).toLowerCase();
  const state = states.find((candidate) => candidate.reference.kind === "event"
    && candidate.reference.seriesID.toLowerCase() === seriesID
    && candidate.reference.scheduledAt === scheduledAt);
  return state?.disposition !== "skipped" && state?.disposition !== "deleted";
}

function eventFactsForDay(
  event: FamilyEvent,
  roles: DayBriefEventRole[],
  localDate: string,
  timeZone: string,
): DayBriefEventFact[] {
  const sourceStart = new Date(event.startTime);
  const duration = new Date(event.endTime).getTime() - sourceStart.getTime();
  const expansionHorizon = new Date(`${localDate}T12:00:00.000Z`);
  expansionHorizon.setUTCDate(expansionHorizon.getUTCDate() + 2);
  return eventOccurrenceStarts(event, expansionHorizon)
    .filter((start) => localDateFor(start.toISOString(), timeZone) === localDate)
    .map((start) => eventFact(event, roles, start, duration));
}

function eventFact(
  event: FamilyEvent,
  roles: DayBriefEventRole[],
  start: Date,
  duration = new Date(event.endTime).getTime() - new Date(event.startTime).getTime(),
): DayBriefEventFact {
  return {
    id: event.id,
    title: event.title,
    scheduledAt: start.toISOString(),
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + duration).toISOString(),
    location: event.location,
    roles,
  };
}

function localParts(instant: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
} {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (const part of formatter.formatToParts(instant)) values[part.type] = part.value;
  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: weekdays[values.weekday ?? ""] ?? -1,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, "0");
}

function isPublicHoliday(localDate: string, region: string): boolean {
  if (region.toUpperCase() !== "US") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = Date.UTC(year, month - 1, day);
  const parsed = new Date(target);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) return false;
  const weekday = (instant: number) => new Date(instant).getUTCDay();
  const observed = (instant: number) => {
    const dayOfWeek = weekday(instant);
    if (dayOfWeek === 6) return instant - 24 * 60 * 60 * 1_000;
    if (dayOfWeek === 0) return instant + 24 * 60 * 60 * 1_000;
    return instant;
  };
  const nthWeekday = (candidateYear: number, candidateMonth: number, dayOfWeek: number, nth: number) => {
    const first = weekday(Date.UTC(candidateYear, candidateMonth - 1, 1));
    return Date.UTC(
      candidateYear,
      candidateMonth - 1,
      1 + ((dayOfWeek - first + 7) % 7) + (nth - 1) * 7,
    );
  };
  const lastWeekday = (candidateYear: number, candidateMonth: number, dayOfWeek: number) => {
    const lastDay = new Date(Date.UTC(candidateYear, candidateMonth, 0)).getUTCDate();
    const lastDayWeekday = weekday(Date.UTC(candidateYear, candidateMonth - 1, lastDay));
    return Date.UTC(
      candidateYear,
      candidateMonth - 1,
      lastDay - ((lastDayWeekday - dayOfWeek + 7) % 7),
    );
  };
  const fixed = [
    Date.UTC(year, 0, 1), Date.UTC(year, 5, 19), Date.UTC(year, 6, 4),
    Date.UTC(year, 10, 11), Date.UTC(year, 11, 25),
    Date.UTC(year + 1, 0, 1),
  ];
  const moving = [
    nthWeekday(year, 1, 1, 3), nthWeekday(year, 2, 1, 3),
    lastWeekday(year, 5, 1), nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 10, 1, 2), nthWeekday(year, 11, 4, 4),
  ];
  return fixed.some((holiday) => observed(holiday) === target)
    || moving.includes(target);
}

function minuteOfDay(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error("invalid_day_brief_time");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("invalid_day_brief_time");
  return hour * 60 + minute;
}

function minuteForInstant(instant: string, timeZone: string): number {
  const parts = localParts(new Date(instant), timeZone);
  return parts.hour * 60 + parts.minute;
}

function localDateFor(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(instant));
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
