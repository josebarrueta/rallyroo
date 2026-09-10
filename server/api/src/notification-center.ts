import { createHash, randomUUID } from "node:crypto";
import type { Account } from "./domain.js";

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

export interface NotificationCenterRepository {
  saveInboxRecordsIfAbsent(records: MemberInboxRecord[]): Promise<MemberInboxRecord[]>;
  inboxRecords(familyID: string, memberID: string, limit: number): Promise<MemberInboxRecord[]>;
  markInboxRecordRead(
    familyID: string, memberID: string, recordID: string, readAt: Date,
  ): Promise<boolean>;
}

export class NotificationCenterModule {
  constructor(private readonly repository: NotificationCenterRepository) {}

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

  async list(account: Account, limit = 100): Promise<MemberInboxRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("invalid_notification_limit");
    return this.repository.inboxRecords(account.familyID, account.memberID, limit);
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
