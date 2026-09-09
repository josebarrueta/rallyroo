import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import { CaltrainCommutePoller } from "../src/caltrain-commute-poller.js";
import { CommuterModule } from "../src/commuter-module.js";
import { InMemoryCommuterRepository } from "../src/in-memory-commuter-repository.js";

const gtfs = GtfsRealtimeBindings.transit_realtime;
const encode = (value: Record<string, unknown>) =>
  gtfs.FeedMessage.encode(gtfs.FeedMessage.fromObject(value)).finish();

describe("CaltrainCommutePoller", () => {
  it("polls each agency feed once and fans normalized matches out through the module", async () => {
    const commuter = new CommuterModule(new InMemoryCommuterRepository());
    const account = { identitySubject: "parent", familyID: "family", memberID: "parent", role: "parent" as const };
    await commuter.enable(account);
    await commuter.createSubscription(account, {
      visibility: "personal", agencyID: "CT", routeID: "L1", directionID: "northbound",
      originStopID: "70171", destinationStopID: "70011", serviceWeekdays: [3],
      windowStartMinutes: 420, windowEndMinutes: 540, alertKinds: ["delay"], minimumDelayMinutes: 15,
    });
    await commuter.replaceCatalog({
      observedAt: "2026-09-09T14:59:00Z",
      stops: [
        { id: "70171", stationID: "palo_alto", stationName: "Palo Alto", direction: "northbound", latitude: 1, longitude: 1, validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z" },
        { id: "70011", stationID: "san_francisco", stationName: "San Francisco", direction: "northbound", latitude: 1, longitude: 1, validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z" },
      ],
    }, new Date("2026-09-09T14:59:00Z"));
    let tripCalls = 0;
    let alertCalls = 0;
    const header = { gtfsRealtimeVersion: "1.0", timestamp: 1_788_966_000 };
    const poller = new CaltrainCommutePoller({
      tripUpdates: async () => {
        tripCalls += 1;
        return encode({ header, entity: [{ id: "e1", tripUpdate: { trip: { tripId: "t1", routeId: "L1" }, stopTimeUpdate: [
          { stopSequence: 1, stopId: "70171", arrival: { delay: 1200, time: 1_788_966_000 } },
          { stopSequence: 2, stopId: "70011", arrival: { delay: 1200, time: 1_788_967_800 } },
        ] } }] });
      },
      serviceAlerts: async () => {
        alertCalls += 1;
        return encode({ header, entity: [] });
      },
    }, commuter);

    const intents = await poller.poll(new Date("2026-09-09T15:00:01Z"));

    expect({ tripCalls, alertCalls }).toEqual({ tripCalls: 1, alertCalls: 1 });
    expect(intents).toEqual([expect.objectContaining({ kind: "delay", audience: { kind: "member", memberID: "parent" } })]);
  });
});
