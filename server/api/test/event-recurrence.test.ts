import { describe, expect, it } from "vitest";
import type { FamilyEvent } from "../src/domain.js";
import { eventOccurrenceStarts } from "../src/event-recurrence.js";

const baseEvent: FamilyEvent = {
  id: "00000000-0000-4000-8000-000000000201",
  familyID: "family-1",
  title: "Recurring activity",
  kidID: "kid-1",
  participantIDs: ["kid-1"],
  startTime: "2026-09-10T00:30:00.000Z",
  endTime: "2026-09-10T01:30:00.000Z",
  location: null,
  driver: null,
  driverMemberID: null,
  source: "manual",
  status: "confirmed",
  alertLeadTimeMinutes: 0,
};

describe("eventOccurrenceStarts", () => {
  it("expands selected weekdays in the recurrence's local time zone", () => {
    const event: FamilyEvent = {
      ...baseEvent,
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: [3],
        timeZone: "America/Los_Angeles",
        endDate: "2026-09-24T00:30:00.000Z",
      },
    };

    expect(eventOccurrenceStarts(event, new Date(event.recurrence!.endDate)).map(String))
      .toEqual([
        String(new Date("2026-09-10T00:30:00.000Z")),
        String(new Date("2026-09-17T00:30:00.000Z")),
        String(new Date("2026-09-24T00:30:00.000Z")),
      ]);
  });

  it("preserves local wall-clock time across daylight-saving transitions", () => {
    const event: FamilyEvent = {
      ...baseEvent,
      startTime: "2026-10-31T00:30:00.000Z", // 5:30 PM PDT.
      endTime: "2026-10-31T01:30:00.000Z",
      recurrence: {
        frequency: "daily",
        interval: 1,
        timeZone: "America/Los_Angeles",
        endDate: "2026-11-03T01:30:00.000Z",
      },
    };

    expect(eventOccurrenceStarts(event, new Date(event.recurrence!.endDate)).map((date) => date.toISOString()))
      .toEqual([
        "2026-10-31T00:30:00.000Z",
        "2026-11-01T00:30:00.000Z",
        "2026-11-02T01:30:00.000Z",
        "2026-11-03T01:30:00.000Z",
      ]);
  });
});
