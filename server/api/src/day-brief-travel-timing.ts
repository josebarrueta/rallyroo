import type { DayBriefEventFact, DayBriefVerifiedLeaveTimeProvider } from "./day-brief.js";
import type { TravelPlanningRepository } from "./travel-planning.js";
import { TravelPlanningModule } from "./travel-planning.js";
import type { RoutingProvider } from "./travel-preview.js";

interface CachedEstimate {
  leaveTime: Date | null;
  nextCheck: number;
}

// Only route-provider results count as verified leave times. A failed route or
// a plan that does not address the Member leaves the Event-based trigger intact.
export class DayBriefTravelTiming implements DayBriefVerifiedLeaveTimeProvider {
  private readonly estimates = new Map<string, CachedEstimate>();

  constructor(
    private readonly repository: TravelPlanningRepository,
    private readonly routingProvider: RoutingProvider,
  ) {}

  async earliestVerifiedLeaveTime(
    familyID: string,
    memberID: string,
    events: readonly DayBriefEventFact[],
    now: Date,
  ): Promise<Date | null> {
    if (events.length === 0) return null;
    const plans = await this.repository.travelPlansForFamily(familyID);
    const byEventID = new Map(plans.map((plan) => [plan.eventID, plan]));
    const planning = new TravelPlanningModule(this.repository, this.routingProvider, () => now);
    let earliest: Date | null = null;
    for (const event of events) {
      if (event.roles.includes("personal_calendar")
        || new Date(event.startTime).getTime() <= now.getTime()
        // A moved recurrence does not share the Travel plan's base arrival target.
        || event.scheduledAt !== event.startTime) continue;
      const plan = byEventID.get(event.id);
      if (!plan || plan.familyID !== familyID || !plan.recipientMemberIDs.includes(memberID)) continue;
      const key = JSON.stringify([
        familyID, memberID, event.id, plan.revision,
        event.startTime, event.arrivalTime, event.location,
      ]);
      let estimate = this.estimates.get(key);
      if (!estimate || estimate.nextCheck <= now.getTime()) {
        const previouslyVerified = estimate?.leaveTime ?? null;
        try {
          // Use the same validated, provider-backed preview as the Travel plan
          // API, under the least-privileged recipient check even for Parents.
          const preview = await planning.preview({
            identitySubject: "", familyID, memberID, role: "kid",
          }, event.id);
          const verified = preview.leaveTime.getTime() < new Date(event.startTime).getTime()
            ? preview.leaveTime : null;
          // A later estimate cannot undo guidance already verified for this
          // same version of the plan and Event.
          const leaveTime = verified && previouslyVerified
            ? new Date(Math.min(verified.getTime(), previouslyVerified.getTime()))
            : verified ?? previouslyVerified;
          estimate = {
            leaveTime,
            nextCheck: leaveTime
              ? leaveTime <= now ? new Date(event.startTime).getTime() : nextEvaluation(now, leaveTime)
              : now.getTime() + 5 * 60_000,
          };
        } catch {
          estimate = { leaveTime: previouslyVerified, nextCheck: now.getTime() + 5 * 60_000 };
        }
        this.estimates.set(key, estimate);
      }
      if (estimate.leaveTime && (!earliest || estimate.leaveTime < earliest)) {
        earliest = estimate.leaveTime;
      }
    }
    if (this.estimates.size > 2_000) {
      for (const [key, estimate] of this.estimates) {
        if (estimate.nextCheck <= now.getTime()) this.estimates.delete(key);
      }
      while (this.estimates.size > 2_000) this.estimates.delete(this.estimates.keys().next().value!);
    }
    return earliest;
  }
}

function nextEvaluation(now: Date, leaveTime: Date): number {
  const untilLeave = leaveTime.getTime() - now.getTime();
  if (untilLeave > 60 * 60_000) return Math.min(leaveTime.getTime() - 30 * 60_000, now.getTime() + 30 * 60_000);
  if (untilLeave > 15 * 60_000) return leaveTime.getTime() - 10 * 60_000;
  return now.getTime() + 60_000;
}
