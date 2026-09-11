import { randomUUID } from "node:crypto";
import type { Account, EventConflict, FamilyEvent } from "./domain.js";
import { eventOccurrenceStarts } from "./event-recurrence.js";
import type {
  EventMutationPersistence,
  EventMutationResult,
  ScheduleUpdateNotificationOutcome,
} from "./event-mutation-persistence.js";
import type { NotificationCenterModule, NotificationIntent } from "./notification-center.js";

export interface ImportedEventReader {
  visibleEvents(familyID: string, memberID: string): Promise<FamilyEvent[]>;
  sharedEvents(familyID: string): Promise<FamilyEvent[]>;
}

export class EventMutationError extends Error {
  constructor(
    readonly code: "parent_role_required" | "imported_event_read_only" | "unknown_participant" | "invalid_driver",
    readonly statusCode: 400 | 403 | 409,
  ) {
    super(code);
    this.name = "EventMutationError";
  }
}

export interface ScheduleUpdateNotificationDispatch {
  dispatchDue(limit?: number, notificationID?: string): Promise<ScheduleUpdateNotificationOutcome[]>;
}

export class EventMutationModule {
  constructor(private readonly dependencies: {
    persistence: EventMutationPersistence;
    importedEvents: ImportedEventReader;
    notificationDispatcher?: ScheduleUpdateNotificationDispatch;
    notificationCenter?: NotificationCenterModule;
  }) {}

  async delete(input: {
    account: Account;
    eventID: string;
    idempotencyKey: string;
  }): Promise<EventMutationResult> {
    requireParent(input.account);
    const previous = await this.dependencies.persistence.eventMutationResult(
      input.account.familyID,
      input.idempotencyKey,
    );
    if (previous) return this.deliverImmediately(previous);
    const eventID = input.eventID.toLowerCase();
    const visibleImportedEvents = await this.dependencies.importedEvents.visibleEvents(
      input.account.familyID,
      input.account.memberID,
    );
    if (visibleImportedEvents.some((event) => event.id.toLowerCase() === eventID)) {
      throw new EventMutationError("imported_event_read_only", 409);
    }
    const result = await this.dependencies.persistence.performEventMutation(
      input.account.familyID,
      input.idempotencyKey,
      () => ({
        action: { kind: "delete", eventID },
        result: { conflicts: [], notificationOutcome: "notRequested" },
      }),
    );
    return { conflicts: result.conflicts, notificationOutcome: result.notificationOutcome };
  }

  async save(input: {
    account: Account;
    event: FamilyEvent;
    idempotencyKey: string;
    notifyParticipants: boolean;
  }): Promise<EventMutationResult> {
    requireParent(input.account);
    const previous = await this.dependencies.persistence.eventMutationResult(
      input.account.familyID,
      input.idempotencyKey,
    );
    if (previous) {
      for (const change of previous.driverChanges ?? []) {
        await this.recordDriverChange(input, change, false);
      }
      return this.deliverImmediately(previous);
    }
    const eventID = input.event.id.toLowerCase();
    let driverChanges: Array<{ memberID: string; change: "assigned" | "removed" }> = [];
    const [visibleImportedEvents, sharedImportedEvents] = await Promise.all([
      this.dependencies.importedEvents.visibleEvents(input.account.familyID, input.account.memberID),
      this.dependencies.importedEvents.sharedEvents(input.account.familyID),
    ]);
    if (visibleImportedEvents.some((event) => event.id.toLowerCase() === eventID)) {
      throw new EventMutationError("imported_event_read_only", 409);
    }

    const notificationID = randomUUID();
    const storedResult = await this.dependencies.persistence.performEventMutation(
      input.account.familyID,
      input.idempotencyKey,
      ({ events, members }) => {
        const memberIDs = new Set(members.map((member) => member.id));
        const referencedMemberIDs = [
          ...input.event.participantIDs,
          ...(input.event.kidID ? [input.event.kidID] : []),
        ];
        if (referencedMemberIDs.some((memberID) => !memberIDs.has(memberID))) {
          throw new EventMutationError("unknown_participant", 400);
        }
        if (input.event.driverMemberID && input.event.driver) {
          throw new EventMutationError("invalid_driver", 400);
        }
        if (input.event.driverMemberID) {
          const driverMember = members.find((member) => member.id === input.event.driverMemberID);
          if (!driverMember || (driverMember.role === "kid" && driverMember.canDrive !== true)) {
            throw new EventMutationError("invalid_driver", 400);
          }
        }
        const existingEvent = events.find((candidate) => candidate.id.toLowerCase() === eventID);
        if (input.event.driverMemberID !== existingEvent?.driverMemberID) {
          driverChanges = [
            ...(existingEvent?.driverMemberID && existingEvent.driverMemberID !== input.account.memberID
              ? [{ memberID: existingEvent.driverMemberID, change: "removed" as const }] : []),
            ...(input.event.driverMemberID && input.event.driverMemberID !== input.account.memberID
              ? [{ memberID: input.event.driverMemberID, change: "assigned" as const }] : []),
          ];
        }
        const recurrence = preserveWeeklyWeekdays(input.event.recurrence, existingEvent?.recurrence);
        const event: FamilyEvent = {
          ...input.event,
          id: eventID,
          familyID: input.account.familyID,
          ...(recurrence !== undefined ? { recurrence } : {}),
        };
        const nativeOthers = events.filter((candidate) => candidate.id.toLowerCase() !== eventID);
        const conflicts = detectEventConflicts(event, [...nativeOthers, ...visibleImportedEvents]);
        const familyVisibleConflicts = detectEventConflicts(event, [
          ...nativeOthers,
          ...sharedImportedEvents,
        ]);
        const participantIDs = event.participantIDs.filter((id) =>
          id !== input.account.memberID && id !== event.driverMemberID
        );
        const shouldNotify = input.notifyParticipants && participantIDs.length > 0;
        return {
          action: { kind: "save", event },
          result: {
            conflicts,
            notificationOutcome: input.notifyParticipants
              ? (shouldNotify ? "queuedForRetry" : "noRecipients")
              : "notRequested",
            ...(shouldNotify ? { notificationID } : {}),
            ...(driverChanges.length > 0 ? { driverChanges } : {}),
          },
          ...(shouldNotify ? {
            notification: {
              id: notificationID,
              eventID: event.id,
              title: event.title,
              body: familyVisibleConflicts.length > 0
                ? "Schedule conflict detected. Open Rallyroo to review."
                : "Your family schedule was updated.",
              participantIDs,
            },
          } : {}),
        };
      },
    );
    for (const change of storedResult.driverChanges ?? []) {
      await this.recordDriverChange(input, change);
    }
    return this.deliverImmediately(storedResult);
  }


  async recurringEdit(input: {
    account: Account;
    upserts: FamilyEvent[];
    deleteIDs: string[];
    idempotencyKey: string;
    notifyParticipants: boolean;
    }): Promise<EventMutationResult> {
    requireParent(input.account);
    const previous = await this.dependencies.persistence.eventMutationResult(
      input.account.familyID,
      input.idempotencyKey,
    );
    if (previous) return this.deliverImmediately(previous);
    if (input.upserts.length === 0) {
      throw new EventMutationError("invalid_driver", 400);
    }
    const importedEvents = await this.dependencies.importedEvents.visibleEvents(
      input.account.familyID,
      input.account.memberID,
    );
    const importedIDs = new Set(importedEvents.map((event) => event.id.toLowerCase()));
    const deleteLookup = new Set(input.deleteIDs.map((id) => id.toLowerCase()));
    for (const upsert of input.upserts) {
      if (importedIDs.has(upsert.id.toLowerCase())) {
        throw new EventMutationError("imported_event_read_only", 409);
      }
      if (deleteLookup.has(upsert.id.toLowerCase())) {
        throw new EventMutationError("invalid_driver", 400);
      }
    }

    const notificationID = randomUUID();
    const storedResult = await this.dependencies.persistence.performEventMutation(
      input.account.familyID,
      input.idempotencyKey,
      ({ events, members }) => {
        const memberIDs = new Set(members.map((member) => member.id));
        const upsertedEvents: FamilyEvent[] = [];
        for (const upsert of input.upserts) {
          const eventID = upsert.id.toLowerCase();
          for (const memberID of [...upsert.participantIDs, ...(upsert.kidID ? [upsert.kidID] : [])]) {
            if (!memberIDs.has(memberID)) {
              throw new EventMutationError("unknown_participant", 400);
            }
          }
          if (upsert.driverMemberID && upsert.driver) {
            throw new EventMutationError("invalid_driver", 400);
          }
          if (upsert.driverMemberID) {
            const driverMember = members.find((member) => member.id === upsert.driverMemberID);
            if (!driverMember || (driverMember.role === "kid" && driverMember.canDrive !== true)) {
              throw new EventMutationError("invalid_driver", 400);
            }
          }
          const existing = events.find((candidate) => candidate.id.toLowerCase() === eventID);
          const recurrence = preserveWeeklyWeekdays(upsert.recurrence, existing?.recurrence);
          upsertedEvents.push({
              ...upsert,
            id: eventID,
            familyID: input.account.familyID,
          ...(recurrence !== undefined ? { recurrence } : {}),
          });
        }

        const keptIDs = new Set(upsertedEvents.map((event) => event.id));
        const nativeOthers = events.filter((candidate) => !keptIDs.has(candidate.id.toLowerCase()));
        const conflicts = upsertedEvents.flatMap((event) =>
          detectEventConflicts(event, [...nativeOthers, ...importedEvents])
        );
        const primary = upsertedEvents[0];
        if (!primary) {
          throw new EventMutationError("invalid_driver", 400);
          }
        const driverID = primary.driverMemberID;
        const participantIDs = primary.participantIDs.filter(
          (id) => id !== input.account.memberID && id !== driverID,
        );
        const shouldNotify = input.notifyParticipants && participantIDs.length > 0;
        const deleteIDs = Array.from(new Set(input.deleteIDs.map((id) => id.toLowerCase())));
        return {
          action: { kind: "recurringEdit", deleteIDs, upserts: upsertedEvents },
          result: {
            conflicts,
            notificationOutcome: input.notifyParticipants
              ? (shouldNotify ? "queuedForRetry" : "noRecipients")
              : "notRequested",
            ...(shouldNotify ? { notificationID } : {}),
          },
          ...(shouldNotify ? {
            notification: {
              id: notificationID,
              eventID: primary.id,
              title: primary.title,
              body: "Your family schedule was updated.",
              participantIDs,
            },
          } : {}),
        };
      },
    );
    return this.deliverImmediately(storedResult);
  }

  private async recordDriverChange(input: {
    account: Account;
    event: FamilyEvent;
    idempotencyKey: string;
  }, driverChange: { memberID: string; change: "assigned" | "removed" }, dispatchImmediately = true): Promise<void> {
    const title = driverChange.change === "assigned" ? "You're assigned to drive" : "Driver assignment changed";
    const body = driverChange.change === "assigned"
      ? `${input.event.title} has you listed as the driver.`
      : `You are no longer listed as the driver for ${input.event.title}.`;
    const intent: NotificationIntent = {
      familyID: input.account.familyID,
      recipientMemberIDs: [driverChange.memberID],
      kind: "driver_assignment",
      deduplicationKey: `${input.idempotencyKey}:${driverChange.memberID}:${driverChange.change}`,
      title,
      body,
      destination: { kind: "event", id: input.event.id.toLowerCase() },
      occurredAt: new Date(),
    };
    if (dispatchImmediately) {
      await this.dependencies.notificationCenter?.recordAndDispatch(intent);
    } else {
      await this.dependencies.notificationCenter?.record(intent);
    }
  }

  private async deliverImmediately(storedResult: {
    conflicts: EventConflict[];
    notificationOutcome: ScheduleUpdateNotificationOutcome;
    notificationID?: string;
  }): Promise<EventMutationResult> {
    let notificationOutcome = storedResult.notificationOutcome;
    if (
      notificationOutcome === "queuedForRetry"
      && storedResult.notificationID
      && this.dependencies.notificationDispatcher
    ) {
      const outcomes = await this.dependencies.notificationDispatcher.dispatchDue(
        1,
        storedResult.notificationID,
      );
      notificationOutcome = outcomes[0] ?? notificationOutcome;
    }
    return { conflicts: storedResult.conflicts, notificationOutcome };
  }
}

function requireParent(account: Account): void {
  if (account.role !== "parent") throw new EventMutationError("parent_role_required", 403);
}

function preserveWeeklyWeekdays(
  recurrence: FamilyEvent["recurrence"],
  existingRecurrence: FamilyEvent["recurrence"],
): FamilyEvent["recurrence"] {
  const existingWeekdays = existingRecurrence?.weekdays;
  return recurrence?.frequency === "weekly"
    && recurrence.weekdays === undefined
    && existingWeekdays?.length
    ? { ...recurrence, weekdays: existingWeekdays }
    : recurrence;
}

export function detectEventConflicts(
  event: FamilyEvent,
  existingEvents: FamilyEvent[],
): EventConflict[] {
  const conflicts: EventConflict[] = [];
  const rangeEnd = [event, ...existingEvents].reduce((latest, candidate) => {
    const candidateEnd = new Date(candidate.recurrence?.endDate ?? candidate.endTime);
    return candidateEnd > latest ? candidateEnd : latest;
  }, new Date(event.endTime));
  const eventOccurrences = occurrenceRanges(event, rangeEnd);
  for (const existing of existingEvents) {
    const overlaps = eventOccurrences.some((occurrence) =>
      occurrenceRanges(existing, rangeEnd).some((existingOccurrence) =>
        occurrence.start < existingOccurrence.end && existingOccurrence.start < occurrence.end
      )
    );
    if (!overlaps) continue;
    const memberID = event.participantIDs.find((id) => existing.participantIDs.includes(id));
    if (memberID) {
      conflicts.push({
        kind: "overlapping_participant",
        memberID,
        driver: null,
        eventIDs: [existing.id, event.id],
      });
    } else if (event.driverMemberID && event.driverMemberID === existing.driverMemberID) {
      conflicts.push({
        kind: "double_booked_driver",
        memberID: event.driverMemberID,
        driver: null,
        eventIDs: [existing.id, event.id],
      });
    } else if (!event.driverMemberID && !existing.driverMemberID
      && event.driver && event.driver === existing.driver) {
      conflicts.push({
        kind: "double_booked_driver",
        memberID: null,
        driver: event.driver,
        eventIDs: [existing.id, event.id],
      });
    }
  }
  return conflicts;
}

function occurrenceRanges(event: FamilyEvent, rangeEnd: Date): Array<{ start: Date; end: Date }> {
  const firstStart = new Date(event.startTime);
  const duration = new Date(event.endTime).getTime() - firstStart.getTime();
  if (!event.recurrence) return [{ start: firstStart, end: new Date(firstStart.getTime() + duration) }];
  return eventOccurrenceStarts(event, rangeEnd).map((start) => ({
    start,
    end: new Date(start.getTime() + duration),
  }));
}
