import type { Expense, ExpenseCursor, ExpenseDraft, ExpenseRepository } from "./expense-module.js";

export class InMemoryExpenseRepository implements ExpenseRepository {
  private readonly records = new Map<string, Expense & { deleted: boolean }>();

  async listExpenses(familyID: string, limit: number, cursor: ExpenseCursor | null): Promise<Expense[]> {
    return [...this.records.values()]
      .filter((expense) => expense.familyID === familyID && !expense.deleted
        && (!cursor || expense.spentOn < cursor.spentOn
          || (expense.spentOn === cursor.spentOn && expense.id < cursor.id)))
      .sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.id.localeCompare(a.id))
      .slice(0, limit).map(({ deleted: _deleted, ...expense }) => expense);
  }

  async expense(familyID: string, id: string): Promise<Expense | null> {
    const record = this.records.get(`${familyID}:${id}`);
    if (!record || record.deleted) return null;
    const { deleted: _deleted, ...expense } = record;
    return expense;
  }

  async createExpenseIfAbsent(expense: Expense): Promise<Expense | null> {
    const key = `${expense.familyID}:${expense.id}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.deleted) return null;
      const { deleted: _deleted, ...saved } = existing;
      return saved;
    }
    this.records.set(key, { ...expense, deleted: false });
    return expense;
  }

  async updateExpense(familyID: string, id: string, version: number, draft: ExpenseDraft, updatedAt: string): Promise<Expense | null> {
    const key = `${familyID}:${id}`;
    const existing = this.records.get(key);
    if (!existing || existing.deleted || existing.version !== version) return null;
    const updated = { ...existing, ...draft, version: version + 1, updatedAt };
    this.records.set(key, updated);
    const { deleted: _deleted, ...expense } = updated;
    return expense;
  }

  async deleteExpense(familyID: string, id: string, version: number): Promise<"deleted" | "already_deleted" | "not_found" | "conflict"> {
    const key = `${familyID}:${id}`;
    const existing = this.records.get(key);
    if (!existing) return "not_found";
    if (existing.deleted) return "already_deleted";
    if (existing.version !== version) return "conflict";
    this.records.set(key, { ...existing, version: version + 1, deleted: true });
    return "deleted";
  }
}
