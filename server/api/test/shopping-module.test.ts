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

  it("prepares a deterministic draft trip from requests and fresh or stale Stock evidence", async () => {
    let now = new Date("2026-10-10T12:00:00.000Z");
    const module = new ShoppingModule(new InMemoryShoppingRepository(), () => now);
    await module.saveRoutine(parent, routineID, {
      storeName: "Market", intervalWeeks: 1, preferredWeekday: 6,
    });
    const itemIDs = {
      requested: "20000000-0000-4000-8000-000000000011",
      low: "20000000-0000-4000-8000-000000000012",
      enough: "20000000-0000-4000-8000-000000000013",
      stale: "20000000-0000-4000-8000-000000000014",
      unknown: "20000000-0000-4000-8000-000000000015",
    };
    for (const [name, id] of Object.entries(itemIDs)) {
      await module.savePantryItem(parent, id, {
        name, critical: name === "unknown", routineIDs: [routineID],
      });
    }
    await module.requestItem(kid, "30000000-0000-4000-8000-000000000011", {
      itemID: itemIDs.requested, quantity: 2, note: null,
    });
    await module.observeStock(kid, "40000000-0000-4000-8000-000000000011", itemIDs.requested, {
      level: "enough", quantity: 3, note: null,
    });
    await module.observeStock(kid, "40000000-0000-4000-8000-000000000012", itemIDs.low, {
      level: "low", quantity: null, note: null,
    });
    await module.observeStock(kid, "40000000-0000-4000-8000-000000000013", itemIDs.enough, {
      level: "enough", quantity: null, note: null,
    });
    now = new Date("2026-10-01T12:00:00.000Z");
    await module.observeStock(kid, "40000000-0000-4000-8000-000000000014", itemIDs.stale, {
      level: "out", quantity: 0, note: null,
    });
    now = new Date("2026-10-10T12:00:00.000Z");

    const trip = await module.prepareTrip(
      parent,
      "50000000-0000-4000-8000-000000000001",
      routineID,
      "2026-10-11",
    );

    expect(trip).toMatchObject({ status: "draft", routineID, plannedFor: "2026-10-11" });
    expect(trip.entries.map(({ itemID: id, decision, reason }) => ({ id, decision, reason })))
      .toEqual([
        { id: itemIDs.enough, decision: "skip", reason: "Recent Stock evidence says Enough." },
        { id: itemIDs.low, decision: "buy", reason: "Recent Stock evidence says Low." },
        { id: itemIDs.requested, decision: "buy", reason: "Requested by a Family Member; recent Stock evidence says Enough." },
        { id: itemIDs.stale, decision: "check_at_home", reason: "The latest Stock evidence is stale." },
        { id: itemIDs.unknown, decision: "check_at_home", reason: "No recent Stock evidence is available." },
      ]);
  });

  it("marks Stock uncertain for a trip planned beyond the freshness window", async () => {
    const module = new ShoppingModule(
      new InMemoryShoppingRepository(), () => new Date("2026-10-10T12:00:00.000Z"),
    );
    await module.saveRoutine(parent, routineID, {
      storeName: "Market", intervalWeeks: 1, preferredWeekday: null,
    });
    await module.savePantryItem(parent, itemID, {
      name: "Milk", critical: true, routineIDs: [routineID],
    });
    await module.observeStock(kid, "40000000-0000-4000-8000-000000000041", itemID, {
      level: "enough", quantity: null, note: null,
    });
    const trip = await module.prepareTrip(
      parent, "50000000-0000-4000-8000-000000000041", routineID, "2026-11-01",
    );
    expect(trip.entries).toMatchObject([{
      decision: "check_at_home", reason: "The latest Stock evidence is stale.",
    }]);
  });

  it("keeps drafts parent-private and shares a finalized parent-reviewed plan", async () => {
    let now = new Date("2026-10-10T12:00:00.000Z");
    const module = new ShoppingModule(new InMemoryShoppingRepository(), () => now);
    await module.saveRoutine(parent, routineID, {
      storeName: "Market", intervalWeeks: 1, preferredWeekday: null,
    });
    await module.savePantryItem(parent, itemID, {
      name: "Oat milk", critical: true, routineIDs: [routineID],
    });
    const requestID = "30000000-0000-4000-8000-000000000021";
    await module.requestItem(kid, requestID, { itemID, quantity: 1, note: null });
    const trip = await module.prepareTrip(
      parent,
      "50000000-0000-4000-8000-000000000021",
      routineID,
      "2026-10-11",
    );
    await expect(module.trips(kid)).resolves.toEqual([]);
    await expect(module.reviewTrip(kid, trip.id, {
      expectedVersion: trip.version,
      entries: [{ itemID, decision: "skip" }],
    })).rejects.toEqual(new ShoppingModuleError("parent_required"));

    now = new Date("2026-10-10T13:00:00.000Z");
    const reviewed = await module.reviewTrip(parent, trip.id, {
      expectedVersion: trip.version,
      entries: [{ itemID, decision: "check_at_home" }],
    });
    expect(reviewed.entries).toMatchObject([{
      itemID, decision: "check_at_home", reason: "Parent decision.", requestIDs: [requestID],
    }]);
    await expect(module.finalizeTrip(parent, trip.id, trip.version))
      .rejects.toEqual(new ShoppingModuleError("shopping_trip_conflict"));

    now = new Date("2026-10-10T14:00:00.000Z");
    const finalized = await module.finalizeTrip(parent, trip.id, reviewed.version);
    expect(finalized).toMatchObject({
      status: "finalized", finalizedByMemberID: parent.memberID,
    });
    await expect(module.trips(kid)).resolves.toEqual([finalized]);
    expect((await module.evidence(parent)).openRequests).toHaveLength(1);
  });

  it("resolves incorporated requests only when a finalized plan marks them Buy", async () => {
    const module = new ShoppingModule(
      new InMemoryShoppingRepository(),
      () => new Date("2026-10-10T12:00:00.000Z"),
    );
    await module.saveRoutine(parent, routineID, {
      storeName: "Market", intervalWeeks: 1, preferredWeekday: null,
    });
    await module.savePantryItem(parent, itemID, {
      name: "Oat milk", critical: false, routineIDs: [routineID],
    });
    const requestID = "30000000-0000-4000-8000-000000000022";
    await module.requestItem(kid, requestID, { itemID, quantity: null, note: null });
    const trip = await module.prepareTrip(
      parent, "50000000-0000-4000-8000-000000000022", routineID, "2026-10-11",
    );

    await module.finalizeTrip(parent, trip.id, trip.version);

    await expect(module.evidence(parent)).resolves.toMatchObject({ openRequests: [] });
  });

  it("reuses a trip for the same Shopping routine and day without overwriting parent decisions", async () => {
    const module = new ShoppingModule(new InMemoryShoppingRepository());
    await module.saveRoutine(parent, routineID, {
      storeName: "Market", intervalWeeks: 1, preferredWeekday: null,
    });
    const first = await module.prepareTrip(
      parent, "50000000-0000-4000-8000-000000000036", routineID, "2026-10-11",
    );
    const replay = await module.prepareTrip(
      parent, "50000000-0000-4000-8000-000000000037", routineID, "2026-10-11",
    );
    expect(replay).toEqual(first);
    expect(await module.trips(parent)).toEqual([first]);
  });

  it("retains catalog items referenced by a Shopping trip", async () => {
    const module = new ShoppingModule(new InMemoryShoppingRepository());
    await module.saveRoutine(parent, routineID, {
      storeName: "Market", intervalWeeks: 1, preferredWeekday: null,
    });
    await module.savePantryItem(parent, itemID, {
      name: "Milk", critical: false, routineIDs: [routineID],
    });
    await module.prepareTrip(parent, "50000000-0000-4000-8000-000000000035", routineID, "2026-10-11");
    await expect(module.deleteRoutine(parent, routineID))
      .rejects.toEqual(new ShoppingModuleError("shopping_trip_catalog_in_use"));
    await expect(module.deletePantryItem(parent, itemID))
      .rejects.toEqual(new ShoppingModuleError("shopping_trip_catalog_in_use"));
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
