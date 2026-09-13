import { describe, expect, it } from "vitest";
import type {
  Account,
  FamilyEvent,
  FamilyMember,
} from "../src/domain.js";
import {
  InMemoryTravelPlanningRepository,
  type InMemoryTravelPlanningRepositoryOptions,
} from "../src/in-memory-travel-planning-repository.js";
import {
  TravelPlanningError,
  TravelPlanningModule,
  type EventTravelPlanDraft,
  type SavedPlaceDraft,
} from "../src/travel-planning.js";
import {
  type RoutingProvider,
  type TravelPreview,
} from "../src/travel-preview.js";

const moment = new Date("2026-08-01T10:00:00.000Z");
const clock = () => new Date(moment);

function parent(): Account {
  return {
    identitySubject: "parent-subject",
    familyID: "family-1",
    memberID: "member-parent",
    role: "parent",
  };
}

function kid(): Account {
  return {
    identitySubject: "kid-subject",
    familyID: "family-1",
    memberID: "member-kid",
    role: "kid",
  };
}

function sibling(): Account {
  return {
    identitySubject: "sibling-subject",
    familyID: "family-1",
    memberID: "member-sibling",
    role: "kid",
  };
}

function otherFamilyParent(): Account {
  return {
    identitySubject: "other-subject",
    familyID: "family-2",
    memberID: "member-other",
    role: "parent",
  };
}

function members(): FamilyMember[] {
  return [
    {
      id: "member-parent",
      familyID: "family-1",
      name: "Parent",
      role: "parent",
      colorTag: "#000000",
      canDrive: true,
    },
    {
      id: "member-kid",
      familyID: "family-1",
      name: "Kid",
      role: "kid",
      colorTag: "#111111",
    },
    {
      id: "member-sibling",
      familyID: "family-1",
      name: "Sibling",
      role: "kid",
      colorTag: "#222222",
    },
    {
      id: "member-outside",
      familyID: "family-2",
      name: "Outside",
      role: "parent",
      colorTag: "#333333",
    },
  ];
}

function event(overrides: Partial<FamilyEvent> = {}): FamilyEvent {
  return {
    id: "event-1",
    familyID: "family-1",
    title: "Soccer",
    kidID: "member-kid",
    participantIDs: ["member-kid"],
    startTime: "2026-08-01T17:30:00.000Z",
    endTime: "2026-08-01T19:00:00.000Z",
    arrivalTime: "2026-08-01T18:00:00.000Z",
    location: "123 Field St, Palo Alto, CA",
    driver: "Parent",
    driverMemberID: "member-parent",
    source: "manual",
    status: "confirmed",
    ...overrides,
  };
}

interface Harness {
  repo: InMemoryTravelPlanningRepository;
  module: TravelPlanningModule;
  calls: () => number;
}

function make(
  overrides:
   & Partial<InMemoryTravelPlanningRepositoryOptions>
   & { repo?: InMemoryTravelPlanningRepository; provider?: RoutingProvider } = {},
): Harness {
  let calls = 0;
  const provider: RoutingProvider = overrides.provider ?? {
    async estimate() {
      calls += 1;
      return { durationSeconds: 1_800, distanceMeters: 9_000 };
    },
  };
  const seed: InMemoryTravelPlanningRepositoryOptions = {
    events: overrides.events ?? [event()],
    members: overrides.members ?? members(),
  };
  if (overrides.savedPlaces) seed.savedPlaces = overrides.savedPlaces;
  if (overrides.travelPlans) seed.travelPlans = overrides.travelPlans;
  const repo = overrides.repo ?? new InMemoryTravelPlanningRepository(seed);
  return { repo, module: new TravelPlanningModule(repo, provider, clock), calls: () => calls };
}

function oneTimeDraft(overrides: Partial<EventTravelPlanDraft> = {}): EventTravelPlanDraft {
  return {
    origin: { kind: "one_time", waypoint: { address: "Home" } },
    preparationMinutes: 30,
    trafficPreference: "best_guess",
    recipientMemberIDs: ["member-kid"],
    leaveAlertEnabled: false,
    ...overrides,
  };
}

function savedPlaceDraft(overrides: Partial<SavedPlaceDraft> = {}): SavedPlaceDraft {
  return {
    visibility: "personal",
    label: "Label",
    waypoint: { address: "Home" },
    ...overrides,
  };
}

describe("InMemoryTravelPlanningRepository", () => {
  it("returns independent copies so callers cannot mutate storage", async () => {
    const repo = new InMemoryTravelPlanningRepository({
      events: [event()],
      savedPlaces: [
        {
          id: "place-1",
          familyID: "family-1",
          ownerMemberID: "member-parent",
          visibility: "personal",
          label: "Home",
          waypoint: { address: "Home" },
          createdAt: moment.toISOString(),
          updatedAt: moment.toISOString(),
        },
      ],
    });

    const places = await repo.savedPlacesForFamily("family-1");
    places[0]!.label = "Mutated";
    places[0]!.waypoint = { address: "Mutated" };
    const reloaded = await repo.savedPlacesForFamily("family-1");
    expect(reloaded[0]!.label).toBe("Home");
    expect(reloaded[0]!.waypoint).toEqual({ address: "Home" });

    const eventList = await repo.eventsForFamily("family-1");
    eventList[0]!.location = "Mutated";
    expect((await repo.eventsForFamily("family-1"))[0]!.location).toBe(
       "123 Field St, Palo Alto, CA",
      );
   });

  it("upserts by identity and removes saved places and travel plans", async () => {
    const repo = new InMemoryTravelPlanningRepository();
    expect(await repo.deleteSavedPlace("family-1", "missing")).toBe(false);
    expect(await repo.deleteTravelPlan("family-1", "event-1")).toBe(false);

    const place = {
      id: "place-1",
      familyID: "family-1",
      ownerMemberID: null,
      visibility: "family" as const,
      label: "Home",
      waypoint: { address: "Home" },
      createdAt: moment.toISOString(),
      updatedAt: moment.toISOString(),
      };
    await repo.saveSavedPlace(place);
    expect(await repo.savedPlacesForFamily("family-1")).toHaveLength(1);
    await repo.saveSavedPlace({ ...place, label: "Updated", updatedAt: "later" });
    expect(await repo.savedPlacesForFamily("family-1")).toHaveLength(1);
    expect((await repo.savedPlacesForFamily("family-1"))[0]!.label).toBe("Updated");
    expect(await repo.deleteSavedPlace("family-1", "place-1")).toBe(true);
    expect(await repo.deleteSavedPlace("family-1", "place-1")).toBe(false);

    const plan = {
      familyID: "family-1",
      eventID: "event-1",
      revision: 1,
      origin: { kind: "one_time" as const, waypoint: { address: "Home" } },
      preparationMinutes: 30,
      trafficPreference: "best_guess" as const,
      recipientMemberIDs: ["member-kid"],
      leaveAlertEnabled: false,
      createdByMemberID: "member-parent",
      createdAt: moment.toISOString(),
      updatedAt: moment.toISOString(),
      };
    await repo.saveTravelPlan(plan);
    expect(await repo.travelPlanForEvent("family-1", "event-1")).not.toBeNull();
    await repo.saveTravelPlan({ ...plan, revision: 2, updatedAt: "later" });
    expect(await repo.travelPlansForFamily("family-1")).toHaveLength(1);
    expect((await repo.travelPlanForEvent("family-1", "event-1"))!.revision).toBe(2);
    expect((await repo.travelPlanForEvent("family-1", "event-9"))).toBeNull();
    expect(await repo.deleteTravelPlan("family-1", "event-1")).toBe(true);
    expect(await repo.travelPlanForEvent("family-1", "event-1")).toBeNull();
   });
});

describe("TravelPlanningModule authorization", () => {
  it("lets only parents create, update, or delete family saved places", async () => {
    const { module } = make();
    const draft = savedPlaceDraft({ visibility: "family" });
    const created = await module.saveSavedPlace(parent(), draft);
    expect(created.ownerMemberID).toBeNull();

    await expect(
      module.saveSavedPlace(kid(), draft),
    ).rejects.toEqual(new TravelPlanningError("parent_required"));
    await expect(
      module.saveSavedPlace(kid(), { ...draft, id: created.id, visibility: "personal" }),
    ).rejects.toEqual(new TravelPlanningError("parent_required"));
    await expect(module.deleteSavedPlace(kid(), created.id))
      .rejects.toEqual(new TravelPlanningError("parent_required"));
   });

  it("lets only parents save and delete travel plans", async () => {
    const { module } = make();
    await expect(
      module.saveTravelPlan(kid(), "event-1", oneTimeDraft()),
     ).rejects.toEqual(new TravelPlanningError("parent_required"));
    await expect(
      module.deleteTravelPlan(kid(), "event-1"),
     ).rejects.toEqual(new TravelPlanningError("parent_required"));

    await module.saveTravelPlan(parent(), "event-1", oneTimeDraft());
    expect(await module.deleteTravelPlan(parent(), "event-1")).toBe(true);
   });

  it("forbids a non-recipient from reading or previewing a saved plan", async () => {
    const { module } = make();
     // Sibling is a family member but not a recipient of this plan.
    await module.saveTravelPlan(parent(), "event-1", oneTimeDraft({ recipientMemberIDs: ["member-kid"] }));

    await expect(
      module.travelPlan(sibling(), "event-1"),
     ).rejects.toEqual(new TravelPlanningError("travel_plan_forbidden"));
    await expect(
      module.preview(sibling(), "event-1", oneTimeDraft({ recipientMemberIDs: ["member-kid"] })),
    ).rejects.toEqual(new TravelPlanningError("parent_required"));
   });

  it("lets a child read and preview a plan when they are a recipient", async () => {
    const { module } = make();
    await module.saveTravelPlan(
      parent(),
       "event-1",
      oneTimeDraft({ recipientMemberIDs: ["member-kid"] }),
      );

    const plan = await module.travelPlan(kid(), "event-1");
    expect(plan!.recipientMemberIDs).toEqual(["member-kid"]);
    const preview = await module.preview(kid(), "event-1");
    expect(preview.durationSeconds).toBe(1_800);
   });

  it("returns null when no plan exists for a child", async () => {
    const { module } = make();
    expect(await module.travelPlan(kid(), "event-1")).toBeNull();
   });
});

describe("TravelPlanningModule saved place invariants", () => {
  it("isolates personal visibility to the owning member", async () => {
    const { module } = make();
    const owned = await module.saveSavedPlace(
      kid(),
      savedPlaceDraft({ visibility: "personal" }),
      );

    expect(
       (await module.listSavedPlaces(kid())).map((place) => place.id),
      ).toContain(owned.id);
    expect(
       (await module.listSavedPlaces(parent())).some((place) => place.id === owned.id),
      ).toBe(false);
    expect(
       (await module.listSavedPlaces(otherFamilyParent())).some(
         (place) => place.id === owned.id,
       ),
      ).toBe(false);
   });

  it("shares family visibility within the family but not across families", async () => {
    const { module } = make();
    const shared = await module.saveSavedPlace(
      parent(),
      savedPlaceDraft({ visibility: "family" }),
      );

    expect(
       (await module.listSavedPlaces(kid())).some((place) => place.id === shared.id),
      ).toBe(true);
    expect(
       (await module.listSavedPlaces(otherFamilyParent())).some(
         (place) => place.id === shared.id,
       ),
      ).toBe(false);
   });

  it("enforces owner-only updates of saved places", async () => {
    const { module } = make();
    const owned = await module.saveSavedPlace(
      kid(),
      savedPlaceDraft({ visibility: "personal", label: "Original" }),
      );

    const updated = await module.saveSavedPlace(
      kid(),
      savedPlaceDraft({ id: owned.id, visibility: "personal", label: "Renamed" }),
      );
    expect(updated.id).toBe(owned.id);
    expect(updated.ownerMemberID).toBe("member-kid");
    expect(updated.createdAt).toBe(owned.createdAt);
    expect(updated.label).toBe("Renamed");

     // A family parent who is not the owner cannot update it.
    await expect(
      module.saveSavedPlace(
        parent(),
        savedPlaceDraft({ id: owned.id, visibility: "personal", label: "Snatched" }),
       ),
      ).rejects.toEqual(new TravelPlanningError("saved_place_not_found"));
   });

  it("rejects deleting a saved place that a travel plan references", async () => {
    const { module } = make();
    const place = await module.saveSavedPlace(
      parent(),
      savedPlaceDraft({ visibility: "family", label: "Home" }),
      );
    await module.saveTravelPlan(
      parent(),
       "event-1",
      oneTimeDraft({
        origin: { kind: "saved_place", savedPlaceID: place.id },
        }),
      );

    await expect(
      module.deleteSavedPlace(parent(), place.id),
    ).rejects.toEqual(new TravelPlanningError("saved_place_in_use"));

     // Once the referencing plan is gone, deletion succeeds.
    await module.deleteTravelPlan(parent(), "event-1");
    expect(await module.deleteSavedPlace(parent(), place.id)).toBe(true);
   });
});

describe("TravelPlanningModule event context invariants", () => {
  it("rejects unknown events, missing arrival, and missing destination", async () => {
    const { module } = make();
    await expect(
      module.saveTravelPlan(parent(), "event-missing", oneTimeDraft()),
     ).rejects.toEqual(new TravelPlanningError("event_not_found"));

    const noArrival = make({ events: [event({ arrivalTime: null })] });
    await expect(
      noArrival.module.saveTravelPlan(parent(), "event-1", oneTimeDraft()),
     ).rejects.toEqual(new TravelPlanningError("event_missing_arrival_target"));

    const noLocation = make({ events: [event({ location: "   " })] });
    await expect(
      noLocation.module.saveTravelPlan(parent(), "event-1", oneTimeDraft()),
     ).rejects.toEqual(new TravelPlanningError("event_missing_destination"));
    });

  it("requires recipients to be family participants or the structured driver", async () => {
    const { module } = make();

     // A member from another family is not an eligible recipient.
    await expect(
      module.saveTravelPlan(
        parent(),
         "event-1",
        oneTimeDraft({ recipientMemberIDs: ["member-outside", "member-parent"] }),
       ),
      ).rejects.toEqual(new TravelPlanningError("invalid_recipients"));

     // An in-family member who is neither a participant nor the driver.
    await expect(
      module.saveTravelPlan(
        parent(),
         "event-1",
        oneTimeDraft({ recipientMemberIDs: ["member-sibling"] }),
       ),
      ).rejects.toEqual(new TravelPlanningError("invalid_recipients"));

     // The configured (non-participant) driver is an eligible recipient.
    await expect(
      module.saveTravelPlan(
        parent(),
         "event-1",
        oneTimeDraft({ recipientMemberIDs: ["member-parent"] }),
       ),
      ).resolves.toBeDefined();
    });
});

describe("TravelPlanningModule revisions and previews", () => {
  it("increments revision and preserves creator across saves", async () => {
    const { module } = make();
    const first = await module.saveTravelPlan(parent(), "event-1", oneTimeDraft());
    expect(first.revision).toBe(1);
    expect(first.createdByMemberID).toBe("member-parent");

    const second = await module.saveTravelPlan(
      parent(),
       "event-1",
      oneTimeDraft({ recipientMemberIDs: ["member-kid", "member-parent"] }),
      );
    expect(second.revision).toBe(2);
    expect(second.createdByMemberID).toBe("member-parent");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(moment.toISOString());
   });

  it("previews both one-time origins and saved-place origins", async () => {
    const { module, calls } = make();
    const oneTime: TravelPreview = await module.preview(
      parent(),
       "event-1",
      oneTimeDraft(),
      );
    expect(oneTime.durationSeconds).toBe(1_800);
    expect(oneTime.estimatedAt).toEqual(moment);

    const place = await module.saveSavedPlace(
      parent(),
      savedPlaceDraft({ visibility: "family", label: "Home" }),
      );
    const savedOrigin: TravelPreview = await module.preview(
      parent(),
       "event-1",
      oneTimeDraft({ origin: { kind: "saved_place", savedPlaceID: place.id } }),
      );
    expect(savedOrigin.distanceMeters).toBe(9_000);
    expect(calls()).toBe(2);
   });

  it("previews the next occurrence of a recurring Event", async () => {
    const recurring = event({
      startTime: "2026-07-31T17:30:00.000Z",
      endTime: "2026-07-31T19:00:00.000Z",
      arrivalTime: "2026-07-31T17:00:00.000Z",
      recurrence: {
        frequency: "daily",
        interval: 1,
        endDate: "2026-08-03T17:30:00.000Z",
      },
    });
    const { module } = make({ events: [recurring] });
    const preview = await module.preview(parent(), "event-1", oneTimeDraft());
    expect(preview.leaveTime).toEqual(new Date("2026-08-01T16:00:00.000Z"));
  });

  it("leaves a saved plan intact when the provider is unavailable", async () => {
    const failing: RoutingProvider = {
      async estimate() {
        throw new Error("provider down");
        },
      };
    const { module } = make({ provider: failing });
    const saved = await module.saveTravelPlan(parent(), "event-1", oneTimeDraft());
    expect(saved.revision).toBe(1);

    await expect(
      module.preview(parent(), "event-1", oneTimeDraft()),
     ).rejects.toThrow("provider down");

    const stillThere = await module.travelPlan(parent(), "event-1");
    expect(stillThere).not.toBeNull();
    expect(stillThere!.revision).toBe(1);
    });
});
