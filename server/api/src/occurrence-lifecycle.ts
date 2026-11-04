import type {
  Account,
  FamilyEvent,
  FamilyReminder,
  ScheduleOccurrenceReference,
  ScheduleOccurrenceState,
} from "./domain.js";
import { eventLocalISOWeekday, eventOccurrenceStarts } from "./event-recurrence.js";

export type OccurrenceScope = "this_occurrence" | "this_weekday_future" | "all_future";

// Rendering context for legacy rules only; never part of durable occurrence identity.
export interface OccurrenceLifecycleReference extends ScheduleOccurrenceReference {
  timeZone?: string | undefined;
}

export interface OccurrenceLifecycleRepository {
  eventsForFamily(familyID: string): Promise<FamilyEvent[]>;
  remindersForFamily(familyID: string): Promise<FamilyReminder[]>;
  occurrenceStatesForFamily(familyID: string): Promise<ScheduleOccurrenceState[]>;
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
    readonly code:
      | "invalid_occurrence_reference"
      | "occurrence_not_found"
      | "occurrence_not_skipped"
      | "parent_required",
    readonly statusCode: 400 | 403 | 404 | 409,
  ) {
    super(code);
  }
}

export class OccurrenceLifecycleModule {
  constructor(private readonly repository: OccurrenceLifecycleRepository) {}

  async skip(
    account: Account,
    untrustedReference: OccurrenceLifecycleReference,
    scope: OccurrenceScope = "this_occurrence",
  ): Promise<ScheduleOccurrenceState[]> {
    if (account.role !== "parent") {
      throw new OccurrenceLifecycleError("parent_required", 403);
    }
    const reference = await this.requireOccurrence(account, untrustedReference);
    const targets = await this.resolveScope(account, reference, scope, untrustedReference.timeZone);
    return Promise.all(
      targets.map((ref) => this.repository.setOccurrenceDisposition(account.familyID, ref, "skipped")),
    );
  }

  async restore(
    account: Account,
    untrustedReference: OccurrenceLifecycleReference,
    scope: OccurrenceScope = "this_occurrence",
  ): Promise<ScheduleOccurrenceState[]> {
    if (account.role !== "parent") {
      throw new OccurrenceLifecycleError("parent_required", 403);
    }
    const reference = await this.requireOccurrence(account, untrustedReference);
    const states = await this.repository.occurrenceStatesForFamily(account.familyID);
    const skipped = new Set(states
      .filter((state) => state.disposition === "skipped")
      .map((state) => occurrenceKey(state.reference)));
    if (!skipped.has(occurrenceKey(reference))) {
      throw new OccurrenceLifecycleError("occurrence_not_skipped", 409);
    }
    const targets = (await this.resolveScope(account, reference, scope, untrustedReference.timeZone))
      .filter((target) => skipped.has(occurrenceKey(target)));
    return Promise.all(
      targets.map((ref) => this.repository.setOccurrenceDisposition(account.familyID, ref, "scheduled")),
    );
  }

  async delete(
    account: Account,
    untrustedReference: OccurrenceLifecycleReference,
    scope: OccurrenceScope = "this_occurrence",
  ): Promise<ScheduleOccurrenceState[]> {
    if (account.role !== "parent") {
      throw new OccurrenceLifecycleError("parent_required", 403);
    }
    const reference = await this.requireOccurrence(account, untrustedReference);
    const targets = await this.resolveScope(account, reference, scope, untrustedReference.timeZone);
    return Promise.all(
      targets.map((ref) => this.repository.setOccurrenceDisposition(account.familyID, ref, "deleted")),
    );
  }

  async acknowledge(
    account: Account,
    untrustedReference: OccurrenceLifecycleReference,
  ): Promise<ScheduleOccurrenceState> {
    const reference = await this.requireOccurrence(account, untrustedReference);
    return this.repository.acknowledgeOccurrence(account.familyID, reference, account.memberID);
  }

  private async resolveScope(
    account: Account,
    reference: ScheduleOccurrenceReference,
    scope: OccurrenceScope,
    timeZone?: string,
  ): Promise<ScheduleOccurrenceReference[]> {
    if (scope === "this_occurrence" || reference.kind !== "event") return [reference];

    const events = (await this.repository.eventsForFamily(account.familyID))
      .filter((event) => (event.recurrenceSeriesID ?? event.id).toLowerCase() === reference.seriesID)
      .map((event) => withLegacyTimeZone(event, timeZone));
    const scheduledAt = new Date(reference.scheduledAt);
    const sourceEvent = events.find((event) => eventOccurrenceStarts(event, scheduledAt)
      .some((start) => start.getTime() === scheduledAt.getTime()));
    if (!sourceEvent) return [reference];

    const sourceTimeZone = sourceEvent.recurrence?.timeZone;
    const targetWeekday = eventLocalISOWeekday(scheduledAt, sourceTimeZone);
    const now = new Date();
    const targets = new Map<string, ScheduleOccurrenceReference>();
    for (const event of events) {
      // Expand every bounded segment, not only the first (possibly historical) row.
      const through = new Date(event.recurrence?.endDate ?? event.startTime);
      for (const start of eventOccurrenceStarts(event, through)) {
        if (start < now) continue;
        if (scope === "this_weekday_future"
          && eventLocalISOWeekday(start, event.recurrence?.timeZone ?? sourceTimeZone) !== targetWeekday) continue;
        const target: ScheduleOccurrenceReference = {
          kind: "event",
          seriesID: reference.seriesID,
          scheduledAt: start.toISOString(),
        };
        targets.set(occurrenceKey(target), target);
      }
    }
    return [...targets.values()].sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
  }

  private async requireOccurrence(
    account: Account,
    untrustedReference: OccurrenceLifecycleReference,
  ): Promise<ScheduleOccurrenceReference> {
    const reference = canonicalReference(untrustedReference);
    if (untrustedReference.timeZone !== undefined) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: untrustedReference.timeZone }).format();
      } catch {
        throw new OccurrenceLifecycleError("invalid_occurrence_reference", 400);
      }
    }
    if (reference.kind === "event") {
      const events = (await this.repository.eventsForFamily(account.familyID))
        .map((event) => withLegacyTimeZone(event, untrustedReference.timeZone));
      if (eventOccurrenceExists(events, reference)) return reference;
    }
    if (reference.kind === "reminder") {
      const reminders = await this.repository.remindersForFamily(account.familyID);
      if (reminderOccurrenceExists(reminders, reference)) return reference;
    }
    throw new OccurrenceLifecycleError("occurrence_not_found", 404);
  }
}

function withLegacyTimeZone(event: FamilyEvent, timeZone?: string): FamilyEvent {
  // A supplied zone must never override a series' authoritative saved zone.
  if (!timeZone || !event.recurrence || event.recurrence.timeZone) return event;
  return { ...event, recurrence: { ...event.recurrence, timeZone } };
}

function occurrenceKey(reference: ScheduleOccurrenceReference): string {
  return `${reference.kind}:${reference.seriesID.toLowerCase()}:${new Date(reference.scheduledAt).toISOString()}`;
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
