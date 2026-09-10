import type {
  MemberInboxRecord,
  NotificationCenterRepository,
} from "./notification-center.js";

export class InMemoryNotificationCenterRepository implements NotificationCenterRepository {
  private readonly recordsByDeduplication = new Map<string, MemberInboxRecord>();

  async saveInboxRecordsIfAbsent(records: MemberInboxRecord[]): Promise<MemberInboxRecord[]> {
    return records.map((record) => {
      const key = `${record.familyID}:${record.memberID}:${record.deduplicationDigest}`;
      const existing = this.recordsByDeduplication.get(key);
      if (existing) return existing;
      this.recordsByDeduplication.set(key, record);
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
