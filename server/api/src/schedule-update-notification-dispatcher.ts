import type {
  EventMutationPersistence,
  ScheduleUpdateNotificationOutcome,
} from "./event-mutation-persistence.js";
import type { PushNotificationProvider } from "./push-notification-provider.js";

export interface ScheduleUpdateNotificationRecipients {
  deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]>;
}

interface ScheduleUpdateNotificationDispatcherDependencies {
  persistence: EventMutationPersistence;
  recipients: ScheduleUpdateNotificationRecipients;
  pushNotificationProvider: PushNotificationProvider;
  now?: () => Date;
  sendTimeoutMilliseconds?: number;
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
