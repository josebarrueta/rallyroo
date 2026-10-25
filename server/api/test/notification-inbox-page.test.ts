import { describe, expect, it } from "vitest";
import type { Account } from "../src/domain.js";
import { InMemoryNotificationCenterRepository } from "../src/in-memory-notification-center-repository.js";
import { NotificationCenterModule } from "../src/notification-center.js";

const parent: Account = { identitySubject: "parent", familyID: "f", memberID: "p", role: "parent" };
const kid: Account = { ...parent, memberID: "k", role: "kid" };

async function fixture() {
  const center = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
  for (let index = 0; index < 121; index++) {
    await center.record({
      familyID: "f", recipientMemberIDs: ["p", "k"], kind: "schedule_update",
      deduplicationKey: `${index}`, title: "Update", body: "Review it.",
      destination: { kind: "event", id: `${index}` }, occurredAt: new Date("2030-01-01T12:00:00Z"),
    });
  }
  return center;
}

describe("member inbox pagination", () => {
  it("pages beyond 100 tied timestamps without duplicates and preserves the legacy endpoint", async () => {
    const center = await fixture();
    expect(await center.list(parent)).toHaveLength(100);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await center.page(parent, 50, "all", cursor);
      seen.push(...page.items.map((record) => record.id));
      expect(page.items.every((record) => record.memberID === "p")).toBe(true);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(121);
    expect(new Set(seen).size).toBe(121);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it("binds cursors to member, Family and filter and rejects malformed input", async () => {
    const center = await fixture();
    const page = await center.page(parent, 10);
    for (const account of [kid, { ...parent, familyID: "other" }]) {
      await expect(center.page(account, 10, "all", page.nextCursor!)).rejects.toThrow("invalid_inbox_page");
    }
    await expect(center.page(parent, 10, "unread", page.nextCursor!)).rejects.toThrow("invalid_inbox_page");
    for (const cursor of ["", "not-json", "*", Buffer.from('{"at":"bad"}').toString("base64url")]) {
      await expect(center.page(parent, 10, "all", cursor)).rejects.toThrow("invalid_inbox_page");
    }
    for (const limit of [0, 101, 1.5]) {
      await expect(center.page(parent, limit)).rejects.toThrow("invalid_inbox_page");
    }
  });

  it("filters read/deleted records while subsequent new arrivals remain available on refresh", async () => {
    const center = await fixture();
    const first = await center.page(parent, 10, "unread");
    await center.markRead(parent, first.items[0]!.id);
    await center.delete(parent, first.items[1]!.id);
    const second = await center.page(parent, 100, "unread", first.nextCursor!);
    expect(second.items.some((record) => first.items.some((old) => old.id === record.id))).toBe(false);
    const unread = await center.page(parent, 100, "unread");
    expect(unread.items.every((record) => record.readAt === null)).toBe(true);
    await center.deleteAll(parent);
    expect(await center.page(parent)).toEqual({ items: [], nextCursor: null });
    expect((await center.page(kid)).items).toHaveLength(50);
    await center.record({
      familyID: "f", recipientMemberIDs: ["p"], kind: "schedule_update", deduplicationKey: "new",
      title: "New", body: "Review", destination: { kind: "event", id: "new" }, occurredAt: new Date(),
    });
    expect((await center.page(parent)).items.map((item) => item.title)).toEqual(["New"]);
  });
});
