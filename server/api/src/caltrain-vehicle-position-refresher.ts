import type { Cache } from "./cache.js";
import type { CommuterModule } from "./commuter-module.js";
import {
  decodeCaltrainVehiclePositions,
  type CaltrainVehiclePositionsSnapshot,
} from "./sf511-gtfs-realtime.js";
import { caltrainJourneyID } from "./caltrain-static-schedule.js";

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
    trackedJourneyIDs: readonly string[] = [],
  ): Promise<CaltrainVehiclePositionsSnapshot> {
    const body = await this.client.vehiclePositions();
    const snapshot = decodeCaltrainVehiclePositions(body);
    const tracked = new Set(trackedJourneyIDs);
    const positions = {
      ...snapshot,
      positions: tracked.size === 0
        ? []
        : snapshot.positions.filter((position) => (
          position.tripID !== "" && tracked.has(caltrainJourneyID(position.tripID))
        )),
    };
    await this.cache.set(VEHICLE_POSITIONS_KEY, positions, VEHICLE_POSITIONS_TTL);
    await this.commuterModule.replaceVehiclePositions(positions, attemptedAt);
    return positions;
  }

  async cached(): Promise<CaltrainVehiclePositionsSnapshot | null> {
    return this.cache.get<CaltrainVehiclePositionsSnapshot>(VEHICLE_POSITIONS_KEY);
   }
}
