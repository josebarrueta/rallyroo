import { describe, expect, it } from "vitest";
import { ReminderNotificationDispatcher } from "../src/reminder-notification-dispatcher.js";
import type { FamilyReminder } from "../src/domain.js";

const reminder: FamilyReminder = {
  id: "abcdefab-cdef-4abc-8def-abcdefabc201",
  familyID: "family-1",
  title: "Bring the permission slip",
  assigneeIDs: ["kid-1"],
  dueAt: "2026-09-10T15:00:00Z",
  status: "open",
  completedAt: null,
  completedByMemberID: null,
  alertLeadTimeMinutes: 60,
  createdByMemberID: "parent-1",
};

describe("ReminderNotificationDispatcher", () => {
  it("sends due reminders only to assignee devices and marks delivery", async () => {
    const marked: string[] = [];
    const deliveries: Array<{ tokens: string[]; reminderID: string | undefined }> = [];
    const dispatcher = new ReminderNotificationDispatcher({
      repository: {
        claimDueReminderNotifications: async () => [{ reminder, occurrenceDue: reminder.dueAt }],
        deviceTokensForMembers: async (_familyID, memberIDs) => {
          expect(memberIDs).toEqual(["kid-1"]);
          return ["assignee-device-token"];
        },
        markReminderNotificationSent: async (_familyID, reminderID) => { marked.push(reminderID); },
        releaseReminderNotificationClaim: async () => {},
      },
      pushNotificationProvider: {
        async send(tokens, payload) {
          deliveries.push({ tokens, reminderID: payload.data?.reminderID });
        },
      },
    });

    await dispatcher.dispatchDue(new Date("2026-09-10T14:00:00Z"));

    expect(deliveries).toEqual([{
      tokens: ["assignee-device-token"],
      reminderID: reminder.id,
    }]);
    expect(marked).toEqual([reminder.id]);
  });

  it("releases a failed delivery claim for a later retry", async () => {
    let marked = false;
    let released = false;
    const dispatcher = new ReminderNotificationDispatcher({
      repository: {
        claimDueReminderNotifications: async () => [{ reminder, occurrenceDue: reminder.dueAt }],
        deviceTokensForMembers: async () => ["device-token"],
        markReminderNotificationSent: async () => { marked = true; },
        releaseReminderNotificationClaim: async () => { released = true; },
      },
      pushNotificationProvider: {
        async send() { throw new Error("provider unavailable"); },
      },
    });

    await expect(dispatcher.dispatchDue(new Date("2026-09-10T14:00:00Z"))).rejects.toThrow();
    expect(marked).toBe(false);
    expect(released).toBe(true);
  });
});
