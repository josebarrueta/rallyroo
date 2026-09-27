import { describe, expect, it } from "vitest";
import type { Account } from "../src/domain.js";
import { ExpenseModule, ExpenseError } from "../src/expense-module.js";
import { InMemoryExpenseRepository } from "../src/in-memory-expense-repository.js";

const parent: Account = { identitySubject: "parent", familyID: "family-a", memberID: "parent-a", role: "parent" };
const other: Account = { ...parent, familyID: "family-b", memberID: "parent-b" };
const kid: Account = { ...parent, memberID: "kid-a", role: "kid" };
const draft = { spentOn: "2026-09-26", amountMinor: 1399, currency: "USD", category: "Groceries", merchant: "Market", note: null };
const id = "00000000-0000-4000-8000-000000000001";

function fixture() {
  const repository = new InMemoryExpenseRepository();
  const expenses = new ExpenseModule(repository, () => new Date("2026-09-27T00:00:00Z"));
  return { repository, expenses };
}

describe("parent-only Household expenses", () => {
  it("creates idempotently without confusing other Families or Shopping Purchases", async () => {
    const { expenses } = fixture();
    const saved = await expenses.create(parent, id, draft);
    expect(await expenses.create(parent, id, draft)).toEqual(saved);
    await expect(expenses.create(parent, id, { ...draft, amountMinor: 1 })).rejects.toMatchObject({ reason: "expense_conflict" });
    expect((await expenses.list(other)).expenses).toEqual([]);
    expect((await expenses.create(other, id, draft)).familyID).toBe("family-b");
    expect((await expenses.list(parent)).expenses).toEqual([saved]);
    expect(saved.amountMinor).toBe(1399);
  });

  it("never allows a Member to read or write expenses even through the module interface", async () => {
    const { expenses } = fixture();
    await expenses.create(parent, id, draft);
    for (const action of [
      () => expenses.list(kid),
      () => expenses.create(kid, "00000000-0000-4000-8000-000000000002", draft),
      () => expenses.update(kid, id, 1, draft),
      () => expenses.delete(kid, id, 1),
    ]) await expect(action()).rejects.toMatchObject({ reason: "parent_required" } satisfies Partial<ExpenseError>);
  });

  it("paginates, version-guards corrections and keeps deletion retries idempotent", async () => {
    const { expenses } = fixture();
    await expenses.create(parent, id, draft);
    await expenses.create(parent, "00000000-0000-4000-8000-000000000002", draft);
    const first = await expenses.list(parent, 1);
    expect(first.expenses).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const [spentOn, nextID] = first.nextCursor!.split("_");
    const second = await expenses.list(parent, 1, { spentOn: spentOn!, id: nextID! });
    expect(second.expenses).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const updated = await expenses.update(parent, id, 1, { ...draft, category: "Transport" });
    expect(updated).toMatchObject({ version: 2, category: "Transport" });
    await expect(expenses.update(parent, id, 1, draft)).rejects.toMatchObject({ reason: "expense_conflict" });
    await expect(expenses.delete(parent, id, 1)).rejects.toMatchObject({ reason: "expense_conflict" });
    await expenses.delete(parent, id, 2);
    await expenses.delete(parent, id, 2);
    expect((await expenses.list(parent)).expenses.map((expense) => expense.id)).not.toContain(id);
    await expect(expenses.create(parent, id, draft)).rejects.toMatchObject({ reason: "expense_conflict" });
  });
});
