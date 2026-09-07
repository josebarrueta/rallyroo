import { describe, expect, it } from "vitest";
import { EventMutationModule } from "../src/event-mutation.js";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";
import { ScheduleUpdateNotificationDispatcher } from "../src/schedule-update-notification-dispatcher.js";
import type { Account, FamilyEvent } from "../src/domain.js";

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
});
