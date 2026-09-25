import { describe, expect, it } from "vitest";
import type { FamilyEvent, FamilyMember } from "../src/domain.js";
import type { DayBriefEventFact } from "../src/day-brief.js";
import { DayBriefTravelTiming } from "../src/day-brief-travel-timing.js";
import { InMemoryTravelPlanningRepository } from "../src/in-memory-travel-planning-repository.js";
import { TravelPlanningModule } from "../src/travel-planning.js";
import type { RoutingProvider } from "../src/travel-preview.js";

const familyID = "family";
const parentID = "parent";
const otherID = "other";
const now = new Date("2026-10-05T05:20:00.000Z");

function familyEvent(id: string, startTime: string, arrivalTime: string): FamilyEvent {
  return {
    id, familyID, title: id, kidID: null, participantIDs: [parentID],
    startTime, endTime: new Date(new Date(startTime).getTime() + 3_600_000).toISOString(),
    arrivalTime, location: `Destination ${id}`, driver: null, driverMemberID: null,
    source: "manual", status: "confirmed",
  };
}

function fact(event: FamilyEvent): DayBriefEventFact {
  return {
    id: event.id, title: event.title, scheduledAt: event.startTime,
    startTime: event.startTime, endTime: event.endTime,
    ...(event.arrivalTime ? { arrivalTime: event.arrivalTime } : {}),
    location: event.location, roles: ["participant"],
  };
}

const members: FamilyMember[] = [parentID, otherID].map((id) => ({
  id, familyID, name: id, role: "parent", colorTag: "#000000",
}));

describe("DayBriefTravelTiming", () => {
  it("uses verified routes for recipient plans, including plans without a leave alert", async () => {
    const events = [
      familyEvent("first", "2026-10-05T08:00:00.000Z", "2026-10-05T07:50:00.000Z"),
      familyEvent("later", "2026-10-05T09:00:00.000Z", "2026-10-05T08:50:00.000Z"),
      familyEvent("not-for-parent", "2026-10-05T10:00:00.000Z", "2026-10-05T09:50:00.000Z"),
    ];
    events[2]!.participantIDs.push(otherID);
    const repository = new InMemoryTravelPlanningRepository({ events, members });
    const planning = new TravelPlanningModule(repository, {
      async estimate() { return { durationSeconds: 1200, distanceMeters: 9000 }; },
    }, () => now);
    for (const event of events) {
      await planning.saveTravelPlan({ identitySubject: "parent", familyID, memberID: parentID, role: "parent" }, event.id, {
        origin: { kind: "one_time", waypoint: { address: "Home" } },
        preparationMinutes: 20, trafficPreference: "best_guess",
        recipientMemberIDs: event.id === "not-for-parent" ? [otherID] : [parentID],
        leaveAlertEnabled: false,
      });
    }
    let calls = 0;
    let routesAvailable = true;
    const routes: RoutingProvider = {
      async estimate({ destination }) {
        calls += 1;
        if (!routesAvailable) throw new Error("provider unavailable");
        return {
          durationSeconds: destination.kind === "address"
            && destination.address === "Destination not-for-parent" ? 14400
            : destination.kind === "address" && destination.address === "Destination later" ? 7800 : 1200,
          distanceMeters: 9000,
        };
      },
    };
    const timing = new DayBriefTravelTiming(repository, routes);
    const facts = events.map(fact);

    expect((await timing.earliestVerifiedLeaveTime(familyID, parentID, facts, now))?.toISOString())
      .toBe("2026-10-05T06:20:00.000Z");
    const afterFirst = calls;
    expect((await timing.earliestVerifiedLeaveTime(familyID, parentID, facts, new Date(now.getTime() + 60_000)))?.toISOString())
      .toBe("2026-10-05T06:20:00.000Z");
    expect(calls).toBe(afterFirst);

    // Changing the arrival target invalidates the previous route estimate.
    await timing.earliestVerifiedLeaveTime(familyID, parentID, [{
      ...facts[0]!, arrivalTime: "2026-10-05T07:40:00.000Z",
    }], new Date(now.getTime() + 60_000));
    expect(calls).toBeGreaterThan(afterFirst);

    routesAvailable = false;
    expect((await timing.earliestVerifiedLeaveTime(
      familyID, parentID, facts, new Date("2026-10-05T06:11:00.000Z"),
    ))?.toISOString()).toBe("2026-10-05T06:20:00.000Z");
    expect(await timing.earliestVerifiedLeaveTime(familyID, parentID, [{
      ...facts[0]!, roles: ["personal_calendar"],
    }], new Date("2026-10-05T06:11:00.000Z"))).toBeNull();
  });

  it("falls back when the route is unavailable rather than inventing a leave time", async () => {
    const event = familyEvent("first", "2026-10-05T08:00:00.000Z", "2026-10-05T07:50:00.000Z");
    const repository = new InMemoryTravelPlanningRepository({ events: [event], members });
    await new TravelPlanningModule(repository, {
      async estimate() { throw new Error("provider unavailable"); },
    }, () => now).saveTravelPlan({ identitySubject: "parent", familyID, memberID: parentID, role: "parent" }, event.id, {
      origin: { kind: "one_time", waypoint: { address: "Home" } },
      preparationMinutes: 20, trafficPreference: "best_guess",
      recipientMemberIDs: [parentID], leaveAlertEnabled: true,
    });
    const timing = new DayBriefTravelTiming(repository, {
      async estimate() { throw new Error("provider unavailable"); },
    });
    expect(await timing.earliestVerifiedLeaveTime(familyID, parentID, [fact(event)], now)).toBeNull();
  });
});
