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

describe("single recurring occurrence edits", () => {
  it("accepts a location-only edit when a legacy weekly series has noncanonical weekday order", async () => {
    const persistence = new InMemoryRallyrooRepository({
      accounts: [account],
      members: [{
        id: account.memberID,
        familyID: account.familyID,
        name: "Alex",
        role: "parent",
        colorTag: "blue",
      }],
    });
    const module = new EventMutationModule({ persistence, importedEvents });
    const seriesID = "10000000-0000-4000-8000-000000000001";
    const legacyRecurrence = {
      frequency: "weekly" as const,
      interval: 1,
      weekdays: [4, 2] as Array<2 | 4>,
      endDate: "2026-12-31T16:00:00.000Z",
    };
    const canonicalRecurrence = { ...legacyRecurrence, weekdays: [2, 4] as Array<2 | 4> };
    const source: FamilyEvent = {
      id: seriesID,
      familyID: account.familyID,
      title: "Practice",
      kidID: null,
      participantIDs: [account.memberID],
      startTime: "2026-09-08T16:00:00.000Z",
      endTime: "2026-09-08T17:00:00.000Z",
      location: "Old field",
      driver: null,
      source: "manual",
      status: "confirmed",
      recurrenceSeriesID: seriesID,
      recurrence: legacyRecurrence,
    };
    await persistence.saveEvent(source);

    const occurrenceStart = new Date("2026-09-15T16:00:00.000Z");
    const overrideID = "20000000-0000-4000-8000-000000000001";
    const continuationID = "20000000-0000-4000-8000-000000000002";
    const edited: FamilyEvent = {
      ...source,
      location: "New field",
      startTime: occurrenceStart.toISOString(),
      endTime: "2026-09-15T17:00:00.000Z",
      recurrence: canonicalRecurrence,
    };

    await expect(module.recurringEdit({
      account,
      sourceEventID: seriesID,
      edited,
      scope: "thisOccurrence",
      occurrenceStart,
      upserts: [
        {
          ...source,
          recurrence: {
            ...canonicalRecurrence,
            endDate: "2026-09-15T15:59:59.999Z",
          },
        },
        { ...edited, id: overrideID, recurrence: null },
        {
          ...source,
          id: continuationID,
          startTime: "2026-09-17T16:00:00.000Z",
          endTime: "2026-09-17T17:00:00.000Z",
          recurrence: canonicalRecurrence,
        },
      ],
      deleteIDs: [],
      affectedEventIDs: [overrideID],
      affectedSourceEventIDs: [seriesID],
      baseSeriesEvents: [{
        ...source,
        recurrence: canonicalRecurrence,
      }],
      idempotencyKey: "location-edit",
      notifyParticipants: false,
    })).resolves.toEqual({ conflicts: [], notificationOutcome: "notRequested" });

    expect((await persistence.eventsForFamily(account.familyID)).find((event) =>
      event.id === overrideID
    )?.location).toBe("New field");
  });
});
