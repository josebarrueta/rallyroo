import type { CommuterModule } from "./commuter-module.js";
import {
  decodeCaltrainVehiclePositions,
  type CaltrainVehiclePositionsSnapshot,
} from "./sf511-gtfs-realtime.js";

interface CaltrainVehiclePositionClient {
  vehiclePositions(): Promise<Uint8Array>;
}

export class CaltrainVehiclePositionRefresher {
  constructor(
    private readonly client: CaltrainVehiclePositionClient,
    private readonly commuterModule: CommuterModule,
     ) {}

  async refresh(
    attemptedAt: Date = new Date(),
  ): Promise<CaltrainVehiclePositionsSnapshot> {
    try {
      const body = await this.client.vehiclePositions();
      const snapshot = decodeCaltrainVehiclePositions(body);
      await this.commuterModule.replaceVehiclePositions(snapshot, attemptedAt);
      return snapshot;
    } catch (error) {
      await this.commuterModule.recordProviderFailure("positions", attemptedAt);
      throw new Error("Caltrain vehicle position refresh failed", { cause: error });
    }
  }
}
