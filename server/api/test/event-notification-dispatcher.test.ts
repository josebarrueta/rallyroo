import { describe, expect, it } from "vitest";
import { EventNotificationDispatcher } from "../src/event-notification-dispatcher.js";
import type { FamilyEvent } from "../src/domain.js";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";

const event: FamilyEvent = {
  id: "00000000-0000-4000-8000-000000000101",
  familyID: "family-1",
  title: "Soccer practice",
  kidID: "kid-1",
  participantIDs: ["kid-1", "parent-1"],
  startTime: "2026-09-06T18:00:00.000Z",
  endTime: "2026-09-06T19:00:00.000Z",
  location: null,
  driver: null,
  source: "manual",
  status: "confirmed",
  alertLeadTimeMinutes: 15,
  driverMemberID: "driver-1",
};

describe("EventNotificationDispatcher", () => {
  it("sends one occurrence alert to participants and the assigned driver", async () => {
    const requestedMembers: string[][] = [];
    const pushes: Array<{ tokens: string[]; title: string; body: string; data?: Record<string, string> }> = [];
    const marked: string[] = [];
    const dispatcher = new EventNotificationDispatcher({
      repository: {
        claimDueEventNotifications: async () => [{ event, occurrenceStart: event.startTime }],
        deviceTokensForMembers: async (_familyID, memberIDs) => {
          requestedMembers.push(memberIDs);
          return ["participant-device"];
        },
        markEventNotificationSent: async (_familyID, eventID, occurrenceStart) => {
          marked.push(`${eventID}:${occurrenceStart}`);
        },
        releaseEventNotificationClaim: async () => undefined,
      },
      pushNotificationProvider: {
        send: async (tokens, notification) => { pushes.push({ tokens, ...notification }); },
      },
    });

    await dispatcher.dispatchDue(new Date("2026-09-06T17:45:00.000Z"));

    expect(requestedMembers).toEqual([["kid-1", "parent-1", "driver-1"]]);
    expect(pushes).toEqual([{
      tokens: ["participant-device"],
      title: "Soccer practice",
      body: "Event starts in 15 minutes.",
      data: {
        eventID: event.id,
        occurrenceStart: event.startTime,
      },
    }]);
    expect(marked).toEqual([`${event.id}:${event.startTime}`]);
  });

  it("claims each due recurring occurrence once", async () => {
    const repository = new InMemoryRallyrooRepository();
    await repository.saveEvent({
      ...event,
      startTime: "2026-09-01T18:00:00.000Z",
      endTime: "2026-09-01T19:00:00.000Z",
      recurrence: {
        frequency: "daily",
        interval: 1,
        endDate: "2026-09-03T18:00:00.000Z",
      },
    });
    const now = new Date("2026-09-02T17:45:00.000Z");

    const claimed = await repository.claimDueEventNotifications(now, 100);
    for (const notification of claimed) {
      await repository.markEventNotificationSent(
        event.familyID,
        event.id,
        notification.occurrenceStart,
        now,
      );
    }

    expect(claimed.map((notification) => notification.occurrenceStart))
      .toEqual(["2026-09-02T18:00:00.000Z"]);
    expect(await repository.claimDueEventNotifications(now, 100)).toEqual([]);
  });

  it("claims alerts for every selected weekday in a weekly series", async () => {
    const repository = new InMemoryRallyrooRepository();
    await repository.saveEvent({
      ...event,
      startTime: "2026-09-07T18:00:00.000Z",
      endTime: "2026-09-07T19:00:00.000Z",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: [1, 3],
        endDate: "2026-09-16T18:00:00.000Z",
      },
    });

    const monday = await repository.claimDueEventNotifications(
      new Date("2026-09-07T17:45:00.000Z"),
      100,
    );
    const wednesday = await repository.claimDueEventNotifications(
      new Date("2026-09-09T17:45:00.000Z"),
      100,
    );

    expect(monday.map((notification) => notification.occurrenceStart))
      .toEqual(["2026-09-07T18:00:00.000Z"]);
    expect(wednesday.map((notification) => notification.occurrenceStart))
      .toEqual(["2026-09-09T18:00:00.000Z"]);
  });

  it("releases a failed event delivery claim for retry", async () => {
    let marked = false;
    let released = false;
    const dispatcher = new EventNotificationDispatcher({
      repository: {
        claimDueEventNotifications: async () => [{ event, occurrenceStart: event.startTime }],
        deviceTokensForMembers: async () => ["device"],
        markEventNotificationSent: async () => { marked = true; },
        releaseEventNotificationClaim: async () => { released = true; },
      },
      pushNotificationProvider: {
        send: async () => { throw new Error("provider unavailable"); },
      },
    });

    await expect(dispatcher.dispatchDue()).rejects.toThrow();
    expect(marked).toBe(false);
    expect(released).toBe(true);
  });

  it("describes an at-start alert", async () => {
    const pushes: string[] = [];
    const atStart = { ...event, alertLeadTimeMinutes: 0 as const };
    const dispatcher = new EventNotificationDispatcher({
      repository: {
        claimDueEventNotifications: async () => [{ event: atStart, occurrenceStart: atStart.startTime }],
        deviceTokensForMembers: async () => ["device"],
        markEventNotificationSent: async () => undefined,
        releaseEventNotificationClaim: async () => undefined,
      },
      pushNotificationProvider: {
        send: async (_tokens, notification) => { pushes.push(notification.body); },
      },
    });

    await dispatcher.dispatchDue();

    expect(pushes).toEqual(["Event starting now."]);
  });
});
