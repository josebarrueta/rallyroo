import { describe, expect, it, vi } from "vitest";
import {
  CommuterAlertDispatcher,
  type ClaimedCommuteAlert,
  type CommuterAlertDeliveryRepository,
} from "../src/commuter-alert-dispatcher.js";

const personal: ClaimedCommuteAlert = {
  id: "alert-personal",
  subscriptionID: "subscription-personal",
  familyID: "family-1",
  kind: "delay",
  delayMinutes: 20,
  audience: { kind: "member", memberID: "parent-1" },
  attemptCount: 1,
  claimedAt: new Date("2026-09-09T15:00:00Z"),
};
const family: ClaimedCommuteAlert = {
  id: "alert-family",
  subscriptionID: "subscription-family",
  familyID: "family-1",
  kind: "cancellation",
  delayMinutes: 0,
  audience: { kind: "family" },
  attemptCount: 1,
  claimedAt: new Date("2026-09-09T15:00:00Z"),
};

function repository(overrides: Partial<CommuterAlertDeliveryRepository> = {}): CommuterAlertDeliveryRepository {
  return {
    claimDueCommuteAlerts: vi.fn().mockResolvedValue([personal, family]),
    deviceTokensForMembers: vi.fn().mockResolvedValue(["personal-token"]),
    deviceTokensForFamily: vi.fn().mockResolvedValue(["family-token"]),
    markCommuteAlertDelivered: vi.fn().mockResolvedValue(undefined),
    releaseCommuteAlertClaim: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("CommuterAlertDispatcher", () => {
  it("delivers personal alerts only to the owner and Family alerts to Family devices", async () => {
    const storage = repository();
    const send = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-09-09T15:00:00Z");
    const dispatcher = new CommuterAlertDispatcher({
      repository: storage,
      pushNotificationProvider: { send },
    });

    await dispatcher.dispatchDue(now);

    expect(storage.deviceTokensForMembers).toHaveBeenCalledWith("family-1", ["parent-1"]);
    expect(storage.deviceTokensForFamily).toHaveBeenCalledWith("family-1");
    expect(send).toHaveBeenNthCalledWith(1, ["personal-token"], {
      title: "Caltrain commute delayed",
      body: "A saved commute is delayed by 20 minutes. Open Rallyroo to review.",
      data: { commuterAlertID: "alert-personal", subscriptionID: "subscription-personal" },
      collapseID: "alert-personal",
    });
    expect(send).toHaveBeenNthCalledWith(2, ["family-token"], {
      title: "Caltrain commute canceled",
      body: "A saved commute may be affected. Open Rallyroo to review.",
      data: { commuterAlertID: "alert-family", subscriptionID: "subscription-family" },
      collapseID: "alert-family",
    });
    expect(storage.markCommuteAlertDelivered).toHaveBeenCalledTimes(2);
    expect(storage.releaseCommuteAlertClaim).not.toHaveBeenCalled();
  });

  it("completes alerts with no registered recipient devices", async () => {
    const storage = repository({
      claimDueCommuteAlerts: vi.fn().mockResolvedValue([personal]),
      deviceTokensForMembers: vi.fn().mockResolvedValue([]),
    });
    const send = vi.fn();
    const now = new Date("2026-09-09T15:00:00Z");
    const dispatcher = new CommuterAlertDispatcher({
      repository: storage,
      pushNotificationProvider: { send },
    });

    await dispatcher.dispatchDue(now);

    expect(send).not.toHaveBeenCalled();
    expect(storage.markCommuteAlertDelivered).toHaveBeenCalledWith(personal, now);
  });

  it("times out a stalled provider and releases the claim", async () => {
    const storage = repository({
      claimDueCommuteAlerts: vi.fn().mockResolvedValue([personal]),
    });
    const dispatcher = new CommuterAlertDispatcher({
      repository: storage,
      pushNotificationProvider: { send: () => new Promise(() => {}) },
      sendTimeoutMilliseconds: 5,
    });
    const now = new Date("2026-09-09T15:00:00Z");

    await expect(dispatcher.dispatchDue(now)).rejects.toThrow("Commuter alert delivery failed");
    expect(storage.releaseCommuteAlertClaim).toHaveBeenCalledWith(personal, now);
  });

  it("releases failed claims while continuing the bounded batch", async () => {
    const storage = repository();
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("APNs unavailable"))
      .mockResolvedValueOnce(undefined);
    const now = new Date("2026-09-09T15:00:00Z");
    const dispatcher = new CommuterAlertDispatcher({
      repository: storage,
      pushNotificationProvider: { send },
    });

    await expect(dispatcher.dispatchDue(now)).rejects.toThrow("Commuter alert delivery failed");

    expect(storage.releaseCommuteAlertClaim).toHaveBeenCalledWith(personal, now);
    expect(storage.markCommuteAlertDelivered).toHaveBeenCalledWith(family, now);
  });
});
