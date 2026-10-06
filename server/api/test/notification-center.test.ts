import { describe, expect, it } from "vitest";
import type { Account } from "../src/domain.js";
import { InMemoryNotificationCenterRepository } from "../src/in-memory-notification-center-repository.js";
import { NotificationCenterModule } from "../src/notification-center.js";
import type { PushNotification } from "../src/push-notification-provider.js";

const parent: Account = {
  identitySubject: "parent-subject", familyID: "family-1", memberID: "parent-1", role: "parent",
};
const kid: Account = {
  identitySubject: "kid-subject", familyID: "family-1", memberID: "kid-1", role: "kid",
};

describe("NotificationCenterModule", () => {
  it("uses each recipient's full durable unread count on retry, not a page or increment", async () => {
    const repository = new InMemoryNotificationCenterRepository();
    const pushes: Array<{ tokens: string[]; notification: PushNotification }> = [];
    let fail = true;
    const center = new NotificationCenterModule(repository, {
      send: async (tokens, notification) => {
        if (fail) throw new Error("provider unavailable");
        pushes.push({ tokens, notification });
      },
    });
    const intent = (key: string, recipients = ["parent-1"]) => ({
      familyID: "family-1", recipientMemberIDs: recipients,
      kind: "schedule_update" as const, deduplicationKey: key,
      title: "Update", body: "Review it.", destination: { kind: "event" as const, id: key },
      occurredAt: new Date(),
    });
    for (let index = 0; index < 105; index++) await center.record(intent(`old-${index}`));
    const first = (await center.record(intent("first", ["parent-1", "kid-1"])));
    await expect(center.dispatchDue(new Date(), 2, first.map((record) => record.id))).rejects.toThrow();
    expect(await center.unreadCount(parent)).toBe(106);
    expect(await center.list(parent)).toHaveLength(100);
    const kidRecord = first.find((record) => record.memberID === "kid-1")!;
    await center.markRead(kid, kidRecord.id);
    fail = false;
    await center.dispatchDue(new Date(), 2, first.map((record) => record.id));
    expect(pushes.map(({ tokens, notification }) => ({ tokens, badge: notification.badge }))).toEqual([
      { tokens: ["token:parent-1"], badge: 99 },
      { tokens: ["token:kid-1"], badge: 0 },
    ]);
    await center.record(intent("first", ["parent-1", "kid-1"]));
    expect(await center.unreadCount(parent)).toBe(106);
    const parentRecord = first.find((record) => record.memberID === "parent-1")!;
    await center.delete(parent, parentRecord.id);
    expect(await center.unreadCount(parent)).toBe(105);
    expect(await center.unreadCount({ ...parent, familyID: "other-family" })).toBe(0);
    await center.record(intent("kid-unread", ["kid-1"]));
    await center.markAllRead(parent);
    expect(await center.unreadCount(parent)).toBe(0);
    expect(await center.unreadCount(kid)).toBe(1);
    await center.markAllRead(parent); // Replays remain idempotent.
    expect(await center.unreadCount(kid)).toBe(1);
  });

  it("records one private inbox item per recipient and replays idempotently", async () => {
    const center = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const intent = {
      familyID: "family-1",
      recipientMemberIDs: ["parent-1", "kid-1", "kid-1"],
      kind: "event_occurrence" as const,
      deduplicationKey: "event-1:2026-09-10T16:00:00Z",
      title: "Soccer practice",
      body: "Event starting now.",
      destination: { kind: "event" as const, id: "event-1" },
      occurredAt: new Date("2026-09-10T16:00:00Z"),
    };

    const first = await center.record(intent);
    const replay = await center.record(intent);

    expect(first).toHaveLength(2);
    expect(replay.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(await center.list(parent)).toEqual([
      expect.objectContaining({ memberID: "parent-1", kind: "event_occurrence", readAt: null }),
    ]);
    expect(await center.list(kid)).toEqual([
      expect.objectContaining({ memberID: "kid-1", destination: { kind: "event", id: "event-1" } }),
    ]);

    const kidItem = (await center.list(kid))[0]!;
    expect(await center.markRead(parent, kidItem.id, new Date("2026-09-10T16:01:00Z"))).toBe(false);
    expect(await center.markRead(kid, kidItem.id, new Date("2026-09-10T16:01:00Z"))).toBe(true);
    expect((await center.list(kid))[0]?.readAt).toEqual(new Date("2026-09-10T16:01:00Z"));
  });

  it("sends the same absolute count to all registered devices for the recipient", async () => {
    class MultiDeviceRepository extends InMemoryNotificationCenterRepository {
      override async deviceTokensForMembers(): Promise<string[]> { return ["phone", "tablet"]; }
    }
    const pushes: Array<{ tokens: string[]; notification: PushNotification }> = [];
    const center = new NotificationCenterModule(new MultiDeviceRepository(), {
      send: async (tokens, notification) => { pushes.push({ tokens, notification }); },
    });
    await center.recordAndDispatch({
      familyID: "family-1", recipientMemberIDs: ["kid-1"], kind: "schedule_update",
      deduplicationKey: "multi-device", title: "Update", body: "Review it.",
      destination: { kind: "event", id: "event" }, occurredAt: new Date(),
    });
    expect(pushes).toEqual([{
      tokens: ["phone", "tablet"], notification: expect.objectContaining({ badge: 1 }),
    }]);
  });

  it("delivers the notification's useful title and body", async () => {
    const repository = new InMemoryNotificationCenterRepository();
    const pushes: PushNotification[] = [];
    const center = new NotificationCenterModule(repository, {
      send: async (_tokens, notification) => { pushes.push(notification); },
    });

    await center.recordAndDispatch({
      familyID: "family-1",
      recipientMemberIDs: ["kid-1"],
      kind: "event_occurrence",
      deduplicationKey: "event-1:2026-09-10T16:00:00Z",
      title: "Soccer practice",
      body: "Event starts in 30 minutes.",
      destination: { kind: "event", id: "event-1" },
      occurredAt: new Date("2026-09-10T15:30:00Z"),
    });

    expect(pushes).toEqual([expect.objectContaining({
      title: "Soccer practice",
      body: "Event starts in 30 minutes.",
      badge: 1,
      data: expect.objectContaining({ notificationKind: "event_occurrence" }),
    })]);
  });

  it("preserves one inbox record and retries channel delivery after provider failure", async () => {
    const repository = new InMemoryNotificationCenterRepository();
    let shouldFail = true;
    const sent: string[][] = [];
    const center = new NotificationCenterModule(repository, {
      send: async (tokens) => {
        if (shouldFail) throw new Error("provider unavailable");
        sent.push(tokens);
      },
    });
    const intent = {
      familyID: "family-1", recipientMemberIDs: ["kid-1"], kind: "reminder_occurrence" as const,
      deduplicationKey: "reminder-1:occurrence-1", title: "Permission slip", body: "Reminder due.",
      destination: { kind: "reminder" as const, id: "reminder-1" }, occurredAt: new Date(),
    };

    await expect(center.recordAndDispatch(intent)).rejects.toThrow("Notification delivery failed");
    expect(await center.list(kid)).toHaveLength(1);
    shouldFail = false;
    await center.recordAndDispatch(intent);
    await center.recordAndDispatch(intent);
    expect(await center.list(kid)).toHaveLength(1);
    expect(sent).toEqual([["token:kid-1"]]);
  });
});
