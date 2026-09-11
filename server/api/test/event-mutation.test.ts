import { describe, expect, it } from "vitest";
import { EventMutationError, EventMutationModule } from "../src/event-mutation.js";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";
import { ScheduleUpdateNotificationDispatcher } from "../src/schedule-update-notification-dispatcher.js";
import type { Account, FamilyEvent } from "../src/domain.js";
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

describe("EventMutationModule.recurringEdit", () => {
  it("applies a weekday-future scope atomically: upserts the new row and deletes the source", async () => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });

    const source: FamilyEvent = {
       ...event,
      id: "11111111-1111-1111-1111-111111111111",
      recurrence: { frequency: "weekly", interval: 1, weekdays: [3, 5], endDate: "2027-09-01T00:00:00.000Z" }
     };
    await module.save({
      account,
      event: source,
      idempotencyKey: "src-1",
      notifyParticipants: false,
     });
    expect((await persistence.eventsForFamily("family-1")).map((e) => e.id)).toEqual([source.id]);

    const fridayRow: FamilyEvent = {
       ...source,
      id: `${source.id}.w5`,
      recurrence: { frequency: "weekly", interval: 1, weekdays: [5], endDate: "2027-09-01T00:00:00.000Z"},
      location: "New field",
     };

    const result = await module.recurringEdit({
      account,
      upserts: [fridayRow],
      deleteIDs: [source.id],
      idempotencyKey: "recurring-1",
      notifyParticipants: false,
     });

    const events = await persistence.eventsForFamily("family-1");
    expect(result.notificationOutcome).toBe("notRequested");
    expect(events.map((item) => item.id)).toEqual([fridayRow.id]);
    const first = events[0];
    expect(first?.location).toBe("New field");

    // Replay is a no-op: same idempotency key returns the same single row.
    await module.recurringEdit({
      account,
      upserts: [fridayRow],
      deleteIDs: [source.id],
      idempotencyKey: "recurring-1",
      notifyParticipants: false,
     });
    const afterReplay = await persistence.eventsForFamily("family-1");
    expect(afterReplay).toHaveLength(1);
    const replayed = afterReplay[0];
    expect(replayed?.id).toBe(fridayRow.id);
   });

  it("refuses to upsert a row whose id is also being deleted", async () => {
      const module = new EventMutationModule({ persistence: repository(), importedEvents });
    const source: FamilyEvent = {
       ...event,
      recurrence: { frequency: "weekly", interval: 1, weekdays: [3, 5], endDate: "2027-09-01T00:00:00.000Z" }
     };
    await expect(
       module.recurringEdit({
        account,
        upserts: [source],
        deleteIDs: [source.id],
        idempotencyKey: "recurring-clash",
        notifyParticipants: false,
       }),
     ).rejects.toMatchObject({ code: "invalid_driver" });
   });
});
