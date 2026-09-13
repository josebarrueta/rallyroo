import { describe, expect, it } from "vitest";
import { InMemoryNotificationCenterRepository } from "../src/in-memory-notification-center-repository.js";
import { InMemoryTravelPlanningRepository } from "../src/in-memory-travel-planning-repository.js";
import { LeaveAlertDispatcher } from "../src/leave-alert-dispatcher.js";
import { NotificationCenterModule } from "../src/notification-center.js";
import type { RoutingProvider } from "../src/travel-preview.js";

function repository(overrides: { leaveAlertEnabled?: boolean; recipientMemberIDs?: string[] } = {}) {
  return new InMemoryTravelPlanningRepository({
    members: [
      { id: "parent", familyID: "family", name: "Parent", role: "parent", colorTag: "blue" },
      { id: "kid", familyID: "family", name: "Kid", role: "kid", colorTag: "purple" },
    ],
    events: [{
      id: "event",
      familyID: "family",
      title: "Practice",
      kidID: "kid",
      participantIDs: ["kid"],
      startTime: "2026-08-01T10:30:00Z",
      endTime: "2026-08-01T11:30:00Z",
      arrivalTime: "2026-08-01T10:00:00Z",
      location: "Field",
      driver: null,
      driverMemberID: "parent",
      source: "manual",
      status: "confirmed",
    }],
    travelPlans: [{
      familyID: "family",
      eventID: "event",
      revision: 1,
      origin: { kind: "one_time", waypoint: { address: "Home" } },
      preparationMinutes: 15,
      trafficPreference: "best_guess",
      recipientMemberIDs: overrides.recipientMemberIDs ?? ["kid", "parent"],
      leaveAlertEnabled: overrides.leaveAlertEnabled ?? true,
      createdByMemberID: "parent",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    }],
  });
}

function provider(durationSeconds = 30 * 60): { provider: RoutingProvider; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    provider: {
      async estimate() {
        calls += 1;
        return { durationSeconds, distanceMeters: 10_000 };
      },
    },
  };
}

describe("LeaveAlertDispatcher", () => {
  it("records recipient-specific durable inbox notifications when it is time to leave", async () => {
    const travelRepository = repository();
    const inbox = new InMemoryNotificationCenterRepository();
    const notifications = new NotificationCenterModule(inbox);
    const routing = provider();
    const dispatcher = new LeaveAlertDispatcher(travelRepository, routing.provider, notifications);
    const now = new Date("2026-08-01T09:14:00Z");

    expect(await dispatcher.dispatchDue(now)).toMatchObject({ evaluated: 1, recorded: 2, failed: 0 });
    const kidInbox = await notifications.list({
      identitySubject: "kid-subject", familyID: "family", memberID: "kid", role: "kid",
    });
    expect(kidInbox).toHaveLength(1);
    expect(kidInbox[0]).toMatchObject({
      kind: "leave_time",
      title: "Time to leave",
      body: "Leave now for Practice.",
      destination: { kind: "event", id: "event" },
    });

    await dispatcher.dispatchDue(new Date("2026-08-01T09:15:00Z"));
    expect(await notifications.list({
      identitySubject: "kid-subject", familyID: "family", memberID: "kid", role: "kid",
    })).toHaveLength(1);
  });

  it("defers distant guidance without persisting provider-derived route content", async () => {
    const travelRepository = repository();
    const inbox = new InMemoryNotificationCenterRepository();
    const notifications = new NotificationCenterModule(inbox);
    const routing = provider(10 * 60);
    const dispatcher = new LeaveAlertDispatcher(travelRepository, routing.provider, notifications);

    const first = await dispatcher.dispatchDue(new Date("2026-08-01T07:00:00Z"));
    const second = await dispatcher.dispatchDue(new Date("2026-08-01T07:01:00Z"));
    expect(first).toMatchObject({ evaluated: 1, recorded: 0 });
    expect(second).toMatchObject({ evaluated: 0, recorded: 0 });
    expect(routing.calls()).toBe(2);
  });

  it("skips disabled alerts and stale recipients", async () => {
    const disabledRouting = provider();
    const disabled = new LeaveAlertDispatcher(
      repository({ leaveAlertEnabled: false }),
      disabledRouting.provider,
      new NotificationCenterModule(new InMemoryNotificationCenterRepository()),
    );
    expect(await disabled.dispatchDue(new Date("2026-08-01T09:14:00Z")))
      .toMatchObject({ evaluated: 0, recorded: 0 });
    expect(disabledRouting.calls()).toBe(0);

    const inbox = new InMemoryNotificationCenterRepository();
    const stale = new LeaveAlertDispatcher(
      repository({ recipientMemberIDs: ["deleted-member"] }),
      provider().provider,
      new NotificationCenterModule(inbox),
    );
    expect(await stale.dispatchDue(new Date("2026-08-01T09:14:00Z")))
      .toMatchObject({ evaluated: 1, recorded: 0 });
  });

  it("isolates provider failures and retries them later", async () => {
    let calls = 0;
    const failing: RoutingProvider = {
      async estimate() {
        calls += 1;
        throw new Error("provider unavailable");
      },
    };
    const dispatcher = new LeaveAlertDispatcher(
      repository(), failing, new NotificationCenterModule(new InMemoryNotificationCenterRepository()),
    );
    expect(await dispatcher.dispatchDue(new Date("2026-08-01T09:14:00Z")))
      .toMatchObject({ evaluated: 1, recorded: 0, failed: 1 });
    expect(await dispatcher.dispatchDue(new Date("2026-08-01T09:15:00Z")))
      .toMatchObject({ evaluated: 0 });
    expect(calls).toBe(1);
  });
});
