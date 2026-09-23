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
