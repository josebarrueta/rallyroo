import { describe, expect, it } from "vitest";
import { SF511Client, SF511ProviderError } from "../src/sf511-client.js";

const testKey = "fixture-key-not-a-secret";

describe("SF511Client", () => {
  it("constructs fixed credentialed requests only inside the adapter", async () => {
    const requests: Array<[URL, RequestInit]> = [];
    const fetcher = async (url: URL, options: RequestInit) => {
      requests.push([url, options]);
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      });
    };
    const client = new SF511Client(testKey, fetcher);

    await expect(client.tripUpdates()).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(client.serviceAlerts()).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(client.stops()).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(client.staticSchedule()).resolves.toEqual(new Uint8Array([1, 2, 3]));

    expect(requests).toHaveLength(4);
    const [tripURL, tripOptions] = requests[0]!;
    expect(tripURL).toBeInstanceOf(URL);
    expect(tripURL.origin).toBe("https://api.511.org");
    expect(tripURL.pathname).toBe("/Transit/TripUpdates");
    expect(tripURL.searchParams.get("agency")).toBe("CT");
    expect(tripURL.searchParams.get("api_key")).toBe(testKey);
    expect(tripOptions).toMatchObject({
      redirect: "error",
      headers: expect.objectContaining({ "accept-encoding": "gzip, deflate" }),
    });
    const [stopsURL] = requests[2]!;
    expect(stopsURL.pathname).toBe("/transit/stops");
    expect(stopsURL.searchParams.get("operator_id")).toBe("CT");
    expect(stopsURL.searchParams.get("format")).toBe("json");
    const [scheduleURL] = requests[3]!;
    expect(scheduleURL.pathname).toBe("/transit/datafeeds");
    expect(scheduleURL.searchParams.get("operator_id")).toBe("CT");
  });

  it("bounds response bodies and never includes credentialed URLs in errors", async () => {
    const client = new SF511Client(testKey, async () => new Response(null, {
      status: 429,
      headers: {
        "content-length": String(6 * 1024 * 1024),
        "retry-after": "300",
      },
    }));

    let caught: unknown;
    try {
      await client.tripUpdates();
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(new SF511ProviderError("http_error", 429, 300));
    expect(String(caught)).not.toContain(testKey);
    expect(String(caught)).not.toContain("api.511.org");
  });

  it("rejects oversized successful bodies even without Content-Length", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const client = new SF511Client(testKey, async () => new Response(oversized));

    await expect(client.serviceAlerts())
      .rejects.toEqual(new SF511ProviderError("response_too_large"));
  });
});
