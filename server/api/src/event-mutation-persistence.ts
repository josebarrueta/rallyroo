import type { CalendarResource } from "./caldav-persistence.js";
import type {
  EventConflict,
  FamilyEvent,
  FamilyMember,
  ScheduleOccurrenceReference,
} from "./domain.js";

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
  driverChanges?: Array<{
    memberID: string;
    change: "assigned" | "removed";
    eventID?: string;
    eventTitle?: string;
  }>;
}

export interface EventMutationSnapshot {
  calendarResources?: CalendarResource[];
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
    | { kind: "replaceRecurringSeries"; events: FamilyEvent[]; deleteIDs: string[] };
  result: StoredEventMutationResult;
  calendarResource?: CalendarResource;
  occurrenceOverride?: {
    reference: ScheduleOccurrenceReference;
    overrideEntityID: string;
  };
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
    options?: { includeCalendarResources?: boolean },
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
