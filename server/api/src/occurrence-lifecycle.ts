import type {
  Account,
  FamilyEvent,
  FamilyReminder,
  ScheduleOccurrenceReference,
  ScheduleOccurrenceState,
} from "./domain.js";
import { eventOccurrenceStarts } from "./event-recurrence.js";

export type OccurrenceScope = "this_occurrence" | "this_weekday_future" | "all_future";

export interface OccurrenceLifecycleRepository {
  eventsForFamily(familyID: string): Promise<FamilyEvent[]>;
  remindersForFamily(familyID: string): Promise<FamilyReminder[]>;
  acknowledgeOccurrence(
    familyID: string,
    reference: ScheduleOccurrenceReference,
    memberID: string,
   ): Promise<ScheduleOccurrenceState>;
  setOccurrenceDisposition(
    familyID: string,
    reference: ScheduleOccurrenceReference,
    disposition: ScheduleOccurrenceState["disposition"],
   ): Promise<ScheduleOccurrenceState>;
}

export class OccurrenceLifecycleError extends Error {
  constructor(
    readonly code: "invalid_occurrence_reference" | "occurrence_not_found" | "parent_required",
    readonly statusCode: 400 | 403 | 404,
   ) {
    super(code);
   }
}

export class OccurrenceLifecycleModule {
  constructor(private readonly repository: OccurrenceLifecycleRepository) {}

  async skip(
    account: Account,
    untrustedReference: ScheduleOccurrenceReference,
    scope: OccurrenceScope = "this_occurrence",
   ): Promise<ScheduleOccurrenceState[]> {
    if (account.role !== "parent") {
      throw new OccurrenceLifecycleError("parent_required", 403);
     }
    const reference = await this.requireOccurrence(account, untrustedReference);
    const targets = await this.resolveScope(account, reference, scope);
    return Promise.all(
      targets.map((ref) => this.repository.setOccurrenceDisposition(account.familyID, ref, "skipped")),
     );
   }

  async delete(
    account: Account,
    untrustedReference: ScheduleOccurrenceReference,
    scope: OccurrenceScope = "this_occurrence",
    ): Promise<ScheduleOccurrenceState[]> {
    if (account.role !== "parent") {
      throw new OccurrenceLifecycleError("parent_required", 403);
       }
    const reference = await this.requireOccurrence(account, untrustedReference);
    const targets = await this.resolveScope(account, reference, scope);
    return Promise.all(
      targets.map((ref) => this.repository.setOccurrenceDisposition(account.familyID, ref, "deleted")),
       );
     }

  async acknowledge(
    account: Account,
    untrustedReference: ScheduleOccurrenceReference,
   ): Promise<ScheduleOccurrenceState> {
    const reference = await this.requireOccurrence(account, untrustedReference);
    return this.repository.acknowledgeOccurrence(
      account.familyID,
      reference,
      account.memberID,
     );
   }

  private async resolveScope(
    account: Account,
    reference: ScheduleOccurrenceReference,
    scope: OccurrenceScope,
   ): Promise<ScheduleOccurrenceReference[]> {
    if (scope === "this_occurrence") return [reference];

    const events = await this.repository.eventsForFamily(account.familyID);
    const sourceEvent = events.find((event) => {
      const seriesID = (event.recurrenceSeriesID ?? event.id).toLowerCase();
      return seriesID === reference.seriesID;
      });
    if (!sourceEvent) return [reference];

    const now = new Date();
    const aYearFromNow = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
    const starts = eventOccurrenceStarts(sourceEvent, aYearFromNow);
    const future = starts.filter((start) => start >= now);

    if (scope === "all_future") {
      return future.map((start) => ({
          kind: "event" as const,
          seriesID: reference.seriesID,
          scheduledAt: start.toISOString(),
          }));
        }

     // scope === "this_weekday_future"
    const targetWeekday = starts.find((start) => start.getTime() === new Date(reference.scheduledAt).getTime());
    if (!targetWeekday) return [reference];
    const targetWeekdayIdx = weekdayIndex(targetWeekday);
    return future
         .filter((start) => weekdayIndex(start) === targetWeekdayIdx)
         .map((start) => ({
             kind: "event" as const,
             seriesID: reference.seriesID,
             scheduledAt: start.toISOString(),
             }));
     }

  private async requireOccurrence(
    account: Account,
    untrustedReference: ScheduleOccurrenceReference,
   ): Promise<ScheduleOccurrenceReference> {
    const reference = canonicalReference(untrustedReference);
    if (reference.kind === "event") {
      const events = await this.repository.eventsForFamily(account.familyID);
      if (eventOccurrenceExists(events, reference)) return reference;
     }
      if (reference.kind === "reminder") {
        const reminders = await this.repository.remindersForFamily(account.familyID);
        if (reminderOccurrenceExists(reminders, reference)) return reference;
         }
    throw new OccurrenceLifecycleError("occurrence_not_found", 404);
   }
}

function weekdayIndex(date: Date): number {
   // 0=Monday, 6=Sunday, based on UTC
    const day = date.getUTCDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    return day === 0 ? 6 : day - 1;
   }

function canonicalReference(reference: ScheduleOccurrenceReference): ScheduleOccurrenceReference {
  const scheduledAt = new Date(reference.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new OccurrenceLifecycleError("invalid_occurrence_reference", 400);
   }
  return {
    kind: reference.kind,
    seriesID: reference.seriesID.toLowerCase(),
    scheduledAt: scheduledAt.toISOString(),
   };
}

function eventOccurrenceExists(
  events: FamilyEvent[],
  reference: ScheduleOccurrenceReference,
): boolean {
  const scheduledAt = new Date(reference.scheduledAt);
  return events.some((event) => {
    const seriesID = (event.recurrenceSeriesID ?? event.id).toLowerCase();
    if (seriesID !== reference.seriesID) return false;
    return eventOccurrenceStarts(event, scheduledAt)
       .some((start) => start.getTime() === scheduledAt.getTime());
   });
}

function reminderOccurrenceExists(
  reminders: FamilyReminder[],
  reference: ScheduleOccurrenceReference,
): boolean {
  const scheduledAt = new Date(reference.scheduledAt);
  return reminders.some((reminder) => {
    const seriesID = (reminder.recurrenceSeriesID ?? reminder.id).toLowerCase();
    if (seriesID !== reference.seriesID) return false;
    // For now, check the base dueAt matches; full expansion is a next slice.
    return new Date(reminder.dueAt).getTime() === scheduledAt.getTime();
    });
}
