import type { FamilyEvent } from "./domain.js";
import type { PushNotificationProvider } from "./push-notification-provider.js";

export interface DueEventNotification {
  event: FamilyEvent;
  occurrenceStart: string;
}

export interface EventNotificationRepository {
  claimDueEventNotifications(now: Date, limit: number): Promise<DueEventNotification[]>;
  deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]>;
  markEventNotificationSent(
    familyID: string,
    eventID: string,
    occurrenceStart: string,
    claimedAt: Date,
  ): Promise<void>;
  releaseEventNotificationClaim(
    familyID: string,
    eventID: string,
    occurrenceStart: string,
    claimedAt: Date,
  ): Promise<void>;
}

interface Dependencies {
  repository: EventNotificationRepository;
  pushNotificationProvider: PushNotificationProvider;
  batchSize?: number;
}

export class EventNotificationDispatcher {
  private readonly repository: EventNotificationRepository;
  private readonly pushNotificationProvider: PushNotificationProvider;
  private readonly batchSize: number;

  constructor({ repository, pushNotificationProvider, batchSize = 100 }: Dependencies) {
    this.repository = repository;
    this.pushNotificationProvider = pushNotificationProvider;
    this.batchSize = batchSize;
  }

  async dispatchDue(now = new Date()): Promise<void> {
    const notifications = await this.repository.claimDueEventNotifications(now, this.batchSize);
    const results = await Promise.allSettled(notifications.map(async ({ event, occurrenceStart }) => {
      try {
        const tokens = await this.repository.deviceTokensForMembers(
          event.familyID,
          event.participantIDs,
        );
        if (tokens.length > 0) {
          await this.pushNotificationProvider.send(tokens, {
            title: event.title,
            body: alertBody(event.alertLeadTimeMinutes),
            data: { eventID: event.id, occurrenceStart },
          });
        }
        await this.repository.markEventNotificationSent(
          event.familyID,
          event.id,
          occurrenceStart,
          now,
        );
      } catch (error) {
        await this.repository.releaseEventNotificationClaim(
          event.familyID,
          event.id,
          occurrenceStart,
          now,
        );
        throw error;
      }
    }));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(failures.map((failure) => failure.reason), "Event notification delivery failed");
    }
  }
}

function alertBody(leadTimeMinutes: FamilyEvent["alertLeadTimeMinutes"]): string {
  switch (leadTimeMinutes) {
    case 0: return "Event starting now.";
    case 5: return "Event starts in 5 minutes.";
    case 15: return "Event starts in 15 minutes.";
    case 60: return "Event starts in 1 hour.";
    case 1440: return "Event starts in 1 day.";
    case null:
    case undefined: return "Event starting soon.";
  }
}
