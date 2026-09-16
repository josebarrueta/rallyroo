import type {
  Account,
  FamilyEvent,
  FamilyReminder,
  ScheduleOccurrenceReference,
  ScheduleOccurrenceState,
} from "./domain.js";
import { eventOccurrenceStarts } from "./event-recurrence.js";

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
  ): Promise<ScheduleOccurrenceState> {
    if (account.role !== "parent") {
      throw new OccurrenceLifecycleError("parent_required", 403);
    }
    const reference = await this.requireOccurrence(account, untrustedReference);
    return this.repository.setOccurrenceDisposition(account.familyID, reference, "skipped");
  }

  async delete(
    account: Account,
    untrustedReference: ScheduleOccurrenceReference,
   ): Promise<ScheduleOccurrenceState> {
    if (account.role !== "parent") {
      throw new OccurrenceLifecycleError("parent_required", 403);
      }
    const reference = await this.requireOccurrence(account, untrustedReference);
    return this.repository.setOccurrenceDisposition(account.familyID, reference, "deleted");
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

  private async requireOccurrence(
    account: Account,
    untrustedReference: ScheduleOccurrenceReference,
  ): Promise<ScheduleOccurrenceReference> {
    const reference = canonicalReference(untrustedReference);
    if (reference.kind === "event") {
      const events = await this.repository.eventsForFamily(account.familyID);
      if (eventOccurrenceExists(events, reference)) return reference;
    }
    // Reminder expansion is added as the next vertical lifecycle slice.
    throw new OccurrenceLifecycleError("occurrence_not_found", 404);
  }
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
