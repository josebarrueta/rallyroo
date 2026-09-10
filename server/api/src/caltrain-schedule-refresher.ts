import { parseCaltrainStaticSchedule } from "./caltrain-static-schedule.js";
import type { CommuterModule } from "./commuter-module.js";

interface CaltrainStaticScheduleClient {
  staticSchedule(): Promise<Uint8Array>;
}

export class CaltrainScheduleRefresher {
  constructor(
    private readonly client: CaltrainStaticScheduleClient,
    private readonly commuter: CommuterModule,
  ) {}

  async refresh(attemptedAt: Date): Promise<void> {
    try {
      const schedule = parseCaltrainStaticSchedule(
        await this.client.staticSchedule(),
        attemptedAt,
      );
      await this.commuter.replaceSchedule(schedule, attemptedAt);
    } catch (error) {
      await this.commuter.recordProviderFailure("catalog", attemptedAt);
      throw new Error("Caltrain schedule refresh failed", { cause: error });
    }
  }
}
