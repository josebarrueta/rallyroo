import { readFileSync } from "node:fs";

export type SecretFileReader = (path: string) => string;

export interface CaltrainPollingConfiguration {
  enabled: boolean;
  intervalMilliseconds: number;
  maximumBackoffMilliseconds: number;
}

export function caltrainPollingConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): CaltrainPollingConfiguration {
  const enabledValue = environment.CALTRAIN_POLLING_ENABLED ?? "false";
  if (enabledValue !== "true" && enabledValue !== "false") invalidCaltrainPollingConfiguration();
  const intervalSeconds = boundedInteger(
    environment.CALTRAIN_POLL_INTERVAL_SECONDS ?? "120",
    60,
    3_600,
  );
  const maximumBackoffSeconds = boundedInteger(
    environment.CALTRAIN_POLL_MAX_BACKOFF_SECONDS ?? "3600",
    60,
    21_600,
  );
  if (maximumBackoffSeconds < intervalSeconds) invalidCaltrainPollingConfiguration();
  return {
    enabled: enabledValue === "true",
    intervalMilliseconds: intervalSeconds * 1_000,
    maximumBackoffMilliseconds: maximumBackoffSeconds * 1_000,
  };
}

function boundedInteger(value: string, minimum: number, maximum: number): number {
  if (!/^[0-9]+$/.test(value)) invalidCaltrainPollingConfiguration();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    invalidCaltrainPollingConfiguration();
  }
  return parsed;
}

function invalidCaltrainPollingConfiguration(): never {
  throw new Error("Invalid Caltrain polling configuration");
}

export function configuredSecret(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
  readSecretFile: SecretFileReader = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const file = environment[`${name}_FILE`];
  if (file) {
    const value = readSecretFile(file).trim();
    if (!value) throw new Error(`${name}_FILE is empty`);
    return value;
  }
  return environment[name];
}
