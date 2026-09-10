import { createHash, randomUUID } from "node:crypto";
import type { Account } from "./domain.js";
import type { PushNotificationProvider } from "./push-notification-provider.js";

export type NotificationKind =
  | "event_occurrence"
  | "reminder_occurrence"
  | "schedule_update"
  | "commute_disruption"
  | "driver_assignment"
  | "saved_conflict";

export type NotificationDestination = {
  kind: "event" | "reminder" | "commute_subscription" | "settings";
  id: string;
};

export interface MemberInboxRecord {
  id: string;
  familyID: string;
  memberID: string;
  kind: NotificationKind;
  deduplicationDigest: string;
  title: string;
  body: string;
  destination: NotificationDestination;
  occurredAt: Date;
  readAt: Date | null;
}

export interface NotificationIntent {
  familyID: string;
  recipientMemberIDs: string[];
  kind: NotificationKind;
  deduplicationKey: string;
  title: string;
  body: string;
  destination: NotificationDestination;
  occurredAt: Date;
}

export interface ClaimedNotificationDelivery {
  record: MemberInboxRecord;
  attemptCount: number;
  claimedAt: Date;
}

export interface NotificationCenterRepository {
  saveInboxRecordsIfAbsent(records: MemberInboxRecord[]): Promise<MemberInboxRecord[]>;
  inboxRecords(familyID: string, memberID: string, limit: number): Promise<MemberInboxRecord[]>;
  markInboxRecordRead(
    familyID: string, memberID: string, recordID: string, readAt: Date,
  ): Promise<boolean>;
  deleteInboxRecord(familyID: string, memberID: string, recordID: string): Promise<boolean>;
  claimNotificationDeliveries(now: Date, limit: number, recordIDs?: string[]): Promise<ClaimedNotificationDelivery[]>;
  deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]>;
  completeNotificationDelivery(recordID: string, claimedAt: Date, outcome: "delivered" | "no_recipient", completedAt: Date): Promise<void>;
  releaseNotificationDelivery(recordID: string, claimedAt: Date, errorCategory: string, releasedAt: Date): Promise<void>;
  notificationDeliveryOutcomes(recordIDs: string[]): Promise<Array<"pending" | "claimed" | "delivered" | "no_recipient" | "terminal_failure">>;
  pruneNotificationInbox(now: Date, limit: number): Promise<number>;
}

export interface NotificationCenterTelemetry {
  observeNotificationDelivery(
    category: NotificationKind,
    outcome: "delivered" | "no_recipient" | "failure",
    durationSeconds: number,
  ): void;
}

export class NotificationCenterModule {
  constructor(
    private readonly repository: NotificationCenterRepository,
    private readonly pushNotificationProvider?: PushNotificationProvider,
    private readonly telemetry?: NotificationCenterTelemetry,
  ) {}

  async record(intent: NotificationIntent): Promise<MemberInboxRecord[]> {
    validateIntent(intent);
    const recipients = [...new Set(intent.recipientMemberIDs)];
    return this.repository.saveInboxRecordsIfAbsent(recipients.map((memberID) => ({
      id: randomUUID(),
      familyID: intent.familyID,
      memberID,
      kind: intent.kind,
      deduplicationDigest: createHash("sha256")
        .update(`${intent.kind}\0${intent.deduplicationKey}\0${memberID}`)
        .digest("hex"),
      title: intent.title,
      body: intent.body,
      destination: intent.destination,
      occurredAt: intent.occurredAt,
      readAt: null,
    })));
  }

  async recordAndDispatch(intent: NotificationIntent): Promise<{
    records: MemberInboxRecord[];
    outcomes: Array<"delivered" | "no_recipient">;
  }> {
    const records = await this.record(intent);
    await this.dispatchDue(new Date(), records.length, records.map((record) => record.id));
    if (!this.pushNotificationProvider) return { records, outcomes: [] };
    const states = await this.repository.notificationDeliveryOutcomes(records.map((record) => record.id));
    if (states.length !== records.length || states.some((state) => state === "pending" || state === "claimed")) {
      throw new Error("notification_delivery_deferred");
    }
    if (states.some((state) => state === "terminal_failure")) {
      throw new Error("notification_delivery_terminal_failure");
    }
    return { records, outcomes: states as Array<"delivered" | "no_recipient"> };
  }

  async dispatchDue(
    now = new Date(), limit = 100, recordIDs?: string[],
  ): Promise<Array<"delivered" | "no_recipient">> {
    if (!this.pushNotificationProvider) return [];
    const claims = await this.repository.claimNotificationDeliveries(now, Math.min(Math.max(limit, 1), 200), recordIDs);
    const failures: unknown[] = [];
    const outcomes: Array<"delivered" | "no_recipient"> = [];
    for (const claim of claims) {
      const startedAt = performance.now();
      try {
        const tokens = await this.repository.deviceTokensForMembers(
          claim.record.familyID, [claim.record.memberID],
        );
        if (tokens.length === 0) {
          await this.repository.completeNotificationDelivery(
            claim.record.id, claim.claimedAt, "no_recipient", new Date(),
          );
          outcomes.push("no_recipient");
          this.telemetry?.observeNotificationDelivery(
            claim.record.kind, "no_recipient", (performance.now() - startedAt) / 1_000,
          );
          continue;
        }
        await this.pushNotificationProvider.send(tokens, {
          title: "Rallyroo update",
          body: "Open Rallyroo to review.",
          data: {
            notificationID: claim.record.id,
            destinationKind: claim.record.destination.kind,
            destinationID: claim.record.destination.id,
          },
          collapseID: claim.record.id,
        });
        await this.repository.completeNotificationDelivery(
          claim.record.id, claim.claimedAt, "delivered", new Date(),
        );
        outcomes.push("delivered");
        this.telemetry?.observeNotificationDelivery(
          claim.record.kind, "delivered", (performance.now() - startedAt) / 1_000,
        );
      } catch (error) {
        await this.repository.releaseNotificationDelivery(
          claim.record.id, claim.claimedAt, "provider_unavailable", new Date(),
        );
        this.telemetry?.observeNotificationDelivery(
          claim.record.kind, "failure", (performance.now() - startedAt) / 1_000,
        );
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Notification delivery failed");
    return outcomes;
  }

  async list(account: Account, limit = 100): Promise<MemberInboxRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("invalid_notification_limit");
    return this.repository.inboxRecords(account.familyID, account.memberID, limit);
  }

  async prune(now = new Date(), limit = 100): Promise<number> {
    return this.repository.pruneNotificationInbox(now, Math.min(Math.max(limit, 1), 500));
  }

  async delete(account: Account, recordID: string): Promise<boolean> {
    if (!recordID) throw new Error("invalid_notification_delete");
    return this.repository.deleteInboxRecord(account.familyID, account.memberID, recordID);
  }

  async markRead(account: Account, recordID: string, readAt = new Date()): Promise<boolean> {
    if (!recordID || Number.isNaN(readAt.getTime())) throw new Error("invalid_notification_read");
    return this.repository.markInboxRecordRead(account.familyID, account.memberID, recordID, readAt);
  }
}

function validateIntent(intent: NotificationIntent): void {
  if (!intent.familyID || intent.recipientMemberIDs.length < 1 || intent.recipientMemberIDs.length > 100
    || intent.recipientMemberIDs.some((id) => !id || id.length > 300)
    || !intent.deduplicationKey || intent.deduplicationKey.length > 500
    || !intent.title || intent.title.length > 300
    || !intent.body || intent.body.length > 1_000
    || !intent.destination.id || intent.destination.id.length > 500
    || Number.isNaN(intent.occurredAt.getTime())) {
    throw new Error("invalid_notification_intent");
  }
}
