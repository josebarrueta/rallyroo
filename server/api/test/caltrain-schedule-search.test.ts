import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { parseCaltrainStaticSchedule } from "../src/caltrain-static-schedule.js";
import { findJourneys } from "../src/caltrain-schedule-search.js";

function fixtureZip(): Uint8Array {
  return zipSync({
    "agency.txt": strToU8("agency_id,agency_name,agency_url,agency_timezone\nCT,Caltrain,https://www.caltrain.com,America/Los_Angeles"),
    "feed_info.txt": strToU8("feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nC,https://caltrain.com,en,20260901,20261231,v1"),
    "stops.txt": strToU8([
      "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
      "70171,Palo Alto,37.443,-122.165,0,PA",
      "70211,Mountain View,37.394,-122.076,0,MV",
    ].join("\n")),
    "trips.txt": strToU8([
      "route_id,service_id,trip_id,direction_id,trip_headsign",
      "Local,weekday,train-101,1,San Francisco",
      "Local,weekday,train-102,1,San Francisco",
    ].join("\n")),
    "stop_times.txt": strToU8([
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      "train-101,07:30:00,07:31:00,70211,1",
      "train-101,07:44:00,07:45:00,70171,2",
      "train-102,08:00:00,08:01:00,70211,1",
      "train-102,08:14:00,08:15:00,70171,2",
    ].join("\n")),
    "calendar.txt": strToU8([
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
      "weekday,1,1,1,1,1,0,0,20260901,20261231",
    ].join("\n")),
  });
}

describe("findJourneys", () => {
  it("returns matching journeys for stop pair and weekday", () => {
    const snap = parseCaltrainStaticSchedule(fixtureZip(), new Date("2026-09-10T00:00:00Z"));
    const opts = { fromStopID: "70211", toStopID: "70171", directionID: "1", weekday: 1 };
    const options = findJourneys(snap, opts);
    expect(options).toHaveLength(2);
    expect(options[0]!.departureMinutes).toBe(7 * 60 + 31);
    expect(options[0]!.arrivalMinutes).toBe(7 * 60 + 44);
    expect(options[1]!.departureMinutes).toBe(8 * 60 + 1);
    expect(options[1]!.arrivalMinutes).toBe(8 * 60 + 14);
  });

  it("filters by weekday", () => {
    const snap = parseCaltrainStaticSchedule(fixtureZip(), new Date("2026-09-10T00:00:00Z"));
    const opts = { fromStopID: "70211", toStopID: "70171", directionID: "1", weekday: 6 };
    const options = findJourneys(snap, opts);
    expect(options).toHaveLength(0);
  });
});
