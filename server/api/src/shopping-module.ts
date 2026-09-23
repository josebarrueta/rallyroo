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

export type ShoppingItemRequestStatus = "open" | "resolved" | "cancelled";

export interface ShoppingItemRequest {
  id: string;
  familyID: string;
  itemID: string;
  requestedByMemberID: string;
  quantity: number | null;
  note: string | null;
  status: ShoppingItemRequestStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedByMemberID: string | null;
}

export interface ShoppingItemRequestDraft {
  itemID: string;
  quantity?: number | null;
  note?: string | null;
}

export type StockLevel = "enough" | "low" | "out";

export interface StockObservation {
  id: string;
  familyID: string;
  itemID: string;
  observedByMemberID: string;
  level: StockLevel;
  quantity: number | null;
  note: string | null;
  observedAt: string;
}

export interface StockObservationInput {
  level: StockLevel;
  quantity?: number | null;
  note?: string | null;
}

export interface ShoppingEvidence {
  openRequests: ShoppingItemRequest[];
  latestObservations: StockObservation[];
}

export type ShoppingTripStatus = "draft" | "finalized" | "completed";
export type ShoppingOutcomeStatus = "purchased" | "skipped" | "unavailable" | "deferred";

export interface ShoppingOutcomeInput {
  itemID: string;
  status: ShoppingOutcomeStatus;
  quantity: number | null;
  price: number | null;
}

export interface ShoppingPurchase {
  familyID: string;
  tripID: string;
  itemID: string;
  purchasedAt: string;
  quantity: number | null;
  price: number | null;
}
export type ShoppingTripDecision = "buy" | "check_at_home" | "skip";

export interface ShoppingTripEntry {
  itemID: string;
  decision: ShoppingTripDecision;
  reason: string;
  requestIDs: string[];
  observationID: string | null;
}

export interface ShoppingTripPlan {
  id: string;
  familyID: string;
  routineID: string;
  plannedFor: string;
  status: ShoppingTripStatus;
  version: number;
  entries: ShoppingTripEntry[];
  outcomes: ShoppingOutcomeInput[];
  createdByMemberID: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  finalizedByMemberID: string | null;
  completedAt: string | null;
  completedByMemberID: string | null;
}

export interface ShoppingRepository {
  catalog(familyID: string): Promise<ShoppingCatalog>;
  saveRoutine(routine: ShoppingRoutine): Promise<ShoppingRoutine>;
  deleteRoutine(familyID: string, routineID: string): Promise<boolean>;
  savePantryItem(item: PantryItem): Promise<PantryItem>;
  deletePantryItem(familyID: string, itemID: string): Promise<boolean>;
  evidence(familyID: string): Promise<ShoppingEvidence>;
  itemRequest(familyID: string, requestID: string): Promise<ShoppingItemRequest | null>;
  saveItemRequestIfAbsent(request: ShoppingItemRequest): Promise<ShoppingItemRequest>;
  closeItemRequest(
    familyID: string,
    requestID: string,
    status: Exclude<ShoppingItemRequestStatus, "open">,
    resolvedAt: string,
    resolvedByMemberID: string,
  ): Promise<ShoppingItemRequest | null>;
  stockObservation(familyID: string, observationID: string): Promise<StockObservation | null>;
  saveStockObservationIfAbsent(observation: StockObservation): Promise<StockObservation>;
  trips(familyID: string): Promise<ShoppingTripPlan[]>;
  trip(familyID: string, tripID: string): Promise<ShoppingTripPlan | null>;
  saveTripIfAbsent(trip: ShoppingTripPlan): Promise<ShoppingTripPlan>;
  replaceDraftTrip(
    trip: ShoppingTripPlan,
    expectedVersion: number,
  ): Promise<ShoppingTripPlan | null>;
  purchases(familyID: string): Promise<ShoppingPurchase[]>;
  completeTrip(
    familyID: string,
    tripID: string,
    expectedVersion: number,
    outcomes: ShoppingOutcomeInput[],
    completedAt: string,
    completedByMemberID: string,
  ): Promise<ShoppingTripPlan | null>;
  finalizeTrip(
    familyID: string,
    tripID: string,
    expectedVersion: number,
    finalizedAt: string,
    finalizedByMemberID: string,
    resolvedRequestIDs: string[],
  ): Promise<ShoppingTripPlan | null>;
}

export interface ShoppingTripReview {
  expectedVersion: number;
  entries: Array<{ itemID: string; decision: ShoppingTripDecision }>;
}

export type ShoppingModuleFailureReason =
  | "parent_required"
  | "invalid_routine"
  | "routine_not_found"
  | "routine_name_conflict"
  | "invalid_pantry_item"
  | "pantry_item_name_conflict"
  | "pantry_item_not_found"
  | "invalid_item_request"
  | "item_request_not_found"
  | "item_request_forbidden"
  | "invalid_stock_observation"
  | "invalid_shopping_trip"
  | "shopping_trip_not_found"
  | "shopping_trip_conflict"
  | "shopping_trip_catalog_in_use"
  | "invalid_trip_outcomes";

export class ShoppingNameConflictError extends Error {
  constructor(public readonly kind: "routine" | "pantry_item") {
    super(`${kind}_name_conflict`);
    this.name = "ShoppingNameConflictError";
  }
}

export class ShoppingTripCatalogInUseError extends Error {
  constructor() {
    super("shopping_trip_catalog_in_use");
    this.name = "ShoppingTripCatalogInUseError";
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
    try {
      return await this.repository.deleteRoutine(account.familyID, routineID);
    } catch (error) {
      if (error instanceof ShoppingTripCatalogInUseError) {
        throw new ShoppingModuleError("shopping_trip_catalog_in_use");
      }
      throw error;
    }
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
    try {
      return await this.repository.deletePantryItem(account.familyID, itemID);
    } catch (error) {
      if (error instanceof ShoppingTripCatalogInUseError) {
        throw new ShoppingModuleError("shopping_trip_catalog_in_use");
      }
      throw error;
    }
  }

  evidence(account: Account): Promise<ShoppingEvidence> {
    return this.repository.evidence(account.familyID);
  }

  async requestItem(
    account: Account,
    id: string,
    draft: ShoppingItemRequestDraft,
  ): Promise<ShoppingItemRequest> {
    const existing = await this.repository.itemRequest(account.familyID, id);
    if (existing) return existing;
    const catalog = await this.repository.catalog(account.familyID);
    if (!catalog.items.some((item) => item.id === draft.itemID)) {
      throw new ShoppingModuleError("pantry_item_not_found");
    }
    const quantity = optionalPositiveNumber(
      draft.quantity, 1_000_000, "invalid_item_request",
    );
    const note = optionalText(draft.note, 500, "invalid_item_request");
    const requestedAt = timestamp(this.now(), "invalid_item_request");
    return this.repository.saveItemRequestIfAbsent({
      id,
      familyID: account.familyID,
      itemID: draft.itemID,
      requestedByMemberID: account.memberID,
      quantity,
      note,
      status: "open",
      requestedAt,
      resolvedAt: null,
      resolvedByMemberID: null,
    });
  }

  async closeRequest(
    account: Account,
    requestID: string,
    status: "resolved" | "cancelled",
  ): Promise<ShoppingItemRequest> {
    const request = await this.repository.itemRequest(account.familyID, requestID);
    if (!request) throw new ShoppingModuleError("item_request_not_found");
    if (request.status !== "open") return request;
    if (status === "resolved" && account.role !== "parent") {
      throw new ShoppingModuleError("parent_required");
    }
    if (status === "cancelled" && account.role !== "parent"
      && request.requestedByMemberID !== account.memberID) {
      throw new ShoppingModuleError("item_request_forbidden");
    }
    const closed = await this.repository.closeItemRequest(
      account.familyID,
      requestID,
      status,
      timestamp(this.now(), "invalid_item_request"),
      account.memberID,
    );
    if (!closed) throw new ShoppingModuleError("item_request_not_found");
    return closed;
  }

  purchases(account: Account): Promise<ShoppingPurchase[]> {
    return this.repository.purchases(account.familyID);
  }

  async trips(account: Account): Promise<ShoppingTripPlan[]> {
    const trips = await this.repository.trips(account.familyID);
    return account.role === "parent" ? trips : trips.filter((trip) => trip.status === "finalized");
  }

  async prepareTrip(
    account: Account,
    id: string,
    routineID: string,
    plannedFor: string,
  ): Promise<ShoppingTripPlan> {
    requireParent(account);
    const existing = await this.repository.trip(account.familyID, id);
    if (existing) return existing;
    if (!validDateOnly(plannedFor)) throw new ShoppingModuleError("invalid_shopping_trip");
    const catalog = await this.repository.catalog(account.familyID);
    if (!catalog.routines.some((routine) => routine.id === routineID)) {
      throw new ShoppingModuleError("routine_not_found");
    }
    const [evidence, purchases] = await Promise.all([
      this.repository.evidence(account.familyID), this.repository.purchases(account.familyID),
    ]);
    const now = this.now();
    const createdAt = timestamp(now, "invalid_shopping_trip");
    const evidenceAsOf = new Date(Math.max(now.getTime(), Date.parse(`${plannedFor}T00:00:00.000Z`)));
    const entries = catalog.items
      .filter((item) => item.routineIDs.includes(routineID))
      .sort((left, right) => left.name.localeCompare(right.name, "en-US")
        || left.id.localeCompare(right.id))
      .map((item) => recommendedEntry(item, evidence, evidenceAsOf, purchases));
    return this.repository.saveTripIfAbsent({
      id,
      familyID: account.familyID,
      routineID,
      plannedFor,
      status: "draft",
      version: 1,
      entries,
      outcomes: [],
      createdByMemberID: account.memberID,
      createdAt,
      updatedAt: createdAt,
      finalizedAt: null,
      finalizedByMemberID: null,
      completedAt: null,
      completedByMemberID: null,
    });
  }

  async reviewTrip(
    account: Account,
    tripID: string,
    review: ShoppingTripReview,
  ): Promise<ShoppingTripPlan> {
    requireParent(account);
    const trip = await this.repository.trip(account.familyID, tripID);
    if (!trip) throw new ShoppingModuleError("shopping_trip_not_found");
    if (trip.status !== "draft" || !Number.isSafeInteger(review.expectedVersion)
      || review.expectedVersion < 1 || review.entries.length > 500) {
      throw new ShoppingModuleError("shopping_trip_conflict");
    }
    const itemIDs = review.entries.map((entry) => entry.itemID);
    if (new Set(itemIDs).size !== itemIDs.length
      || review.entries.some((entry) => !isTripDecision(entry.decision))) {
      throw new ShoppingModuleError("invalid_shopping_trip");
    }
    const [catalog, evidence, purchases] = await Promise.all([
      this.repository.catalog(account.familyID),
      this.repository.evidence(account.familyID),
      this.repository.purchases(account.familyID),
    ]);
    if (itemIDs.some((itemID) => !catalog.items.some((item) => item.id === itemID))) {
      throw new ShoppingModuleError("pantry_item_not_found");
    }
    const existingEntries = new Map(trip.entries.map((entry) => [entry.itemID, entry]));
    const now = this.now();
    const evidenceAsOf = new Date(Math.max(now.getTime(), Date.parse(`${trip.plannedFor}T00:00:00.000Z`)));
    const entries = review.entries.map((entry) => {
      const existing = existingEntries.get(entry.itemID);
      const item = catalog.items.find((candidate) => candidate.id === entry.itemID)!;
      const evidenceEntry = existing ?? recommendedEntry(item, evidence, evidenceAsOf, purchases);
      return {
        ...evidenceEntry,
        decision: entry.decision,
        reason: existing && existing.decision === entry.decision
          ? existing.reason
          : existing ? "Parent decision." : "Added by a parent.",
      };
    }).sort((left, right) => {
      const leftName = catalog.items.find((item) => item.id === left.itemID)?.name ?? "";
      const rightName = catalog.items.find((item) => item.id === right.itemID)?.name ?? "";
      return leftName.localeCompare(rightName, "en-US")
        || left.itemID.localeCompare(right.itemID);
    });
    const updated = await this.repository.replaceDraftTrip({
      ...trip,
      version: trip.version + 1,
      entries,
      updatedAt: timestamp(now, "invalid_shopping_trip"),
    }, review.expectedVersion);
    if (!updated) throw new ShoppingModuleError("shopping_trip_conflict");
    return updated;
  }

  async finalizeTrip(
    account: Account,
    tripID: string,
    expectedVersion: number,
  ): Promise<ShoppingTripPlan> {
    requireParent(account);
    const trip = await this.repository.trip(account.familyID, tripID);
    if (!trip) throw new ShoppingModuleError("shopping_trip_not_found");
    if (trip.status === "finalized") return trip;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new ShoppingModuleError("shopping_trip_conflict");
    }
    const finalizedAt = timestamp(this.now(), "invalid_shopping_trip");
    const requestIDs = [...new Set(trip.entries
      .filter((entry) => entry.decision === "buy")
      .flatMap((entry) => entry.requestIDs))];
    const finalized = await this.repository.finalizeTrip(
      account.familyID,
      tripID,
      expectedVersion,
      finalizedAt,
      account.memberID,
      requestIDs,
    );
    if (!finalized) throw new ShoppingModuleError("shopping_trip_conflict");
    return finalized;
  }

  async completeTrip(
    account: Account,
    tripID: string,
    expectedVersion: number,
    outcomes: ShoppingOutcomeInput[],
  ): Promise<ShoppingTripPlan> {
    requireParent(account);
    const trip = await this.repository.trip(account.familyID, tripID);
    if (!trip) throw new ShoppingModuleError("shopping_trip_not_found");
    if (trip.status === "completed") return trip;
    if (trip.status !== "finalized" || !Number.isSafeInteger(expectedVersion)
      || expectedVersion < 1 || trip.version !== expectedVersion) {
      throw new ShoppingModuleError("shopping_trip_conflict");
    }
    const itemIDs = new Set(trip.entries.map((entry) => entry.itemID));
    if (outcomes.length !== itemIDs.size || outcomes.length > 500
      || new Set(outcomes.map((outcome) => outcome.itemID)).size !== outcomes.length
      || outcomes.some((outcome) => !itemIDs.has(outcome.itemID)
        || !isOutcomeStatus(outcome.status)
        || (outcome.quantity !== null && (typeof outcome.quantity !== "number"
          || !Number.isFinite(outcome.quantity) || outcome.quantity <= 0
          || outcome.quantity > 1_000_000))
        || (outcome.price !== null && (typeof outcome.price !== "number"
          || !Number.isFinite(outcome.price) || outcome.price < 0 || outcome.price > 1_000_000))
        || (outcome.status !== "purchased" && (outcome.quantity !== null || outcome.price !== null)))) {
      throw new ShoppingModuleError("invalid_trip_outcomes");
    }
    const completed = await this.repository.completeTrip(
      account.familyID, tripID, expectedVersion, outcomes,
      timestamp(this.now(), "invalid_trip_outcomes"), account.memberID,
    );
    if (completed) return completed;
    const replay = await this.repository.trip(account.familyID, tripID);
    if (replay?.status === "completed") return replay;
    throw new ShoppingModuleError("shopping_trip_conflict");
  }

  async observeStock(
    account: Account,
    id: string,
    itemID: string,
    input: StockObservationInput,
  ): Promise<StockObservation> {
    const existing = await this.repository.stockObservation(account.familyID, id);
    if (existing) return existing;
    const catalog = await this.repository.catalog(account.familyID);
    if (!catalog.items.some((item) => item.id === itemID)) {
      throw new ShoppingModuleError("pantry_item_not_found");
    }
    if (input.level !== "enough" && input.level !== "low" && input.level !== "out") {
      throw new ShoppingModuleError("invalid_stock_observation");
    }
    const quantity = optionalPositiveNumber(
      input.quantity, 1_000_000, "invalid_stock_observation", true,
    );
    const note = optionalText(input.note, 500, "invalid_stock_observation");
    return this.repository.saveStockObservationIfAbsent({
      id,
      familyID: account.familyID,
      itemID,
      observedByMemberID: account.memberID,
      level: input.level,
      quantity,
      note,
      observedAt: timestamp(this.now(), "invalid_stock_observation"),
    });
  }
}

export function normalizedShoppingName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

const STOCK_FRESHNESS_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

function recommendedEntry(
  item: PantryItem,
  evidence: ShoppingEvidence,
  now: Date,
  purchases: ShoppingPurchase[],
): ShoppingTripEntry {
  const itemID = item.id;
  const requests = evidence.openRequests.filter((request) => request.itemID === itemID);
  const observation = evidence.latestObservations.find((candidate) => candidate.itemID === itemID);
  const age = observation ? now.getTime() - new Date(observation.observedAt).getTime() : Infinity;
  const fresh = age >= 0 && age <= STOCK_FRESHNESS_MILLISECONDS;
  if (requests.length > 0) {
    const conflict = fresh && observation?.level === "enough"
      ? "; recent Stock evidence says Enough"
      : "";
    return {
      itemID,
      decision: "buy",
      reason: `Requested by a Family Member${conflict}.`,
      requestIDs: requests.map((request) => request.id).sort(),
      observationID: observation?.id ?? null,
    };
  }
  if (!observation) {
    const lastPurchase = purchases.find((purchase) => purchase.itemID === itemID);
    const purchaseAge = lastPurchase
      ? now.getTime() - new Date(lastPurchase.purchasedAt).getTime() : Infinity;
    const purchaseWindow = (item.expectedDurationDays ?? 7) * 24 * 60 * 60 * 1_000;
    return {
      itemID, decision: "check_at_home",
      reason: purchaseAge >= 0 && purchaseAge <= purchaseWindow
        ? "Purchased recently; check at home before buying."
        : "No recent Stock evidence is available.",
      requestIDs: [], observationID: null,
    };
  }
  if (!fresh) {
    return {
      itemID, decision: "check_at_home", reason: "The latest Stock evidence is stale.",
      requestIDs: [], observationID: observation.id,
    };
  }
  const title = observation.level === "out" ? "Out"
    : observation.level === "low" ? "Low" : "Enough";
  return {
    itemID,
    decision: observation.level === "enough" ? "skip" : "buy",
    reason: `Recent Stock evidence says ${title}.`,
    requestIDs: [],
    observationID: observation.id,
  };
}

function isOutcomeStatus(value: unknown): value is ShoppingOutcomeStatus {
  return value === "purchased" || value === "skipped"
    || value === "unavailable" || value === "deferred";
}

function isTripDecision(value: unknown): value is ShoppingTripDecision {
  return value === "buy" || value === "check_at_home" || value === "skip";
}

function validDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
  return timestamp(value, "invalid_pantry_item");
}

function timestamp(value: Date, reason: ShoppingModuleFailureReason): string {
  if (!Number.isFinite(value.getTime())) throw new ShoppingModuleError(reason);
  return value.toISOString();
}
