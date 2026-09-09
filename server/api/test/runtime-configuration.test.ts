import { describe, expect, it } from "vitest";
import {
  caltrainPollingConfiguration,
  configuredSecret,
} from "../src/runtime-configuration.js";

describe("configuredSecret", () => {
  it("prefers a mounted secret file over a legacy environment value", () => {
    const value = configuredSecret("PROVIDER_TOKEN", {
      PROVIDER_TOKEN: "legacy-local-value",
      PROVIDER_TOKEN_FILE: "/run/secrets/provider/token",
    }, (path) => {
      expect(path).toBe("/run/secrets/provider/token");
      return "mounted-value";
    });

    expect(value).toBe("mounted-value");
  });

  it("trims line endings from mounted secret files", () => {
    const value = configuredSecret("PROVIDER_TOKEN", {
      PROVIDER_TOKEN_FILE: "/run/secrets/provider/token",
    }, () => "mounted-value\n");

    expect(value).toBe("mounted-value");
  });

  it("retains environment compatibility for local development", () => {
    expect(configuredSecret("PROVIDER_TOKEN", {
      PROVIDER_TOKEN: "local-value",
    })).toBe("local-value");
  });
});

describe("caltrainPollingConfiguration", () => {
  it("defaults to disabled polling at a two-minute interval", () => {
    expect(caltrainPollingConfiguration({})).toEqual({
      enabled: false,
      intervalMilliseconds: 120_000,
      maximumBackoffMilliseconds: 3_600_000,
    });
  });

  it("accepts a bounded interval that can be raised after quota approval", () => {
    expect(caltrainPollingConfiguration({
      CALTRAIN_POLLING_ENABLED: "true",
      CALTRAIN_POLL_INTERVAL_SECONDS: "65",
      CALTRAIN_POLL_MAX_BACKOFF_SECONDS: "900",
    })).toEqual({
      enabled: true,
      intervalMilliseconds: 65_000,
      maximumBackoffMilliseconds: 900_000,
    });
  });

  it.each([
    { CALTRAIN_POLLING_ENABLED: "yes" },
    { CALTRAIN_POLL_INTERVAL_SECONDS: "59" },
    { CALTRAIN_POLL_INTERVAL_SECONDS: "not-a-number" },
    { CALTRAIN_POLL_MAX_BACKOFF_SECONDS: "59" },
  ])("rejects unsafe configuration: %j", (environment) => {
    expect(() => caltrainPollingConfiguration(environment)).toThrow("Invalid Caltrain polling configuration");
  });
});
