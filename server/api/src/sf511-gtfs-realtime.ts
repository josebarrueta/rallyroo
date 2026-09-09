import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime: gtfs } = GtfsRealtimeBindings;

export interface CaltrainRealtimeStopUpdate {
  stopID: string;
  stopSequence: number;
  delaySeconds: number;
  eventTime: string | null;
}

export interface CaltrainRealtimeTrip {
  id: string;
  tripID: string;
  routeID: string;
  directionID: number | null;
  startDate: string | null;
  startTime: string | null;
  status: "scheduled" | "canceled";
  stops: CaltrainRealtimeStopUpdate[];
}

export interface CaltrainTripUpdatesSnapshot {
  observedAt: string;
  validUntil: string;
  trips: CaltrainRealtimeTrip[];
}

export function decodeCaltrainTripUpdates(body: Uint8Array): CaltrainTripUpdatesSnapshot {
  try {
    if (body.byteLength < 1) throw new Error("empty feed");
    const feed = gtfs.FeedMessage.decode(body);
    const timestamp = safeInteger(feed.header.timestamp);
    if (timestamp < 1 || feed.entity.length > 500) throw new Error("invalid header");
    const observedAt = epochSeconds(timestamp);
    const trips: CaltrainRealtimeTrip[] = [];
    for (const entity of feed.entity) {
      if (entity.isDeleted || !entity.tripUpdate) continue;
      const update = entity.tripUpdate;
      const trip = update.trip;
      const stopUpdates = update.stopTimeUpdate ?? [];
      if (!entity.id || entity.id.length > 300
        || !trip?.tripId || trip.tripId.length > 300
        || !trip.routeId || trip.routeId.length > 200
        || (trip.startDate && !/^\d{8}$/.test(trip.startDate))
        || (trip.startTime && !/^\d{1,2}:\d{2}:\d{2}$/.test(trip.startTime))
        || stopUpdates.length > 500) {
        throw new Error("invalid trip");
      }
      const stops = stopUpdates.map((stop) => {
        if (!stop.stopId || stop.stopId.length > 200) throw new Error("invalid stop");
        const stopSequence = Number(stop.stopSequence);
        if (!Number.isSafeInteger(stopSequence) || stopSequence < 0) throw new Error("invalid sequence");
        const event = stop.arrival ?? stop.departure;
        const delaySeconds = event ? Number(event.delay) : 0;
        if (!Number.isSafeInteger(delaySeconds) || Math.abs(delaySeconds) > 24 * 60 * 60) {
          throw new Error("invalid delay");
        }
        const eventSeconds = event ? safeInteger(event.time) : 0;
        return {
          stopID: stop.stopId,
          stopSequence,
          delaySeconds,
          eventTime: eventSeconds > 0 ? epochSeconds(eventSeconds) : null,
        };
      }).sort((left, right) => left.stopSequence - right.stopSequence);
      trips.push({
        id: entity.id,
        tripID: trip.tripId,
        routeID: trip.routeId,
        directionID: Object.prototype.hasOwnProperty.call(trip, "directionId")
          && Number.isSafeInteger(Number(trip.directionId))
          ? Number(trip.directionId)
          : null,
        startDate: trip.startDate || null,
        startTime: trip.startTime || null,
        status: trip.scheduleRelationship === gtfs.TripDescriptor.ScheduleRelationship.CANCELED
          ? "canceled"
          : "scheduled",
        stops,
      });
    }
    return {
      observedAt,
      validUntil: epochSeconds(timestamp + 3 * 60),
      trips,
    };
  } catch {
    throw new Error("Invalid Caltrain Trip Updates feed");
  }
}

function safeInteger(value: unknown): number {
  const number = Number(
    typeof value === "object" && value !== null && "toString" in value
      ? value.toString()
      : value,
  );
  if (!Number.isSafeInteger(number)) throw new Error("invalid integer");
  return number;
}

function epochSeconds(value: number): string {
  const milliseconds = value * 1_000;
  if (!Number.isSafeInteger(milliseconds)) throw new Error("invalid timestamp");
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid timestamp");
  return date.toISOString();
}
