import {
  normalizedShoppingName,
  ShoppingNameConflictError,
  ShoppingRoutineReferenceError,
  ShoppingTripCatalogInUseError,
  type PantryItem,
  type ShoppingCatalog,
  type ShoppingEvidence,
  type ShoppingItemRequest,
  type ShoppingItemRequestStatus,
  type ShoppingRepository,
  type ShoppingRoutine,
  type ShoppingTripPlan,
  type ShoppingOutcomeInput,
  type ShoppingPurchase,
  type StockObservation,
} from "./shopping-module.js";

export class InMemoryShoppingRepository implements ShoppingRepository {
  private readonly routines: ShoppingRoutine[] = [];
  private readonly items: PantryItem[] = [];
  private readonly requests: ShoppingItemRequest[] = [];
  private readonly observations: StockObservation[] = [];
  private readonly tripPlans: ShoppingTripPlan[] = [];
  private readonly purchaseRecords: ShoppingPurchase[] = [];

  async catalog(familyID: string): Promise<ShoppingCatalog> {
    return {
      routines: this.routines.filter((routine) => routine.familyID === familyID)
        .map((routine) => ({ ...routine })),
      items: this.items.filter((item) => item.familyID === familyID)
        .map((item) => ({ ...item, routineIDs: [...item.routineIDs] })),
    };
  }

  async saveRoutine(routine: ShoppingRoutine): Promise<ShoppingRoutine> {
    if (this.routines.some((candidate) => candidate.familyID === routine.familyID
      && candidate.id !== routine.id
      && normalizedShoppingName(candidate.storeName)
        === normalizedShoppingName(routine.storeName))) {
      throw new ShoppingNameConflictError("routine");
    }
    const index = this.routines.findIndex((candidate) => candidate.familyID === routine.familyID
      && candidate.id === routine.id);
    if (index >= 0) this.routines[index] = { ...routine };
    else this.routines.push({ ...routine });
    return { ...routine };
  }

  async deleteRoutine(familyID: string, routineID: string): Promise<boolean> {
    if (this.tripPlans.some((trip) => trip.familyID === familyID && trip.routineID === routineID)) {
      throw new ShoppingTripCatalogInUseError();
    }
    const index = this.routines.findIndex((routine) => routine.familyID === familyID
      && routine.id === routineID);
    if (index < 0) return false;
    this.routines.splice(index, 1);
    for (let itemIndex = 0; itemIndex < this.items.length; itemIndex += 1) {
      const item = this.items[itemIndex]!;
      if (item.familyID === familyID && item.routineIDs.includes(routineID)) {
        this.items[itemIndex] = {
          ...item,
          routineIDs: item.routineIDs.filter((id) => id !== routineID),
        };
      }
    }
    return true;
  }

  async savePantryItem(item: PantryItem): Promise<PantryItem> {
    if (item.routineIDs.some((routineID) => !this.routines.some((routine) =>
      routine.familyID === item.familyID && routine.id === routineID))) {
      throw new ShoppingRoutineReferenceError();
    }
    if (this.items.some((candidate) => candidate.familyID === item.familyID
      && candidate.id !== item.id
      && normalizedShoppingName(candidate.name) === normalizedShoppingName(item.name))) {
      throw new ShoppingNameConflictError("pantry_item");
    }
    const copy = { ...item, routineIDs: [...item.routineIDs] };
    const index = this.items.findIndex((candidate) => candidate.familyID === item.familyID
      && candidate.id === item.id);
    if (index >= 0) this.items[index] = copy;
    else this.items.push(copy);
    return { ...copy, routineIDs: [...copy.routineIDs] };
  }

  async deletePantryItem(familyID: string, itemID: string): Promise<boolean> {
    if (this.tripPlans.some((trip) => trip.familyID === familyID
      && trip.entries.some((entry) => entry.itemID === itemID))) {
      throw new ShoppingTripCatalogInUseError();
    }
    const index = this.items.findIndex((item) => item.familyID === familyID && item.id === itemID);
    if (index < 0) return false;
    this.items.splice(index, 1);
    for (let requestIndex = this.requests.length - 1; requestIndex >= 0; requestIndex -= 1) {
      if (this.requests[requestIndex]!.familyID === familyID
        && this.requests[requestIndex]!.itemID === itemID) this.requests.splice(requestIndex, 1);
    }
    for (let observationIndex = this.observations.length - 1;
      observationIndex >= 0; observationIndex -= 1) {
      if (this.observations[observationIndex]!.familyID === familyID
        && this.observations[observationIndex]!.itemID === itemID) {
        this.observations.splice(observationIndex, 1);
      }
    }
    return true;
  }

  async evidence(familyID: string): Promise<ShoppingEvidence> {
    const openRequests = this.requests.filter((request) =>
      request.familyID === familyID && request.status === "open")
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)
        || right.id.localeCompare(left.id))
      .map((request) => ({ ...request }));
    const latest = new Map<string, StockObservation>();
    for (const observation of this.observations.filter((candidate) =>
      candidate.familyID === familyID)) {
      const current = latest.get(observation.itemID);
      if (!current || observation.observedAt > current.observedAt
        || (observation.observedAt === current.observedAt && observation.id > current.id)) {
        latest.set(observation.itemID, observation);
      }
    }
    return {
      openRequests,
      latestObservations: [...latest.values()]
        .sort((left, right) => left.itemID.localeCompare(right.itemID))
        .map((observation) => ({ ...observation })),
    };
  }

  async itemRequest(familyID: string, requestID: string): Promise<ShoppingItemRequest | null> {
    const request = this.requests.find((candidate) =>
      candidate.familyID === familyID && candidate.id === requestID);
    return request ? { ...request } : null;
  }

  async saveItemRequestIfAbsent(request: ShoppingItemRequest): Promise<ShoppingItemRequest> {
    const existing = await this.itemRequest(request.familyID, request.id);
    if (existing) return existing;
    this.requests.push({ ...request });
    return { ...request };
  }

  async closeItemRequest(
    familyID: string,
    requestID: string,
    status: Exclude<ShoppingItemRequestStatus, "open">,
    resolvedAt: string,
    resolvedByMemberID: string,
  ): Promise<ShoppingItemRequest | null> {
    const index = this.requests.findIndex((request) =>
      request.familyID === familyID && request.id === requestID);
    if (index < 0) return null;
    const current = this.requests[index]!;
    if (current.status === "open") {
      this.requests[index] = {
        ...current, status, resolvedAt, resolvedByMemberID,
      };
    }
    return { ...this.requests[index]! };
  }

  async stockObservation(
    familyID: string,
    observationID: string,
  ): Promise<StockObservation | null> {
    const observation = this.observations.find((candidate) =>
      candidate.familyID === familyID && candidate.id === observationID);
    return observation ? { ...observation } : null;
  }

  async saveStockObservationIfAbsent(
    observation: StockObservation,
  ): Promise<StockObservation> {
    const existing = await this.stockObservation(observation.familyID, observation.id);
    if (existing) return existing;
    this.observations.push({ ...observation });
    return { ...observation };
  }

  async purchases(familyID: string): Promise<ShoppingPurchase[]> {
    return this.purchaseRecords.filter((purchase) => purchase.familyID === familyID)
      .sort((left, right) => right.purchasedAt.localeCompare(left.purchasedAt)
        || right.tripID.localeCompare(left.tripID))
      .map((purchase) => ({ ...purchase }));
  }

  async trips(familyID: string): Promise<ShoppingTripPlan[]> {
    return this.tripPlans.filter((trip) => trip.familyID === familyID)
      .sort((left, right) => right.plannedFor.localeCompare(left.plannedFor)
        || right.id.localeCompare(left.id))
      .map(copyTrip);
  }

  async trip(familyID: string, tripID: string): Promise<ShoppingTripPlan | null> {
    const trip = this.tripPlans.find((candidate) =>
      candidate.familyID === familyID && candidate.id === tripID);
    return trip ? copyTrip(trip) : null;
  }

  async saveTripIfAbsent(trip: ShoppingTripPlan): Promise<ShoppingTripPlan> {
    const existing = await this.trip(trip.familyID, trip.id);
    if (existing) return existing;
    const sameDay = this.tripPlans.find((candidate) => candidate.familyID === trip.familyID
      && candidate.routineID === trip.routineID && candidate.plannedFor === trip.plannedFor);
    if (sameDay) return copyTrip(sameDay);
    this.tripPlans.push(copyTrip(trip));
    return copyTrip(trip);
  }

  async replaceDraftTrip(
    trip: ShoppingTripPlan,
    expectedVersion: number,
  ): Promise<ShoppingTripPlan | null> {
    const index = this.tripPlans.findIndex((candidate) => candidate.familyID === trip.familyID
      && candidate.id === trip.id && candidate.status === "draft"
      && candidate.version === expectedVersion);
    if (index < 0) return null;
    this.tripPlans[index] = copyTrip(trip);
    return copyTrip(trip);
  }

  async completeTrip(
    familyID: string,
    tripID: string,
    expectedVersion: number,
    outcomes: ShoppingOutcomeInput[],
    completedAt: string,
    completedByMemberID: string,
  ): Promise<ShoppingTripPlan | null> {
    const index = this.tripPlans.findIndex((trip) => trip.familyID === familyID
      && trip.id === tripID && trip.status === "finalized" && trip.version === expectedVersion);
    if (index < 0) return null;
    this.tripPlans[index] = {
      ...this.tripPlans[index]!, status: "completed", version: expectedVersion + 1,
      outcomes: outcomes.map((outcome) => ({ ...outcome })),
      updatedAt: completedAt, completedAt, completedByMemberID,
    };
    for (const outcome of outcomes.filter((entry) => entry.status === "purchased")) {
      this.purchaseRecords.push({
        familyID, tripID, itemID: outcome.itemID, purchasedAt: completedAt,
        quantity: outcome.quantity, price: outcome.price,
      });
    }
    return copyTrip(this.tripPlans[index]!);
  }

  async finalizeTrip(
    familyID: string,
    tripID: string,
    expectedVersion: number,
    finalizedAt: string,
    finalizedByMemberID: string,
    resolvedRequestIDs: string[],
  ): Promise<ShoppingTripPlan | null> {
    const index = this.tripPlans.findIndex((trip) => trip.familyID === familyID
      && trip.id === tripID && trip.status === "draft" && trip.version === expectedVersion);
    if (index < 0) return null;
    this.tripPlans[index] = {
      ...this.tripPlans[index]!,
      status: "finalized",
      version: expectedVersion + 1,
      updatedAt: finalizedAt,
      finalizedAt,
      finalizedByMemberID,
    };
    const requestIDs = new Set(resolvedRequestIDs);
    for (let requestIndex = 0; requestIndex < this.requests.length; requestIndex += 1) {
      const request = this.requests[requestIndex]!;
      if (request.familyID === familyID && request.status === "open" && requestIDs.has(request.id)) {
        this.requests[requestIndex] = {
          ...request,
          status: "resolved",
          resolvedAt: finalizedAt,
          resolvedByMemberID: finalizedByMemberID,
        };
      }
    }
    return copyTrip(this.tripPlans[index]!);
  }
}

function copyTrip(trip: ShoppingTripPlan): ShoppingTripPlan {
  return {
    ...trip,
    entries: trip.entries.map((entry) => ({ ...entry, requestIDs: [...entry.requestIDs] })),
    outcomes: trip.outcomes.map((outcome) => ({ ...outcome })),
  };
}
