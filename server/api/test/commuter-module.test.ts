import { describe, expect, it } from "vitest";
import {
  CommuterModule,
  CommuterModuleError,
  type NewCommuteSubscription,
} from "../src/commuter-module.js";
import { InMemoryCommuterRepository } from "../src/in-memory-commuter-repository.js";
import type { Account } from "../src/domain.js";

const parent: Account = {
  identitySubject: "parent-subject",
  familyID: "family-1",
  memberID: "parent-1",
  role: "parent",
};
const otherParent: Account = {
  identitySubject: "other-parent-subject",
  familyID: "family-1",
  memberID: "parent-2",
  role: "parent",
};
const kid: Account = {
  identitySubject: "kid-subject",
  familyID: "family-1",
  memberID: "kid-1",
  role: "kid",
};
const otherFamilyParent: Account = {
  identitySubject: "outside-subject",
  familyID: "family-2",
  memberID: "outside-parent",
  role: "parent",
};

const commute: Omit<NewCommuteSubscription, "visibility"> = {
  agencyID: "CT",
  routeID: "caltrain-local",
  directionID: "northbound",
  originStopID: "70171",
  destinationStopID: "70011",
  serviceWeekdays: [1, 2, 3, 4, 5],
  windowStartMinutes: 7 * 60,
  windowEndMinutes: 9 * 60,
  alertKinds: ["delay", "cancellation"] as const,
  minimumDelayMinutes: 15,
};

describe("CommuterModule", () => {
  it("lets a parent enable Commuter once for the Family", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());

    const installation = await module.enable(parent);
    const replay = await module.enable(otherParent);

    expect(installation).toEqual({
      familyID: "family-1",
      enabledByMemberID: "parent-1",
      status: "enabled",
    });
    expect(replay).toEqual(installation);
    expect(await module.state(kid)).toMatchObject({ installation, subscriptions: [] });
    expect((await module.state(otherFamilyParent)).installation).toBeNull();
  });

  it("tracks catalog and real-time provider health independently from installation", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    const firstAttempt = new Date("2026-09-09T15:00:00Z");

    expect(await module.providerStatus(firstAttempt)).toMatchObject({
      catalog: { state: "unavailable", lastSuccessAt: null },
      realtime: { state: "unavailable", lastSuccessAt: null },
    });
    await module.enable(parent);
    await module.recordProviderSuccess("catalog", firstAttempt);
    await module.recordProviderSuccess("realtime", firstAttempt);
    await module.recordProviderFailure("realtime", new Date("2026-09-09T15:01:00Z"));

    expect(await module.providerStatus(new Date("2026-09-09T15:01:00Z"))).toMatchObject({
      catalog: { state: "healthy", lastSuccessAt: firstAttempt.toISOString() },
      realtime: {
        state: "degraded",
        lastSuccessAt: firstAttempt.toISOString(),
        lastAttemptAt: "2026-09-09T15:01:00.000Z",
      },
    });
    expect((await module.state(parent)).installation?.status).toBe("enabled");
    expect((await module.providerStatus(new Date("2026-09-09T15:04:01Z"))).realtime.state)
      .toBe("stale");

    await module.recordProviderSuccess("realtime", new Date("2026-09-09T15:05:00Z"));
    await module.recordProviderFailure("realtime", new Date("2026-09-09T15:04:00Z"));
    expect(await module.providerStatus(new Date("2026-09-09T15:05:00Z"))).toMatchObject({
      realtime: { state: "healthy", lastAttemptAt: "2026-09-09T15:05:00.000Z" },
    });
  });

  it("rejects kid configuration and subscriptions before installation", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());

    await expect(module.enable(kid)).rejects.toEqual(new CommuterModuleError("parent_required"));
    await expect(module.createSubscription(parent, {
      ...commute,
      visibility: "personal",
    })).rejects.toEqual(new CommuterModuleError("module_not_enabled"));
  });

  it("enforces personal and Family subscription visibility", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    await module.enable(parent);

    const personal = await module.createSubscription(parent, {
      ...commute,
      visibility: "personal",
    });
    const family = await module.createSubscription(parent, {
      ...commute,
      directionID: "southbound",
      originStopID: "70011",
      destinationStopID: "70172",
      visibility: "family",
    });

    expect((await module.state(parent)).subscriptions.map((item) => item.id))
      .toEqual([personal.id, family.id]);
    expect((await module.state(otherParent)).subscriptions.map((item) => item.id))
      .toEqual([family.id]);
    expect((await module.state(kid)).subscriptions.map((item) => item.id))
      .toEqual([family.id]);
    expect((await module.state(otherFamilyParent)).subscriptions).toEqual([]);
  });

  it("allows parents to pause Family subscriptions but only the owner to mutate personal ones", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    await module.enable(parent);
    const personal = await module.createSubscription(parent, {
      ...commute,
      visibility: "personal",
    });
    const family = await module.createSubscription(parent, {
      ...commute,
      visibility: "family",
    });

    await expect(module.setSubscriptionStatus(otherParent, personal.id, "paused"))
      .rejects.toEqual(new CommuterModuleError("subscription_not_found"));
    await expect(module.setSubscriptionStatus(kid, family.id, "paused"))
      .rejects.toEqual(new CommuterModuleError("parent_required"));
    expect((await module.setSubscriptionStatus(otherParent, family.id, "paused")).status)
      .toBe("paused");
    await expect(module.removeSubscription(otherParent, personal.id))
      .rejects.toEqual(new CommuterModuleError("subscription_not_found"));
    await module.removeSubscription(otherParent, family.id);
    expect((await module.state(parent)).subscriptions.map((item) => item.id)).toEqual([personal.id]);
  });

  it("bounds subscriptions per Family", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    await module.enable(parent);
    for (let index = 0; index < 20; index += 1) {
      await module.createSubscription(parent, {
        ...commute,
        routeID: `route-${index}`,
        visibility: "family",
      });
    }

    await expect(module.createSubscription(parent, {
      ...commute,
      routeID: "one-too-many",
      visibility: "family",
    })).rejects.toEqual(new CommuterModuleError("subscription_limit_reached"));
  });

  it("fans out one fresh matching condition and deduplicates repeated polls", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    await module.enable(parent);
    const personal = await module.createSubscription(parent, {
      ...commute,
      visibility: "personal",
    });
    const family = await module.createSubscription(otherParent, {
      ...commute,
      visibility: "family",
    });
    const condition = {
      id: "trip-123:2026-09-09",
      agencyID: "CT" as const,
      routeID: commute.routeID,
      directionID: commute.directionID,
      stopIDs: [commute.originStopID, commute.destinationStopID],
      serviceWeekday: 3,
      scheduledMinutes: 8 * 60,
      kind: "delay" as const,
      delayMinutes: 18,
      observedAt: "2026-09-09T14:59:00Z",
      validUntil: "2026-09-09T15:02:00Z",
    };

    const first = await module.processTransitConditions(
      [condition],
      new Date("2026-09-09T15:00:00Z"),
    );
    const repeated = await module.processTransitConditions(
      [condition],
      new Date("2026-09-09T15:01:00Z"),
    );

    expect(first).toEqual([
      expect.objectContaining({ subscriptionID: personal.id, audience: { kind: "member", memberID: parent.memberID } }),
      expect.objectContaining({ subscriptionID: family.id, audience: { kind: "family" } }),
    ]);
    expect(repeated).toEqual([]);
  });

  it("rejects malformed provider snapshots instead of partially faning them out", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    await module.enable(parent);
    await module.createSubscription(parent, { ...commute, visibility: "family" });

    await expect(module.processTransitConditions([{
      id: "bad-condition",
      agencyID: "CT",
      routeID: commute.routeID,
      directionID: commute.directionID,
      stopIDs: [],
      serviceWeekday: 3,
      scheduledMinutes: 480,
      kind: "delay",
      delayMinutes: 20,
      observedAt: "not-a-date",
      validUntil: "2026-09-09T15:02:00Z",
    }], new Date("2026-09-09T15:00:00Z")))
      .rejects.toThrow("Invalid Commuter provider snapshot");
  });

  it("matches an all-service subscription against a specific Caltrain route", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    await module.enable(parent);
    await module.createSubscription(parent, {
      ...commute,
      routeID: "*",
      visibility: "personal",
    });

    const alerts = await module.processTransitConditions([{
      id: "trip-specific-route",
      agencyID: "CT",
      routeID: "Local Weekday",
      directionID: commute.directionID,
      stopIDs: [commute.originStopID, commute.destinationStopID],
      serviceWeekday: 3,
      scheduledMinutes: 480,
      kind: "delay",
      delayMinutes: 20,
      observedAt: "2026-09-09T14:59:00Z",
      validUntil: "2026-09-09T15:02:00Z",
    }], new Date("2026-09-09T15:00:00Z"));

    expect(alerts).toHaveLength(1);
  });

  it("matches scoped service disruptions without inventing delay minutes", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    await module.enable(parent);
    await module.createSubscription(parent, {
      ...commute,
      minimumDelayMinutes: 30,
      visibility: "family",
    });

    const alerts = await module.processTransitConditions([{
      scope: "disruption",
      id: "alert:fixture",
      agencyID: "CT",
      routeID: "*",
      directionID: "*",
      stopIDs: [commute.originStopID],
      serviceWeekday: 3,
      scheduledMinutes: 480,
      kind: "delay",
      delayMinutes: 0,
      observedAt: "2026-09-09T14:59:00Z",
      validUntil: "2026-09-09T15:02:00Z",
    }], new Date("2026-09-09T15:00:00Z"));

    expect(alerts).toHaveLength(1);
  });

  it("suppresses paused, stale, below-threshold, and out-of-window conditions", async () => {
    const module = new CommuterModule(new InMemoryCommuterRepository());
    await module.enable(parent);
    const subscription = await module.createSubscription(parent, {
      ...commute,
      visibility: "family",
    });
    const base = {
      id: "trip-456:2026-09-09",
      agencyID: "CT" as const,
      routeID: commute.routeID,
      directionID: commute.directionID,
      stopIDs: [commute.originStopID, commute.destinationStopID],
      serviceWeekday: 3,
      scheduledMinutes: 8 * 60,
      kind: "delay" as const,
      delayMinutes: 18,
      observedAt: "2026-09-09T14:59:00Z",
      validUntil: "2026-09-09T15:02:00Z",
    };

    expect(await module.processTransitConditions(
      [{ ...base, id: "stale", validUntil: "2026-09-09T14:59:59Z" }],
      new Date("2026-09-09T15:00:00Z"),
    )).toEqual([]);
    expect(await module.processTransitConditions(
      [{ ...base, id: "small-delay", delayMinutes: 14 }],
      new Date("2026-09-09T15:00:00Z"),
    )).toEqual([]);
    expect(await module.processTransitConditions(
      [{ ...base, id: "outside-window", scheduledMinutes: 10 * 60 }],
      new Date("2026-09-09T15:00:00Z"),
    )).toEqual([]);
    await module.setSubscriptionStatus(parent, subscription.id, "paused");
    expect(await module.processTransitConditions(
      [{ ...base, id: "paused" }],
      new Date("2026-09-09T15:00:00Z"),
    )).toEqual([]);
  });

  it("keeps configuration while disabled and excludes it from provider fan-out", async () => {
    const repository = new InMemoryCommuterRepository();
    const module = new CommuterModule(repository);
    await module.enable(parent);
    await module.createSubscription(parent, { ...commute, visibility: "family" });

    await module.disable(parent);

    expect(await module.state(parent)).toMatchObject({
      installation: { status: "disabled" },
      subscriptions: [expect.objectContaining({ routeID: commute.routeID })],
    });
    expect(await repository.activeSubscriptionsForAgency("CT")).toEqual([]);
    expect((await module.enable(parent)).status).toBe("enabled");
  });

  it("removes all module-owned state when uninstalled", async () => {
    const repository = new InMemoryCommuterRepository();
    const module = new CommuterModule(repository);
    await module.enable(parent);
    await module.createSubscription(parent, { ...commute, visibility: "family" });

    await module.remove(parent);

    expect(await module.state(parent)).toMatchObject({ installation: null, subscriptions: [] });
    expect(await repository.subscriptionsForFamily(parent.familyID)).toEqual([]);
  });
});
