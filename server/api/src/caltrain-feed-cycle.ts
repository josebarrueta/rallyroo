import type { CaltrainTrackingPlan } from "./caltrain-tracking-plan.js";

export interface CaltrainFeedCycle {
  refreshPositions(attemptedAt: Date): Promise<void>;
  refreshSubscriptionConditions(attemptedAt: Date): Promise<void>;
}

export async function runCaltrainFeedCycle(
  cycle: CaltrainFeedCycle,
  tracking: CaltrainTrackingPlan,
  attemptedAt: Date,
): Promise<void> {
  if (!tracking.pollRealtime) {
    await cycle.refreshPositions(attemptedAt);
    return;
  }

  const [positions, conditions] = await Promise.allSettled([
    cycle.refreshPositions(attemptedAt),
    cycle.refreshSubscriptionConditions(attemptedAt),
  ]);
  if (positions.status === "rejected") throw positions.reason;
  if (conditions.status === "rejected") throw conditions.reason;
}
