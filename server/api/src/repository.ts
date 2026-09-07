import type { Account, FamilyEvent, FamilyInvitation, FamilyMember, FamilyReminder } from "./domain.js";
import type { DueEventNotification } from "./event-notification-dispatcher.js";
import type { EventMutationPersistence } from "./event-mutation-persistence.js";

export interface RallyrooRepository extends EventMutationPersistence {
  accountForIdentity(subject: string): Promise<Account | null>;
  provisionParentAccount(subject: string, displayName: string): Promise<Account>;
  deleteAccount(subject: string): Promise<void>;
  saveInvitation(invitation: FamilyInvitation): Promise<void>;
  pendingInvitations(familyID: string): Promise<FamilyInvitation[]>;
  cancelInvitation(familyID: string, invitationID: string): Promise<boolean>;
  rotateInvitation(
    familyID: string,
    invitationID: string,
    codeHash: string,
    expiresAt: string,
  ): Promise<FamilyInvitation | null>;
  consumeInvitation(codeHash: string, subject: string, displayName: string): Promise<Account | null>;
  familyChangeVersion(familyID: string): Promise<number>;
  markFamilyChanged(familyID: string): Promise<void>;
  saveDeviceToken(familyID: string, memberID: string, token: string): Promise<void>;
  deleteDeviceToken(memberID: string, token: string): Promise<void>;
  deviceTokensForFamily(familyID: string): Promise<string[]>;
  deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]>;
  eventsForFamily(familyID: string): Promise<FamilyEvent[]>;
  saveEvent(event: FamilyEvent): Promise<void>;
  deleteEvent(familyID: string, eventID: string): Promise<void>;
  claimDueEventNotifications(now: Date, limit: number): Promise<DueEventNotification[]>;
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
  remindersForFamily(familyID: string): Promise<FamilyReminder[]>;
  saveReminder(reminder: FamilyReminder): Promise<void>;
  deleteReminder(familyID: string, reminderID: string): Promise<void>;
  claimDueReminderNotifications(now: Date, limit: number): Promise<FamilyReminder[]>;
  markReminderNotificationSent(familyID: string, reminderID: string, sentAt: Date): Promise<void>;
  releaseReminderNotificationClaim(familyID: string, reminderID: string, claimedAt: Date): Promise<void>;
  membersForFamily(familyID: string): Promise<FamilyMember[]>;
  saveMember(member: FamilyMember): Promise<void>;
  deleteMember(familyID: string, memberID: string): Promise<void>;
}
