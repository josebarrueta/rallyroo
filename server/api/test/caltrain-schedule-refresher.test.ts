import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CaltrainScheduleRefresher } from "../src/caltrain-schedule-refresher.js";
import { CommuterModule } from "../src/commuter-module.js";
import { InMemoryCommuterRepository } from "../src/in-memory-commuter-repository.js";

function scheduleZip(version = "v1"): Uint8Array {
  return zipSync({
    "agency.txt": strToU8("agency_id,agency_name,agency_url,agency_timezone\nCT,Caltrain,https://caltrain.com,America/Los_Angeles"),
    "feed_info.txt": strToU8(`feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nC,https://caltrain.com,en,20260901,20261231,${version}`),
    "stops.txt": strToU8("stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\nA-N,Alpha,37,-122,0,A\nB-N,Beta,38,-122,0,B"),
    "trips.txt": strToU8("route_id,service_id,trip_id,direction_id\nLocal,weekday,t1,1"),
    "stop_times.txt": strToU8("trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,07:00:00,07:01:00,A-N,1\nt1,07:30:00,07:31:00,B-N,2"),
    "calendar.txt": strToU8("service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20260901,20261231"),
  });
}

describe("CaltrainScheduleRefresher", () => {
  it("stores a valid schedule as the last-good catalog", async () => {
    const repository = new InMemoryCommuterRepository();
    const commuter = new CommuterModule(repository);
    const refresher = new CaltrainScheduleRefresher(
      { staticSchedule: async () => scheduleZip() },
      commuter,
    );

    await refresher.refresh(new Date("2026-09-10T00:00:00Z"));

    expect((await repository.caltrainSchedule())?.version).toBe("v1");
    expect((await commuter.catalog(new Date("2026-09-10T01:00:00Z"))).status.state).toBe("healthy");
  });

  it("retains the last-good schedule after malformed provider data", async () => {
    const repository = new InMemoryCommuterRepository();
    const commuter = new CommuterModule(repository);
    let body = scheduleZip();
    const refresher = new CaltrainScheduleRefresher(
      { staticSchedule: async () => body },
      commuter,
    );
    await refresher.refresh(new Date("2026-09-10T00:00:00Z"));
    body = new Uint8Array([1, 2, 3]);

    await expect(refresher.refresh(new Date("2026-09-11T00:00:00Z"))).rejects.toThrow();

    expect((await repository.caltrainSchedule())?.version).toBe("v1");
    expect((await commuter.catalog(new Date("2026-09-11T01:00:00Z"))).status.state).toBe("degraded");
  });
});
