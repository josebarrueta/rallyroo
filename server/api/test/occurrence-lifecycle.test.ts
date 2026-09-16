import { describe, expect, it } from "vitest";
import type { Account, FamilyEvent, ScheduleOccurrenceState } from "../src/domain.js";
import {
  OccurrenceLifecycleModule,
  type OccurrenceLifecycleRepository,
} from "../src/occurrence-lifecycle.js";

const account: Account = {
  identitySubject: "parent-subject",
  familyID: "family-1",
  memberID: "parent-1",
  role: "parent",
};

const series: FamilyEvent = {
  id: "00000000-0000-4000-8000-000000000301",
  familyID: account.familyID,
  title: "Weekly practice",
  kidID: "kid-1",
  participantIDs: ["kid-1", "parent-1"],
  startTime: "2026-09-10T00:30:00.000Z",
  endTime: "2026-09-10T01:30:00.000Z",
  location: null,
  driver: null,
  driverMemberID: null,
  source: "manual",
  status: "confirmed",
  recurrenceSeriesID: "00000000-0000-4000-8000-000000000301",
  recurrence: {
    frequency: "weekly",
    interval: 1,
    weekdays: [3],
    timeZone: "America/Los_Angeles",
    endDate: "2026-09-24T00:30:00.000Z",
  },
};

class MemoryOccurrenceRepository implements OccurrenceLifecycleRepository {
  state: ScheduleOccurrenceState | null = null;

  async eventsForFamily(): Promise<FamilyEvent[]> { return [series]; }
  async remindersForFamily() { return []; }

  async setOccurrenceDisposition(
    familyID: string,
    reference: ScheduleOccurrenceState["reference"],
    disposition: ScheduleOccurrenceState["disposition"],
  ) {
    this.state = this.buildState(familyID, reference, { disposition });
    return this.state;
  }

  async acknowledgeOccurrence(
    familyID: string,
    reference: ScheduleOccurrenceState["reference"],
    memberID: string,
  ) {
    this.state = this.buildState(familyID, reference, {
      acknowledgedMemberIDs: [...new Set([
        ...(this.state?.acknowledgedMemberIDs ?? []), memberID,
      ])].sort(),
    });
    return this.state;
  }

  private buildState(
    familyID: string,
    reference: ScheduleOccurrenceState["reference"],
    changes: Partial<ScheduleOccurrenceState>,
  ): ScheduleOccurrenceState {
    return {
      familyID,
      reference,
      disposition: this.state?.disposition ?? "scheduled",
      acknowledgedMemberIDs: this.state?.acknowledgedMemberIDs ?? [],
      overrideEntityID: this.state?.overrideEntityID ?? null,
      completedAt: this.state?.completedAt ?? null,
      completedByMemberID: this.state?.completedByMemberID ?? null,
      ...changes,
    };
  }
}

describe("OccurrenceLifecycleModule", () => {
  it("lets a parent skip one Event occurrence without deleting its history", async () => {
    const lifecycle = new OccurrenceLifecycleModule(new MemoryOccurrenceRepository());
    const state = await lifecycle.skip(account, {
      kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
    });
    expect(state.disposition).toBe("skipped");
    expect(state.reference.scheduledAt).toBe("2026-09-17T00:30:00.000Z");
  });

  it("lets a parent delete an occurrence as a durable tombstone", async () => {
    const lifecycle = new OccurrenceLifecycleModule(new MemoryOccurrenceRepository());
    const state = await lifecycle.delete(account, {
      kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
     });
    expect(state.disposition).toBe("deleted");
    expect(state.reference.seriesID).toBe(series.id);
    expect(state.reference.scheduledAt).toBe("2026-09-17T00:30:00.000Z");
    });

  it("records a Member acknowledgement against a stable Event occurrence reference", async () => {
    const lifecycle = new OccurrenceLifecycleModule(new MemoryOccurrenceRepository());
    const state = await lifecycle.acknowledge(account, {
      kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
    });
    expect(state).toEqual({
      familyID: account.familyID,
      reference: {
        kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
      },
      disposition: "scheduled",
      acknowledgedMemberIDs: [account.memberID],
      overrideEntityID: null,
      completedAt: null,
      completedByMemberID: null,
    });
  });
});
