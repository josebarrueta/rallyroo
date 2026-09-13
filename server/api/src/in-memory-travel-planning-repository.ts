import type { FamilyEvent, FamilyMember } from "./domain.js";
import type {
  EventTravelPlan,
  SavedPlace,
  TravelPlanningRepository,
} from "./travel-planning.js";

export interface InMemoryTravelPlanningRepositoryOptions {
  events?: FamilyEvent[];
  members?: FamilyMember[];
  savedPlaces?: SavedPlace[];
  travelPlans?: EventTravelPlan[];
}

/**
 * Deep-clone every read and write boundary so callers can never retain a
 * reference that mutates the backing store. Node's `structuredClone` copies
 * plain nested data (waypoints, origins) faithfully.
 */
const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryTravelPlanningRepository
implements TravelPlanningRepository {
  private readonly eventsByFamily = new Map<string, FamilyEvent[]>();
  private readonly membersByFamily = new Map<string, FamilyMember[]>();
  private readonly savedPlacesByFamily = new Map<string, SavedPlace[]>();
  private readonly travelPlansByFamily = new Map<string, EventTravelPlan[]>();

  constructor(options: InMemoryTravelPlanningRepositoryOptions = {}) {
    for (const ev of options.events ?? []) {
      addGrouped(this.eventsByFamily, ev.familyID, clone(ev));
      }
    for (const member of options.members ?? []) {
      addGrouped(this.membersByFamily, member.familyID, clone(member));
      }
    for (const place of options.savedPlaces ?? []) {
      addGrouped(this.savedPlacesByFamily, place.familyID, clone(place));
      }
    for (const plan of options.travelPlans ?? []) {
      addGrouped(this.travelPlansByFamily, plan.familyID, clone(plan));
      }
    }

  async eventsForFamily(familyID: string): Promise<FamilyEvent[]> {
    return (this.eventsByFamily.get(familyID) ?? []).map(clone);
    }

  async membersForFamily(familyID: string): Promise<FamilyMember[]> {
    return (this.membersByFamily.get(familyID) ?? []).map(clone);
    }

  async savedPlacesForFamily(familyID: string): Promise<SavedPlace[]> {
    return (this.savedPlacesByFamily.get(familyID) ?? []).map(clone);
    }

  async saveSavedPlace(place: SavedPlace): Promise<void> {
    const family = this.savedPlacesByFamily.get(place.familyID) ?? [];
    upsert(family, place, (candidate) => candidate.id === place.id);
    this.savedPlacesByFamily.set(place.familyID, family);
    }

  async deleteSavedPlace(familyID: string, placeID: string): Promise<boolean> {
    const family = this.savedPlacesByFamily.get(familyID);
    return family ? remove(family, (candidate) => candidate.id === placeID) : false;
    }

  async familyIDsWithTravelPlans(): Promise<string[]> {
    return [...this.travelPlansByFamily.entries()]
      .filter(([, plans]) => plans.length > 0)
      .map(([familyID]) => familyID)
      .sort();
  }

  async travelPlansForFamily(familyID: string): Promise<EventTravelPlan[]> {
    return (this.travelPlansByFamily.get(familyID) ?? []).map(clone);
    }

  async travelPlanForEvent(
    familyID: string,
    eventID: string,
   ): Promise<EventTravelPlan | null> {
    const family = this.travelPlansByFamily.get(familyID);
    const plan = family?.find((candidate) => candidate.eventID === eventID);
    return plan ? clone(plan) : null;
    }

  async saveTravelPlan(plan: EventTravelPlan): Promise<void> {
    const family = this.travelPlansByFamily.get(plan.familyID) ?? [];
    upsert(family, plan, (candidate) => candidate.eventID === plan.eventID);
    this.travelPlansByFamily.set(plan.familyID, family);
    }

  async deleteTravelPlan(familyID: string, eventID: string): Promise<boolean> {
    const family = this.travelPlansByFamily.get(familyID);
    return family ? remove(family, (candidate) => candidate.eventID === eventID) : false;
    }
}

function addGrouped<T>(
  groups: Map<string, T[]>,
  familyID: string,
  item: T,
): void {
  const existing = groups.get(familyID) ?? [];
  existing.push(item);
  groups.set(familyID, existing);
}

function upsert<T>(
  list: T[],
  item: T,
  matches: (candidate: T) => boolean,
): void {
  const index = list.findIndex(matches);
  const copy = clone(item);
  if (index === -1) list.push(copy);
  else list[index] = copy;
}

function remove<T>(
  list: T[],
  matches: (candidate: T) => boolean,
): boolean {
  const index = list.findIndex(matches);
  if (index === -1) return false;
  list.splice(index, 1);
  return true;
}
