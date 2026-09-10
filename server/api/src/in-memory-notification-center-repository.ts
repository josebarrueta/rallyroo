import type {
  MemberInboxRecord,
  NotificationCenterRepository,
} from "./notification-center.js";

export class InMemoryNotificationCenterRepository implements NotificationCenterRepository {
  private readonly recordsByDeduplication = new Map<string, MemberInboxRecord>();
  private readonly deliveryStatus = new Map<string, "pending" | "claimed" | "delivered" | "no_recipient">();

  async saveInboxRecordsIfAbsent(records: MemberInboxRecord[]): Promise<MemberInboxRecord[]> {
    return records.map((record) => {
      const key = `${record.familyID}:${record.memberID}:${record.deduplicationDigest}`;
      const existing = this.recordsByDeduplication.get(key);
      if (existing) return existing;
      this.recordsByDeduplication.set(key, record);
      this.deliveryStatus.set(record.id, "pending");
      return record;
    });
  }

  async inboxRecords(
    familyID: string,
    memberID: string,
    limit: number,
  ): Promise<MemberInboxRecord[]> {
    return [...this.recordsByDeduplication.values()]
      .filter((record) => record.familyID === familyID && record.memberID === memberID)
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .slice(0, limit);
  }

  async claimNotificationDeliveries(now: Date, limit: number, recordIDs?: string[]) {
    const allowed = recordIDs ? new Set(recordIDs) : undefined;
    return [...this.recordsByDeduplication.values()]
      .filter((record) => this.deliveryStatus.get(record.id) === "pending" && (!allowed || allowed.has(record.id)))
      .slice(0, limit)
      .map((record) => {
        this.deliveryStatus.set(record.id, "claimed");
        return { record, attemptCount: 1, claimedAt: now };
      });
  }

  async deviceTokensForMembers(_familyID: string, memberIDs: string[]): Promise<string[]> {
    return memberIDs.map((id) => `token:${id}`);
  }

  async completeNotificationDelivery(
    recordID: string, _claimedAt: Date, outcome: "delivered" | "no_recipient",
  ): Promise<void> {
    this.deliveryStatus.set(recordID, outcome);
  }

  async releaseNotificationDelivery(recordID: string): Promise<void> {
    this.deliveryStatus.set(recordID, "pending");
  }

  async pruneNotificationInbox(): Promise<number> { return 0; }

  async deleteInboxRecord(familyID: string, memberID: string, recordID: string): Promise<boolean> {
    for (const [key, record] of this.recordsByDeduplication) {
      if (record.id !== recordID || record.familyID !== familyID || record.memberID !== memberID) continue;
      this.recordsByDeduplication.delete(key); this.deliveryStatus.delete(recordID); return true;
    }
    return false;
  }

  async markInboxRecordRead(
    familyID: string,
    memberID: string,
    recordID: string,
    readAt: Date,
  ): Promise<boolean> {
    for (const [key, record] of this.recordsByDeduplication) {
      if (record.id !== recordID || record.familyID !== familyID || record.memberID !== memberID) continue;
      this.recordsByDeduplication.set(key, { ...record, readAt: record.readAt ?? readAt });
      return true;
    }
    return false;
  }
}
