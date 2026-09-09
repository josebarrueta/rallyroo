export function safeGTFSInteger(value: unknown): number {
  const number = Number(
    typeof value === "object" && value !== null && "toString" in value
      ? value.toString()
      : value,
  );
  if (!Number.isSafeInteger(number)) throw new Error("invalid GTFS integer");
  return number;
}

export function gtfsEpochSeconds(value: number): string {
  const milliseconds = value * 1_000;
  if (!Number.isSafeInteger(milliseconds)) throw new Error("invalid GTFS timestamp");
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid GTFS timestamp");
  return date.toISOString();
}
