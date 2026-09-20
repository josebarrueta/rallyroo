import { describe, expect, it } from "vitest";
import type { CommuteSubscription } from "../src/commuter-module.js";
import { searchCaltrainJourneys } from "../src/caltrain-schedule-search.js";
import type { CaltrainStaticScheduleSnapshot } from "../src/caltrain-static-schedule.js";
import { caltrainTrackingPlan } from "../src/caltrain-tracking-plan.js";

const schedule: CaltrainStaticScheduleSnapshot = {
  observedAt: "2026-09-20T12:00:00Z",
  version: "test",
  timeZone: "America/Los_Angeles",
  validFrom: "2026-09-01",
  validUntil: "2026-09-30",
  stops: [
    stop("origin", "Origin", 37.3),
    stop("destination", "Destination", 37.6),
    stop("terminal", "Terminal", 37.8),
  ],
  services: [{
    id: "service",
    weekdays: [1, 2, 3, 4, 5],
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    addedDates: [],
    removedDates: [],
  }],
  journeys: [{
    id: "tracked-journey",
    serviceID: "service",
    routeID: "route",
    direction: "northbound",
    calls: [
      { stopID: "origin", sequence: 1, arrivalSeconds: 7 * 3600, departureSeconds: 7 * 3600 },
      { stopID: "destination", sequence: 2, arrivalSeconds: 7.5 * 3600, departureSeconds: 7.5 * 3600 },
      { stopID: "terminal", sequence: 3, arrivalSeconds: 8 * 3600, departureSeconds: 8 * 3600 },
    ],
  }],
};

const option = searchCaltrainJourneys(schedule, {
  originStationID: "Origin",
  destinationStationID: "Destination",
  serviceWeekdays: [1, 2, 3, 4, 5],
}, "2026-09-21")[0]!;

const scheduledSubscription: CommuteSubscription = {
  id: "subscription",
  familyID: "family",
  ownerMemberID: "member",
  visibility: "personal",
  agencyID: "CT",
  routeID: "*",
  directionID: option.directionID,
  originStopID: option.originStopID,
  destinationStopID: option.destinationStopID,
  serviceWeekdays: option.operatingWeekdays,
  windowStartMinutes: option.departureMinutes,
  windowEndMinutes: option.arrivalMinutes,
  alertKinds: ["delay", "cancellation"],
  minimumDelayMinutes: 10,
  status: "active",
  scheduleOptionID: option.id,
  scheduledDepartureMinutes: option.departureMinutes,
  scheduledArrivalMinutes: option.arrivalMinutes,
  scheduleVersion: schedule.version,
};

describe("caltrainTrackingPlan", () => {
  it("wakes at the subscribed departure and tracks until that train reaches its route terminal", () => {
    const before = caltrainTrackingPlan(
      [scheduledSubscription],
      schedule,
      new Date("2026-09-21T13:59:00Z"),
    );
    expect(before.pollRealtime).toBe(false);
    expect(before.trackedJourneyIDs).toEqual([]);
    expect(before.nextWakeAt).toBe("2026-09-21T14:00:00.000Z");

    const active = caltrainTrackingPlan(
      [scheduledSubscription],
      schedule,
      new Date("2026-09-21T14:00:00Z"),
    );
    expect(active.pollRealtime).toBe(true);
    expect(active.trackedJourneyIDs).toEqual(["tracked-journey"]);

    const after = caltrainTrackingPlan(
      [scheduledSubscription],
      schedule,
      new Date("2026-09-21T15:01:00Z"),
    );
    expect(after.pollRealtime).toBe(false);
    expect(after.trackedJourneyIDs).toEqual([]);
  });

  it("polls legacy alert windows without pretending they identify a specific train", () => {
    const legacy = {
      ...scheduledSubscription,
      scheduleOptionID: null,
      scheduledDepartureMinutes: null,
      scheduledArrivalMinutes: null,
      windowStartMinutes: 7 * 60,
      windowEndMinutes: 8 * 60,
    };

    const plan = caltrainTrackingPlan([legacy], schedule, new Date("2026-09-21T14:30:00Z"));

    expect(plan.pollRealtime).toBe(true);
    expect(plan.trackedJourneyIDs).toEqual([]);
  });

  it("ignores paused subscriptions", () => {
    const plan = caltrainTrackingPlan(
      [{ ...scheduledSubscription, status: "paused" }],
      schedule,
      new Date("2026-09-21T14:30:00Z"),
    );

    expect(plan.pollRealtime).toBe(false);
    expect(plan.trackedJourneyIDs).toEqual([]);
    expect(plan.nextWakeAt).toBeNull();
  });
});

function stop(id: string, stationID: string, latitude: number) {
  return {
    id,
    stationID,
    stationName: stationID,
    direction: "northbound" as const,
    latitude,
    longitude: -122,
    validFrom: "2026-09-01T00:00:00Z",
    validUntil: "2026-10-01T00:00:00Z",
  };
}
