import type {
  EventMutationPersistence,
  ScheduleUpdateNotificationOutcome,
} from "./event-mutation-persistence.js";
import type { PushNotificationProvider } from "./push-notification-provider.js";
import type { NotificationCenterModule } from "./notification-center.js";

export interface ScheduleUpdateNotificationRecipients {
  deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]>;
}

interface ScheduleUpdateNotificationDispatcherDependencies {
  persistence: EventMutationPersistence;
  recipients: ScheduleUpdateNotificationRecipients;
  pushNotificationProvider: PushNotificationProvider;
  now?: () => Date;
  sendTimeoutMilliseconds?: number;
  notificationCenter?: NotificationCenterModule;
}

export class ScheduleUpdateNotificationDispatcher {
  private readonly now: () => Date;
  private readonly sendTimeoutMilliseconds: number;

  constructor(private readonly dependencies: ScheduleUpdateNotificationDispatcherDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.sendTimeoutMilliseconds = dependencies.sendTimeoutMilliseconds ?? 2_000;
  }

  async dispatchDue(
    limit = 100,
    notificationID?: string,
  ): Promise<ScheduleUpdateNotificationOutcome[]> {
    const claimed = await this.dependencies.persistence.claimScheduleUpdateNotifications(
      this.now(),
      limit,
      notificationID,
    );
    const outcomes: ScheduleUpdateNotificationOutcome[] = [];
    for (const notification of claimed) {
      if (this.dependencies.notificationCenter) {
        try {
          const delivery = await this.dependencies.notificationCenter.recordAndDispatch({
            familyID: notification.familyID,
            recipientMemberIDs: notification.participantIDs,
            kind: "schedule_update",
            deduplicationKey: notification.id,
            title: notification.title,
            body: notification.body,
            destination: { kind: "event", id: notification.eventID },
            occurredAt: this.now(),
          });
          const outcome = delivery.outcomes.every((item) => item === "no_recipient")
            ? "noRecipients" : "sent";
          await this.dependencies.persistence.completeScheduleUpdateNotification(
            notification, outcome, this.now(),
          );
          outcomes.push(outcome);
        } catch {
          await this.dependencies.persistence.releaseScheduleUpdateNotification(
            notification, "provider_unavailable",
          );
          outcomes.push("queuedForRetry");
        }
        continue;
      }
      const tokens = await this.dependencies.recipients.deviceTokensForMembers(
        notification.familyID,
        notification.participantIDs,
      );
      if (tokens.length === 0) {
        await this.dependencies.persistence.completeScheduleUpdateNotification(
          notification,
          "noRecipients",
          this.now(),
        );
        outcomes.push("noRecipients");
        continue;
      }
      try {
        await withTimeout(
          this.dependencies.pushNotificationProvider.send(tokens, {
            title: notification.title,
            body: notification.body,
            data: { eventID: notification.eventID },
            collapseID: notification.id,
          }),
          this.sendTimeoutMilliseconds,
        );
        await this.dependencies.persistence.completeScheduleUpdateNotification(
          notification,
          "sent",
          this.now(),
        );
        outcomes.push("sent");
      } catch {
        await this.dependencies.persistence.releaseScheduleUpdateNotification(
          notification,
          "provider_unavailable",
        );
        outcomes.push("queuedForRetry");
      }
    }
    return outcomes;
  }
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("notification_timeout")), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
