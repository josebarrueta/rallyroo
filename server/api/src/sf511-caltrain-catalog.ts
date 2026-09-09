import { z } from "zod";
import type { CaltrainStop, CaltrainStopsSnapshot } from "./commuter-module.js";

const dateSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const coordinateSchema = z.string().trim().min(1).transform(Number).pipe(z.number().finite());
const providerStopSchema = z.object({
  id: z.string().trim().min(1).max(200),
  Name: z.string().trim().min(1).max(300),
  Extensions: z.object({
    ParentStation: z.string().trim().min(1).max(200),
    ValidBetween: z.object({
      FromDate: dateSchema,
      ToDate: dateSchema,
    }),
  }),
  Location: z.object({
    Longitude: coordinateSchema.pipe(z.number().min(-180).max(180)),
    Latitude: coordinateSchema.pipe(z.number().min(-90).max(90)),
  }),
}).refine((stop) => (
  new Date(stop.Extensions.ValidBetween.ToDate) >= new Date(stop.Extensions.ValidBetween.FromDate)
));
const providerSnapshotSchema = z.object({
  Contents: z.object({
    ResponseTimestamp: dateSchema,
    dataObjects: z.object({
      ScheduledStopPoint: z.array(providerStopSchema).min(1).max(500),
    }),
  }),
});

export function parseCaltrainStops(body: string): CaltrainStopsSnapshot {
  try {
    const parsed = providerSnapshotSchema.parse(JSON.parse(body));
    const ids = new Set<string>();
    const stops = parsed.Contents.dataObjects.ScheduledStopPoint.map((stop) => {
      if (ids.has(stop.id)) throw new Error("duplicate stop");
      ids.add(stop.id);
      const direction = stop.Name.endsWith(" Northbound")
        ? "northbound"
        : stop.Name.endsWith(" Southbound") ? "southbound" : "unknown";
      const stationName = stop.Name
        .replace(/ Caltrain Station(?: Northbound| Southbound)?$/, "")
        .trim();
      if (!stationName) throw new Error("missing station name");
      return {
        id: stop.id,
        stationID: stop.Extensions.ParentStation,
        stationName,
        direction,
        latitude: stop.Location.Latitude,
        longitude: stop.Location.Longitude,
        validFrom: stop.Extensions.ValidBetween.FromDate,
        validUntil: stop.Extensions.ValidBetween.ToDate,
      } satisfies CaltrainStop;
    });
    return { observedAt: parsed.Contents.ResponseTimestamp, stops };
  } catch {
    throw new Error("Invalid Caltrain Stops snapshot");
  }
}
