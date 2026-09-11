import { randomUUID } from "node:crypto";
import type { Account, EventConflict, FamilyEvent, FamilyMember } from "./domain.js";
import { eventOccurrenceStarts } from "./event-recurrence.js";
import type {
  EventMutationPersistence,
  EventMutationResult,
  ScheduleUpdateNotificationOutcome,
  StoredEventMutationResult,
} from "./event-mutation-persistence.js";
import type { NotificationCenterModule, NotificationIntent } from "./notification-center.js";

type EventEditScope = "thisOccurrence" | "thisWeekdayAndFuture" | "allFuture";

export interface ImportedEventReader {
  visibleEvents(familyID: string, memberID: string): Promise<FamilyEvent[]>;
  sharedEvents(familyID: string): Promise<FamilyEvent[]>;
}

export class EventMutationError extends Error {
  constructor(
    readonly code:
      | "parent_role_required"
      | "imported_event_read_only"
      | "unknown_participant"
      | "invalid_driver"
      | "invalid_recurring_edit"
      | "event_not_found",
    readonly statusCode: 400 | 403 | 404 | 409,
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
        validateEventMembers(input.event, members);
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
        const recurrenceSeriesID = existingEvent?.recurrenceSeriesID
          ?? (recurrence ? eventID : undefined);
        const event: FamilyEvent = {
          ...input.event,
          id: eventID,
          familyID: input.account.familyID,
          ...(recurrenceSeriesID !== undefined ? { recurrenceSeriesID } : {}),
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
    sourceEventID: string;
    edited: FamilyEvent;
    scope: EventEditScope;
    occurrenceStart: Date;
    upserts: FamilyEvent[];
    deleteIDs: string[];
    affectedEventIDs: string[];
    affectedSourceEventIDs: string[];
    baseSeriesEvents: FamilyEvent[];
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
        await this.recordDriverChange({
          account: input.account,
          event: input.edited,
          idempotencyKey: input.idempotencyKey,
        }, change, false);
      }
      return this.deliverImmediately(previous);
    }

    const sourceEventID = input.sourceEventID.toLowerCase();
    const [visibleImportedEvents, sharedImportedEvents] = await Promise.all([
      this.dependencies.importedEvents.visibleEvents(input.account.familyID, input.account.memberID),
      this.dependencies.importedEvents.sharedEvents(input.account.familyID),
    ]);
    if (visibleImportedEvents.some((event) => event.id.toLowerCase() === sourceEventID)) {
      throw new EventMutationError("imported_event_read_only", 409);
    }

    const notificationID = randomUUID();
    const storedResult: StoredEventMutationResult =
      await this.dependencies.persistence.performEventMutation(
        input.account.familyID,
        input.idempotencyKey,
        ({ events, members }) => {
          const source = events.find((event) => event.id.toLowerCase() === sourceEventID);
          if (!source) throw new EventMutationError("event_not_found", 404);
          const edited: FamilyEvent = {
            ...input.edited,
            id: source.id,
            familyID: input.account.familyID,
            source: source.source,
            status: source.status,
            recurrenceSeriesID: source.recurrenceSeriesID ?? source.id,
          };
          validateEventMembers(edited, members);
          const seriesID = source.recurrenceSeriesID ?? source.id;
          const seriesRows = events.filter((event) =>
            (event.recurrenceSeriesID ?? (event.recurrence ? event.id : null)) === seriesID
          );
          const plan = validateConcreteRecurringPlan({
            events,
            seriesRows,
            source,
            edited,
            scope: input.scope,
            occurrenceStart: input.occurrenceStart,
            upserts: input.upserts,
            deleteIDs: input.deleteIDs,
            affectedEventIDs: input.affectedEventIDs,
            affectedSourceEventIDs: input.affectedSourceEventIDs,
            baseSeriesEvents: input.baseSeriesEvents,
            members,
          });
          const replacedIDs = new Set([
            ...plan.upserts.map((event) => event.id.toLowerCase()),
            ...plan.deleteIDs,
          ]);
          const finalNativeEvents = [
            ...events.filter((event) => !replacedIDs.has(event.id.toLowerCase())),
            ...plan.upserts,
          ];
          const conflicts = uniqueConflicts(plan.affectedEvents.flatMap((event) =>
            detectEventConflicts(event, [
              ...finalNativeEvents.filter((candidate) =>
                candidate.id !== event.id && candidate.recurrenceSeriesID !== seriesID
              ),
              ...visibleImportedEvents,
            ])
          ));
          const familyVisibleConflicts = uniqueConflicts(plan.affectedEvents.flatMap((event) =>
            detectEventConflicts(event, [
              ...finalNativeEvents.filter((candidate) =>
                candidate.id !== event.id && candidate.recurrenceSeriesID !== seriesID
              ),
              ...sharedImportedEvents,
            ])
          ));
          const primary = plan.affectedEvents[0]!;
          const driverChanges = edited.driverMemberID
            && plan.previousDriverMemberIDs.some((driverID) => driverID !== edited.driverMemberID)
            && edited.driverMemberID !== input.account.memberID
            ? [{
              memberID: edited.driverMemberID,
              change: "assigned" as const,
              eventID: primary.id,
              eventTitle: primary.title,
            }]
            : [];
          const participantIDs = edited.participantIDs.filter((id) =>
            id !== input.account.memberID && id !== edited.driverMemberID
          );
          const shouldNotify = input.notifyParticipants && participantIDs.length > 0;
          return {
            action: {
              kind: "replaceRecurringSeries",
              events: plan.upserts,
              deleteIDs: plan.deleteIDs,
            },
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
                eventID: primary.id,
                title: primary.title,
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
      await this.recordDriverChange({
        account: input.account,
        event: input.edited,
        idempotencyKey: input.idempotencyKey,
      }, change);
    }
    return this.deliverImmediately(storedResult);
  }

  private async recordDriverChange(input: {
    account: Account;
    event: FamilyEvent;
    idempotencyKey: string;
  }, driverChange: {
    memberID: string;
    change: "assigned" | "removed";
    eventID?: string;
    eventTitle?: string;
  }, dispatchImmediately = true): Promise<void> {
    const eventTitle = driverChange.eventTitle ?? input.event.title;
    const title = driverChange.change === "assigned" ? "You're assigned to drive" : "Driver assignment changed";
    const body = driverChange.change === "assigned"
      ? `${eventTitle} has you listed as the driver.`
      : `You are no longer listed as the driver for ${eventTitle}.`;
    const intent: NotificationIntent = {
      familyID: input.account.familyID,
      recipientMemberIDs: [driverChange.memberID],
      kind: "driver_assignment",
      deduplicationKey: `${input.idempotencyKey}:${driverChange.memberID}:${driverChange.change}`,
      title,
      body,
      destination: { kind: "event", id: driverChange.eventID ?? input.event.id.toLowerCase() },
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

function validateConcreteRecurringPlan(input: {
  events: FamilyEvent[];
  seriesRows: FamilyEvent[];
  source: FamilyEvent;
  edited: FamilyEvent;
  scope: EventEditScope;
  occurrenceStart: Date;
  upserts: FamilyEvent[];
  deleteIDs: string[];
  affectedEventIDs: string[];
  affectedSourceEventIDs: string[];
  baseSeriesEvents: FamilyEvent[];
  members: FamilyMember[];
}): {
  upserts: FamilyEvent[];
  deleteIDs: string[];
  affectedEvents: FamilyEvent[];
  previousDriverMemberIDs: Array<string | null | undefined>;
} {
  if (input.upserts.length < 1 || input.upserts.length > 2048
    || input.deleteIDs.length > 2048
    || input.affectedEventIDs.length < 1 || input.affectedEventIDs.length > 2048
    || input.affectedSourceEventIDs.length < 1 || input.affectedSourceEventIDs.length > 2048
    || input.baseSeriesEvents.length < 1 || input.baseSeriesEvents.length > 2048
    || Number.isNaN(input.occurrenceStart.getTime())) {
    throw new EventMutationError("invalid_recurring_edit", 400);
  }
  if (!input.source.recurrence && !input.source.recurrenceSeriesID) {
    throw new EventMutationError("invalid_recurring_edit", 400);
  }
  const seriesID = (input.source.recurrenceSeriesID ?? input.source.id).toLowerCase();
  const currentSeriesIDs = new Set(input.seriesRows.map((event) => event.id.toLowerCase()));
  const baseIDs = normalizedUniqueIDs(input.baseSeriesEvents.map((event) => event.id));
  if (!sameStringSet(currentSeriesIDs, new Set(baseIDs))) {
    throw new EventMutationError("invalid_recurring_edit", 409);
  }
  const currentByID = new Map(input.seriesRows.map((event) => [event.id.toLowerCase(), event]));
  if (input.baseSeriesEvents.some((base) => {
    const current = currentByID.get(base.id.toLowerCase());
    return !current || eventVersionSignature(base) !== eventVersionSignature(current);
  })) {
    throw new EventMutationError("invalid_recurring_edit", 409);
  }
  const deleteIDs = normalizedUniqueIDs(input.deleteIDs);
  const deleteSet = new Set(deleteIDs);
  const affectedIDs = normalizedUniqueIDs(input.affectedEventIDs);
  const affectedSourceIDs = normalizedUniqueIDs(input.affectedSourceEventIDs);
  if (affectedIDs.length !== input.affectedEventIDs.length
    || affectedIDs.length !== affectedSourceIDs.length) {
    throw new EventMutationError("invalid_recurring_edit", 400);
  }
  const existingByID = new Map(input.events.map((event) => [event.id.toLowerCase(), event]));
  const upsertIDs = new Set<string>();
  const upserts = input.upserts.map((candidate) => {
    const id = candidate.id.toLowerCase();
    if (upsertIDs.has(id) || deleteSet.has(id)) {
      throw new EventMutationError("invalid_recurring_edit", 400);
    }
    upsertIDs.add(id);
    const existing = existingByID.get(id);
    if (existing && !currentSeriesIDs.has(id)) {
      throw new EventMutationError("invalid_recurring_edit", 409);
    }
    if (candidate.source !== input.source.source
      || candidate.status !== input.source.status
      || candidate.readOnly === true) {
      throw new EventMutationError("invalid_recurring_edit", 400);
    }
    const event: FamilyEvent = {
      ...candidate,
      id,
      familyID: input.source.familyID,
      source: input.source.source,
      status: input.source.status,
      recurrenceSeriesID: seriesID,
      readOnly: false,
      provenance: [],
    };
    validateEventMembers(event, input.members);
    if (new Date(event.endTime) <= new Date(event.startTime)) {
      throw new EventMutationError("invalid_recurring_edit", 400);
    }
    const plannedStartsInPast = new Date(event.startTime) < input.occurrenceStart;
    const existingStartsInPast = existing
      ? new Date(existing.startTime) < input.occurrenceStart
      : false;
    if ((plannedStartsInPast && !existingStartsInPast)
      || (existingStartsInPast && !pastRowIsPreserved(existing!, event))) {
      throw new EventMutationError("invalid_recurring_edit", 409);
    }
    return event;
  });
  for (const id of deleteIDs) {
    const existing = existingByID.get(id);
    if (!existing || !currentSeriesIDs.has(id)
      || new Date(existing.startTime) < input.occurrenceStart) {
      throw new EventMutationError("invalid_recurring_edit", 409);
    }
  }
  const upsertsByID = new Map(upserts.map((event) => [event.id, event]));
  const affectedEvents = affectedIDs.map((id) => {
    const event = upsertsByID.get(id);
    if (!event || editableEventSignature(event) !== editableEventSignature(input.edited)) {
      throw new EventMutationError("invalid_recurring_edit", 400);
    }
    return event;
  });
  if (input.scope === "thisOccurrence" && affectedEvents.length !== 1) {
    throw new EventMutationError("invalid_recurring_edit", 400);
  }
  if (input.scope === "thisWeekdayAndFuture"
    && !input.seriesRows.some((event) => event.recurrence?.frequency === "weekly")) {
    throw new EventMutationError("invalid_recurring_edit", 400);
  }
  const previousDriverMemberIDs = affectedSourceIDs.map((id) => {
    const event = existingByID.get(id);
    if (!event || !currentSeriesIDs.has(id)) {
      throw new EventMutationError("invalid_recurring_edit", 409);
    }
    return event.driverMemberID;
  });
  return { upserts, deleteIDs, affectedEvents, previousDriverMemberIDs };
}

function normalizedUniqueIDs(ids: string[]): string[] {
  const normalized = ids.map((id) => id.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new EventMutationError("invalid_recurring_edit", 400);
  }
  return normalized;
}

function sameStringSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function editableEventSignature(event: FamilyEvent): string {
  return JSON.stringify({
    title: event.title,
    kidID: event.kidID,
    participantIDs: [...event.participantIDs].sort(),
    duration: new Date(event.endTime).getTime() - new Date(event.startTime).getTime(),
    location: event.location,
    driver: event.driver,
    driverMemberID: event.driverMemberID,
    alertLeadTimeMinutes: event.alertLeadTimeMinutes,
  });
}

function eventVersionSignature(event: FamilyEvent): string {
  return JSON.stringify({
    id: event.id.toLowerCase(),
    title: event.title,
    kidID: event.kidID,
    participantIDs: event.participantIDs,
    startTime: new Date(event.startTime).getTime(),
    endTime: new Date(event.endTime).getTime(),
    location: event.location,
    driver: event.driver,
    driverMemberID: event.driverMemberID ?? null,
    source: event.source,
    status: event.status,
    alertLeadTimeMinutes: event.alertLeadTimeMinutes ?? null,
    recurrence: event.recurrence ? {
      ...event.recurrence,
      endDate: new Date(event.recurrence.endDate).getTime(),
    } : null,
    recurrenceSeriesID: event.recurrenceSeriesID?.toLowerCase() ?? null,
    readOnly: event.readOnly ?? false,
    provenance: event.provenance ?? [],
  });
}

function pastRowIsPreserved(
  existing: FamilyEvent,
  planned: FamilyEvent,
): boolean {
  const existingRecurrence = existing.recurrence;
  const plannedRecurrence = planned.recurrence;
  const recurrenceShapeMatches = existingRecurrence
    ? plannedRecurrence != null
      && existingRecurrence.frequency === plannedRecurrence.frequency
      && existingRecurrence.interval === plannedRecurrence.interval
      && JSON.stringify(existingRecurrence.weekdays ?? null)
        === JSON.stringify(plannedRecurrence.weekdays ?? null)
      && new Date(plannedRecurrence.endDate) <= new Date(existingRecurrence.endDate)
    : plannedRecurrence == null;
  return recurrenceShapeMatches
    && existing.title === planned.title
    && existing.kidID === planned.kidID
    && JSON.stringify(existing.participantIDs) === JSON.stringify(planned.participantIDs)
    && new Date(existing.startTime).getTime() === new Date(planned.startTime).getTime()
    && new Date(existing.endTime).getTime() === new Date(planned.endTime).getTime()
    && existing.location === planned.location
    && existing.driver === planned.driver
    && existing.driverMemberID === planned.driverMemberID
    && existing.alertLeadTimeMinutes === planned.alertLeadTimeMinutes;
}

function validateEventMembers(event: FamilyEvent, members: FamilyMember[]): void {
  const memberIDs = new Set(members.map((member) => member.id));
  const referencedMemberIDs = [
    ...event.participantIDs,
    ...(event.kidID ? [event.kidID] : []),
  ];
  if (referencedMemberIDs.some((memberID) => !memberIDs.has(memberID))) {
    throw new EventMutationError("unknown_participant", 400);
  }
  if (event.driverMemberID && event.driver) {
    throw new EventMutationError("invalid_driver", 400);
  }
  if (event.driverMemberID) {
    const driverMember = members.find((member) => member.id === event.driverMemberID);
    if (!driverMember || (driverMember.role === "kid" && driverMember.canDrive !== true)) {
      throw new EventMutationError("invalid_driver", 400);
    }
  }
}

function uniqueConflicts(conflicts: EventConflict[]): EventConflict[] {
  const unique = new Map<string, EventConflict>();
  for (const conflict of conflicts) {
    const key = JSON.stringify([
      conflict.kind,
      conflict.memberID,
      conflict.driver,
      [...conflict.eventIDs].sort(),
    ]);
    unique.set(key, conflict);
  }
  return [...unique.values()];
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
