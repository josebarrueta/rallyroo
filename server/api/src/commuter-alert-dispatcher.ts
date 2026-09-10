import type { CommuteAlertKind } from "./commuter-module.js";
import type { PushNotificationProvider } from "./push-notification-provider.js";
import type { NotificationCenterModule } from "./notification-center.js";

export interface ClaimedCommuteAlert {
  id: string;
  subscriptionID: string;
  familyID: string;
  kind: CommuteAlertKind;
  delayMinutes: number;
  audience: { kind: "member"; memberID: string } | { kind: "family" };
  attemptCount: number;
  claimedAt: Date;
}

export interface CommuterAlertDeliveryRepository {
  claimDueCommuteAlerts(now: Date, limit: number): Promise<ClaimedCommuteAlert[]>;
  deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]>;
  deviceTokensForFamily(familyID: string): Promise<string[]>;
  memberIDsForFamily?(familyID: string): Promise<string[]>;
  markCommuteAlertDelivered(alert: ClaimedCommuteAlert, deliveredAt: Date): Promise<void>;
  releaseCommuteAlertClaim(alert: ClaimedCommuteAlert, releasedAt: Date): Promise<void>;
}

interface Dependencies {
  repository: CommuterAlertDeliveryRepository;
  pushNotificationProvider: PushNotificationProvider;
  batchSize?: number;
  sendTimeoutMilliseconds?: number;
  notificationCenter?: NotificationCenterModule;
}

export class CommuterAlertDispatcher {
  private readonly batchSize: number;
  private readonly sendTimeoutMilliseconds: number;

  constructor(private readonly dependencies: Dependencies) {
    this.batchSize = dependencies.batchSize ?? 100;
    this.sendTimeoutMilliseconds = dependencies.sendTimeoutMilliseconds ?? 2_000;
  }

  async dispatchDue(now = new Date()): Promise<void> {
    const alerts = await this.dependencies.repository.claimDueCommuteAlerts(now, this.batchSize);
    const failures: unknown[] = [];
    for (const alert of alerts) {
      try {
        const recipientMemberIDs = alert.audience.kind === "member"
          ? [alert.audience.memberID]
          : await this.dependencies.repository.memberIDsForFamily?.(alert.familyID) ?? [];
        if (this.dependencies.notificationCenter && recipientMemberIDs.length === 0) {
          throw new Error("commuter_notification_recipients_unavailable");
        }
        if (this.dependencies.notificationCenter) {
          await this.dependencies.notificationCenter.recordAndDispatch({
            familyID: alert.familyID,
            recipientMemberIDs,
            kind: "commute_disruption",
            deduplicationKey: alert.id,
            title: alert.kind === "delay" ? "Caltrain commute delayed" : "Caltrain commute canceled",
            body: notificationBody(alert),
            destination: { kind: "commute_subscription", id: alert.subscriptionID },
            occurredAt: now,
          });
          await this.dependencies.repository.markCommuteAlertDelivered(alert, now);
          continue;
        }
        const tokens = alert.audience.kind === "member"
          ? await this.dependencies.repository.deviceTokensForMembers(
            alert.familyID,
            [alert.audience.memberID],
          )
          : await this.dependencies.repository.deviceTokensForFamily(alert.familyID);
        if (tokens.length > 0) {
          await withTimeout(this.dependencies.pushNotificationProvider.send(tokens, {
            title: alert.kind === "delay" ? "Caltrain commute delayed" : "Caltrain commute canceled",
            body: notificationBody(alert),
            data: { commuterAlertID: alert.id, subscriptionID: alert.subscriptionID },
            collapseID: alert.id,
          }), this.sendTimeoutMilliseconds);
        }
        await this.dependencies.repository.markCommuteAlertDelivered(alert, now);
      } catch (error) {
        try {
          await this.dependencies.repository.releaseCommuteAlertClaim(alert, now);
        } catch (releaseError) {
          failures.push(releaseError);
        }
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Commuter alert delivery failed");
    }
  }
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("commuter_alert_timeout")), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function notificationBody(alert: ClaimedCommuteAlert): string {
  if (alert.kind === "delay" && alert.delayMinutes > 0) {
    return `A saved commute is delayed by ${alert.delayMinutes} minutes. Open Rallyroo to review.`;
  }
  return "A saved commute may be affected. Open Rallyroo to review.";
}
