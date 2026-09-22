import type { Cache } from "./cache.js";
import type { CaltrainVehiclePositionsSnapshot } from "./commuter-module.js";

export interface CaltrainVehiclePositionStore {
  replace(snapshot: CaltrainVehiclePositionsSnapshot): Promise<void>;
  current(): Promise<CaltrainVehiclePositionsSnapshot | null>;
}

const vehiclePositionsKey = "caltrain:vehicle-positions";
const vehiclePositionsTTLSeconds = 5 * 60;

export class CachedCaltrainVehiclePositionStore implements CaltrainVehiclePositionStore {
  constructor(private readonly cache: Cache) {}

  async replace(snapshot: CaltrainVehiclePositionsSnapshot): Promise<void> {
    await this.cache.set(vehiclePositionsKey, snapshot, vehiclePositionsTTLSeconds);
  }

  async current(): Promise<CaltrainVehiclePositionsSnapshot | null> {
    return this.cache.get<CaltrainVehiclePositionsSnapshot>(vehiclePositionsKey);
  }
}
