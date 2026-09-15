import { randomUUID } from "node:crypto";
import type { Account, FamilyEvent, FamilyMember } from "./domain.js";
import { eventOccurrenceStarts } from "./event-recurrence.js";
import {
  previewDrivingTravel,
  type RoutingProvider,
  type TrafficPreference,
  type TravelPreview,
  type TravelWaypoint,
} from "./travel-preview.js";

export type SavedPlaceVisibility = "family" | "personal";

export interface SavedPlace {
  id: string;
  familyID: string;
  ownerMemberID: string | null;
  visibility: SavedPlaceVisibility;
  label: string;
  waypoint: TravelWaypoint;
  createdAt: string;
  updatedAt: string;
}

export type TravelPlanOrigin =
  | { kind: "saved_place"; savedPlaceID: string }
  | { kind: "one_time"; waypoint: TravelWaypoint };

export interface EventTravelPlan {
  familyID: string;
  eventID: string;
  revision: number;
  origin: TravelPlanOrigin;
  preparationMinutes: number;
  trafficPreference: TrafficPreference;
  recipientMemberIDs: string[];
  leaveAlertEnabled: boolean;
  createdByMemberID: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPlaceDraft {
  id?: string;
  visibility: SavedPlaceVisibility;
  label: string;
  waypoint: TravelWaypoint;
}

export interface EventTravelPlanDraft {
  origin: TravelPlanOrigin;
  preparationMinutes: number;
  trafficPreference: TrafficPreference;
  recipientMemberIDs: string[];
  leaveAlertEnabled: boolean;
}

export interface TravelPlanningRepository {
  eventsForFamily(familyID: string): Promise<FamilyEvent[]>;
  membersForFamily(familyID: string): Promise<FamilyMember[]>;
  savedPlacesForFamily(familyID: string): Promise<SavedPlace[]>;
  saveSavedPlace(place: SavedPlace): Promise<SavedPlace>;
  deleteSavedPlace(familyID: string, placeID: string): Promise<boolean>;
  familyIDsWithTravelPlans(): Promise<string[]>;
  travelPlansForFamily(familyID: string): Promise<EventTravelPlan[]>;
  travelPlanForEvent(familyID: string, eventID: string): Promise<EventTravelPlan | null>;
  saveTravelPlan(plan: EventTravelPlan): Promise<void>;
  deleteTravelPlan(familyID: string, eventID: string): Promise<boolean>;
}

export type TravelPlanningFailureReason =
  | "parent_required"
  | "event_not_found"
  | "event_missing_arrival_target"
  | "event_missing_destination"
  | "event_no_upcoming_occurrence"
  | "saved_place_not_found"
  | "saved_place_in_use"
  | "travel_plan_not_found"
  | "travel_plan_forbidden"
  | "invalid_saved_place"
  | "invalid_travel_plan"
  | "invalid_recipients";

export class SavedPlaceLabelConflictError extends Error {
  constructor() {
    super("saved_place_label_conflict");
    this.name = "SavedPlaceLabelConflictError";
  }
}

export class TravelPlanningError extends Error {
  constructor(public readonly reason: TravelPlanningFailureReason) {
    super(reason);
    this.name = "TravelPlanningError";
  }
}

export class TravelPlanningModule {
  constructor(
    private readonly repository: TravelPlanningRepository,
    private readonly routingProvider: RoutingProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listSavedPlaces(account: Account): Promise<SavedPlace[]> {
    return (await this.repository.savedPlacesForFamily(account.familyID))
      .filter((place) => this.canUseSavedPlace(account, place));
  }

  async saveSavedPlace(account: Account, draft: SavedPlaceDraft): Promise<SavedPlace> {
    const label = validateLabel(draft.label);
    const waypoint = validateWaypoint(draft.waypoint);
    if (draft.visibility === "family" && account.role !== "parent") {
      throw new TravelPlanningError("parent_required");
    }
    if (draft.visibility !== "family" && draft.visibility !== "personal") {
      throw new TravelPlanningError("invalid_saved_place");
    }
    const visiblePlaces = await this.listSavedPlaces(account);
    const existing = draft.id
      ? visiblePlaces.find((place) => place.id === draft.id)
      : undefined;
    if (draft.id && !existing) throw new TravelPlanningError("saved_place_not_found");
    const equivalent = visiblePlaces.find((place) => place.id !== draft.id
      && place.visibility === draft.visibility
      && place.ownerMemberID === (draft.visibility === "personal" ? account.memberID : null)
      && normalizedSavedPlaceLabel(place.label) === normalizedSavedPlaceLabel(label));
    if (equivalent) {
      if (draft.id) throw new TravelPlanningError("invalid_saved_place");
      return equivalent;
    }
    if (existing?.visibility === "family" && account.role !== "parent") {
      throw new TravelPlanningError("parent_required");
    }
    const timestamp = validNow(this.now()).toISOString();
    const place: SavedPlace = {
      id: existing?.id ?? randomUUID(),
      familyID: account.familyID,
      ownerMemberID: draft.visibility === "personal" ? account.memberID : null,
      visibility: draft.visibility,
      label,
      waypoint,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    try {
      return await this.repository.saveSavedPlace(place);
    } catch (error) {
      if (error instanceof SavedPlaceLabelConflictError) {
        throw new TravelPlanningError("invalid_saved_place");
      }
      throw error;
    }
  }

  async deleteSavedPlace(account: Account, placeID: string): Promise<boolean> {
    const place = (await this.listSavedPlaces(account)).find((candidate) => candidate.id === placeID);
    if (!place) return false;
    if (place.visibility === "family" && account.role !== "parent") {
      throw new TravelPlanningError("parent_required");
    }
    const plans = await this.repository.travelPlansForFamily(account.familyID);
    if (plans.some((plan) => plan.origin.kind === "saved_place"
      && plan.origin.savedPlaceID === placeID)) {
      throw new TravelPlanningError("saved_place_in_use");
    }
    return this.repository.deleteSavedPlace(account.familyID, placeID);
  }

  async travelPlan(account: Account, eventID: string): Promise<EventTravelPlan | null> {
    const plan = await this.repository.travelPlanForEvent(account.familyID, eventID);
    if (!plan) return null;
    if (account.role !== "parent" && !plan.recipientMemberIDs.includes(account.memberID)) {
      throw new TravelPlanningError("travel_plan_forbidden");
    }
    return plan;
  }

  async saveTravelPlan(
    account: Account,
    eventID: string,
    draft: EventTravelPlanDraft,
  ): Promise<EventTravelPlan> {
    requireParent(account);
    const { event, members } = await this.validatedContext(account.familyID, eventID, draft);
    await this.resolveOrigin(account, draft.origin);
    validateRecipients(draft.recipientMemberIDs, event, members);
    const existing = await this.repository.travelPlanForEvent(account.familyID, eventID);
    const timestamp = validNow(this.now()).toISOString();
    const plan: EventTravelPlan = {
      familyID: account.familyID,
      eventID,
      revision: (existing?.revision ?? 0) + 1,
      origin: copyOrigin(draft.origin),
      preparationMinutes: draft.preparationMinutes,
      trafficPreference: draft.trafficPreference,
      recipientMemberIDs: [...new Set(draft.recipientMemberIDs)],
      leaveAlertEnabled: draft.leaveAlertEnabled,
      createdByMemberID: existing?.createdByMemberID ?? account.memberID,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await this.repository.saveTravelPlan(plan);
    return plan;
  }

  async deleteTravelPlan(account: Account, eventID: string): Promise<boolean> {
    requireParent(account);
    return this.repository.deleteTravelPlan(account.familyID, eventID);
  }

  async preview(
    account: Account,
    eventID: string,
    draft?: EventTravelPlanDraft,
  ): Promise<TravelPreview> {
    if (draft) requireParent(account);
    const planDraft = draft ?? await this.existingDraft(account, eventID);
    const { event, members } = await this.validatedContext(account.familyID, eventID, planDraft);
    if (account.role !== "parent" && !planDraft.recipientMemberIDs.includes(account.memberID)) {
      throw new TravelPlanningError("travel_plan_forbidden");
    }
    validateRecipients(planDraft.recipientMemberIDs, event, members);
    const origin = draft
      ? await this.resolveOrigin(account, planDraft.origin)
      : await this.resolvePersistedOrigin(account.familyID, planDraft.origin);
    const previewNow = validNow(this.now());
    return previewDrivingTravel({
      origin,
      destination: { address: event.location! },
      arrivalTime: previewArrivalTime(event, previewNow),
      preparationMinutes: planDraft.preparationMinutes,
      trafficPreference: planDraft.trafficPreference,
    }, this.routingProvider, { now: () => previewNow });
  }

  private async existingDraft(account: Account, eventID: string): Promise<EventTravelPlanDraft> {
    const plan = await this.travelPlan(account, eventID);
    if (!plan) throw new TravelPlanningError("travel_plan_not_found");
    return plan;
  }

  private async validatedContext(
    familyID: string,
    eventID: string,
    draft: EventTravelPlanDraft,
  ): Promise<{ event: FamilyEvent; members: FamilyMember[] }> {
    validatePlanFields(draft);
    const [events, members] = await Promise.all([
      this.repository.eventsForFamily(familyID),
      this.repository.membersForFamily(familyID),
    ]);
    const event = events.find((candidate) => candidate.familyID === familyID && candidate.id === eventID);
    if (!event) throw new TravelPlanningError("event_not_found");
    const familyMembers = members.filter((member) => member.familyID === familyID);
    if (!event.arrivalTime) throw new TravelPlanningError("event_missing_arrival_target");
    if (!event.location?.trim()) throw new TravelPlanningError("event_missing_destination");
    return { event, members: familyMembers };
  }

  private async resolveOrigin(account: Account, origin: TravelPlanOrigin): Promise<TravelWaypoint> {
    if (origin.kind === "one_time") return validateWaypoint(origin.waypoint);
    if (origin.kind !== "saved_place" || !origin.savedPlaceID) {
      throw new TravelPlanningError("invalid_travel_plan");
    }
    const place = (await this.listSavedPlaces(account))
      .find((candidate) => candidate.id === origin.savedPlaceID);
    if (!place) throw new TravelPlanningError("saved_place_not_found");
    return place.waypoint;
  }

  private async resolvePersistedOrigin(
    familyID: string,
    origin: TravelPlanOrigin,
  ): Promise<TravelWaypoint> {
    if (origin.kind === "one_time") return validateWaypoint(origin.waypoint);
    const place = (await this.repository.savedPlacesForFamily(familyID))
      .find((candidate) => candidate.id === origin.savedPlaceID);
    if (!place) throw new TravelPlanningError("saved_place_not_found");
    return place.waypoint;
  }

  private canUseSavedPlace(account: Account, place: SavedPlace): boolean {
    return place.familyID === account.familyID
      && (place.visibility === "family" || place.ownerMemberID === account.memberID);
  }
}

function requireParent(account: Account): void {
  if (account.role !== "parent") throw new TravelPlanningError("parent_required");
}

export function normalizedSavedPlaceLabel(label: string): string {
  return label.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function validateLabel(label: unknown): string {
  const value = typeof label === "string" ? label.trim() : "";
  if (!value || value.length > 100) throw new TravelPlanningError("invalid_saved_place");
  return value;
}

function validateWaypoint(waypoint: TravelWaypoint): TravelWaypoint {
  const placeID = typeof waypoint.placeID === "string" ? waypoint.placeID.trim() : "";
  const address = typeof waypoint.address === "string" ? waypoint.address.trim() : "";
  if ((placeID.length > 0) === (address.length > 0)
    || placeID.length > 500
    || address.length > 500) {
    throw new TravelPlanningError("invalid_travel_plan");
  }
  return placeID ? { placeID } : { address };
}

function validatePlanFields(draft: EventTravelPlanDraft): void {
  if (!Number.isInteger(draft.preparationMinutes)
    || draft.preparationMinutes < 0
    || draft.preparationMinutes > 180
    || (draft.trafficPreference !== "best_guess" && draft.trafficPreference !== "pessimistic")
    || typeof draft.leaveAlertEnabled !== "boolean") {
    throw new TravelPlanningError("invalid_travel_plan");
  }
  if (!Array.isArray(draft.recipientMemberIDs)
    || draft.recipientMemberIDs.length > 20
    || (draft.leaveAlertEnabled && draft.recipientMemberIDs.length < 1)
    || draft.recipientMemberIDs.some((id) => typeof id !== "string" || !id || id.length > 300)) {
    throw new TravelPlanningError("invalid_recipients");
  }
}

function validateRecipients(
  recipientIDs: string[],
  event: FamilyEvent,
  members: FamilyMember[],
): void {
  const familyMemberIDs = new Set(members.map((member) => member.id));
  const eligibleIDs = new Set(event.participantIDs);
  if (event.driverMemberID) eligibleIDs.add(event.driverMemberID);
  if (recipientIDs.some((id) => !familyMemberIDs.has(id) || !eligibleIDs.has(id))) {
    throw new TravelPlanningError("invalid_recipients");
  }
}

function copyOrigin(origin: TravelPlanOrigin): TravelPlanOrigin {
  return origin.kind === "saved_place"
    ? { kind: "saved_place", savedPlaceID: origin.savedPlaceID }
    : { kind: "one_time", waypoint: validateWaypoint(origin.waypoint) };
}

function previewArrivalTime(event: FamilyEvent, now: Date): Date {
  const baseArrival = new Date(event.arrivalTime!);
  const baseStart = new Date(event.startTime);
  if (!Number.isFinite(baseArrival.getTime()) || !Number.isFinite(baseStart.getTime())) {
    throw new TravelPlanningError("invalid_travel_plan");
  }
  if (!event.recurrence) return baseArrival;
  const arrivalOffset = baseStart.getTime() - baseArrival.getTime();
  const occurrence = eventOccurrenceStarts(event, new Date(event.recurrence.endDate))
    .find((start) => start > now);
  if (!occurrence) throw new TravelPlanningError("event_no_upcoming_occurrence");
  return new Date(occurrence.getTime() - arrivalOffset);
}

function validNow(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new TravelPlanningError("invalid_travel_plan");
  return now;
}
