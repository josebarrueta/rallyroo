import { describe, expect, it, vi } from "vitest";
import { CaltrainScheduleRefresher } from "../src/caltrain-schedule-refresher.js";

describe("CaltrainScheduleRefresher", () => {
  it("stores schedule on success", async () => {
    const repository = { saveScheduleSnapshot: vi.fn(), recordAttempt: vi.fn() };
    const client = vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3])));
    const refresher = new CaltrainScheduleRefresher(client, repository);
    await expect(async () => refresher.refresh(new Date())).rejects.toThrow("Caltrain schedule refresh failed");
    expect(await repository.recordAttempt).toHaveBeenCalledWith(expect.any(Date), false);
  });
});
