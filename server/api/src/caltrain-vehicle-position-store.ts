import type { Cache } from "./cache.js";
import type { CaltrainVehiclePositionsSnapshot } from "./commuter-module.js";

export interface CaltrainVehiclePositionStore {
  replace(snapshot: CaltrainVehiclePositionsSnapshot): Promise<void>;
  current(): Promise<CaltrainVehiclePositionsSnapshot | null>;
}

const vehiclePositionsKey = "caltrain:vehicle-positions";
const vehiclePositionsTTLSeconds = 2 * 60 * 60;

export class CachedCaltrainVehiclePositionStore implements CaltrainVehiclePositionStore {
  constructor(private readonly cache: Cache) {}

  async replace(snapshot: CaltrainVehiclePositionsSnapshot): Promise<void> {
    if (snapshot.positions.length === 0) {
      const current = await this.current();
      if (current && current.positions.length > 0) return;
    }
    await this.cache.set(vehiclePositionsKey, snapshot, vehiclePositionsTTLSeconds);
  }

  async current(): Promise<CaltrainVehiclePositionsSnapshot | null> {
    return this.cache.get<CaltrainVehiclePositionsSnapshot>(vehiclePositionsKey);
  }
}
