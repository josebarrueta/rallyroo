import type { CommuterModule } from "./commuter-module.js";
import {
  decodeCaltrainTripUpdates,
  type CaltrainTripUpdatesSnapshot,
} from "./sf511-gtfs-realtime.js";
import {
  decodeCaltrainServiceAlerts,
  type CaltrainServiceAlertsSnapshot,
} from "./sf511-service-alerts.js";

interface CaltrainRealtimeClient {
  tripUpdates(): Promise<Uint8Array>;
  serviceAlerts(): Promise<Uint8Array>;
}

export interface CaltrainRealtimeSnapshot {
  tripUpdates: CaltrainTripUpdatesSnapshot;
  serviceAlerts: CaltrainServiceAlertsSnapshot;
}

export class CaltrainRealtimeRefresher {
  constructor(
    private readonly client: CaltrainRealtimeClient,
    private readonly commuter: CommuterModule,
  ) {}

  async refresh(attemptedAt: Date): Promise<CaltrainRealtimeSnapshot> {
    try {
      const [tripBody, alertBody] = await Promise.all([
        this.client.tripUpdates(),
        this.client.serviceAlerts(),
      ]);
      const snapshot = {
        tripUpdates: decodeCaltrainTripUpdates(tripBody),
        serviceAlerts: decodeCaltrainServiceAlerts(alertBody),
      };
      const staleBefore = attemptedAt.getTime() - 30_000;
      if (new Date(snapshot.tripUpdates.validUntil).getTime() < staleBefore
        || new Date(snapshot.serviceAlerts.validUntil).getTime() < staleBefore) {
        throw new Error("stale feed");
      }
      await this.commuter.recordProviderSuccess("realtime", attemptedAt);
      return snapshot;
    } catch (error) {
      await this.commuter.recordProviderFailure("realtime", attemptedAt);
      throw new Error("Caltrain real-time refresh failed", { cause: error });
    }
  }
}
