import { describe, expect, it } from "vitest";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";
import { ReminderNotificationDispatcher } from "../src/reminder-notification-dispatcher.js";
import type { FamilyReminder } from "../src/domain.js";

describe("recurring reminder notifications", () => {
  it("delivers each weekly occurrence instead of only the series anchor", async () => {
    const reminder: FamilyReminder = {
      id: "abcdefab-cdef-4abc-8def-abcdefabc201",
      familyID: "family-1",
      title: "Take out the trash",
      assigneeIDs: ["parent-1"],
      // 6:45 PM Tuesday in Los Angeles is 1:45 AM Wednesday UTC. Legacy
      // weekly series did not persist a time zone, so the anchor instant must
      // still define the first selected local weekday.
      dueAt: "2026-09-30T01:45:00Z",
      status: "open",
      completedAt: null,
      completedByMemberID: null,
      alertLeadTimeMinutes: 0,
      createdByMemberID: "parent-1",
      recurrenceFrequency: "weekly",
      recurrenceInterval: 1,
      recurrenceWeekdays: [2],
      recurrenceEndDate: null,
      recurrenceTimeZone: null,
      recurrenceSeriesID: "abcdefab-cdef-4abc-8def-abcdefabc201",
    };
    const repository = new InMemoryRallyrooRepository({ reminders: [reminder] });
    await repository.saveDeviceToken("family-1", "parent-1", "parent-device");
    const deliveries: string[] = [];
    const dispatcher = new ReminderNotificationDispatcher({
      repository,
      pushNotificationProvider: {
        async send(_tokens, payload) {
          deliveries.push(payload.data?.occurrenceDue ?? "missing");
        },
      },
    });

    await dispatcher.dispatchDue(new Date("2026-09-30T01:45:00Z"));
    await dispatcher.dispatchDue(new Date("2026-10-07T01:45:00Z"));

    expect(deliveries).toEqual([
      "2026-09-30T01:45:00.000Z",
      "2026-10-07T01:45:00.000Z",
    ]);
  });
});
