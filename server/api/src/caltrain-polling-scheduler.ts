import { setTimeout as sleepWithSignal } from "node:timers/promises";
import { SF511ProviderError } from "./sf511-client.js";

export interface CaltrainPollingFailure {
  throttled: boolean;
  nextAttemptInSeconds: number;
}

type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

interface CaltrainPollingSchedulerOptions {
  poll(attemptedAt: Date): Promise<unknown>;
  intervalMilliseconds: number;
  maximumBackoffMilliseconds: number;
  now?: () => Date;
  random?: () => number;
  sleep?: Sleep;
  onFailure?: (failure: CaltrainPollingFailure) => void;
}

export class CaltrainPollingScheduler {
  private readonly poll: CaltrainPollingSchedulerOptions["poll"];
  private readonly intervalMilliseconds: number;
  private readonly maximumBackoffMilliseconds: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly sleep: Sleep;
  private readonly onFailure?: CaltrainPollingSchedulerOptions["onFailure"];

  constructor(options: CaltrainPollingSchedulerOptions) {
    this.poll = options.poll;
    this.intervalMilliseconds = options.intervalMilliseconds;
    this.maximumBackoffMilliseconds = options.maximumBackoffMilliseconds;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
    this.onFailure = options.onFailure;
  }

  async run(signal: AbortSignal): Promise<void> {
    let consecutiveFailures = 0;
    let nextDelay = this.intervalMilliseconds;
    while (!signal.aborted) {
      try {
        const delayCeiling = nextDelay > this.maximumBackoffMilliseconds
          ? 21_600_000
          : this.maximumBackoffMilliseconds;
        await this.sleep(withPositiveJitter(nextDelay, delayCeiling, this.random), signal);
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
      if (signal.aborted) return;

      try {
        await this.poll(this.now());
        consecutiveFailures = 0;
        nextDelay = this.intervalMilliseconds;
      } catch (error) {
        consecutiveFailures += 1;
        const throttle = throttleInformation(error);
        const exponentialDelay = Math.min(
          this.intervalMilliseconds * (2 ** (consecutiveFailures - 1)),
          this.maximumBackoffMilliseconds,
        );
        nextDelay = throttle.retryAfterMilliseconds === undefined
          ? exponentialDelay
          : Math.min(
            Math.max(exponentialDelay, throttle.retryAfterMilliseconds),
            21_600_000,
          );
        this.onFailure?.({
          throttled: throttle.throttled,
          nextAttemptInSeconds: Math.ceil(nextDelay / 1_000),
        });
      }
    }
  }
}

async function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  await sleepWithSignal(milliseconds, undefined, { signal });
}

function withPositiveJitter(
  milliseconds: number,
  maximumMilliseconds: number,
  random: () => number,
): number {
  const boundedRandom = Math.min(Math.max(random(), 0), 1);
  return Math.min(
    milliseconds + Math.floor(milliseconds * 0.1 * boundedRandom),
    maximumMilliseconds,
  );
}

function throttleInformation(error: unknown): {
  throttled: boolean;
  retryAfterMilliseconds?: number;
} {
  if (error instanceof SF511ProviderError && error.statusCode === 429) {
    return {
      throttled: true,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterMilliseconds: error.retryAfterSeconds * 1_000 }),
    };
  }
  if (error instanceof Error && error.cause !== undefined) {
    return throttleInformation(error.cause);
  }
  return { throttled: false };
}
