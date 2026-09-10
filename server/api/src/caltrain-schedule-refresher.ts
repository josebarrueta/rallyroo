import { parseCaltrainStaticSchedule } from "./caltrain-static-schedule.js";

const maximumArchiveBytes = 5 * 1024 * 1024;
const maximumExpandedBytes = 25 * 1024 * 1024;

export class CaltrainScheduleRefresher {
  constructor(
    private readonly client: () => Promise<Uint8Array>,
    private readonly repository: {
      saveScheduleSnapshot(schedule: any): Promise<void>;
      recordAttempt(attemptedAt: Date, succeeded: boolean): Promise<void>;
    },
  ) {}

  async refresh(attemptedAt: Date): Promise<void> {
    try {
      if (attemptedAt.getTime() > Date.now() + 60_000) throw new Error("future attemptedAt");
      const body = (await this.client());
      if (body.byteLength < 1 || body.byteLength > maximumArchiveBytes) throw new Error("invalid archive size");
      const schedule = parseCaltrainStaticSchedule(body, attemptedAt);
      await this.repository.saveScheduleSnapshot(schedule);
      await this.repository.recordAttempt(attemptedAt, true);
    } catch (error) {
      await this.repository.recordAttempt(attemptedAt, false);
      throw new Error("Caltrain schedule refresh failed", { cause: error });
    }
  }
}
