import type { Account } from "./domain.js";

export interface ExpenseDraft {
  spentOn: string;
  amountMinor: number;
  currency: string;
  category: string;
  merchant: string | null;
  note: string | null;
}

export interface Expense extends ExpenseDraft {
  id: string;
  familyID: string;
  createdByMemberID: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCursor {
  spentOn: string;
  id: string;
}

export interface ExpensePage {
  expenses: Expense[];
  nextCursor: string | null;
}

export interface ExpenseRepository {
  listExpenses(familyID: string, limit: number, cursor: ExpenseCursor | null): Promise<Expense[]>;
  expense(familyID: string, id: string): Promise<Expense | null>;
  createExpenseIfAbsent(expense: Expense): Promise<Expense | null>;
  updateExpense(familyID: string, id: string, version: number, draft: ExpenseDraft, updatedAt: string): Promise<Expense | null>;
  deleteExpense(familyID: string, id: string, version: number): Promise<"deleted" | "already_deleted" | "not_found" | "conflict">;
}

export class ExpenseError extends Error {
  constructor(public readonly reason: "parent_required" | "expense_conflict" | "expense_not_found" | "invalid_expense") {
    super(reason);
    this.name = "ExpenseError";
  }
}

// An Expense is a financial ledger entry, not evidence of Pantry Stock or a
// second sum of Shopping Purchase prices. Parents alone may read or change it.
export class ExpenseModule {
  constructor(private readonly repository: ExpenseRepository, private readonly now: () => Date = () => new Date()) {}

  async list(account: Account, limit = 50, cursor: ExpenseCursor | null = null): Promise<ExpensePage> {
    this.requireParent(account);
    const expenses = await this.repository.listExpenses(account.familyID, limit + 1, cursor);
    const page = expenses.slice(0, limit);
    const last = page.at(-1);
    return {
      expenses: page,
      nextCursor: expenses.length > limit && last ? `${last.spentOn}_${last.id}` : null,
    };
  }

  async create(account: Account, id: string, draft: ExpenseDraft): Promise<Expense> {
    this.requireParent(account);
    const normalized = normalizeDraft(draft);
    const timestamp = this.now().toISOString();
    const candidate: Expense = {
      ...normalized, id, familyID: account.familyID, createdByMemberID: account.memberID,
      version: 1, createdAt: timestamp, updatedAt: timestamp,
    };
    const saved = await this.repository.createExpenseIfAbsent(candidate);
    if (!saved || saved.createdByMemberID !== account.memberID || !equalDraft(saved, normalized)) {
      throw new ExpenseError("expense_conflict");
    }
    return saved;
  }

  async update(account: Account, id: string, expectedVersion: number, draft: ExpenseDraft): Promise<Expense> {
    this.requireParent(account);
    const saved = await this.repository.updateExpense(account.familyID, id, expectedVersion,
      normalizeDraft(draft), this.now().toISOString());
    if (saved) return saved;
    if (!(await this.repository.expense(account.familyID, id))) throw new ExpenseError("expense_not_found");
    throw new ExpenseError("expense_conflict");
  }

  async delete(account: Account, id: string, expectedVersion: number): Promise<void> {
    this.requireParent(account);
    const result = await this.repository.deleteExpense(account.familyID, id, expectedVersion);
    if (result === "not_found") throw new ExpenseError("expense_not_found");
    if (result === "conflict") throw new ExpenseError("expense_conflict");
  }

  private requireParent(account: Account): void {
    if (account.role !== "parent") throw new ExpenseError("parent_required");
  }
}

function normalizeDraft(draft: ExpenseDraft): ExpenseDraft {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.spentOn)
    || Number.isNaN(Date.parse(`${draft.spentOn}T00:00:00Z`))
    || new Date(`${draft.spentOn}T00:00:00Z`).toISOString().slice(0, 10) !== draft.spentOn
    || !Number.isSafeInteger(draft.amountMinor) || draft.amountMinor < 1
    || draft.amountMinor > 1_000_000_000_000 || draft.currency !== "USD"
    || !draft.category.trim() || draft.category.length > 60
    || (draft.merchant?.length ?? 0) > 120 || (draft.note?.length ?? 0) > 500) {
    throw new ExpenseError("invalid_expense");
  }
  return {
    ...draft, category: draft.category.trim(),
    merchant: draft.merchant?.trim() || null,
    note: draft.note?.trim() || null,
  };
}

function equalDraft(left: ExpenseDraft, right: ExpenseDraft): boolean {
  return left.spentOn === right.spentOn && left.amountMinor === right.amountMinor
    && left.currency === right.currency && left.category === right.category
    && left.merchant === right.merchant && left.note === right.note;
}
