import { CaltrainRealtimeRefresher } from "./caltrain-realtime-refresher.js";
import { caltrainRealtimeConditions } from "./caltrain-realtime-conditions.js";
import type { CommuteAlertIntent, CommuterModule } from "./commuter-module.js";

interface CaltrainRealtimeClient {
  tripUpdates(): Promise<Uint8Array>;
  serviceAlerts(): Promise<Uint8Array>;
}

export class CaltrainCommutePoller {
  private readonly refresher: CaltrainRealtimeRefresher;

  constructor(client: CaltrainRealtimeClient, private readonly commuter: CommuterModule) {
    this.refresher = new CaltrainRealtimeRefresher(client, commuter);
  }

  async poll(attemptedAt: Date): Promise<CommuteAlertIntent[]> {
    const snapshot = await this.refresher.refresh(attemptedAt);
    const catalog = await this.commuter.catalog(attemptedAt);
    const conditions = caltrainRealtimeConditions(snapshot, catalog.stops, attemptedAt);
    return this.commuter.processTransitConditions(conditions, attemptedAt);
  }
}
