import { describe, expect, it, vi } from "vitest";
import { runCaltrainFeedCycle } from "../src/caltrain-feed-cycle.js";

const attemptedAt = new Date("2026-09-21T14:00:00Z");

describe("runCaltrainFeedCycle", () => {
  it("refreshes public vehicle positions without an active subscription window", async () => {
    const refreshPositions = vi.fn(async () => undefined);
    const refreshSubscriptionConditions = vi.fn(async () => undefined);

    await runCaltrainFeedCycle({ refreshPositions, refreshSubscriptionConditions }, {
      pollRealtime: false,
      trackedJourneyIDs: [],
      nextWakeAt: null,
    }, attemptedAt);

    expect(refreshPositions).toHaveBeenCalledWith(attemptedAt);
    expect(refreshSubscriptionConditions).not.toHaveBeenCalled();
  });

  it("also refreshes personalized conditions during an active subscription window", async () => {
    const refreshPositions = vi.fn(async () => undefined);
    const refreshSubscriptionConditions = vi.fn(async () => undefined);

    await runCaltrainFeedCycle({ refreshPositions, refreshSubscriptionConditions }, {
      pollRealtime: true,
      trackedJourneyIDs: ["journey-1"],
      nextWakeAt: null,
    }, attemptedAt);

    expect(refreshPositions).toHaveBeenCalledWith(attemptedAt);
    expect(refreshSubscriptionConditions).toHaveBeenCalledWith(attemptedAt);
  });

  it("attempts both active feeds when one provider call fails", async () => {
    const failure = new Error("provider unavailable");
    const refreshPositions = vi.fn(async () => { throw failure; });
    const refreshSubscriptionConditions = vi.fn(async () => undefined);

    await expect(runCaltrainFeedCycle({ refreshPositions, refreshSubscriptionConditions }, {
      pollRealtime: true,
      trackedJourneyIDs: ["journey-1"],
      nextWakeAt: null,
    }, attemptedAt)).rejects.toBe(failure);

    expect(refreshPositions).toHaveBeenCalledOnce();
    expect(refreshSubscriptionConditions).toHaveBeenCalledOnce();
  });
});
