import { randomUUID } from "node:crypto";
import type { Account, FamilyEvent, FamilyInvitation, FamilyMember, FamilyReminder } from "./domain.js";
import type { DueEventNotification } from "./event-notification-dispatcher.js";
import type {
  ClaimedScheduleUpdateNotification,
  EventMutationPlan,
  StoredEventMutationResult,
  EventMutationSnapshot,
  ScheduleUpdateNotificationIntent,
} from "./event-mutation-persistence.js";
import { eventOccurrenceStarts } from "./event-recurrence.js";
import type { InvitationConsumptionResult, RallyrooRepository } from "./repository.js";

interface SeedData {
  accounts?: Account[];
  events?: FamilyEvent[];
  reminders?: FamilyReminder[];
  members?: FamilyMember[];
}

export class InMemoryRallyrooRepository implements RallyrooRepository {
  private readonly accounts: Account[];
  private readonly events: FamilyEvent[];
  private readonly reminders: FamilyReminder[];
  private readonly members: FamilyMember[];
  private readonly invitations: FamilyInvitation[] = [];
  private readonly changeVersions = new Map<string, number>();
  private readonly devices = new Map<string, { familyID: string; memberID: string }>();
  private readonly claimedReminderNotifications = new Set<string>();
  private readonly sentReminderNotifications = new Set<string>();
  private readonly claimedEventNotifications = new Map<string, Date>();
  private readonly sentEventNotifications = new Set<string>();
  private readonly eventMutationResults = new Map<string, StoredEventMutationResult>();
  private readonly scheduleUpdateNotifications = new Map<string, {
    familyID: string;
    idempotencyKey: string;
    notification: ScheduleUpdateNotificationIntent;
    status: "pending" | "claimed" | "sent";
    claimedAt: Date | null;
    attemptCount: number;
    lastErrorCategory: string | null;
    createdAt: Date;
  }>();

  constructor(seed: SeedData = {}) {
    this.accounts = [...(seed.accounts ?? [])];
    this.events = [...(seed.events ?? [])];
    this.reminders = [...(seed.reminders ?? [])];
    this.members = [...(seed.members ?? [])];
  }

  async accountForIdentity(subject: string): Promise<Account | null> {
    return this.accounts.find((account) => account.identitySubject === subject) ?? null;
  }

  async provisionParentAccount(subject: string, displayName: string): Promise<Account> {
    const existing = await this.accountForIdentity(subject);
    if (existing) return existing;
    const familyID = `family-${randomUUID()}`;
    const memberID = `parent-${randomUUID()}`;
    const account: Account = {
      identitySubject: subject,
      familyID,
      memberID,
      role: "parent",
    };
    this.members.push({
      id: memberID,
      familyID,
      name: displayName,
      role: "parent",
      colorTag: "blue",
    });
    this.accounts.push(account);
    return account;
  }

  async deleteAccount(subject: string): Promise<void> {
    const accountIndex = this.accounts.findIndex((account) => account.identitySubject === subject);
    if (accountIndex < 0) return;
    const account = this.accounts[accountIndex]!;
    const isLastAccount = this.accounts.filter(
      (candidate) => candidate.familyID === account.familyID,
    ).length === 1;

    if (isLastAccount) {
      removeWhere(this.accounts, (candidate) => candidate.familyID === account.familyID);
      removeWhere(this.members, (member) => member.familyID === account.familyID);
      removeWhere(this.events, (event) => event.familyID === account.familyID);
      removeWhere(this.reminders, (reminder) => reminder.familyID === account.familyID);
      removeWhere(this.invitations, (invitation) => invitation.familyID === account.familyID);
      this.changeVersions.delete(account.familyID);
      for (const [token, device] of this.devices) {
        if (device.familyID === account.familyID) this.devices.delete(token);
      }
      return;
    }

    this.accounts.splice(accountIndex, 1);
    removeWhere(
      this.members,
      (member) => member.familyID === account.familyID && member.id === account.memberID,
    );
    for (const event of this.events.filter((candidate) => candidate.familyID === account.familyID)) {
      event.participantIDs = event.participantIDs.filter((id) => id !== account.memberID);
      if (event.kidID === account.memberID) event.kidID = null;
    }
    removeWhere(this.reminders, (reminder) =>
      reminder.familyID === account.familyID
      && reminder.assigneeIDs.length === 1
      && reminder.assigneeIDs[0] === account.memberID
    );
    for (const reminder of this.reminders.filter((candidate) => candidate.familyID === account.familyID)) {
      reminder.assigneeIDs = reminder.assigneeIDs.filter((id) => id !== account.memberID);
    }
    for (const [token, device] of this.devices) {
      if (device.memberID === account.memberID) this.devices.delete(token);
    }
    await this.markFamilyChanged(account.familyID);
  }

  async saveInvitation(invitation: FamilyInvitation): Promise<void> {
    this.invitations.push(invitation);
  }

  async pendingInvitations(familyID: string): Promise<FamilyInvitation[]> {
    return this.invitations.filter((invitation) =>
      invitation.familyID === familyID && new Date(invitation.expiresAt) > new Date()
    );
  }

  async cancelInvitation(familyID: string, invitationID: string): Promise<boolean> {
    const index = this.invitations.findIndex((invitation) =>
      invitation.id === invitationID &&
      invitation.familyID === familyID &&
      new Date(invitation.expiresAt) > new Date()
    );
    if (index < 0) return false;
    this.invitations.splice(index, 1);
    return true;
  }

  async rotateInvitation(
    familyID: string,
    invitationID: string,
    codeHash: string,
    expiresAt: string,
  ): Promise<FamilyInvitation | null> {
    const invitation = this.invitations.find((candidate) =>
      candidate.id === invitationID &&
      candidate.familyID === familyID &&
      new Date(candidate.expiresAt) > new Date()
    );
    if (!invitation) return null;
    invitation.codeHash = codeHash;
    invitation.expiresAt = expiresAt;
    return invitation;
  }

  async consumeInvitation(
    codeHash: string,
    subject: string,
    displayName: string,
  ): Promise<InvitationConsumptionResult> {
    const invitationIndex = this.invitations.findIndex((invitation) =>
      invitation.codeHash === codeHash && new Date(invitation.expiresAt) > new Date()
    );
    if (invitationIndex < 0) return { status: "invalid" };
    const invitation = this.invitations[invitationIndex]!;
    const existing = await this.accountForIdentity(subject);

    if (existing?.familyID === invitation.familyID) {
      this.invitations.splice(invitationIndex, 1);
      return { status: "accepted", account: existing };
    }

    if (existing) {
      const sourceIsDisposable = this.accounts.filter(
        (account) => account.familyID === existing.familyID,
      ).length === 1
        && this.members.filter((member) => member.familyID === existing.familyID).length === 1
        && !this.events.some((event) => event.familyID === existing.familyID)
        && !this.reminders.some((reminder) => reminder.familyID === existing.familyID)
        && !this.invitations.some((candidate) => candidate.familyID === existing.familyID);
      if (!sourceIsDisposable) return { status: "account_conflict" };

      const oldFamilyID = existing.familyID;
      const oldMemberID = existing.memberID;
      const memberID = `${invitation.role}-${randomUUID()}`;
      this.members.push({
        id: memberID,
        familyID: invitation.familyID,
        name: displayName,
        role: invitation.role,
        colorTag: "blue",
      });
      existing.familyID = invitation.familyID;
      existing.memberID = memberID;
      existing.role = invitation.role;
      for (const device of this.devices.values()) {
        if (device.familyID === oldFamilyID && device.memberID === oldMemberID) {
          device.familyID = invitation.familyID;
          device.memberID = memberID;
        }
      }
      removeWhere(this.members, (member) =>
        member.familyID === oldFamilyID && member.id === oldMemberID
      );
      this.changeVersions.delete(oldFamilyID);
      this.invitations.splice(invitationIndex, 1);
      await this.markFamilyChanged(invitation.familyID);
      return { status: "accepted", account: existing };
    }

    const memberID = `${invitation.role}-${randomUUID()}`;
    const account: Account = {
      identitySubject: subject,
      familyID: invitation.familyID,
      memberID,
      role: invitation.role,
    };
    this.members.push({
      id: memberID,
      familyID: invitation.familyID,
      name: displayName,
      role: invitation.role,
      colorTag: "blue",
    });
    this.accounts.push(account);
    this.invitations.splice(invitationIndex, 1);
    await this.markFamilyChanged(invitation.familyID);
    return { status: "accepted", account };
  }

  async familyChangeVersion(familyID: string): Promise<number> {
    return this.changeVersions.get(familyID) ?? 0;
  }

  async markFamilyChanged(familyID: string): Promise<void> {
    this.changeVersions.set(familyID, (this.changeVersions.get(familyID) ?? 0) + 1);
  }

  async saveDeviceToken(familyID: string, memberID: string, token: string): Promise<void> {
    this.devices.set(token, { familyID, memberID });
  }

  async deleteDeviceToken(memberID: string, token: string): Promise<void> {
    if (this.devices.get(token)?.memberID === memberID) this.devices.delete(token);
  }

  async deviceTokensForFamily(familyID: string): Promise<string[]> {
    return [...this.devices.entries()]
      .filter(([, device]) => device.familyID === familyID)
      .map(([token]) => token);
  }

  async deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]> {
    const requested = new Set(memberIDs);
    return [...this.devices.entries()]
      .filter(([, device]) => device.familyID === familyID && requested.has(device.memberID))
      .map(([token]) => token);
  }

  async eventsForFamily(familyID: string): Promise<FamilyEvent[]> {
    return this.events.filter((event) => event.familyID === familyID);
  }

  async eventMutationResult(
    familyID: string,
    idempotencyKey: string,
  ): Promise<StoredEventMutationResult | null> {
    const result = this.eventMutationResults.get(`${familyID}:${idempotencyKey}`);
    return result ? structuredClone(result) : null;
  }

  async performEventMutation(
    familyID: string,
    idempotencyKey: string,
    prepare: (snapshot: EventMutationSnapshot) => EventMutationPlan,
  ): Promise<StoredEventMutationResult> {
    const mutationKey = `${familyID}:${idempotencyKey}`;
    const previous = this.eventMutationResults.get(mutationKey);
    if (previous) return structuredClone(previous);

    const plan = prepare({
      events: this.events.filter((event) => event.familyID === familyID).map((event) => structuredClone(event)),
      members: this.members.filter((member) => member.familyID === familyID).map((member) => structuredClone(member)),
    });
    const action = plan.action;
    if (action.kind === "save") {
      const index = this.events.findIndex((candidate) =>
        candidate.familyID === familyID && candidate.id === action.event.id
      );
      if (index >= 0) this.events[index] = structuredClone(action.event);
      else this.events.push(structuredClone(action.event));
    } else if (action.kind === "recurringEdit") {
      const deleteIDs = new Set(action.deleteIDs.map((id) => id.toLowerCase()));
      removeWhere(this.events, (event) => event.familyID === familyID && deleteIDs.has(event.id));
      for (const upsert of action.upserts) {
        const index = this.events.findIndex((candidate) =>
          candidate.familyID === familyID && candidate.id === upsert.id
        );
        if (index >= 0) this.events[index] = structuredClone(upsert);
        else this.events.push(structuredClone(upsert));
      }
    } else {
      removeWhere(this.events, (event) => event.familyID === familyID && event.id === action.eventID);
    }
    this.changeVersions.set(familyID, (this.changeVersions.get(familyID) ?? 0) + 1);
    if (plan.notification) {
      this.scheduleUpdateNotifications.set(plan.notification.id, {
        familyID,
        idempotencyKey,
        notification: structuredClone(plan.notification),
        status: "pending",
        claimedAt: null,
        attemptCount: 0,
        lastErrorCategory: null,
        createdAt: new Date(),
      });
    }
    this.eventMutationResults.set(mutationKey, structuredClone(plan.result));
    return structuredClone(plan.result);
  }

  async claimScheduleUpdateNotifications(
    now: Date,
    limit: number,
    notificationID?: string,
  ): Promise<ClaimedScheduleUpdateNotification[]> {
    const staleBefore = now.getTime() - 5 * 60 * 1_000;
    const candidates = [...this.scheduleUpdateNotifications.values()]
      .filter((entry) =>
        (!notificationID || entry.notification.id === notificationID)
        && (entry.status === "pending"
          || (entry.status === "claimed" && (entry.claimedAt?.getTime() ?? 0) < staleBefore))
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit);
    return candidates.map((entry) => {
      entry.status = "claimed";
      entry.claimedAt = now;
      entry.attemptCount += 1;
      return {
        ...structuredClone(entry.notification),
        familyID: entry.familyID,
        idempotencyKey: entry.idempotencyKey,
        claimedAt: now,
      };
    });
  }

  async completeScheduleUpdateNotification(
    notification: ClaimedScheduleUpdateNotification,
    outcome: "sent" | "noRecipients",
    _completedAt: Date,
  ): Promise<void> {
    const entry = this.scheduleUpdateNotifications.get(notification.id);
    if (!entry || entry.claimedAt?.getTime() !== notification.claimedAt.getTime()) return;
    entry.status = "sent";
    entry.claimedAt = null;
    const key = `${notification.familyID}:${notification.idempotencyKey}`;
    const result = this.eventMutationResults.get(key);
    if (result) result.notificationOutcome = outcome;
  }

  async releaseScheduleUpdateNotification(
    notification: ClaimedScheduleUpdateNotification,
    errorCategory: string,
  ): Promise<void> {
    const entry = this.scheduleUpdateNotifications.get(notification.id);
    if (!entry || entry.claimedAt?.getTime() !== notification.claimedAt.getTime()) return;
    entry.status = "pending";
    entry.claimedAt = null;
    entry.lastErrorCategory = errorCategory;
  }

  async saveEvent(event: FamilyEvent): Promise<void> {
    const index = this.events.findIndex((candidate) => candidate.id === event.id && candidate.familyID === event.familyID);
    if (index >= 0) this.events[index] = event;
    else this.events.push(event);
  }

  async deleteEvent(familyID: string, eventID: string): Promise<void> {
    const index = this.events.findIndex((event) => event.familyID === familyID && event.id === eventID);
    if (index >= 0) this.events.splice(index, 1);
    const prefix = `${familyID}:${eventID.toLowerCase()}:`;
    for (const key of this.claimedEventNotifications.keys()) {
      if (key.startsWith(prefix)) this.claimedEventNotifications.delete(key);
    }
    for (const key of this.sentEventNotifications) {
      if (key.startsWith(prefix)) this.sentEventNotifications.delete(key);
    }
  }

  async claimDueEventNotifications(now: Date, limit: number): Promise<DueEventNotification[]> {
    const oldestOccurrence = now.getTime() - 5 * 60 * 1_000;
    const staleClaim = now.getTime() - 5 * 60 * 1_000;
    const candidates: DueEventNotification[] = [];
    for (const event of this.events) {
      if (event.alertLeadTimeMinutes === null || event.alertLeadTimeMinutes === undefined) continue;
      const through = new Date(now.getTime() + event.alertLeadTimeMinutes * 60 * 1_000);
      for (const occurrenceStart of eventOccurrenceStarts(event, through)) {
        const occurrenceTime = occurrenceStart.getTime();
        const notifyAt = occurrenceTime - event.alertLeadTimeMinutes * 60 * 1_000;
        if (notifyAt > now.getTime() || occurrenceTime < oldestOccurrence) continue;
        const occurrenceISO = occurrenceStart.toISOString();
        const key = eventNotificationKey(event.familyID, event.id, occurrenceISO);
        const claimedAt = this.claimedEventNotifications.get(key);
        if (this.sentEventNotifications.has(key) || (claimedAt && claimedAt.getTime() >= staleClaim)) continue;
        candidates.push({ event, occurrenceStart: occurrenceISO });
      }
    }
    candidates.sort((left, right) => left.occurrenceStart.localeCompare(right.occurrenceStart));
    const due = candidates.slice(0, limit);
    for (const notification of due) {
      this.claimedEventNotifications.set(
        eventNotificationKey(notification.event.familyID, notification.event.id, notification.occurrenceStart),
        now,
      );
    }
    return due;
  }

  async markEventNotificationSent(
    familyID: string,
    eventID: string,
    occurrenceStart: string,
    _claimedAt: Date,
  ): Promise<void> {
    const key = eventNotificationKey(familyID, eventID, occurrenceStart);
    this.claimedEventNotifications.delete(key);
    this.sentEventNotifications.add(key);
  }

  async releaseEventNotificationClaim(
    familyID: string,
    eventID: string,
    occurrenceStart: string,
    _claimedAt: Date,
  ): Promise<void> {
    this.claimedEventNotifications.delete(eventNotificationKey(familyID, eventID, occurrenceStart));
  }

  async remindersForFamily(familyID: string): Promise<FamilyReminder[]> {
    return this.reminders
      .filter((reminder) => reminder.familyID === familyID)
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }

  async saveReminder(reminder: FamilyReminder): Promise<void> {
    const index = this.reminders.findIndex((candidate) =>
      candidate.familyID === reminder.familyID && candidate.id.toLowerCase() === reminder.id.toLowerCase()
    );
    if (index >= 0) this.reminders[index] = reminder;
    else this.reminders.push(reminder);
    this.claimedReminderNotifications.delete(`${reminder.familyID}:${reminder.id.toLowerCase()}`);
    this.sentReminderNotifications.delete(`${reminder.familyID}:${reminder.id.toLowerCase()}`);
  }

  async deleteReminder(familyID: string, reminderID: string): Promise<void> {
    const index = this.reminders.findIndex((reminder) =>
      reminder.familyID === familyID && reminder.id.toLowerCase() === reminderID.toLowerCase()
    );
    if (index >= 0) this.reminders.splice(index, 1);
  }

  async claimDueReminderNotifications(now: Date, limit: number): Promise<FamilyReminder[]> {
    const oldestDueAt = now.getTime() - 24 * 60 * 60 * 1_000;
    const due = this.reminders.filter((reminder) => {
      if (reminder.status !== "open" || reminder.alertLeadTimeMinutes === null) return false;
      const key = `${reminder.familyID}:${reminder.id.toLowerCase()}`;
      if (this.claimedReminderNotifications.has(key) || this.sentReminderNotifications.has(key)) return false;
      const dueAt = new Date(reminder.dueAt).getTime();
      const notifyAt = dueAt - reminder.alertLeadTimeMinutes * 60 * 1_000;
      return notifyAt <= now.getTime() && dueAt >= oldestDueAt;
    }).slice(0, limit);
    for (const reminder of due) {
      this.claimedReminderNotifications.add(`${reminder.familyID}:${reminder.id.toLowerCase()}`);
    }
    return due;
  }

  async markReminderNotificationSent(familyID: string, reminderID: string): Promise<void> {
    const key = `${familyID}:${reminderID.toLowerCase()}`;
    this.claimedReminderNotifications.delete(key);
    this.sentReminderNotifications.add(key);
  }

  async releaseReminderNotificationClaim(familyID: string, reminderID: string, _claimedAt: Date): Promise<void> {
    this.claimedReminderNotifications.delete(`${familyID}:${reminderID.toLowerCase()}`);
  }

  async membersForFamily(familyID: string): Promise<FamilyMember[]> {
    return this.members.filter((member) => member.familyID === familyID);
  }

  async saveMember(member: FamilyMember): Promise<void> {
    const index = this.members.findIndex((candidate) => candidate.id === member.id && candidate.familyID === member.familyID);
    if (index >= 0) this.members[index] = member;
    else this.members.push(member);
  }

  async deleteMember(familyID: string, memberID: string): Promise<void> {
    const index = this.members.findIndex((member) => member.familyID === familyID && member.id === memberID);
    if (index >= 0) this.members.splice(index, 1);
  }
}

function eventNotificationKey(familyID: string, eventID: string, occurrenceStart: string): string {
  return `${familyID}:${eventID.toLowerCase()}:${occurrenceStart}`;
}

function removeWhere<T>(values: T[], predicate: (value: T) => boolean): void {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) values.splice(index, 1);
  }
}
