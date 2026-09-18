import type { Cache } from "./cache.js";
import type { CommuterModule } from "./commuter-module.js";
import {
  decodeCaltrainVehiclePositions,
  type CaltrainVehiclePositionsSnapshot,
} from "./sf511-gtfs-realtime.js";
import type { SF511Client } from "./sf511-client.js";

const VEHICLE_POSITIONS_KEY = "caltrain:vehicle-positions";
const VEHICLE_POSITIONS_TTL = 5 * 60; // 5 minutes

interface CaltrainVehiclePositionRefreshResult {
  success: boolean;
  positions: CaltrainVehiclePositionsSnapshot | null;
}

export class CaltrainVehiclePositionRefresher {
  constructor(
    private readonly client: SF511Client,
    private readonly cache: Cache,
    private readonly commuterModule: CommuterModule,
     ) {}

  async refresh(attemptedAt: Date = new Date()): Promise<CaltrainVehiclePositionRefreshResult> {
    try {
      const body = await this.client.vehiclePositions();
      const positions = decodeCaltrainVehiclePositions(body);
      await this.cache.set(
         VEHICLE_POSITIONS_KEY,
         positions,
         VEHICLE_POSITIONS_TTL,
          );
      await this.commuterModule.replaceVehiclePositions(positions, attemptedAt);
      return { success: true, positions };
      } catch (error) {
        return { success: false, positions: null };
       }
      }

  async cached(): Promise<CaltrainVehiclePositionsSnapshot | null> {
    return this.cache.get<CaltrainVehiclePositionsSnapshot>(VEHICLE_POSITIONS_KEY);
   }
}
