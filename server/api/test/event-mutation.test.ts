import { describe, expect, it } from "vitest";
import { EventMutationError, EventMutationModule } from "../src/event-mutation.js";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";
import { ScheduleUpdateNotificationDispatcher } from "../src/schedule-update-notification-dispatcher.js";
import type { Account, FamilyEvent } from "../src/domain.js";
import { eventOccurrenceStarts } from "../src/event-recurrence.js";
import { NotificationCenterModule } from "../src/notification-center.js";
import { InMemoryNotificationCenterRepository } from "../src/in-memory-notification-center-repository.js";

const account: Account = {
  identitySubject: "parent-subject",
  familyID: "family-1",
  memberID: "parent-1",
  role: "parent",
};

const event: FamilyEvent = {
  id: "44444444-4444-4444-8444-444444444444",
  familyID: "family-1",
  title: "Soccer practice",
  kidID: "kid-1",
  participantIDs: ["kid-1"],
  startTime: "2026-09-08T16:00:00.000Z",
  endTime: "2026-09-08T17:00:00.000Z",
  location: "Riverside Field",
  driver: null,
  source: "voice",
  status: "confirmed",
};

function repository() {
  return new InMemoryRallyrooRepository({
    accounts: [account],
    members: [
      { id: "parent-1", familyID: "family-1", name: "Alex", role: "parent", colorTag: "blue" },
      { id: "kid-1", familyID: "family-1", name: "Emma", role: "kid", colorTag: "purple" },
    ],
  });
}

const importedEvents = {
  async visibleEvents() { return []; },
  async sharedEvents() { return []; },
};

describe("EventMutationModule", () => {
  it("atomically saves an Event and records its schedule update notification intent", async () => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });

    const result = await module.save({
      account,
      event,
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      notifyParticipants: true,
    });

    expect(result).toEqual({ conflicts: [], notificationOutcome: "queuedForRetry" });
    expect(await persistence.eventsForFamily("family-1")).toEqual([event]);
    expect(await persistence.familyChangeVersion("family-1")).toBe(1);
  });

  it("replays the original mutation without saving or enqueueing again", async () => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });
    const idempotencyKey = "55555555-5555-4555-8555-555555555556";

    await module.save({ account, event, idempotencyKey, notifyParticipants: true });
    const replay = await module.save({
      account,
      event: { ...event, title: "A different retry payload" },
      idempotencyKey,
      notifyParticipants: false,
    });

    expect(replay.notificationOutcome).toBe("queuedForRetry");
    expect((await persistence.eventsForFamily("family-1"))[0]?.title).toBe("Soccer practice");
    expect(await persistence.familyChangeVersion("family-1")).toBe(1);
  });

  it("keeps personal calendar conflict details out of schedule update notifications", async () => {
    const persistence = repository();
    await persistence.saveDeviceToken("family-1", "kid-1", "kid-token");
    const bodies: string[] = [];
    const dispatcher = new ScheduleUpdateNotificationDispatcher({
      persistence,
      recipients: persistence,
      pushNotificationProvider: {
        async send(_tokens, notification) { bodies.push(notification.body); },
      },
    });
    const personalImportedEvent: FamilyEvent = {
      ...event,
      id: "44444444-4444-4444-8444-444444444445",
      title: "Private appointment",
      source: "calendar",
      readOnly: true,
    };
    const module = new EventMutationModule({
      persistence,
      notificationDispatcher: dispatcher,
      importedEvents: {
        async visibleEvents() { return [personalImportedEvent]; },
        async sharedEvents() { return []; },
      },
    });

    const result = await module.save({
      account,
      event,
      idempotencyKey: "55555555-5555-4555-8555-555555555558",
      notifyParticipants: true,
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.notificationOutcome).toBe("sent");
    expect(bodies).toEqual(["Your family schedule was updated."]);
  });

  it("retries a durable schedule update notification after provider failure", async () => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });
    const idempotencyKey = "55555555-5555-4555-8555-555555555557";
    await persistence.saveDeviceToken("family-1", "kid-1", "kid-token");
    await module.save({ account, event, idempotencyKey, notifyParticipants: true });
    let shouldFail = true;
    const sent: string[][] = [];
    const dispatcher = new ScheduleUpdateNotificationDispatcher({
      persistence,
      recipients: persistence,
      pushNotificationProvider: {
        async send(tokens) {
          if (shouldFail) throw new Error("provider details must not persist");
          sent.push(tokens);
        },
      },
    });

    expect(await dispatcher.dispatchDue()).toEqual(["queuedForRetry"]);
    shouldFail = false;
    expect(await dispatcher.dispatchDue()).toEqual(["sent"]);
    expect(sent).toEqual([["kid-token"]]);
    expect((await module.save({ account, event, idempotencyKey, notifyParticipants: true })).notificationOutcome)
      .toBe("sent");
  });

  it("requires an eligible driver and records an idempotent driver inbox notification", async () => {
    const persistence = repository();
    const inboxRepository = new InMemoryNotificationCenterRepository();
    const notificationCenter = new NotificationCenterModule(inboxRepository);
    const module = new EventMutationModule({ persistence, importedEvents, notificationCenter });
    await expect(module.save({
      account,
      event: { ...event, driverMemberID: "kid-1" },
      idempotencyKey: "55555555-5555-4555-8555-555555555560",
      notifyParticipants: false,
    })).rejects.toEqual(new EventMutationError("invalid_driver", 400));

    await persistence.saveMember({
      id: "kid-1", familyID: "family-1", name: "Emma", role: "kid",
      colorTag: "purple", canDrive: true,
    });
    await expect(module.save({
      account,
      event: { ...event, driverMemberID: "kid-1" },
      idempotencyKey: "55555555-5555-4555-8555-555555555561",
      notifyParticipants: false,
    })).resolves.toMatchObject({ conflicts: [] });
    await module.save({
      account,
      event: { ...event, driverMemberID: "kid-1" },
      idempotencyKey: "55555555-5555-4555-8555-555555555561",
      notifyParticipants: false,
    });
    expect(await notificationCenter.list({ ...account, memberID: "kid-1", role: "kid" })).toEqual([
      expect.objectContaining({ kind: "driver_assignment", destination: { kind: "event", id: event.id } }),
    ]);
    await module.save({
      account,
      event: { ...event, driverMemberID: "kid-1", title: "Updated title" },
      idempotencyKey: "55555555-5555-4555-8555-555555555564",
      notifyParticipants: false,
    });
    expect(await notificationCenter.list({ ...account, memberID: "kid-1", role: "kid" }))
      .toHaveLength(1);
  });

  it("atomically applies a recurring scope and notifies the newly assigned driver once", async () => {
    const persistence = repository();
    await persistence.saveMember({
      id: "parent-2", familyID: "family-1", name: "Sam", role: "parent", colorTag: "green",
    });
    await persistence.saveDeviceToken("family-1", "kid-1", "kid-token");
    const inboxRepository = new InMemoryNotificationCenterRepository();
    const notificationCenter = new NotificationCenterModule(inboxRepository);
    const module = new EventMutationModule({ persistence, importedEvents, notificationCenter });
    const source: FamilyEvent = {
      ...event,
      startTime: "2026-09-08T16:00:00.000Z",
      endTime: "2026-09-08T17:00:00.000Z",
      driverMemberID: "parent-1",
      recurrenceSeriesID: event.id,
      recurrence: {
        frequency: "weekly", interval: 1, weekdays: [2, 4], endDate: "2026-12-31T16:00:00.000Z",
      },
    };
    await module.save({
      account, event: source, idempotencyKey: "recurring-source", notifyParticipants: false,
    });
    const edited: FamilyEvent = {
      ...source,
      title: "Thursday carpool",
      startTime: "2026-09-10T16:00:00.000Z",
      endTime: "2026-09-10T16:45:00.000Z",
      driverMemberID: "parent-2",
      alertLeadTimeMinutes: 45,
    };
    const tuesdayRowID = "20000000-0000-4000-8000-000000000010";
    const thursdayRowID = "20000000-0000-4000-8000-000000000011";
    const input = {
      account,
      sourceEventID: source.id,
      edited,
      scope: "thisWeekdayAndFuture" as const,
      occurrenceStart: new Date("2026-09-10T16:00:00.000Z"),
      upserts: [
        {
          ...source,
          recurrenceSeriesID: source.id,
          recurrence: { ...source.recurrence!, endDate: "2026-09-10T15:59:59.999Z" },
        },
        {
          ...source,
          id: tuesdayRowID,
          recurrenceSeriesID: source.id,
          startTime: "2026-09-15T16:00:00.000Z",
          endTime: "2026-09-15T17:00:00.000Z",
          recurrence: { ...source.recurrence!, weekdays: [2 as const] },
        },
        {
          ...edited,
          id: thursdayRowID,
          recurrenceSeriesID: source.id,
          recurrence: { ...source.recurrence!, weekdays: [4 as const] },
        },
      ],
      deleteIDs: [],
      affectedEventIDs: [thursdayRowID],
      affectedSourceEventIDs: [source.id],
      baseSeriesEvents: [source],
      idempotencyKey: "recurring-edit",
      notifyParticipants: true,
    };

    const result = await module.recurringEdit(input);
    await module.recurringEdit(input);

    expect(result).toEqual({ conflicts: [], notificationOutcome: "queuedForRetry" });
    expect(await persistence.familyChangeVersion("family-1")).toBe(2);
    expect((await persistence.eventsForFamily("family-1")).map((item) => item.title)).toContain("Thursday carpool");
    expect(await notificationCenter.list({ ...account, memberID: "parent-2" })).toEqual([
      expect.objectContaining({
        kind: "driver_assignment",
        destination: { kind: "event", id: expect.any(String) },
      }),
    ]);
    const deliveredBodies: string[] = [];
    const scheduleDispatcher = new ScheduleUpdateNotificationDispatcher({
      persistence,
      recipients: persistence,
      pushNotificationProvider: {
        async send(_tokens, notification) { deliveredBodies.push(notification.body); },
      },
    });
    expect(await scheduleDispatcher.dispatchDue()).toEqual(["sent"]);
    expect(deliveredBodies).toEqual(["Your family schedule was updated."]);
    expect(await scheduleDispatcher.dispatchDue()).toEqual([]);

    let splitRows = await persistence.eventsForFamily("family-1");
    const initialThursdayRow = splitRows.find((item) => item.id === thursdayRowID)!;
    const { recurrenceSeriesID: _legacyOmittedSeriesID, ...legacyThursdayEdit } = initialThursdayRow;
    await module.save({
      account,
      event: legacyThursdayEdit,
      idempotencyKey: "legacy-split-row-edit",
      notifyParticipants: false,
    });
    splitRows = await persistence.eventsForFamily("family-1");
    const tuesdayRow = splitRows.find((item) => item.id === tuesdayRowID)!;
    const thursdayRow = splitRows.find((item) => item.id === thursdayRowID)!;
    expect(thursdayRow.recurrenceSeriesID).toBe(source.id);
    const allFutureEdited = {
      ...thursdayRow,
      title: "All future carpool",
      startTime: "2026-09-17T16:00:00.000Z",
      endTime: "2026-09-17T16:45:00.000Z",
    };
    const futureTuesdayID = "20000000-0000-4000-8000-000000000012";
    const futureThursdayID = "20000000-0000-4000-8000-000000000013";
    await module.recurringEdit({
      account,
      sourceEventID: thursdayRow.id,
      edited: allFutureEdited,
      scope: "allFuture",
      occurrenceStart: new Date("2026-09-17T16:00:00.000Z"),
      upserts: [
        {
          ...tuesdayRow,
          recurrence: { ...tuesdayRow.recurrence!, endDate: "2026-09-22T15:59:59.999Z" },
        },
        {
          ...allFutureEdited,
          id: futureTuesdayID,
          startTime: "2026-09-22T16:00:00.000Z",
          endTime: "2026-09-22T16:45:00.000Z",
          recurrence: { ...tuesdayRow.recurrence!, weekdays: [2 as const] },
        },
        {
          ...thursdayRow,
          recurrence: { ...thursdayRow.recurrence!, endDate: "2026-09-17T15:59:59.999Z" },
        },
        {
          ...allFutureEdited,
          id: futureThursdayID,
          recurrence: { ...thursdayRow.recurrence!, weekdays: [4 as const] },
        },
      ],
      deleteIDs: [],
      affectedEventIDs: [futureTuesdayID, futureThursdayID],
      affectedSourceEventIDs: [tuesdayRowID, thursdayRowID],
      baseSeriesEvents: splitRows,
      idempotencyKey: "recurring-edit-all-future",
      notifyParticipants: false,
    });
    const finalRows = (await persistence.eventsForFamily("family-1"))
      .filter((item) => item.recurrenceSeriesID === source.id);
    const occurrenceTitle = (start: string) => finalRows.find((item) =>
      eventOccurrenceStarts(item, new Date("2026-10-01T23:59:59.000Z"))
        .some((date) => date.toISOString() === start)
    )?.title;
    expect(occurrenceTitle("2026-09-15T16:00:00.000Z")).toBe("Soccer practice");
    expect(occurrenceTitle("2026-09-17T16:00:00.000Z")).toBe("All future carpool");
    expect(occurrenceTitle("2026-09-22T16:00:00.000Z")).toBe("All future carpool");
    expect(occurrenceTitle("2026-09-24T16:00:00.000Z")).toBe("All future carpool");
    expect(await persistence.familyChangeVersion("family-1")).toBe(4);
  });

  it("rejects a concrete recurring plan that would rewrite a past row", async () => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });
    const source: FamilyEvent = {
      ...event,
      recurrenceSeriesID: event.id,
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: [2],
        endDate: "2026-12-31T16:00:00.000Z",
      },
    };
    await module.save({
      account, event: source, idempotencyKey: "past-plan-source", notifyParticipants: false,
    });
    const tampered = {
      ...source,
      title: "Rewritten past",
      recurrenceSeriesID: source.id,
    };

    await expect(module.recurringEdit({
      account,
      sourceEventID: source.id,
      edited: tampered,
      scope: "allFuture",
      occurrenceStart: new Date("2026-09-15T16:00:00.000Z"),
      upserts: [tampered],
      deleteIDs: [],
      affectedEventIDs: [source.id],
      affectedSourceEventIDs: [source.id],
      baseSeriesEvents: [source],
      idempotencyKey: "tampered-past-plan",
      notifyParticipants: false,
    })).rejects.toEqual(new EventMutationError("invalid_recurring_edit", 409));
    expect(await persistence.familyChangeVersion("family-1")).toBe(1);
  });

  it("detects a double-booked driver by stable member identity", async () => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });
    const first: FamilyEvent = {
      ...event, participantIDs: [], kidID: null, driverMemberID: "parent-1",
    };
    await module.save({
      account, event: first,
      idempotencyKey: "55555555-5555-4555-8555-555555555562",
      notifyParticipants: false,
    });
    const second: FamilyEvent = {
      ...first,
      id: "44444444-4444-4444-8444-444444444446",
      title: "School pickup",
    };

    const result = await module.save({
      account, event: second,
      idempotencyKey: "55555555-5555-4555-8555-555555555563",
      notifyParticipants: false,
    });

    expect(result.conflicts).toEqual([{
      kind: "double_booked_driver",
      memberID: "parent-1",
      driver: null,
      eventIDs: [first.id, second.id],
    }]);
  });
});
