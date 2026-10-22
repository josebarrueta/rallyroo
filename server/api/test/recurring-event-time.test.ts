import { describe, expect, it } from "vitest";
import type { Account, FamilyEvent } from "../src/domain.js";
import { EventMutationModule } from "../src/event-mutation.js";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";

const account: Account = {
  identitySubject: "parent-subject",
  familyID: "family-1",
  memberID: "parent-1",
  role: "parent",
};

const importedEvents = {
  async visibleEvents() { return []; },
  async sharedEvents() { return []; },
};

const recurrence = {
  frequency: "weekly" as const,
  interval: 1,
  weekdays: [4] as [4],
  timeZone: "America/Los_Angeles",
  endDate: "2026-10-30T02:00:00.000Z",
};

const source: FamilyEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  familyID: account.familyID,
  title: "Thursday practice",
  kidID: null,
  participantIDs: [account.memberID],
  startTime: "2026-10-16T02:00:00.000Z",
  endTime: "2026-10-16T04:30:00.000Z",
  location: "Old field",
  driver: null,
  source: "manual",
  status: "confirmed",
  recurrenceSeriesID: "10000000-0000-4000-8000-000000000001",
  recurrence,
};

const occurrenceStart = new Date("2026-10-23T02:00:00.000Z");
const edited: FamilyEvent = {
  ...source,
  startTime: "2026-10-23T01:30:00.000Z",
  endTime: "2026-10-23T04:00:00.000Z",
  location: "San Mateo High School",
};

function repository() {
  return new InMemoryRallyrooRepository({
    accounts: [account],
    members: [{
      id: account.memberID,
      familyID: account.familyID,
      name: "Alex",
      role: "parent",
      colorTag: "blue",
    }],
  });
}

describe("recurring occurrence start-time edits", () => {
  it("accepts moving only this occurrence earlier on its scheduled local day", async () => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });
    await persistence.saveEvent(source);
    const overrideID = "20000000-0000-4000-8000-000000000001";

    await expect(module.recurringEdit({
      account,
      sourceEventID: source.id,
      edited,
      scope: "thisOccurrence",
      occurrenceStart,
      upserts: [
        {
          ...source,
          recurrence: { ...recurrence, endDate: "2026-10-23T01:59:59.999Z" },
        },
        { ...edited, id: overrideID, recurrence: null },
        {
          ...source,
          id: "20000000-0000-4000-8000-000000000002",
          startTime: "2026-10-30T02:00:00.000Z",
          endTime: "2026-10-30T04:30:00.000Z",
        },
      ],
      deleteIDs: [],
      affectedEventIDs: [overrideID],
      affectedSourceEventIDs: [source.id],
      baseSeriesEvents: [source],
      idempotencyKey: "earlier-this-occurrence",
      notifyParticipants: false,
    })).resolves.toEqual({ conflicts: [], notificationOutcome: "notRequested" });

    expect((await persistence.eventsForFamily(account.familyID)).find(({ id }) =>
      id === overrideID
    )).toMatchObject({
      startTime: edited.startTime,
      endTime: edited.endTime,
      location: edited.location,
    });
  });

  it("still rejects moving an affected occurrence onto an earlier local date", async () => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });
    await persistence.saveEvent(source);
    const overrideID = "20000000-0000-4000-8000-000000000005";
    const previousDayEdit: FamilyEvent = {
      ...edited,
      startTime: "2026-10-22T01:30:00.000Z",
      endTime: "2026-10-22T04:00:00.000Z",
    };

    await expect(module.recurringEdit({
      account,
      sourceEventID: source.id,
      edited: previousDayEdit,
      scope: "thisOccurrence",
      occurrenceStart,
      upserts: [
        {
          ...source,
          recurrence: { ...recurrence, endDate: "2026-10-23T01:59:59.999Z" },
        },
        { ...previousDayEdit, id: overrideID, recurrence: null },
      ],
      deleteIDs: [],
      affectedEventIDs: [overrideID],
      affectedSourceEventIDs: [source.id],
      baseSeriesEvents: [source],
      idempotencyKey: "previous-local-date",
      notifyParticipants: false,
    })).rejects.toMatchObject({ code: "invalid_recurring_edit", statusCode: 409 });
  });

  it.each([
    ["thisWeekdayAndFuture", "earlier-weekday-future"],
    ["allFuture", "earlier-all-future"],
  ] as const)("accepts moving %s occurrences earlier on the selected local day", async (scope, idempotencyKey) => {
    const persistence = repository();
    const module = new EventMutationModule({ persistence, importedEvents });
    await persistence.saveEvent(source);
    const futureID = scope === "thisWeekdayAndFuture"
      ? "20000000-0000-4000-8000-000000000003"
      : "20000000-0000-4000-8000-000000000004";

    await expect(module.recurringEdit({
      account,
      sourceEventID: source.id,
      edited,
      scope,
      occurrenceStart,
      upserts: [
        {
          ...source,
          recurrence: { ...recurrence, endDate: "2026-10-23T01:59:59.999Z" },
        },
        { ...edited, id: futureID },
      ],
      deleteIDs: [],
      affectedEventIDs: [futureID],
      affectedSourceEventIDs: [source.id],
      baseSeriesEvents: [source],
      idempotencyKey,
      notifyParticipants: false,
    })).resolves.toEqual({ conflicts: [], notificationOutcome: "notRequested" });

    expect((await persistence.eventsForFamily(account.familyID)).find(({ id }) =>
      id === futureID
    )).toMatchObject({
      startTime: edited.startTime,
      endTime: edited.endTime,
      location: edited.location,
      recurrence,
    });
  });
});
