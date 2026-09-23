export interface CaltrainPositionPollingPlan {
  pollPositions: boolean;
  nextDelayMilliseconds: number;
}

const activeDelayMilliseconds = 2 * 60 * 1_000;
const backgroundDelayMilliseconds = 30 * 60 * 1_000;
const serviceStartsAtMinutes = 4 * 60 + 30;
const serviceEndsAtMinutes = 1 * 60 + 30;
const localTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function caltrainPositionPollingPlan(
  now: Date,
  viewerDemandIsActive: boolean,
  lastPositionAttempt: Date | null,
): CaltrainPositionPollingPlan {
  const parts = Object.fromEntries(
    localTime.formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const minute = parts.hour! * 60 + parts.minute!;
  const serviceMayBeRunning = minute >= serviceStartsAtMinutes || minute < serviceEndsAtMinutes;
  const elapsedMilliseconds = lastPositionAttempt
    ? now.getTime() - lastPositionAttempt.getTime()
    : Number.POSITIVE_INFINITY;
  const requiredDelayMilliseconds = viewerDemandIsActive
    ? activeDelayMilliseconds
    : backgroundDelayMilliseconds;
  return {
    pollPositions: serviceMayBeRunning && elapsedMilliseconds >= requiredDelayMilliseconds,
    nextDelayMilliseconds: activeDelayMilliseconds,
  };
}
