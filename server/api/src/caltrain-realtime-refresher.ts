import type { CommuterModule } from "./commuter-module.js";
import {
  decodeCaltrainTripUpdates,
  type CaltrainTripUpdatesSnapshot,
} from "./sf511-gtfs-realtime.js";

interface CaltrainTripUpdatesClient {
  tripUpdates(): Promise<Uint8Array>;
}

export class CaltrainRealtimeRefresher {
  constructor(
    private readonly client: CaltrainTripUpdatesClient,
    private readonly commuter: CommuterModule,
  ) {}

  async refresh(attemptedAt: Date): Promise<CaltrainTripUpdatesSnapshot> {
    try {
      const snapshot = decodeCaltrainTripUpdates(await this.client.tripUpdates());
      await this.commuter.recordProviderSuccess("realtime", attemptedAt);
      return snapshot;
    } catch {
      await this.commuter.recordProviderFailure("realtime", attemptedAt);
      throw new Error("Caltrain real-time refresh failed");
    }
  }
}
