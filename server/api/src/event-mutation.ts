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
      if (previous.driverAssignmentMemberID) {
        await this.recordDriverAssignment(input, previous.driverAssignmentMemberID, false);
      }
      return this.deliverImmediately(previous);
    }
    const eventID = input.event.id.toLowerCase();
    let newlyAssignedDriverMemberID: string | undefined;
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
        if (input.event.driverMemberID
          && input.event.driverMemberID !== existingEvent?.driverMemberID
          && input.event.driverMemberID !== input.account.memberID) {
          newlyAssignedDriverMemberID = input.event.driverMemberID;
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
            ...(newlyAssignedDriverMemberID ? {
              driverAssignmentMemberID: newlyAssignedDriverMemberID,
            } : {}),
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
    if (storedResult.driverAssignmentMemberID) {
      await this.recordDriverAssignment(input, storedResult.driverAssignmentMemberID);
    }
    return this.deliverImmediately(storedResult);
  }

  private async recordDriverAssignment(input: {
    account: Account;
    event: FamilyEvent;
    idempotencyKey: string;
  }, driverMemberID: string, dispatchImmediately = true): Promise<void> {
    const title = "You're assigned to drive";
    const body = `${input.event.title} has you listed as the driver.`;
    const intent: NotificationIntent = {
      familyID: input.account.familyID,
      recipientMemberIDs: [driverMemberID],
      kind: "driver_assignment",
      deduplicationKey: `${input.idempotencyKey}:${driverMemberID}`,
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
