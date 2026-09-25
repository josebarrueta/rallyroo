import { describe, expect, it } from "vitest";
import type {
  Account,
  FamilyEvent,
  FamilyReminder,
  ScheduleOccurrenceState,
} from "../src/domain.js";
import {
  DayBriefModule,
  type DayBriefNarrator,
  type DayBriefPreferences,
  type DayBriefRecord,
  type DayBriefRepository,
} from "../src/day-brief.js";
import { InMemoryNotificationCenterRepository } from "../src/in-memory-notification-center-repository.js";
import { NotificationCenterModule } from "../src/notification-center.js";

const account: Account = {
  identitySubject: "parent-subject",
  familyID: "family",
  memberID: "parent",
  role: "parent",
};

function event(overrides: Partial<FamilyEvent> & Pick<FamilyEvent, "id" | "title" | "startTime" | "endTime">): FamilyEvent {
  return {
    familyID: "family",
    kidID: "kid",
    participantIDs: ["kid"],
    location: null,
    driver: null,
    driverMemberID: null,
    source: "manual",
    status: "confirmed",
    ...overrides,
  };
}

function reminder(overrides: Partial<FamilyReminder> & Pick<FamilyReminder, "id" | "title" | "dueAt">): FamilyReminder {
  return {
    familyID: "family",
    assigneeIDs: ["parent"],
    status: "open",
    completedAt: null,
    completedByMemberID: null,
    alertLeadTimeMinutes: null,
    createdByMemberID: "parent",
    ...overrides,
  };
}

function repository(overrides: {
  familyEvents?: FamilyEvent[];
  importedEvents?: FamilyEvent[];
  reminders?: FamilyReminder[];
  occurrenceStates?: ScheduleOccurrenceState[];
  preferences?: DayBriefPreferences[];
  saveDayBriefIfAbsent?: (record: DayBriefRecord) => Promise<boolean>;
  dayBrief?: (familyID: string, memberID: string, localDate: string) => Promise<DayBriefRecord | null>;
} = {}): DayBriefRepository {
  const familyEvents = overrides.familyEvents ?? [
    event({
      id: "drive",
      title: "School drop-off",
      startTime: "2026-10-05T08:00:00.000Z",
      endTime: "2026-10-05T09:00:00.000Z",
      location: "School",
      driverMemberID: "parent",
    }),
    event({
      id: "kid-only",
      title: "Kid club",
      startTime: "2026-10-05T09:00:00.000Z",
      endTime: "2026-10-05T10:00:00.000Z",
    }),
  ];
  const importedEvents = overrides.importedEvents ?? [event({
    id: "personal-dentist",
    title: "Dentist",
    kidID: null,
    participantIDs: [],
    startTime: "2026-10-05T10:00:00.000Z",
    endTime: "2026-10-05T11:00:00.000Z",
    location: "Clinic",
    source: "calendar",
    readOnly: true,
  })];
  const reminders = overrides.reminders ?? [
    reminder({ id: "form", title: "Submit school form", dueAt: "2026-10-05T18:00:00.000Z" }),
    reminder({
      id: "kid-reminder",
      title: "Kid task",
      dueAt: "2026-10-05T17:00:00.000Z",
      assigneeIDs: ["kid"],
    }),
  ];

  return {
    async eventsForFamily() { return familyEvents; },
    async importedEventsForMember() { return importedEvents; },
    async remindersForFamily() { return reminders; },
    async occurrenceStatesForFamily() { return overrides.occurrenceStates ?? []; },
    async enabledPreferences(limit, after?: Pick<DayBriefPreferences, "familyID" | "memberID">) {
      return (overrides.preferences ?? [])
        .filter((preference) => !after
          || preference.familyID > after.familyID
          || (preference.familyID === after.familyID && preference.memberID > after.memberID))
        .slice(0, limit);
    },
    async saveDayBriefIfAbsent(record) {
      return overrides.saveDayBriefIfAbsent?.(record) ?? true;
    },
    async dayBrief(familyID, memberID, localDate) {
      return overrides.dayBrief?.(familyID, memberID, localDate) ?? null;
    },
  };
}

describe("DayBriefModule.generate", () => {
  it("summarizes only the Member's personal commitments, driving duties, and assigned Reminders", async () => {
    const brief = await new DayBriefModule(repository()).generate(
      account,
      "2026-10-05",
      "UTC",
    );

    expect(brief.facts.events.map(({ title, roles }) => ({ title, roles }))).toEqual([
      { title: "School drop-off", roles: ["driver"] },
      { title: "Dentist", roles: ["personal_calendar"] },
    ]);
    expect(brief.facts.reminders.map(({ title }) => title)).toEqual(["Submit school form"]);
    expect(brief.title).toBe("Your Monday: 2 events, 1 reminder");
    expect(brief.body).toBe(
      "8:00 AM School drop-off (you drive); 10:00 AM Dentist. Reminder: Submit school form.",
    );
  });

  it("expands a recurring driving duty into the requested local day", async () => {
    const recurring = event({
      id: "weekly-drive",
      title: "Weekly practice",
      startTime: "2026-10-05T15:00:00.000Z",
      endTime: "2026-10-05T16:00:00.000Z",
      driverMemberID: "parent",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: [1],
        endDate: "2026-11-01T23:59:59.000Z",
        timeZone: "America/Los_Angeles",
      },
    });

    const brief = await new DayBriefModule(repository({
      familyEvents: [recurring],
      importedEvents: [],
      reminders: [],
    })).generate(account, "2026-10-12", "America/Los_Angeles");

    expect(brief.facts.events).toMatchObject([{
      id: "weekly-drive",
      scheduledAt: "2026-10-12T15:00:00.000Z",
      startTime: "2026-10-12T15:00:00.000Z",
      endTime: "2026-10-12T16:00:00.000Z",
      roles: ["driver"],
    }]);
    expect(brief.body).toBe("8:00 AM Weekly practice (you drive).");
  });

  it("uses an AI narrative only after constructing authorized facts", async () => {
    let receivedTitles: string[] = [];
    const narrator: DayBriefNarrator = {
      async narrate(input) {
        receivedTitles = input.facts.events.map((event) => event.title);
        return {
          title: "A driving-heavy Monday",
          body: "You drive to school at 8:00 AM, then have a dentist appointment at 10:00 AM.",
        };
      },
    };
    const module = new DayBriefModule(repository(), undefined, narrator);

    const brief = await module.generate(account, "2026-10-05", "UTC");

    expect(receivedTitles).toEqual(["School drop-off", "Dentist"]);
    expect(brief.title).toBe("A driving-heavy Monday");
    expect(brief.body).toBe(
      "You drive to school at 8:00 AM, then have a dentist appointment at 10:00 AM.",
    );
  });

  it("uses stable occurrence identity when a modified occurrence is later skipped", async () => {
    const override = event({
      id: "override-event",
      title: "Moved practice",
      startTime: "2026-10-12T17:00:00.000Z",
      endTime: "2026-10-12T18:00:00.000Z",
      driverMemberID: "parent",
      recurrenceSeriesID: "weekly-drive",
    });
    const brief = await new DayBriefModule(repository({
      familyEvents: [override],
      importedEvents: [],
      reminders: [],
      occurrenceStates: [{
        familyID: "family",
        reference: {
          kind: "event",
          seriesID: "weekly-drive",
          scheduledAt: "2026-10-12T15:00:00.000Z",
        },
        disposition: "skipped",
        acknowledgedMemberIDs: [],
        overrideEntityID: "override-event",
        completedAt: null,
        completedByMemberID: null,
      }],
    })).generate(account, "2026-10-12", "America/Los_Angeles");

    expect(brief.facts.events).toEqual([]);
  });

  it("does not recreate a skipped recurring Event occurrence in the brief", async () => {
    const recurring = event({
      id: "weekly-drive",
      title: "Weekly practice",
      startTime: "2026-10-05T15:00:00.000Z",
      endTime: "2026-10-05T16:00:00.000Z",
      driverMemberID: "parent",
      recurrenceSeriesID: "weekly-drive",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: [1],
        endDate: "2026-11-01T23:59:59.000Z",
        timeZone: "America/Los_Angeles",
      },
    });

    const brief = await new DayBriefModule(repository({
      familyEvents: [recurring],
      importedEvents: [],
      reminders: [],
      occurrenceStates: [{
        familyID: "family",
        reference: {
          kind: "event",
          seriesID: "weekly-drive",
          scheduledAt: "2026-10-12T15:00:00.000Z",
        },
        disposition: "skipped",
        acknowledgedMemberIDs: [],
        overrideEntityID: null,
        completedAt: null,
        completedByMemberID: null,
      }],
    })).generate(account, "2026-10-12", "America/Los_Angeles");

    expect(brief.facts.events).toEqual([]);
    expect(brief.body).toBe("No events scheduled.");
  });
});

describe("DayBriefModule.dispatchDue", () => {
  it("records one inbox brief and makes one push attempt under concurrent dispatch", async () => {
    let pushAttempts = 0;
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository(), {
      async send() { pushAttempts += 1; },
    });
    const module = new DayBriefModule(repository({
      familyEvents: [], importedEvents: [], reminders: [],
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60, holidayRegion: "US",
      }],
    }), notifications);

    await Promise.all([
      module.dispatchDue(new Date("2026-10-05T07:00:00.000Z")),
      module.dispatchDue(new Date("2026-10-05T07:00:00.000Z")),
    ]);
    expect(await notifications.list(account)).toHaveLength(1);
    await Promise.all([
      notifications.dispatchDue(new Date("2026-10-05T07:00:01.000Z")),
      notifications.dispatchDue(new Date("2026-10-05T07:00:01.000Z")),
    ]);
    expect(pushAttempts).toBe(1);
  });

  it("uses deterministic narration when the AI provider fails during delivery", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [], importedEvents: [], reminders: [],
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60, holidayRegion: "US",
      }],
    }), notifications, {
      async narrate() { throw new Error("AI unavailable"); },
    });

    expect(await module.dispatchDue(new Date("2026-10-05T07:00:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await notifications.list(account)).toMatchObject([{
      title: "Your Monday: 0 events, 0 reminders", body: "No events scheduled.",
    }]);
  });

  it("eventually delivers to a Member beyond the first bounded preference page", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [], importedEvents: [], reminders: [],
      preferences: ["member-a", "member-b", "member-c"].map((memberID) => ({
        familyID: "family", memberID, enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60, holidayRegion: "US",
      })),
    }), notifications);

    expect(await module.dispatchDue(new Date("2026-10-05T07:00:00.000Z"), 2))
      .toEqual({ evaluated: 2, recorded: 2, failed: 0 });
    expect(await module.dispatchDue(new Date("2026-10-05T07:01:00.000Z"), 2))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await notifications.list({ ...account, memberID: "member-c" })).toHaveLength(1);
  });

  it("retries inbox delivery for a saved brief without re-reading the Family schedule", async () => {
    const preferences: DayBriefPreferences = {
      familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
      weekdayTime: "07:00", weekendHolidayTime: "08:30",
      earlyEventLeadMinutes: 60, holidayRegion: "US",
    };
    const saved: DayBriefRecord = {
      familyID: "family", memberID: "parent", localDate: "2026-10-05",
      timeZone: "UTC", facts: { events: [], reminders: [] },
      title: "Saved brief", body: "No events scheduled.", generatedAt: "2026-10-05T07:00:00.000Z",
    };
    const store = {
      ...repository({ preferences: [preferences], dayBrief: async () => saved }),
      async eventsForFamily(): Promise<FamilyEvent[]> {
        throw new Error("saved brief does not need a schedule re-read");
      },
    };
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(store, notifications);

    expect(await module.dispatchDue(new Date("2026-10-05T07:01:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await notifications.list(account)).toMatchObject([{ title: "Saved brief" }]);
  });

  it("does not read the Family schedule after the morning delivery window closes", async () => {
    const preferences: DayBriefPreferences = {
      familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
      weekdayTime: "07:00", weekendHolidayTime: "08:30",
      earlyEventLeadMinutes: 60, holidayRegion: "US",
    };
    const store = {
      ...repository({ preferences: [preferences] }),
      async eventsForFamily(): Promise<FamilyEvent[]> {
        throw new Error("schedule should not be read for a missed brief");
      },
    };
    const module = new DayBriefModule(store, new NotificationCenterModule(
      new InMemoryNotificationCenterRepository(),
    ));

    expect(await module.dispatchDue(new Date("2026-10-05T22:44:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
  });

  it("stops catch-up after thirty local minutes", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [], importedEvents: [], reminders: [],
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60, holidayRegion: "US",
      }],
    }), notifications);

    expect(await module.dispatchDue(new Date("2026-10-05T07:30:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await module.dispatchDue(new Date("2026-10-05T07:31:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(await notifications.list(account)).toHaveLength(1);
  });

  it("catches up a newly enabled brief within its morning window", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [], importedEvents: [], reminders: [],
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60, holidayRegion: "US",
      }],
    }), notifications);

    expect(await module.dispatchDue(new Date("2026-10-05T07:17:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await notifications.list(account)).toHaveLength(1);
  });

  it("does not send a missed morning brief late at night", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [], importedEvents: [], reminders: [],
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60, holidayRegion: "US",
      }],
    }), notifications);

    expect(await module.dispatchDue(new Date("2026-10-05T22:44:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(await notifications.list(account)).toEqual([]);
    expect(await module.dispatchDue(new Date("2026-10-06T07:00:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
  });

  it("records one private weekday brief at the Member's configured local time", async () => {
    const saved = new Set<string>();
    const inbox = new InMemoryNotificationCenterRepository();
    const notifications = new NotificationCenterModule(inbox);
    const preferences: DayBriefPreferences = {
      familyID: "family",
      memberID: "parent",
      enabled: true,
      timeZone: "UTC",
      weekdayTime: "07:00",
      weekendHolidayTime: "08:30",
      earlyEventLeadMinutes: 60,
      holidayRegion: "US",
    };
    const module = new DayBriefModule(repository({
      familyEvents: [],
      importedEvents: [],
      reminders: [],
      preferences: [preferences],
      saveDayBriefIfAbsent: async (record) => {
        const key = `${record.familyID}:${record.memberID}:${record.localDate}`;
        if (saved.has(key)) return false;
        saved.add(key);
        return true;
      },
    }), notifications);

    expect(await module.dispatchDue(new Date("2026-10-05T07:00:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await notifications.list(account)).toMatchObject([{
      kind: "day_brief",
      title: "Your Monday: 0 events, 0 reminders",
      body: "No events scheduled.",
      destination: { kind: "day_brief", id: "2026-10-05" },
    }]);

    expect(await module.dispatchDue(new Date("2026-10-05T07:01:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await notifications.list(account)).toHaveLength(1);
  });

  it("does not deliver after a previously verified leave time if routing later fails", async () => {
    const stored: DayBriefRecord = {
      familyID: "family", memberID: "parent", localDate: "2026-10-05",
      timeZone: "UTC", title: "Saved", body: "School drive.",
      generatedAt: "2026-10-05T05:20:00.000Z",
      verifiedLeaveTime: "2026-10-05T06:20:00.000Z",
      facts: { events: [{
        id: "school-drive", title: "School drive", scheduledAt: "2026-10-05T08:00:00.000Z",
        startTime: "2026-10-05T08:00:00.000Z", endTime: "2026-10-05T09:00:00.000Z",
        location: "School", roles: ["driver"],
      }], reminders: [] },
    };
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60, holidayRegion: "US",
      }],
      dayBrief: async () => stored,
    }), notifications, undefined, {
      async earliestVerifiedLeaveTime() { throw new Error("route unavailable"); },
    });

    expect(await module.dispatchDue(new Date("2026-10-05T07:00:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(await notifications.list(account)).toEqual([]);
  });

  it("schedules ahead of the earliest verified Travel plan leave time", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [event({
        id: "school-drive", title: "School drive", driverMemberID: "parent",
        startTime: "2026-10-05T08:00:00.000Z", endTime: "2026-10-05T09:00:00.000Z",
        location: "School", arrivalTime: "2026-10-05T07:50:00.000Z",
      })],
      importedEvents: [], reminders: [],
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60, holidayRegion: "US",
      }],
    }), notifications, undefined, {
      async earliestVerifiedLeaveTime() { return new Date("2026-10-05T06:20:00.000Z"); },
    });

    expect(await module.dispatchDue(new Date("2026-10-05T05:19:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(await module.dispatchDue(new Date("2026-10-05T05:20:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await notifications.list(account)).toHaveLength(1);
  });

  it("does not send a brief after its first actionable commitment begins", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [event({
        id: "early-drive", title: "Early drive",
        startTime: "2026-10-05T07:05:00.000Z", endTime: "2026-10-05T07:35:00.000Z",
        driverMemberID: "parent",
      })],
      importedEvents: [], reminders: [],
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true, timeZone: "UTC",
        weekdayTime: "07:00", weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 0, holidayRegion: "US",
      }],
    }), notifications);

    expect(await module.dispatchDue(new Date("2026-10-05T07:04:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await module.dispatchDue(new Date("2026-10-05T07:05:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(await notifications.list(account)).toHaveLength(1);
  });

  it("delivers sixty minutes before an Event that begins before the weekday baseline", async () => {
    const inbox = new InMemoryNotificationCenterRepository();
    const notifications = new NotificationCenterModule(inbox);
    const earlyEvent = event({
      id: "early-drive",
      title: "Early practice",
      startTime: "2026-10-05T06:30:00.000Z",
      endTime: "2026-10-05T07:30:00.000Z",
      driverMemberID: "parent",
    });
    let narrationCount = 0;
    const narrator: DayBriefNarrator = {
      async narrate(input) {
        narrationCount += 1;
        return { title: input.deterministicTitle, body: input.deterministicBody };
      },
    };
    const module = new DayBriefModule(repository({
      familyEvents: [earlyEvent],
      importedEvents: [],
      reminders: [],
      preferences: [{
        familyID: "family",
        memberID: "parent",
        enabled: true,
        timeZone: "UTC",
        weekdayTime: "07:00",
        weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60,
        holidayRegion: "US",
      }],
    }), notifications, narrator);

    expect(await module.dispatchDue(new Date("2026-10-05T05:29:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(narrationCount).toBe(0);
    expect(await module.dispatchDue(new Date("2026-10-05T05:30:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(narrationCount).toBe(1);
    expect(await notifications.list(account)).toMatchObject([{
      body: "6:30 AM Early practice (you drive).",
    }]);
  });

  it("uses the Member's local clock across the daylight-saving transition", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [], importedEvents: [], reminders: [],
      preferences: [{
        familyID: "family", memberID: "parent", enabled: true,
        timeZone: "America/Los_Angeles", weekdayTime: "07:00",
        weekendHolidayTime: "08:30", earlyEventLeadMinutes: 60, holidayRegion: "US",
      }],
    }), notifications);

    // After the fall-back Sunday, 08:30 local is 16:30 UTC (PST).
    expect(await module.dispatchDue(new Date("2026-11-01T16:29:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(await module.dispatchDue(new Date("2026-11-01T16:30:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    // The spring-forward Sunday is on PDT; 08:30 local is 15:30 UTC.
    expect(await module.dispatchDue(new Date("2027-03-14T15:29:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(await module.dispatchDue(new Date("2027-03-14T15:30:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
    expect(await module.dispatchDue(new Date("2027-03-14T16:01:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    const inbox = await notifications.list(account);
    expect(inbox).toHaveLength(2);
    expect(inbox.map((item) => item.destination)).toContainEqual({
      kind: "day_brief", id: "2027-03-14",
    });
  });

  it("uses the weekend time on a configured public holiday", async () => {
    const notifications = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const module = new DayBriefModule(repository({
      familyEvents: [],
      importedEvents: [],
      reminders: [],
      preferences: [{
        familyID: "family",
        memberID: "parent",
        enabled: true,
        timeZone: "America/Los_Angeles",
        weekdayTime: "07:00",
        weekendHolidayTime: "08:30",
        earlyEventLeadMinutes: 60,
        holidayRegion: "US",
      }],
    }), notifications);

    expect(await module.dispatchDue(new Date("2026-11-26T15:00:00.000Z")))
      .toEqual({ evaluated: 0, recorded: 0, failed: 0 });
    expect(await module.dispatchDue(new Date("2026-11-26T16:30:00.000Z")))
      .toEqual({ evaluated: 1, recorded: 1, failed: 0 });
  });
});
