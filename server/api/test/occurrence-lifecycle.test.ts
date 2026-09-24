import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, FamilyEvent, ScheduleOccurrenceState } from "../src/domain.js";
import {
  OccurrenceLifecycleError,
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
  states: ScheduleOccurrenceState[] = [];

  async eventsForFamily(): Promise<FamilyEvent[]> { return [series]; }
  async remindersForFamily() { return []; }
  async occurrenceStatesForFamily(): Promise<ScheduleOccurrenceState[]> { return this.states; }

  async setOccurrenceDisposition(
    familyID: string,
    reference: ScheduleOccurrenceState["reference"],
    disposition: ScheduleOccurrenceState["disposition"],
    ): Promise<ScheduleOccurrenceState> {
      const state: ScheduleOccurrenceState = {
          familyID,
          reference,
          disposition,
          acknowledgedMemberIDs: [],
          overrideEntityID: null,
          completedAt: null,
          completedByMemberID: null,
          };
      this.states.push(state);
      return state;
      }

  async acknowledgeOccurrence(
    familyID: string,
    reference: ScheduleOccurrenceState["reference"],
    memberID: string,
    ): Promise<ScheduleOccurrenceState> {
      const existing = this.states.find(
          (s) => s.reference.seriesID === reference.seriesID && s.reference.scheduledAt === reference.scheduledAt,
          );
      const acknowledgedMemberIDs = existing
          ? [...new Set([...existing.acknowledgedMemberIDs, memberID])].sort()
          : [memberID];
      const state: ScheduleOccurrenceState = {
          familyID,
          reference,
          disposition: existing?.disposition ?? "scheduled",
          acknowledgedMemberIDs,
          overrideEntityID: existing?.overrideEntityID ?? null,
          completedAt: existing?.completedAt ?? null,
          completedByMemberID: existing?.completedByMemberID ?? null,
          };
      const idx = this.states.findIndex(
          (s) => s.reference.seriesID === reference.seriesID && s.reference.scheduledAt === reference.scheduledAt,
          );
      if (idx >= 0) this.states[idx] = state; else this.states.push(state);
      return state;
      }
}

describe("OccurrenceLifecycleModule", () => {
  // The future-scope fixtures are dated September 2026, so pin the clock
  // before their last occurrence instead of depending on the CI run date.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T00:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("lets a parent skip one Event occurrence without deleting its history", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    const results = await lifecycle.skip(account, {
      kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
      }, "this_occurrence");
    expect(results).toHaveLength(1);
    expect(results[0]!.disposition).toBe("skipped");
    expect(results[0]!.reference.scheduledAt).toBe("2026-09-17T00:30:00.000Z");
  });

  it("does not restore a deleted occurrence", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    const reference = {
      kind: "event" as const,
      seriesID: series.id,
      scheduledAt: "2026-09-17T00:30:00.000Z",
    };
    await lifecycle.delete(account, reference, "this_occurrence");

    await expect(lifecycle.restore(account, reference, "this_occurrence")).rejects.toEqual(
      new OccurrenceLifecycleError("occurrence_not_skipped", 409),
    );
  });

  it("lets a parent restore a skipped occurrence to scheduled", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    const reference = {
      kind: "event" as const,
      seriesID: series.id,
      scheduledAt: "2026-09-17T00:30:00.000Z",
    };
    await lifecycle.skip(account, reference, "this_occurrence");

    const results = await lifecycle.restore(account, reference, "this_occurrence");

    expect(results).toHaveLength(1);
    expect(results[0]!.disposition).toBe("scheduled");
  });

  it("lets a parent delete an occurrence as a durable tombstone", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    const results = await lifecycle.delete(account, {
      kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
      }, "this_occurrence");
    expect(results).toHaveLength(1);
    expect(results[0]!.disposition).toBe("deleted");
    expect(results[0]!.reference.seriesID).toBe(series.id);
    expect(results[0]!.reference.scheduledAt).toBe("2026-09-17T00:30:00.000Z");
    });

  it("skips all future occurrences when scope is all_future", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    const results = await lifecycle.skip(account, {
      kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
      }, "all_future");
     // All future occurrences (2026-09-24 only, since 09-17 and 09-10 are in the past relative to 09-17)
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.disposition === "skipped")).toBe(true);
    expect(results.some((r) => r.reference.scheduledAt >= "2026-09-17T00:30:00.000Z")).toBe(true);
    expect(results.some((r) => r.reference.scheduledAt <= "2026-09-10T00:30:00.000Z")).toBe(false);
     });

  it("skips this weekday and future when scope is this_weekday_future", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    const results = await lifecycle.skip(account, {
      kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
      }, "this_weekday_future");
     // Should skip 09-17 and 09-24 (both Wednesdays)
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.disposition === "skipped")).toBe(true);
    expect(results.every((r) => r.reference.scheduledAt >= "2026-09-17T00:30:00.000Z")).toBe(true);
     });

  it("lets a non-parent skip an Event occurrence", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    const child: Account = { ...account, role: "kid", memberID: "kid-1" };
    await expect(lifecycle.skip(child, {
      kind: "event", seriesID: series.id, scheduledAt: "2026-09-17T00:30:00.000Z",
      })).rejects.toThrow("parent_required");
    });

  it("throws for unknown occurrence reference", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    await expect(lifecycle.skip(account, {
      kind: "event",
      seriesID: "00000000-0000-4000-8000-000000000999",
      scheduledAt: "2026-09-17T00:30:00.000Z",
      })).rejects.toThrow("occurrence_not_found");
    });

  it("records a Member acknowledgement against a stable Event occurrence reference", async () => {
    const repo = new MemoryOccurrenceRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
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

describe("OccurrenceLifecycleModule - Reminders", () => {
  const reminderSeriesID = "00000000-0000-4000-8000-000000000401";
  const reminder = {
    id: reminderSeriesID,
    familyID: "family-1",
    title: "Water the plants",
    assigneeIDs: ["parent-1"],
    dueAt: "2026-09-15T09:00:00.000Z",
    status: "open" as const,
    completedAt: null,
    completedByMemberID: null,
    alertLeadTimeMinutes: null,
    createdByMemberID: "parent-1",
    recurrenceSeriesID: reminderSeriesID,
   };

  class MemoryReminderRepository implements OccurrenceLifecycleRepository {
    async eventsForFamily() { return []; }
    async remindersForFamily() { return [reminder]; }
    async occurrenceStatesForFamily(): Promise<ScheduleOccurrenceState[]> { return []; }

    async setOccurrenceDisposition(
      familyID: string,
      reference: import("../src/domain.js").ScheduleOccurrenceState["reference"],
      disposition: import("../src/domain.js").ScheduleOccurrenceState["disposition"],
      ): Promise<import("../src/domain.js").ScheduleOccurrenceState> {
        return {
          familyID,
          reference,
          disposition,
          acknowledgedMemberIDs: [],
          overrideEntityID: null,
          completedAt: null,
          completedByMemberID: null,
            };
          }

    async acknowledgeOccurrence(
      familyID: string,
      reference: import("../src/domain.js").ScheduleOccurrenceState["reference"],
      memberID: string,
      ): Promise<import("../src/domain.js").ScheduleOccurrenceState> {
        return {
          familyID,
          reference,
          disposition: "scheduled",
          acknowledgedMemberIDs: [memberID],
          overrideEntityID: null,
          completedAt: null,
          completedByMemberID: null,
            };
          }
  }

  it("lets a parent acknowledge a Reminder occurrence", async () => {
    const repo = new MemoryReminderRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    const state = await lifecycle.acknowledge(account, {
      kind: "reminder", seriesID: reminderSeriesID, scheduledAt: "2026-09-15T09:00:00.000Z",
       });
    expect(state.acknowledgedMemberIDs).toContain(account.memberID);
    expect(state.disposition).toBe("scheduled");
     });

  it("rejects an unknown Reminder occurrence", async () => {
    const repo = new MemoryReminderRepository();
    const lifecycle = new OccurrenceLifecycleModule(repo);
    await expect(lifecycle.acknowledge(account, {
      kind: "reminder",
      seriesID: "00000000-0000-4000-8000-000000000998",
      scheduledAt: "2026-09-15T09:00:00.000Z",
       })).rejects.toThrow("occurrence_not_found");
     });
});
