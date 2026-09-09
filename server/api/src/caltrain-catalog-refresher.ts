import type { CommuterModule } from "./commuter-module.js";
import { parseCaltrainStops } from "./sf511-caltrain-catalog.js";

interface CaltrainStopsClient {
  stops(): Promise<Uint8Array>;
}

export class CaltrainCatalogRefresher {
  constructor(
    private readonly client: CaltrainStopsClient,
    private readonly commuter: CommuterModule,
  ) {}

  async refresh(attemptedAt: Date): Promise<void> {
    try {
      const body = new TextDecoder("utf-8", { fatal: true }).decode(await this.client.stops());
      const snapshot = parseCaltrainStops(body);
      await this.commuter.replaceCatalog(snapshot, attemptedAt);
    } catch {
      await this.commuter.recordProviderFailure("catalog", attemptedAt);
      throw new Error("Caltrain catalog refresh failed");
    }
  }
}
