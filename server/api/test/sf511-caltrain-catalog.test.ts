import { describe, expect, it } from "vitest";
import { parseCaltrainStops } from "../src/sf511-caltrain-catalog.js";

const response = {
  Contents: {
    ResponseTimestamp: "2026-09-09T07:00:00Z",
    dataObjects: {
      id: "CT",
      ScheduledStopPoint: [{
        id: "70171",
        Extensions: {
          LocationType: "0",
          PlatformCode: null,
          ParentStation: "palo_alto",
          ValidBetween: {
            FromDate: "2026-01-31T00:00:00-08:00",
            ToDate: "2027-01-31T23:59:00-08:00",
          },
        },
        Name: "Palo Alto Caltrain Station Northbound",
        Location: { Longitude: "-122.1649", Latitude: "37.443" },
        Url: null,
        StopType: "onstreetBus",
      }, {
        id: "70172",
        Extensions: {
          LocationType: "0",
          PlatformCode: null,
          ParentStation: "palo_alto",
          ValidBetween: {
            FromDate: "2026-01-31T00:00:00-08:00",
            ToDate: "2027-01-31T23:59:00-08:00",
          },
        },
        Name: "Palo Alto Caltrain Station Southbound",
        Location: { Longitude: "-122.1648", Latitude: "37.4431" },
        Url: null,
        StopType: "onstreetBus",
      }],
    },
  },
};

describe("parseCaltrainStops", () => {
  it("normalizes provider records without exposing the provider schema", () => {
    expect(parseCaltrainStops(JSON.stringify(response))).toEqual({
      observedAt: "2026-09-09T07:00:00.000Z",
      stops: [{
        id: "70171",
        stationID: "palo_alto",
        stationName: "Palo Alto",
        direction: "northbound",
        latitude: 37.443,
        longitude: -122.1649,
        validFrom: "2026-01-31T08:00:00.000Z",
        validUntil: "2027-02-01T07:59:00.000Z",
      }, {
        id: "70172",
        stationID: "palo_alto",
        stationName: "Palo Alto",
        direction: "southbound",
        latitude: 37.4431,
        longitude: -122.1648,
        validFrom: "2026-01-31T08:00:00.000Z",
        validUntil: "2027-02-01T07:59:00.000Z",
      }],
    });
  });

  it("rejects empty and malformed snapshots so callers can retain last-good data", () => {
    expect(() => parseCaltrainStops("{}"))
      .toThrow("Invalid Caltrain Stops snapshot");
    expect(() => parseCaltrainStops(JSON.stringify({
      ...response,
      Contents: { ...response.Contents, dataObjects: { ScheduledStopPoint: [] } },
    }))).toThrow("Invalid Caltrain Stops snapshot");
  });
});
