import type { Account } from "./domain.js";

export interface ShoppingRoutine {
  id: string;
  familyID: string;
  storeName: string;
  intervalWeeks: number;
  preferredWeekday: number | null;
  createdByMemberID: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingRoutineDraft {
  storeName: string;
  intervalWeeks: number;
  preferredWeekday: number | null;
}

export interface PantryItem {
  id: string;
  familyID: string;
  name: string;
  category: string | null;
  unit: string | null;
  critical: boolean;
  expectedDurationDays: number | null;
  minimumQuantity: number | null;
  targetQuantity: number | null;
  routineIDs: string[];
  createdByMemberID: string;
  createdAt: string;
  updatedAt: string;
}

export interface PantryItemDraft {
  name: string;
  category?: string | null;
  unit?: string | null;
  critical: boolean;
  expectedDurationDays?: number | null;
  minimumQuantity?: number | null;
  targetQuantity?: number | null;
  routineIDs: string[];
}

export interface ShoppingCatalog {
  routines: ShoppingRoutine[];
  items: PantryItem[];
}

export interface ShoppingRepository {
  catalog(familyID: string): Promise<ShoppingCatalog>;
  saveRoutine(routine: ShoppingRoutine): Promise<ShoppingRoutine>;
  deleteRoutine(familyID: string, routineID: string): Promise<boolean>;
  savePantryItem(item: PantryItem): Promise<PantryItem>;
  deletePantryItem(familyID: string, itemID: string): Promise<boolean>;
}

export type ShoppingModuleFailureReason =
  | "parent_required"
  | "invalid_routine"
  | "routine_not_found"
  | "routine_name_conflict"
  | "invalid_pantry_item"
  | "pantry_item_name_conflict";

export class ShoppingNameConflictError extends Error {
  constructor(public readonly kind: "routine" | "pantry_item") {
    super(`${kind}_name_conflict`);
    this.name = "ShoppingNameConflictError";
  }
}

export class ShoppingRoutineReferenceError extends Error {
  constructor() {
    super("routine_not_found");
    this.name = "ShoppingRoutineReferenceError";
  }
}

export class ShoppingModuleError extends Error {
  constructor(public readonly reason: ShoppingModuleFailureReason) {
    super(reason);
    this.name = "ShoppingModuleError";
  }
}

export class ShoppingModule {
  constructor(
    private readonly repository: ShoppingRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  catalog(account: Account): Promise<ShoppingCatalog> {
    return this.repository.catalog(account.familyID);
  }

  async saveRoutine(
    account: Account,
    id: string,
    draft: ShoppingRoutineDraft,
  ): Promise<ShoppingRoutine> {
    requireParent(account);
    const storeName = requiredText(draft.storeName, 120, "invalid_routine");
    if (!Number.isSafeInteger(draft.intervalWeeks)
      || draft.intervalWeeks < 1 || draft.intervalWeeks > 52
      || (draft.preferredWeekday !== null
        && (!Number.isSafeInteger(draft.preferredWeekday)
          || draft.preferredWeekday < 1 || draft.preferredWeekday > 7))) {
      throw new ShoppingModuleError("invalid_routine");
    }
    const catalog = await this.repository.catalog(account.familyID);
    const existing = catalog.routines.find((routine) => routine.id === id);
    if (catalog.routines.some((routine) => routine.id !== id
      && normalizedShoppingName(routine.storeName) === normalizedShoppingName(storeName))) {
      throw new ShoppingModuleError("routine_name_conflict");
    }
    const timestamp = validTimestamp(this.now());
    try {
      return await this.repository.saveRoutine({
        id,
        familyID: account.familyID,
        storeName,
        intervalWeeks: draft.intervalWeeks,
        preferredWeekday: draft.preferredWeekday,
        createdByMemberID: existing?.createdByMemberID ?? account.memberID,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
    } catch (error) {
      if (error instanceof ShoppingNameConflictError && error.kind === "routine") {
        throw new ShoppingModuleError("routine_name_conflict");
      }
      throw error;
    }
  }

  async deleteRoutine(account: Account, routineID: string): Promise<boolean> {
    requireParent(account);
    return this.repository.deleteRoutine(account.familyID, routineID);
  }

  async savePantryItem(
    account: Account,
    id: string,
    draft: PantryItemDraft,
  ): Promise<PantryItem> {
    requireParent(account);
    const name = requiredText(draft.name, 120, "invalid_pantry_item");
    const category = optionalText(draft.category, 100, "invalid_pantry_item");
    const unit = optionalText(draft.unit, 60, "invalid_pantry_item");
    const expectedDurationDays = optionalPositiveNumber(
      draft.expectedDurationDays, 3_650, "invalid_pantry_item", false, true,
    );
    const minimumQuantity = optionalPositiveNumber(
      draft.minimumQuantity, 1_000_000, "invalid_pantry_item", true,
    );
    const targetQuantity = optionalPositiveNumber(
      draft.targetQuantity, 1_000_000, "invalid_pantry_item", true,
    );
    if (targetQuantity !== null && minimumQuantity !== null && targetQuantity < minimumQuantity) {
      throw new ShoppingModuleError("invalid_pantry_item");
    }
    const routineIDs = [...new Set(draft.routineIDs)];
    const catalog = await this.repository.catalog(account.familyID);
    if (routineIDs.some((routineID) => !catalog.routines.some((routine) => routine.id === routineID))) {
      throw new ShoppingModuleError("routine_not_found");
    }
    const existing = catalog.items.find((item) => item.id === id);
    if (catalog.items.some((item) => item.id !== id
      && normalizedShoppingName(item.name) === normalizedShoppingName(name))) {
      throw new ShoppingModuleError("pantry_item_name_conflict");
    }
    const timestamp = validTimestamp(this.now());
    try {
      return await this.repository.savePantryItem({
        id,
        familyID: account.familyID,
        name,
        category,
        unit,
        critical: draft.critical,
        expectedDurationDays,
        minimumQuantity,
        targetQuantity,
        routineIDs,
        createdByMemberID: existing?.createdByMemberID ?? account.memberID,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
    } catch (error) {
      if (error instanceof ShoppingNameConflictError && error.kind === "pantry_item") {
        throw new ShoppingModuleError("pantry_item_name_conflict");
      }
      if (error instanceof ShoppingRoutineReferenceError) {
        throw new ShoppingModuleError("routine_not_found");
      }
      throw error;
    }
  }

  async deletePantryItem(account: Account, itemID: string): Promise<boolean> {
    requireParent(account);
    return this.repository.deletePantryItem(account.familyID, itemID);
  }
}

export function normalizedShoppingName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function requireParent(account: Account): void {
  if (account.role !== "parent") throw new ShoppingModuleError("parent_required");
}

function requiredText(
  value: unknown,
  maxLength: number,
  reason: ShoppingModuleFailureReason,
): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > maxLength) throw new ShoppingModuleError(reason);
  return trimmed;
}

function optionalText(
  value: unknown,
  maxLength: number,
  reason: ShoppingModuleFailureReason,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, maxLength, reason);
}

function optionalPositiveNumber(
  value: unknown,
  maximum: number,
  reason: ShoppingModuleFailureReason,
  allowsZero = false,
  requiresInteger = false,
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)
    || (requiresInteger && !Number.isSafeInteger(value))
    || value < (allowsZero ? 0 : 1) || value > maximum) {
    throw new ShoppingModuleError(reason);
  }
  return value;
}

function validTimestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new ShoppingModuleError("invalid_pantry_item");
  return value.toISOString();
}
