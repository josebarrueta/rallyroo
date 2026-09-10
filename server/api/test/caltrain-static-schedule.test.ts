import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { parseCaltrainStaticSchedule } from "../src/caltrain-static-schedule.js";

function fixtureZip(): Uint8Array {
  return zipSync({
    "agency.txt": strToU8([
      "agency_id,agency_name,agency_url,agency_timezone",
      "CT,Caltrain,https://www.caltrain.com,America/Los_Angeles",
    ].join("\n")),
    "feed_info.txt": strToU8([
      "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version",
      "Caltrain,https://www.caltrain.com,en,20260901,20261231,fixture-v1",
    ].join("\n")),
    "stops.txt": strToU8([
      "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
      "PA,Palo Alto,37.443,-122.165,1,",
      "70171,Palo Alto,37.443,-122.165,0,PA",
      "MV,Mountain View,37.394,-122.076,1,",
      "70211,Mountain View,37.394,-122.076,0,MV",
    ].join("\n")),
    "trips.txt": strToU8([
      "route_id,service_id,trip_id,direction_id,trip_headsign",
      "Local,weekday,train-101,1,San Francisco",
      "Local,weekend,train-201,1,San Francisco",
    ].join("\n")),
    "stop_times.txt": strToU8([
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      "train-101,07:30:00,07:31:00,70211,1",
      "train-101,07:44:00,07:45:00,70171,2",
      "train-201,08:00:00,08:01:00,70211,1",
      "train-201,08:14:00,08:15:00,70171,2",
    ].join("\n")),
    "calendar.txt": strToU8([
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
      "weekday,1,1,1,1,1,0,0,20260901,20261231",
      "weekend,0,0,0,0,0,1,1,20260901,20261231",
    ].join("\n")),
    "calendar_dates.txt": strToU8([
      "service_id,date,exception_type",
      "weekday,20261126,2",
      "weekend,20261126,1",
    ].join("\n")),
  });
}

describe("parseCaltrainStaticSchedule", () => {
  it("normalizes bounded stations, service calendars, and scheduled journeys", () => {
    const schedule = parseCaltrainStaticSchedule(
      fixtureZip(),
      new Date("2026-09-10T00:00:00Z"),
    );

    expect(schedule).toMatchObject({
      observedAt: "2026-09-10T00:00:00.000Z",
      version: "fixture-v1",
      timeZone: "America/Los_Angeles",
      validFrom: "2026-09-01",
      validUntil: "2026-12-31",
    });
    expect(schedule.stops).toEqual([
      expect.objectContaining({ id: "70171", stationID: "PA", stationName: "Palo Alto" }),
      expect.objectContaining({ id: "70211", stationID: "MV", stationName: "Mountain View" }),
    ]);
    expect(schedule.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        weekdays: [1, 2, 3, 4, 5],
        removedDates: ["2026-11-26"],
      }),
      expect.objectContaining({
        weekdays: [6, 7],
        addedDates: ["2026-11-26"],
      }),
    ]));
    expect(schedule.journeys).toHaveLength(2);
    expect(schedule.journeys[0]).toMatchObject({
      direction: "northbound",
      calls: [
        { stopID: "70211", arrivalSeconds: 27_000, departureSeconds: 27_060 },
        { stopID: "70171", arrivalSeconds: 27_840, departureSeconds: 27_900 },
      ],
    });
    expect(schedule.journeys[0]!.id).toMatch(/^[a-f0-9]{64}$/);
    expect(schedule.journeys[0]!.serviceID).toMatch(/^[a-f0-9]{64}$/);
  });
});
