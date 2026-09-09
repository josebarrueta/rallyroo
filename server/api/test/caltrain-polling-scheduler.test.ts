import { describe, expect, it, vi } from "vitest";
import { CaltrainPollingScheduler } from "../src/caltrain-polling-scheduler.js";
import { SF511ProviderError } from "../src/sf511-client.js";

const now = () => new Date("2026-09-09T20:00:00Z");

describe("CaltrainPollingScheduler", () => {
  it("waits two minutes between successful shared poll cycles", async () => {
    const abort = new AbortController();
    const delays: number[] = [];
    const poll = vi.fn(async () => undefined);
    const scheduler = new CaltrainPollingScheduler({
      poll,
      intervalMilliseconds: 120_000,
      maximumBackoffMilliseconds: 3_600_000,
      now,
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        if (delays.length === 3) abort.abort();
      },
    });

    await scheduler.run(abort.signal);

    expect(poll).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([120_000, 120_000, 120_000]);
  });

  it("honors provider throttling and resets cadence after a successful retry", async () => {
    const abort = new AbortController();
    const delays: number[] = [];
    const poll = vi.fn()
      .mockRejectedValueOnce(new Error("Caltrain real-time refresh failed", {
        cause: new SF511ProviderError("http_error", 429, 300),
      }))
      .mockResolvedValueOnce(undefined);
    const attempts: Array<{ throttled: boolean; nextAttemptInSeconds: number }> = [];
    const scheduler = new CaltrainPollingScheduler({
      poll,
      intervalMilliseconds: 120_000,
      maximumBackoffMilliseconds: 180_000,
      now,
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        if (delays.length === 3) abort.abort();
      },
      onFailure: (failure) => attempts.push(failure),
    });

    await scheduler.run(abort.signal);

    expect(poll).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([120_000, 300_000, 120_000]);
    expect(attempts).toEqual([{ throttled: true, nextAttemptInSeconds: 300 }]);
  });

  it("backs off safely when a throttle response omits Retry-After", async () => {
    const failures: Array<{ throttled: boolean; nextAttemptInSeconds: number }> = [];
    let sleepCount = 0;
    const secondAbort = new AbortController();
    const retryingScheduler = new CaltrainPollingScheduler({
      poll: async () => { throw new SF511ProviderError("http_error", 429); },
      intervalMilliseconds: 120_000,
      maximumBackoffMilliseconds: 3_600_000,
      now,
      random: () => 0,
      sleep: async () => {
        sleepCount += 1;
        if (sleepCount === 2) secondAbort.abort();
      },
      onFailure: (failure) => failures.push(failure),
    });
    await retryingScheduler.run(secondAbort.signal);

    expect(failures).toEqual([{ throttled: true, nextAttemptInSeconds: 120 }]);
  });

  it("applies bounded exponential backoff to repeated provider failures", async () => {
    const abort = new AbortController();
    const delays: number[] = [];
    const scheduler = new CaltrainPollingScheduler({
      poll: async () => { throw new Error("provider unavailable"); },
      intervalMilliseconds: 120_000,
      maximumBackoffMilliseconds: 300_000,
      now,
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        if (delays.length === 4) abort.abort();
      },
    });

    await scheduler.run(abort.signal);

    expect(delays).toEqual([120_000, 120_000, 240_000, 300_000]);
  });
});
