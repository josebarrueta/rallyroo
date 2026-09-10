import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { parseCaltrainStaticSchedule } from "../src/caltrain-static-schedule.js";
import { searchCaltrainJourneys } from "../src/caltrain-schedule-search.js";

function fixtureZip(): Uint8Array {
  return zipSync({
    "agency.txt": strToU8("agency_id,agency_name,agency_url,agency_timezone\nCT,Caltrain,https://www.caltrain.com,America/Los_Angeles"),
    "feed_info.txt": strToU8("feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nC,https://caltrain.com,en,20260901,20261231,v1"),
    "stops.txt": strToU8([
      "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
      "PA-N,Palo Alto,37.443,-122.165,0,PA",
      "MV-N,Mountain View,37.394,-122.076,0,MV",
    ].join("\n")),
    "trips.txt": strToU8([
      "route_id,service_id,trip_id,direction_id,trip_headsign",
      "Local,mon-thu,train-101-a,1,San Francisco",
      "Local,fri,train-101-b,1,San Francisco",
      "Local,mon-thu,train-102,1,San Francisco",
    ].join("\n")),
    "stop_times.txt": strToU8([
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      "train-101-a,07:30:00,07:31:00,MV-N,1",
      "train-101-a,07:44:00,07:45:00,PA-N,2",
      "train-101-b,07:30:00,07:31:00,MV-N,1",
      "train-101-b,07:44:00,07:45:00,PA-N,2",
      "train-102,08:00:00,08:01:00,MV-N,1",
      "train-102,08:14:00,08:15:00,PA-N,2",
    ].join("\n")),
    "calendar.txt": strToU8([
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
      "mon-thu,1,1,1,1,0,0,0,20260901,20261231",
      "fri,0,0,0,0,1,0,0,20260901,20261231",
    ].join("\n")),
  });
}

describe("searchCaltrainJourneys", () => {
  it("returns only schedules operating on every selected commute day", () => {
    const snapshot = parseCaltrainStaticSchedule(fixtureZip(), new Date("2026-09-10T00:00:00Z"));

    const options = searchCaltrainJourneys(snapshot, {
      originStationID: "MV",
      destinationStationID: "PA",
      serviceWeekdays: [1, 4, 5],
    });

    expect(options).toEqual([{
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      directionID: "northbound",
      originStopID: "MV-N",
      destinationStopID: "PA-N",
      departureMinutes: 451,
      arrivalMinutes: 464,
      operatingWeekdays: [1, 2, 3, 4, 5],
    }]);
  });

  it("rejects cross-category and invalid station searches", () => {
    const snapshot = parseCaltrainStaticSchedule(fixtureZip(), new Date("2026-09-10T00:00:00Z"));
    expect(() => searchCaltrainJourneys(snapshot, {
      originStationID: "MV",
      destinationStationID: "PA",
      serviceWeekdays: [5, 6],
    })).toThrow("Invalid Caltrain journey search");
    expect(() => searchCaltrainJourneys(snapshot, {
      originStationID: "missing",
      destinationStationID: "PA",
      serviceWeekdays: [1],
    })).toThrow("Invalid Caltrain journey search");
  });
});
