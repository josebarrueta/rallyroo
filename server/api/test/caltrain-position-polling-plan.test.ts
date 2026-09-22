import { describe, expect, it } from "vitest";
import { caltrainPositionPollingPlan } from "../src/caltrain-position-polling-plan.js";

const now = new Date("2026-09-21T17:00:00Z");

describe("caltrainPositionPollingPlan", () => {
  it("polls after thirty idle minutes during service hours", () => {
    expect(caltrainPositionPollingPlan(
      now,
      false,
      new Date("2026-09-21T16:29:00Z"),
    )).toEqual({ pollPositions: true, nextDelayMilliseconds: 5 * 60 * 1_000 });
  });

  it("does not poll every scheduler tick without viewer demand", () => {
    expect(caltrainPositionPollingPlan(
      now,
      false,
      new Date("2026-09-21T16:50:00Z"),
    ).pollPositions).toBe(false);
  });

  it("polls after five minutes while someone is viewing live trains", () => {
    expect(caltrainPositionPollingPlan(
      now,
      true,
      new Date("2026-09-21T16:54:00Z"),
    ).pollPositions).toBe(true);
  });

  it("does not call the provider during the overnight service gap", () => {
    expect(caltrainPositionPollingPlan(
      new Date("2026-09-21T10:00:00Z"),
      true,
      null,
    ).pollPositions).toBe(false);
    expect(caltrainPositionPollingPlan(
      new Date("2026-09-21T08:30:00Z"),
      true,
      null,
    ).pollPositions).toBe(false);
  });

  it("resumes polling when the service gap ends", () => {
    expect(caltrainPositionPollingPlan(
      new Date("2026-09-21T11:30:00Z"),
      false,
      null,
    ).pollPositions).toBe(true);
  });

  it("continues polling shortly after midnight while late trains may be running", () => {
    expect(caltrainPositionPollingPlan(
      new Date("2026-09-21T08:00:00Z"),
      false,
      null,
    ).pollPositions).toBe(true);
  });
});
