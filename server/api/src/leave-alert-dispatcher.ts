import { createHash } from "node:crypto";
import { eventOccurrenceStarts } from "./event-recurrence.js";
import type { NotificationCenterModule } from "./notification-center.js";
import type { EventTravelPlan, SavedPlace, TravelPlanningRepository } from "./travel-planning.js";
import { previewDrivingTravel, type RoutingProvider, type TravelWaypoint } from "./travel-preview.js";

const horizonMilliseconds = 24 * 60 * 60 * 1_000;
const dueLookaheadMilliseconds = 90 * 1_000;
const retryMilliseconds = 5 * 60 * 1_000;
const maximumCandidates = 100;

export interface LeaveAlertDispatchResult {
  evaluated: number;
  recorded: number;
  failed: number;
}

export class LeaveAlertDispatcher {
  private readonly nextChecks = new Map<string, number>();

  constructor(
    private readonly repository: TravelPlanningRepository,
    private readonly routingProvider: RoutingProvider,
    private readonly notificationCenter: NotificationCenterModule,
  ) {}

  async dispatchDue(now = new Date()): Promise<LeaveAlertDispatchResult> {
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid leave alert dispatch time");
    const result: LeaveAlertDispatchResult = { evaluated: 0, recorded: 0, failed: 0 };
    const familyIDs = await this.repository.familyIDsWithTravelPlans();
    const activeKeys = new Set<string>();

    for (const familyID of familyIDs) {
      const [plans, events, places, members] = await Promise.all([
        this.repository.travelPlansForFamily(familyID),
        this.repository.eventsForFamily(familyID),
        this.repository.savedPlacesForFamily(familyID),
        this.repository.membersForFamily(familyID),
      ]);
      const memberIDs = new Set(members.map((member) => member.id));
      for (const plan of plans) {
        if (result.evaluated >= maximumCandidates) break;
        const event = events.find((candidate) => candidate.id === plan.eventID);
        if (!plan.leaveAlertEnabled || !event?.arrivalTime || !event.location?.trim()) continue;
        const baseStart = new Date(event.startTime);
        const baseArrival = new Date(event.arrivalTime);
        const arrivalOffset = baseStart.getTime() - baseArrival.getTime();
        if (!Number.isFinite(arrivalOffset) || arrivalOffset < 0) continue;
        const occurrences = eventOccurrenceStarts(
          event,
          new Date(now.getTime() + horizonMilliseconds + arrivalOffset),
        );
        for (const occurrenceStart of occurrences) {
          if (result.evaluated >= maximumCandidates) break;
          const occurrenceArrival = new Date(occurrenceStart.getTime() - arrivalOffset);
          if (occurrenceStart <= now
            || occurrenceArrival < now
            || occurrenceArrival.getTime() > now.getTime() + horizonMilliseconds) continue;
          const key = occurrenceKey(plan, event, occurrenceStart);
          activeKeys.add(key);
          if ((this.nextChecks.get(key) ?? 0) > now.getTime()) continue;
          result.evaluated += 1;
          try {
            const origin = resolveOrigin(plan, places);
            const preview = await previewDrivingTravel({
              origin,
              destination: { address: event.location },
              arrivalTime: occurrenceArrival,
              preparationMinutes: plan.preparationMinutes,
              trafficPreference: plan.trafficPreference,
            }, this.routingProvider, { now: () => now });
            if (preview.leaveTime.getTime() <= now.getTime() + dueLookaheadMilliseconds) {
              const eligible = new Set(event.participantIDs);
              if (event.driverMemberID) eligible.add(event.driverMemberID);
              const recipients = plan.recipientMemberIDs.filter(
                (id) => memberIDs.has(id) && eligible.has(id),
              );
              if (recipients.length > 0) {
                const records = await this.notificationCenter.record({
                  familyID,
                  recipientMemberIDs: recipients,
                  kind: "leave_time",
                  deduplicationKey: key,
                  title: "Time to leave",
                  body: `Leave now for ${event.title}.`,
                  destination: { kind: "event", id: event.id },
                  occurredAt: now,
                });
                result.recorded += records.length;
              }
              this.nextChecks.set(key, occurrenceStart.getTime());
            } else {
              this.nextChecks.set(key, nextEvaluation(now, preview.leaveTime));
            }
          } catch {
            result.failed += 1;
            this.nextChecks.set(key, now.getTime() + retryMilliseconds);
          }
        }
      }
    }

    for (const key of this.nextChecks.keys()) {
      if (!activeKeys.has(key)) this.nextChecks.delete(key);
    }
    return result;
  }
}

function resolveOrigin(plan: EventTravelPlan, places: SavedPlace[]): TravelWaypoint {
  if (plan.origin.kind === "one_time") return plan.origin.waypoint;
  const savedPlaceID = plan.origin.savedPlaceID;
  const place = places.find((candidate) => candidate.id === savedPlaceID);
  if (!place) throw new Error("Saved place is unavailable");
  return place.waypoint;
}

function occurrenceKey(
  plan: EventTravelPlan,
  event: { startTime: string; arrivalTime?: string | null; location: string | null },
  occurrenceStart: Date,
): string {
  const eventConfigurationDigest = createHash("sha256")
    .update(`${event.startTime}\0${event.arrivalTime ?? ""}\0${event.location ?? ""}`)
    .digest("hex");
  return `${plan.familyID}:${plan.eventID}:${occurrenceStart.toISOString()}:${plan.revision}:${eventConfigurationDigest}`;
}

function nextEvaluation(now: Date, leaveTime: Date): number {
  const untilLeave = leaveTime.getTime() - now.getTime();
  if (untilLeave > 60 * 60 * 1_000) return leaveTime.getTime() - 30 * 60 * 1_000;
  if (untilLeave > 15 * 60 * 1_000) return leaveTime.getTime() - 10 * 60 * 1_000;
  return now.getTime() + 60 * 1_000;
}
