import type { Cache } from "./cache.js";
import type { CaltrainVehiclePositionStore } from "./caltrain-vehicle-position-store.js";

const viewerDemandKey = "caltrain:live-viewer-demand";
const viewerDemandSeconds = 15 * 60;
const viewerDemandCacheTTLSeconds = 20 * 60;
const viewerFreshnessMilliseconds = 2 * 60 * 1_000;
const onDemandCooldownMilliseconds = 2 * 60 * 1_000;

type RefreshPositions = (attemptedAt: Date) => Promise<void>;

export interface CaltrainLiveRefreshOperations {
  request(now: Date): Promise<void>;
  force(now: Date): Promise<void>;
}

export class CaltrainLiveRefresh implements CaltrainLiveRefreshOperations {
  private lastRefreshAttemptMilliseconds: number | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly cache: Cache,
    private readonly positions: CaltrainVehiclePositionStore,
    private readonly refreshPositions: RefreshPositions,
  ) {}

  async request(now: Date): Promise<void> {
    await this.recordViewerDemand(now);
    const current = await this.positions.current();
    const observedAt = Date.parse(current?.observedAt ?? "");
    if (Number.isFinite(observedAt)
      && now.getTime() - observedAt < viewerFreshnessMilliseconds) return;
    await this.refreshUnlessCoolingDown(now);
  }

  async force(now: Date): Promise<void> {
    await this.recordViewerDemand(now);
    await this.refreshUnlessCoolingDown(now);
  }

  lastRefreshAttempt(): Date | null {
    return this.lastRefreshAttemptMilliseconds === undefined
      ? null
      : new Date(this.lastRefreshAttemptMilliseconds);
  }

  async viewerDemandIsActive(now: Date): Promise<boolean> {
    const demandUntil = await this.cache.get<string>(viewerDemandKey);
    return demandUntil !== null && Date.parse(demandUntil) > now.getTime();
  }

  async backgroundRefresh(now: Date): Promise<void> {
    await this.refresh(now);
  }

  private async recordViewerDemand(now: Date): Promise<void> {
    await this.cache.set(
      viewerDemandKey,
      new Date(now.getTime() + viewerDemandSeconds * 1_000).toISOString(),
      viewerDemandCacheTTLSeconds,
    );
  }

  private async refreshUnlessCoolingDown(now: Date): Promise<void> {
    if (this.lastRefreshAttemptMilliseconds !== undefined
      && now.getTime() - this.lastRefreshAttemptMilliseconds < onDemandCooldownMilliseconds) return;
    await this.refresh(now);
  }

  private async refresh(now: Date): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.lastRefreshAttemptMilliseconds = now.getTime();
    const operation = this.refreshPositions(now);
    this.inFlight = operation;
    try {
      await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = undefined;
    }
  }
}
