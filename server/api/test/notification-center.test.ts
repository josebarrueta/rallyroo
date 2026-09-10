import { describe, expect, it } from "vitest";
import type { Account } from "../src/domain.js";
import { InMemoryNotificationCenterRepository } from "../src/in-memory-notification-center-repository.js";
import { NotificationCenterModule } from "../src/notification-center.js";

const parent: Account = {
  identitySubject: "parent-subject", familyID: "family-1", memberID: "parent-1", role: "parent",
};
const kid: Account = {
  identitySubject: "kid-subject", familyID: "family-1", memberID: "kid-1", role: "kid",
};

describe("NotificationCenterModule", () => {
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
    expect(await center.list(kid)).toHaveLength(1);
    expect(sent).toEqual([["token:kid-1"]]);
  });
});
