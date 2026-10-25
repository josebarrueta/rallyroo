import type {
  MemberInboxRecord,
  InboxPageQuery,
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

  async inboxRecordPage(familyID: string, memberID: string, query: InboxPageQuery): Promise<MemberInboxRecord[]> {
    return [...this.recordsByDeduplication.values()]
      .filter((record) => record.familyID === familyID && record.memberID === memberID
        && (!query.unreadOnly || record.readAt === null)
        && (!query.before || record.occurredAt < query.before.occurredAt
          || (record.occurredAt.getTime() === query.before.occurredAt.getTime() && record.id < query.before.id)))
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, query.limit);
  }

  async unreadInboxCount(familyID: string, memberID: string): Promise<number> {
    return [...this.recordsByDeduplication.values()].filter((record) =>
      record.familyID === familyID && record.memberID === memberID && record.readAt === null,
    ).length;
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

  async notificationDeliveryOutcomes(recordIDs: string[]) {
    return recordIDs.flatMap((id) => {
      const status = this.deliveryStatus.get(id);
      return status ? [status] : [];
    });
  }

  async pruneNotificationInbox(): Promise<number> { return 0; }

  async deleteInboxRecord(familyID: string, memberID: string, recordID: string): Promise<boolean> {
    for (const [key, record] of this.recordsByDeduplication) {
      if (record.id !== recordID || record.familyID !== familyID || record.memberID !== memberID) continue;
      this.recordsByDeduplication.delete(key); this.deliveryStatus.delete(recordID); return true;
    }
    return false;
  }

  async deleteAllInboxRecords(familyID: string, memberID: string): Promise<void> {
    for (const [key, record] of this.recordsByDeduplication) {
      if (record.familyID !== familyID || record.memberID !== memberID) continue;
      this.recordsByDeduplication.delete(key);
      this.deliveryStatus.delete(record.id);
    }
  }

  async markAllInboxRecordsRead(familyID: string, memberID: string, readAt: Date): Promise<void> {
    for (const [key, record] of this.recordsByDeduplication) {
      if (record.familyID === familyID && record.memberID === memberID && record.readAt === null) {
        this.recordsByDeduplication.set(key, { ...record, readAt });
      }
    }
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
