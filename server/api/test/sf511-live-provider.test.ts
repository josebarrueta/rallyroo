import { describe, expect, it } from "vitest";
import { SF511Client } from "../src/sf511-client.js";
import {
  decodeCaltrainTripUpdates,
  decodeCaltrainVehiclePositions,
} from "../src/sf511-gtfs-realtime.js";
import {
  caltrainJourneyID,
  parseCaltrainStaticSchedule,
} from "../src/caltrain-static-schedule.js";

const liveTestsEnabled = process.env.RUN_SF511_LIVE_TESTS === "true";

describe.skipIf(!liveTestsEnabled)("SF511 live provider contract", () => {
  it("fetches and decodes current Caltrain schedule and real-time feeds", async () => {
    const apiKey = process.env.SF511_API_KEY;
    expect(apiKey, "SF511_API_KEY must be configured for live tests").toBeTruthy();
    const client = new SF511Client(apiKey!);

    const [tripBody, positionBody, scheduleBody] = await Promise.all([
      client.tripUpdates(),
      client.vehiclePositions(),
      client.staticSchedule(),
    ]);
    const trips = decodeCaltrainTripUpdates(tripBody);
    const positions = decodeCaltrainVehiclePositions(positionBody);
    const schedule = parseCaltrainStaticSchedule(scheduleBody, new Date());

    expect(tripBody.byteLength).toBeGreaterThan(0);
    expect(positionBody.byteLength).toBeGreaterThan(0);
    expect(schedule.journeys.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(trips.observedAt))).toBe(true);
    expect(Number.isFinite(Date.parse(positions.observedAt))).toBe(true);

    const scheduledJourneyIDs = new Set(schedule.journeys.map((journey) => journey.id));
    for (const position of positions.positions.filter((item) => item.tripID !== "")) {
      expect(scheduledJourneyIDs.has(caltrainJourneyID(position.tripID))).toBe(true);
    }
  }, 30_000);
});
