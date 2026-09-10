import type { FamilyReminder } from "./domain.js";
import type { PushNotificationProvider } from "./push-notification-provider.js";
import type { NotificationCenterModule } from "./notification-center.js";

export interface ReminderNotificationRepository {
  claimDueReminderNotifications(now: Date, limit: number): Promise<FamilyReminder[]>;
  deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]>;
  markReminderNotificationSent(familyID: string, reminderID: string, sentAt: Date): Promise<void>;
  releaseReminderNotificationClaim(familyID: string, reminderID: string, claimedAt: Date): Promise<void>;
}

interface Dependencies {
  repository: ReminderNotificationRepository;
  pushNotificationProvider: PushNotificationProvider;
  batchSize?: number;
  notificationCenter?: NotificationCenterModule;
}

export class ReminderNotificationDispatcher {
  private readonly repository: ReminderNotificationRepository;
  private readonly pushNotificationProvider: PushNotificationProvider;
  private readonly batchSize: number;
  private readonly dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
    this.repository = dependencies.repository;
    this.pushNotificationProvider = dependencies.pushNotificationProvider;
    this.batchSize = dependencies.batchSize ?? 100;
  }

  async dispatchDue(now = new Date()): Promise<void> {
    const reminders = await this.repository.claimDueReminderNotifications(now, this.batchSize);
    const results = await Promise.allSettled(reminders.map(async (reminder) => {
      try {
        if (this.dependencies.notificationCenter) {
          await this.dependencies.notificationCenter.recordAndDispatch({
            familyID: reminder.familyID,
            recipientMemberIDs: reminder.assigneeIDs,
            kind: "reminder_occurrence",
            deduplicationKey: reminder.id,
            title: reminder.title,
            body: "Reminder due. Open Rallyroo to review.",
            destination: { kind: "reminder", id: reminder.id },
            occurredAt: now,
          });
          await this.repository.markReminderNotificationSent(reminder.familyID, reminder.id, now);
          return;
        }
        const tokens = await this.repository.deviceTokensForMembers(
          reminder.familyID,
          reminder.assigneeIDs,
        );
        if (tokens.length > 0) {
          await this.pushNotificationProvider.send(tokens, {
            title: reminder.title,
            body: "Reminder due. Open Rallyroo to review.",
            data: { reminderID: reminder.id },
          });
        }
        await this.repository.markReminderNotificationSent(reminder.familyID, reminder.id, now);
      } catch (error) {
        await this.repository.releaseReminderNotificationClaim(reminder.familyID, reminder.id, now);
        throw error;
      }
    }));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(failures.map((failure) => failure.reason), "Reminder notification delivery failed");
    }
  }
}
