import type { Cache } from "./cache.js";
import type { CommuterModule } from "./commuter-module.js";
import {
  decodeCaltrainVehiclePositions,
  type CaltrainVehiclePositionsSnapshot,
} from "./sf511-gtfs-realtime.js";

interface CaltrainVehiclePositionClient {
  vehiclePositions(): Promise<Uint8Array>;
}

const VEHICLE_POSITIONS_KEY = "caltrain:vehicle-positions";
const VEHICLE_POSITIONS_TTL = 5 * 60; // 5 minutes

export class CaltrainVehiclePositionRefresher {
  constructor(
    private readonly client: CaltrainVehiclePositionClient,
    private readonly cache: Cache,
    private readonly commuterModule: CommuterModule,
     ) {}

  async refresh(
    attemptedAt: Date = new Date(),
  ): Promise<CaltrainVehiclePositionsSnapshot> {
    const body = await this.client.vehiclePositions();
    const snapshot = decodeCaltrainVehiclePositions(body);
    await this.cache.set(VEHICLE_POSITIONS_KEY, snapshot, VEHICLE_POSITIONS_TTL);
    await this.commuterModule.replaceVehiclePositions(snapshot, attemptedAt);
    return snapshot;
  }

  async cached(): Promise<CaltrainVehiclePositionsSnapshot | null> {
    return this.cache.get<CaltrainVehiclePositionsSnapshot>(VEHICLE_POSITIONS_KEY);
   }
}
