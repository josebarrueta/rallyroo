import { describe, expect, it, vi } from "vitest";
import { GoogleRoutingError, GoogleRoutingProvider } from "../src/google-routing-provider.js";
import type { RouteEstimateRequest } from "../src/travel-preview.js";

const apiKey = "g-test-key-not-a-secret";

function request(overrides: Partial<RouteEstimateRequest> = {}): RouteEstimateRequest {
  return {
    origin: { kind: "address", address: "1 Market St, San Francisco, CA" },
    destination: { kind: "place_id", placeID: "ChIJ_destination" },
    departureTime: new Date("2026-08-01T12:00:00.000Z"),
    trafficPreference: "best_guess",
    ...overrides,
  };
}

function routeResponse(duration = "1532s", distanceMeters: unknown = 48_200): Response {
  return new Response(JSON.stringify({ routes: [{ duration, distanceMeters }] }), { status: 200 });
}

describe("GoogleRoutingProvider", () => {
  it("sends the documented minimal Compute Routes request", async () => {
    let capturedURL: URL | undefined;
    let capturedInit: RequestInit | undefined;
    const provider = new GoogleRoutingProvider(apiKey, {
      fetch: async (url, init) => {
        capturedURL = url;
        capturedInit = init;
        return routeResponse();
      },
    });

    await expect(provider.estimate(request())).resolves.toEqual({
      durationSeconds: 1_532,
      distanceMeters: 48_200,
    });
    expect(capturedURL?.href).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.redirect).toBe("error");
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedInit?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      origin: { address: "1 Market St, San Francisco, CA" },
      destination: { placeId: "ChIJ_destination" },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      departureTime: "2026-08-01T12:00:00.000Z",
      computeAlternativeRoutes: false,
      languageCode: "en-US",
      units: "IMPERIAL",
      trafficModel: "BEST_GUESS",
    });
  });

  it("supports place IDs and pessimistic traffic", async () => {
    let body: Record<string, unknown> = {};
    const provider = new GoogleRoutingProvider(apiKey, {
      fetch: async (_url, init) => {
        body = JSON.parse(String(init.body));
        return routeResponse("60.5s", 100);
      },
    });
    const estimate = await provider.estimate(request({
      origin: { kind: "place_id", placeID: "ChIJ_origin" },
      trafficPreference: "pessimistic",
    }));
    expect(estimate.durationSeconds).toBe(60.5);
    expect(body.origin).toEqual({ placeId: "ChIJ_origin" });
    expect(body.trafficModel).toBe("PESSIMISTIC");
  });

  it("maps HTTP and network failures to non-sensitive errors", async () => {
    const secret = "42 Super Secret Street";
    const httpProvider = new GoogleRoutingProvider(apiKey, {
      fetch: async () => new Response(`provider leaked ${secret}`, { status: 503 }),
    });
    await expect(httpProvider.estimate(request({
      origin: { kind: "address", address: secret },
    }))).rejects.toEqual(new GoogleRoutingError("http_error", 503));

    const networkProvider = new GoogleRoutingProvider(apiKey, {
      fetch: async () => { throw new Error(`network leaked ${secret}`); },
    });
    let caught: unknown;
    try {
      await networkProvider.estimate(request({ origin: { kind: "address", address: secret } }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(new GoogleRoutingError("network_error"));
    expect(String(caught)).not.toContain(secret);
    expect(String(caught)).not.toContain(apiKey);
  });

  it.each([
    new Response("", { status: 200 }),
    new Response("not-json", { status: 200 }),
    new Response(JSON.stringify({}), { status: 200 }),
    new Response(JSON.stringify({ routes: [] }), { status: 200 }),
    routeResponse("bad", 100),
    routeResponse("12s", 0),
    routeResponse("12s", "100"),
  ])("rejects malformed or empty provider responses", async (response) => {
    const provider = new GoogleRoutingProvider(apiKey, { fetch: async () => response });
    await expect(provider.estimate(request())).rejects.toBeInstanceOf(GoogleRoutingError);
  });

  it("aborts requests after the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const provider = new GoogleRoutingProvider(apiKey, {
        requestTimeoutMilliseconds: 10,
        fetch: async (_url, init) => {
          signal = init.signal ?? undefined;
          return await new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        },
      });
      const result = expect(provider.estimate(request())).rejects.toEqual(
        new GoogleRoutingError("network_error"),
      );
      await vi.advanceTimersByTimeAsync(10);
      await result;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects missing keys and invalid timeouts", () => {
    expect(() => new GoogleRoutingProvider(" ")).toThrowError(
      new GoogleRoutingError("invalid_configuration"),
    );
    expect(() => new GoogleRoutingProvider(apiKey, { requestTimeoutMilliseconds: 0 })).toThrowError(
      new GoogleRoutingError("invalid_configuration"),
    );
  });
});
