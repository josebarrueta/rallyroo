import { describe, expect, it } from "vitest";
import type { FamilyReminder } from "../src/domain.js";
import { reminderOccurrenceDueDates } from "../src/reminder-recurrence.js";

function series(overrides: Partial<FamilyReminder>): FamilyReminder {
  return {
    id: "abcdefab-cdef-4abc-8def-abcdefabc201",
    familyID: "family-1",
    title: "Reminder",
    assigneeIDs: ["parent-1"],
    dueAt: "2026-10-28T01:45:00Z",
    status: "open",
    completedAt: null,
    completedByMemberID: null,
    alertLeadTimeMinutes: 0,
    createdByMemberID: "parent-1",
    recurrenceFrequency: "weekly",
    recurrenceInterval: 1,
    recurrenceWeekdays: [2],
    recurrenceEndDate: null,
    recurrenceTimeZone: "America/Los_Angeles",
    recurrenceSeriesID: "abcdefab-cdef-4abc-8def-abcdefabc201",
    ...overrides,
  };
}

describe("Reminder recurrence expansion for notification delivery", () => {
  it("keeps a weekly local due time across daylight saving changes", () => {
    const dates = reminderOccurrenceDueDates(
      series({}),
      new Date("2026-11-05T00:00:00Z"),
    );

    expect(dates.map((date) => date.toISOString())).toEqual([
      "2026-10-28T01:45:00.000Z",
      "2026-11-04T02:45:00.000Z",
    ]);
  });

  it("uses the last valid month day without drifting from the anchor", () => {
    const dates = reminderOccurrenceDueDates(series({
      dueAt: "2027-01-31T17:00:00Z",
      recurrenceFrequency: "monthly",
      recurrenceWeekdays: [],
    }), new Date("2027-04-01T00:00:00Z"));

    expect(dates.map((date) => date.toISOString())).toEqual([
      "2027-01-31T17:00:00.000Z",
      "2027-02-28T17:00:00.000Z",
      "2027-03-31T16:00:00.000Z",
    ]);
  });

  it("returns a leap-day yearly series to February 29 when available", () => {
    const dates = reminderOccurrenceDueDates(series({
      dueAt: "2028-02-29T17:00:00Z",
      recurrenceFrequency: "yearly",
      recurrenceWeekdays: [],
    }), new Date("2032-03-01T00:00:00Z"));

    expect(dates.map((date) => date.toISOString())).toEqual([
      "2028-02-29T17:00:00.000Z",
      "2029-02-28T17:00:00.000Z",
      "2030-02-28T17:00:00.000Z",
      "2031-02-28T17:00:00.000Z",
      "2032-02-29T17:00:00.000Z",
    ]);
  });
});
