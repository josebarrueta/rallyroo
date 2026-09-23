import { describe, expect, it } from "vitest";
import type { Account } from "../src/domain.js";
import { InMemoryShoppingRepository } from "../src/in-memory-shopping-repository.js";
import { ShoppingModule, ShoppingModuleError } from "../src/shopping-module.js";

const parent: Account = {
  identitySubject: "parent-subject",
  familyID: "family-1",
  memberID: "parent-1",
  role: "parent",
};
const kid: Account = {
  identitySubject: "kid-subject",
  familyID: "family-1",
  memberID: "kid-1",
  role: "kid",
};

const routineID = "10000000-0000-4000-8000-000000000001";
const itemID = "20000000-0000-4000-8000-000000000001";

describe("ShoppingModule catalog", () => {
  it("lets a parent build a store-specific Pantry catalog that every Family Member can read", async () => {
    const module = new ShoppingModule(new InMemoryShoppingRepository());

    await module.saveRoutine(parent, routineID, {
      storeName: "Neighborhood Market",
      intervalWeeks: 1,
      preferredWeekday: 6,
    });
    await module.savePantryItem(parent, itemID, {
      name: "Oat milk",
      category: "Dairy alternatives",
      unit: "cartons",
      critical: true,
      expectedDurationDays: 7,
      minimumQuantity: 1,
      targetQuantity: 2,
      routineIDs: [routineID],
    });

    await expect(module.catalog(kid)).resolves.toEqual({
      routines: [expect.objectContaining({
        id: routineID,
        familyID: "family-1",
        storeName: "Neighborhood Market",
        intervalWeeks: 1,
        preferredWeekday: 6,
      })],
      items: [expect.objectContaining({
        id: itemID,
        familyID: "family-1",
        name: "Oat milk",
        critical: true,
        routineIDs: [routineID],
      })],
    });
  });

  it("keeps catalog management parent-only", async () => {
    const module = new ShoppingModule(new InMemoryShoppingRepository());

    await expect(module.saveRoutine(kid, routineID, {
      storeName: "Market",
      intervalWeeks: 1,
      preferredWeekday: null,
    })).rejects.toEqual(new ShoppingModuleError("parent_required"));
  });

  it("lets Family Members request catalog items and record low-friction Stock observations", async () => {
    const module = new ShoppingModule(
      new InMemoryShoppingRepository(),
      () => new Date("2026-10-02T12:00:00.000Z"),
    );
    await module.savePantryItem(parent, itemID, {
      name: "Oat milk",
      critical: true,
      routineIDs: [],
    });

    const request = await module.requestItem(kid, "30000000-0000-4000-8000-000000000001", {
      itemID,
      quantity: 2,
      note: "For breakfast",
    });
    const observation = await module.observeStock(
      kid,
      "40000000-0000-4000-8000-000000000001",
      itemID,
      { level: "low", quantity: 0.5, note: null },
    );

    expect(request).toMatchObject({
      familyID: "family-1",
      itemID,
      requestedByMemberID: "kid-1",
      status: "open",
      quantity: 2,
      note: "For breakfast",
    });
    expect(observation).toMatchObject({
      familyID: "family-1",
      itemID,
      observedByMemberID: "kid-1",
      level: "low",
      quantity: 0.5,
    });
    await expect(module.evidence(parent)).resolves.toEqual({
      openRequests: [request],
      latestObservations: [observation],
    });
  });

  it("orders open Family requests newest first", async () => {
    let now = new Date("2026-10-02T12:00:00.000Z");
    const module = new ShoppingModule(new InMemoryShoppingRepository(), () => now);
    await module.savePantryItem(parent, itemID, {
      name: "Oat milk", critical: false, routineIDs: [],
    });
    const first = await module.requestItem(parent, "30000000-0000-4000-8000-000000000011", {
      itemID, quantity: null, note: "First",
    });
    now = new Date("2026-10-03T12:00:00.000Z");
    const latest = await module.requestItem(kid, "30000000-0000-4000-8000-000000000012", {
      itemID, quantity: null, note: "Latest",
    });

    expect((await module.evidence(parent)).openRequests).toEqual([latest, first]);
  });

  it("keeps immutable resource replays idempotent and exposes only the latest Stock observation", async () => {
    let now = new Date("2026-10-02T12:00:00.000Z");
    const module = new ShoppingModule(new InMemoryShoppingRepository(), () => now);
    await module.savePantryItem(parent, itemID, {
      name: "Oat milk", critical: false, routineIDs: [],
    });
    const firstID = "40000000-0000-4000-8000-000000000001";
    const first = await module.observeStock(parent, firstID, itemID, {
      level: "enough", quantity: 2, note: null,
    });
    now = new Date("2026-10-03T12:00:00.000Z");
    const latest = await module.observeStock(parent, "40000000-0000-4000-8000-000000000002", itemID, {
      level: "out", quantity: 0, note: null,
    });
    const replay = await module.observeStock(parent, firstID, itemID, {
      level: "low", quantity: 1, note: "must not replace immutable evidence",
    });

    expect(replay).toEqual(first);
    expect((await module.evidence(parent)).latestObservations).toEqual([latest]);
  });

  it("lets a requester cancel their request while only a parent can resolve it", async () => {
    const module = new ShoppingModule(new InMemoryShoppingRepository());
    await module.savePantryItem(parent, itemID, {
      name: "Oat milk", critical: false, routineIDs: [],
    });
    const firstID = "30000000-0000-4000-8000-000000000001";
    const secondID = "30000000-0000-4000-8000-000000000002";
    await module.requestItem(kid, firstID, { itemID, quantity: null, note: null });
    await module.requestItem(kid, secondID, { itemID, quantity: null, note: null });

    await expect(module.closeRequest(kid, firstID, "cancelled"))
      .resolves.toMatchObject({ status: "cancelled" });
    await expect(module.closeRequest(kid, secondID, "resolved"))
      .rejects.toEqual(new ShoppingModuleError("parent_required"));
    await expect(module.closeRequest(parent, secondID, "resolved"))
      .resolves.toMatchObject({ status: "resolved", resolvedByMemberID: "parent-1" });
    await expect(module.evidence(parent)).resolves.toEqual({
      openRequests: [], latestObservations: [],
    });
  });

  it("treats replayed resource IDs as updates and rejects normalized duplicate names", async () => {
    const module = new ShoppingModule(new InMemoryShoppingRepository());
    await module.saveRoutine(parent, routineID, {
      storeName: "Costco",
      intervalWeeks: 2,
      preferredWeekday: null,
    });

    const updated = await module.saveRoutine(parent, routineID, {
      storeName: "Costco",
      intervalWeeks: 3,
      preferredWeekday: 7,
    });
    expect(updated.intervalWeeks).toBe(3);

    await expect(module.saveRoutine(parent, "10000000-0000-4000-8000-000000000002", {
      storeName: "  COSTCO  ",
      intervalWeeks: 1,
      preferredWeekday: null,
    })).rejects.toEqual(new ShoppingModuleError("routine_name_conflict"));
  });
});
