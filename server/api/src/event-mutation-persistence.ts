import type { EventConflict, FamilyEvent, FamilyMember } from "./domain.js";

export type ScheduleUpdateNotificationOutcome =
  | "sent"
  | "queuedForRetry"
  | "noRecipients"
  | "notRequested";

export interface EventMutationResult {
  conflicts: EventConflict[];
  notificationOutcome: ScheduleUpdateNotificationOutcome;
}

export interface StoredEventMutationResult extends EventMutationResult {
  notificationID?: string;
  driverChanges?: Array<{ memberID: string; change: "assigned" | "removed" }>;
}

export interface EventMutationSnapshot {
  events: FamilyEvent[];
  members: FamilyMember[];
}

export interface ScheduleUpdateNotificationIntent {
  id: string;
  eventID: string;
  title: string;
  body: string;
  participantIDs: string[];
}

export interface EventMutationPlan {
  action:
   | { kind: "save"; event: FamilyEvent }
   | { kind: "delete"; eventID: string }
   | { kind: "recurringEdit"; deleteIDs: string[]; upserts: FamilyEvent[] };
  result: StoredEventMutationResult;
  notification?: ScheduleUpdateNotificationIntent;
}

export interface ClaimedScheduleUpdateNotification extends ScheduleUpdateNotificationIntent {
  familyID: string;
  idempotencyKey: string;
  claimedAt: Date;
}

export interface EventMutationPersistence {
  eventMutationResult(
    familyID: string,
    idempotencyKey: string,
  ): Promise<StoredEventMutationResult | null>;
  performEventMutation(
    familyID: string,
    idempotencyKey: string,
    prepare: (snapshot: EventMutationSnapshot) => EventMutationPlan,
  ): Promise<StoredEventMutationResult>;
  claimScheduleUpdateNotifications(
    now: Date,
    limit: number,
    notificationID?: string,
  ): Promise<ClaimedScheduleUpdateNotification[]>;
  completeScheduleUpdateNotification(
    notification: ClaimedScheduleUpdateNotification,
    outcome: "sent" | "noRecipients",
    completedAt: Date,
  ): Promise<void>;
  releaseScheduleUpdateNotification(
    notification: ClaimedScheduleUpdateNotification,
    errorCategory: string,
  ): Promise<void>;
}
