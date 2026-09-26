import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  addresses: [{ address: "93.184.215.14", family: 4 }],
  requests: [] as Array<{ url: URL; options: Record<string, any> }>,
  responses: [] as Array<{ status: number; headers?: Record<string, string>; body?: string }>,
}));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => hostname === "127.0.0.1"
    ? [{ address: "127.0.0.1", family: 4 }]
    : mock.addresses),
}));
vi.mock("node:https", () => ({
  default: {
    request(url: URL, options: Record<string, any>, handler: (response: Readable) => void) {
      mock.requests.push({ url, options });
      const request = new EventEmitter() as EventEmitter & { end(): void; setTimeout(ms: number, cb: () => void): void };
      request.setTimeout = () => {};
      request.end = () => {
        options.lookup(url.hostname, { all: true }, (error: Error | null, addresses: unknown) => {
          if (error) return request.emit("error", error);
          if (!Array.isArray(addresses) || addresses.length !== 1 || addresses[0]?.address !== mock.addresses[0]?.address) {
            return request.emit("error", new TypeError("Invalid IP address: undefined"));
          }
          const result = mock.responses.shift() ?? { status: 200, body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" };
          const response = Readable.from([Buffer.from(result.body ?? "")]);
          Object.assign(response, { statusCode: result.status, headers: result.headers ?? {} });
          handler(response);
        });
      };
      return request;
    },
  },
}));

import { fetchPublicCalendarFeed, validateCalendarFeedURL } from "../src/calendar-source-adapters.js";

describe("server-side calendar feed fetch", () => {
  beforeEach(() => {
    mock.addresses = [{ address: "93.184.215.14", family: 4 }];
    mock.requests.length = 0;
    mock.responses.length = 0;
  });

  it("pins a public DNS result in Node's all-address lookup mode", async () => {
    const feed = await fetchPublicCalendarFeed("https://feeds.example.test/schedule.ics");
    expect(feed.body).toContain("BEGIN:VCALENDAR");
    expect(mock.requests).toHaveLength(1);
  });

  it("rejects private DNS answers before making an HTTP request", async () => {
    mock.addresses = [{ address: "127.0.0.1", family: 4 }];
    await expect(fetchPublicCalendarFeed("https://feeds.example.test/schedule.ics"))
      .rejects.toThrow("public addresses");
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects URLs with credentials, fragments, nonstandard ports, or ambiguous separators", () => {
    for (const url of [
      "https://name:secret@feeds.example.test/feed.ics",
      "https://feeds.example.test/feed.ics#fragment",
      "https://feeds.example.test:8443/feed.ics",
      "https:\\private.test/feed.ics",
      `https://feeds.example.test/${"x".repeat(2048)}`,
    ]) expect(validateCalendarFeedURL(url)).toBe(false);
    expect(validateCalendarFeedURL("https://feeds.example.test/team_schedule/filter/games/test.ics")).toBe(true);
  });

  it("rejects DNS answers with both public and private addresses", async () => {
    mock.addresses = [
      { address: "93.184.215.14", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    await expect(fetchPublicCalendarFeed("https://feeds.example.test/schedule.ics"))
      .rejects.toThrow("public addresses");
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects non-calendar content types", async () => {
    mock.responses.push({ status: 200, headers: { "content-type": "text/html" }, body: "<html>login</html>" });
    await expect(fetchPublicCalendarFeed("https://feeds.example.test/schedule.ics"))
      .rejects.toThrow("not an iCalendar file");
  });

  it("rejects redirect targets on private infrastructure", async () => {
    mock.responses.push({ status: 302, headers: { location: "https://127.0.0.1/internal" } });
    await expect(fetchPublicCalendarFeed("https://feeds.example.test/schedule.ics"))
      .rejects.toThrow("public addresses");
    expect(mock.requests).toHaveLength(1);
  });

  it("rejects a not-modified response without an existing validator", async () => {
    mock.responses.push({ status: 304 });
    await expect(fetchPublicCalendarFeed("https://feeds.example.test/schedule.ics"))
      .rejects.toThrow("without a cached snapshot");
  });

  it("does not send feed validators to a different redirect origin", async () => {
    mock.responses.push({ status: 302, headers: { location: "https://other.example.test/calendar.ics" } });
    await fetchPublicCalendarFeed("https://feeds.example.test/schedule.ics", { etag: "opaque-validator" });
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0]!.options.headers["if-none-match"]).toBe("opaque-validator");
    expect(mock.requests[1]!.options.headers["if-none-match"]).toBeUndefined();
  });
});
