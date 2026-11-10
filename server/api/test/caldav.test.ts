import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import type { InjectOptions } from "fastify";
// Fastify's runtime supports registered WebDAV methods; inject's type lists only standard methods.
const PROPFIND = "PROPFIND" as NonNullable<InjectOptions["method"]>;
const REPORT = "REPORT" as NonNullable<InjectOptions["method"]>;
import { buildApp } from "../src/app.js";
import { calendarPreviewConfiguration } from "../src/caldav.js";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";
import type { IdentityProvider } from "../src/identity-provider.js";

const identityProvider: IdentityProvider = {
  googleAuthorizationURL: () => "https://identity.example/google",
  appleAuthorizationURL: () => "https://identity.example/apple",
  authenticateOAuthToken: async () => { throw new Error("unused"); },
  verifySession: async (token) => {
    if (!["parent", "kid", "other"].includes(token)) throw new Error("invalid");
    return { subject: token, displayName: token };
  },
  revokeSession: async () => {}, deleteIdentity: async () => {},
};

function fixture(enabled = true, logger?: Parameters<typeof buildApp>[0]["logger"], allowedIdentitySubjects = ["parent", "kid", "other"]) {
  const repository = new InMemoryRallyrooRepository({
    accounts: [
      { identitySubject: "parent", familyID: "family", memberID: "p", role: "parent" },
      { identitySubject: "kid", familyID: "family", memberID: "k", role: "kid" },
      { identitySubject: "other", familyID: "other", memberID: "o", role: "parent" },
    ],
    members: [
      { familyID: "family", id: "p", name: "Parent", role: "parent", colorTag: "blue" },
      { familyID: "family", id: "k", name: "Kid", role: "kid", colorTag: "blue" },
      { familyID: "other", id: "o", name: "Other", role: "parent", colorTag: "blue" },
    ],
  });
  const app = buildApp({ identityProvider, repository, ...(logger ? { logger } : {}),
    ...(enabled ? { caldav: { publicOrigin: "https://calendar.example", allowedIdentitySubjects } } : {}),
  });
  return { app, repository };
}
const bearer = (token = "parent") => ({ authorization: `Bearer ${token}` });
const basic = (username: string, password: string) => ({
  authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
});

async function connection(app: ReturnType<typeof buildApp>, timeZone?: string) {
  const response = await app.inject({ method: "POST", url: "/v1/calendar-connections", headers: bearer(),
    ...(timeZone ? { payload: { timeZone } } : {}),
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; username: string; password: string; serverURL: string }>();
}

const calendarData = (title = "Dentist", uid = "apple-event@example.test") => [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//Calendar//EN", "BEGIN:VEVENT",
  `UID:${uid}`, "DTSTAMP:20270101T120000Z", "DTSTART:20270104T150000Z", "DTEND:20270104T160000Z",
  `SUMMARY:${title}`, "X-APPLE-CUSTOM:preserve-me", "END:VEVENT", "END:VCALENDAR", "",
].join("\r\n");

describe("calendar preview configuration", () => {
  it("defaults off and requires an explicit HTTPS origin and identity cohort", () => {
    expect(calendarPreviewConfiguration({})).toBeUndefined();
    expect(calendarPreviewConfiguration({ CALDAV_PREVIEW_PUBLIC_ORIGIN: "", CALDAV_PREVIEW_IDENTITY_SUBJECTS: "" })).toBeUndefined();
    expect(calendarPreviewConfiguration({ CALDAV_PREVIEW_PUBLIC_ORIGIN: "https://calendar.example",
      CALDAV_PREVIEW_IDENTITY_SUBJECTS: '["parent"]' })).toEqual({ publicOrigin: "https://calendar.example", allowedIdentitySubjects: ["parent"] });
  });
  it.each([
    { CALDAV_PREVIEW_PUBLIC_ORIGIN: "https://calendar.example" },
    { CALDAV_PREVIEW_IDENTITY_SUBJECTS: '["parent"]' },
    { CALDAV_PREVIEW_PUBLIC_ORIGIN: "http://calendar.example", CALDAV_PREVIEW_IDENTITY_SUBJECTS: '["parent"]' },
    ...['["*"]', '[""]', '[" parent "]', '[123]', '{}', 'invalid-private-value'].map((subjects) => ({
      CALDAV_PREVIEW_PUBLIC_ORIGIN: "https://calendar.example", CALDAV_PREVIEW_IDENTITY_SUBJECTS: subjects,
    })),
  ])("rejects incomplete or unsafe configuration without echoing private values", (environment) => {
    expect(() => calendarPreviewConfiguration(environment)).toThrow(/^Invalid calendar preview configuration$/);
  });
});

describe("CalDAV writes", () => {
  it("restricts preview enrollment to selected identities without disabling ordinary Family access", async () => {
    const { app } = fixture(true, undefined, ["parent"]);
    try {
      expect((await app.inject({ url: "/v1/events", headers: bearer("other") })).statusCode).toBe(200);
      for (const method of ["GET", "POST"] as const) {
        const denied = await app.inject({ method, url: "/v1/calendar-connections", headers: bearer("other") });
        expect(denied.statusCode).toBe(403);
        expect(denied.json()).toEqual({ error: "calendar_preview_unavailable" });
      }
      const c = await connection(app);
      expect((await app.inject({ url: `/dav/calendars/${c.id}/family/`, method: PROPFIND,
        headers: { ...basic(c.username, c.password), depth: "0" } })).statusCode).toBe(207);
    } finally { await app.close(); }
  });

  it("denies an existing calendar password after preview access is removed but still permits owner revocation", async () => {
    const { app, repository } = fixture();
    const restricted = buildApp({ repository, identityProvider,
      caldav: { publicOrigin: "https://calendar.example", allowedIdentitySubjects: ["other"] } });
    try {
      const c = await connection(app);
      const url = `/dav/calendars/${c.id}/family/`;
      expect((await app.inject({ url, method: PROPFIND, headers: basic(c.username, c.password) })).statusCode).toBe(207);
      expect((await restricted.inject({ url, method: PROPFIND, headers: basic(c.username, c.password) })).statusCode).toBe(401);
      expect((await restricted.inject({ url: "/v1/calendar-connections", headers: bearer() })).statusCode).toBe(403);
      expect((await restricted.inject({ method: "DELETE", url: `/v1/calendar-connections/${c.id}`, headers: bearer() })).statusCode).toBe(204);
      expect((await app.inject({ url, method: PROPFIND, headers: basic(c.username, c.password) })).statusCode).toBe(401);
    } finally { await app.close(); await restricted.close(); }
  });

  it("keeps preview enrollment closed for an explicitly empty cohort", async () => {
    const { app } = fixture(true, undefined, []);
    try {
      expect((await app.inject({ method: "POST", url: "/v1/calendar-connections", headers: bearer() })).statusCode).toBe(403);
      expect((await app.inject({ url: "/v1/calendar-connections", headers: bearer(),
        query: { identitySubject: "parent" } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it("rejects oversized durations before calendar endpoint normalization can block the server", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const url = `/dav/calendars/${c.id}/family/duration-bound.ics`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar", "if-none-match": "*" };
      for (const duration of ["P999999999999999999999999999999999999999D", "P99999999999999W", "PT99999999999999999999999999999H", "-P999999999999999999999999999D", "P3661D"]) {
        const payload = calendarData("Bounded duration").replace("DTEND:20270104T160000Z", `DURATION:${duration}`);
        expect((await app.inject({ method: "PUT", url, headers, payload })).statusCode).toBe(403);
      }
      const overflow = calendarData().replace("DTSTART:20270104T150000Z", "DTSTART:99991231T150000Z")
        .replace("DTEND:20270104T160000Z", "DURATION:P1D");
      expect((await app.inject({ method: "PUT", url, headers, payload: overflow })).statusCode).toBe(403);
      expect((await app.inject({ url: "/v1/events", headers: bearer() })).json()).toEqual([]);
      const valid = calendarData("Bounded duration").replace("DTEND:20270104T160000Z", "DURATION:P3660D");
      expect((await app.inject({ method: "PUT", url, headers, payload: valid })).statusCode).toBe(201);
    } finally { await app.close(); }
  });

  it("bounds display-alarm durations while retaining ordinary relative and absolute alarms", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const base = `/dav/calendars/${c.id}/family/`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar", "if-none-match": "*" };
      const withAlarm = (properties: string[], uid = "alarm@example.test") => calendarData("Alarm preview", uid)
        .replace("END:VEVENT", ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Preview alert", ...properties, "END:VALARM", "END:VEVENT"].join("\r\n"));
      for (const properties of [
        ["TRIGGER:-P999999999999999999999999999D"],
        ["TRIGGER:-PT15M", "REPEAT:1", "DURATION:P3661D"],
        ["TRIGGER:-PT15M", "REPEAT:1", "DURATION:-PT1M"],
        ["TRIGGER;VALUE=DATE:20270104"],
        ["TRIGGER;VALUE=DATE-TIME:20270104T140000"],
      ]) expect((await app.inject({ method: "PUT", url: base + "invalid-alarm.ics", headers, payload: withAlarm(properties) })).statusCode).toBe(403);
      for (const [index, properties] of [
        ["TRIGGER:-PT15M"], ["TRIGGER:PT0S"], ["TRIGGER;VALUE=DATE-TIME:20270104T140000Z"],
        ["TRIGGER:-PT15M", "REPEAT:2", "DURATION:PT5M"],
      ].entries()) {
        const payload = withAlarm(properties, `alarm-${index}@example.test`);
        const url = `${base}alarm-${index}.ics`;
        expect((await app.inject({ method: "PUT", url, headers, payload })).statusCode).toBe(201);
        expect((await app.inject({ url, headers: basic(c.username, c.password) })).body).toBe(payload);
      }
    } finally { await app.close(); }
  });

  it("round-trips date-only events across DST and preserves their anchor on another parent's calendar connection", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app, "America/Los_Angeles");
      const url = `/dav/calendars/${c.id}/family/all-day.ics`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar" };
      const payload = calendarData("Family break")
        .replace("DTSTART:20270104T150000Z", "DTSTART;VALUE=DATE:20270314")
        .replace("DTEND:20270104T160000Z", "DTEND;VALUE=DATE:20270316");
      expect((await app.inject({ method: "PUT", url, headers: { ...headers, "if-none-match": "*" }, payload })).statusCode).toBe(201);
      const [event] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<{ id: string } & Record<string, unknown>>>();
      expect(event).toMatchObject({ startTime: "2027-03-14T08:00:00.000Z", endTime: "2027-03-16T07:00:00.000Z",
        allDay: { startDate: "2027-03-14", endDate: "2027-03-16", timeZone: "America/Los_Angeles" } });
      expect((await app.inject({ url, headers })).body).toBe(payload);
      const native = await app.inject({ method: "PUT", url: `/v1/events/${event!.id}`,
        headers: { ...bearer(), "idempotency-key": randomUUID() }, payload: { ...event, title: "Updated in Rallyroo" } });
      expect(native.statusCode).toBe(200);
      const fetched = await app.inject({ url, headers });
      expect(fetched.body).toContain("DTSTART;VALUE=DATE:20270314");
      expect(fetched.body).toContain("DTEND;VALUE=DATE:20270316");
      expect(fetched.body).toContain("SUMMARY:Updated in Rallyroo");
      const otherConnection = await connection(app, "Asia/Tokyo");
      const otherURL = `/dav/calendars/${otherConnection.id}/family/all-day.ics`;
      const otherHeaders = { ...basic(otherConnection.username, otherConnection.password), "content-type": "text/calendar" };
      const other = await app.inject({ url: otherURL, headers: otherHeaders });
      expect(other.body).toBe(fetched.body);
      expect((await app.inject({ method: "PUT", url: otherURL, headers: { ...otherHeaders, "if-match": String(other.headers.etag) },
        payload: other.body.replace("Updated in Rallyroo", "Edited from Tokyo") })).statusCode).toBe(204);
      const [saved] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<Record<string, unknown>>>();
      expect(saved).toMatchObject({ title: "Edited from Tokyo", startTime: "2027-03-14T08:00:00.000Z", endTime: "2027-03-16T07:00:00.000Z",
        allDay: { startDate: "2027-03-14", endDate: "2027-03-16", timeZone: "America/Los_Angeles" } });
    } finally { await app.close(); }
  });

  it("uses exclusive all-day ends, defaults a missing end to the next date, and rejects invalid date semantics", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app, "America/Los_Angeles");
      const base = `/dav/calendars/${c.id}/family/`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar", "if-none-match": "*" };
      const dateOnly = calendarData().replace("DTSTART:20270104T150000Z", "DTSTART;VALUE=DATE:20270314");
      const missingEnd = dateOnly.replace("DTEND:20270104T160000Z\r\n", "");
      expect((await app.inject({ method: "PUT", url: base + "single-day.ics", headers, payload: missingEnd })).statusCode).toBe(201);
      const [event] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<Record<string, unknown>>>();
      expect(event).toMatchObject({ startTime: "2027-03-14T08:00:00.000Z", endTime: "2027-03-15T07:00:00.000Z",
        allDay: { startDate: "2027-03-14", endDate: "2027-03-15" } });
      for (const payload of [
        dateOnly, // mixed DATE and DATE-TIME
        missingEnd.replace("20270314", "20270230"),
        dateOnly.replace("DTEND:20270104T160000Z", "DTEND;VALUE=DATE:20270314"),
        dateOnly.replace("DTEND:20270104T160000Z", "DURATION:PT24H"),
      ]) expect((await app.inject({ method: "PUT", url: base + "invalid.ics", headers,
        payload: payload.replace("apple-event@example.test", `${randomUUID()}@invalid.example.test`) })).statusCode).toBe(403);
      const duration = dateOnly.replace("DTEND:20270104T160000Z", "DURATION:P1D").replace("apple-event@example.test", "duration@example.test");
      expect((await app.inject({ method: "PUT", url: base + "duration-day.ics", headers, payload: duration })).statusCode).toBe(201);
      expect((await app.inject({ url: base + "duration-day.ics", headers: basic(c.username, c.password) })).body).toBe(duration);
    } finally { await app.close(); }
  });

  it("exports a native all-day Event as DATE values and leaves unspecified all-day alerts off", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app, "America/Los_Angeles");
      const id = randomUUID();
      const created = await app.inject({ method: "PUT", url: `/v1/events/${id}`, headers: { ...bearer(), "idempotency-key": randomUUID() },
        payload: { id, title: "Native family day", startTime: "2027-03-14T08:00:00.000Z", endTime: "2027-03-15T07:00:00.000Z",
          allDay: { startDate: "2027-03-14", endDate: "2027-03-15", timeZone: "america/los_angeles" }, source: "manual", status: "confirmed" } });
      expect(created.statusCode).toBe(200);
      const [event] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<Record<string, unknown>>>();
      expect(event).toMatchObject({ alertLeadTimeMinutes: null, allDay: { timeZone: "America/Los_Angeles" } });
      const url = `/dav/calendars/${c.id}/family/rallyroo-${id}.ics`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar" };
      const exported = await app.inject({ url, headers });
      expect(exported.statusCode).toBe(200);
      expect(exported.body).toContain("DTSTART;VALUE=DATE:20270314");
      expect(exported.body).toContain("DTEND;VALUE=DATE:20270315");
      expect((await app.inject({ method: "PUT", url, headers: { ...headers, "if-match": String(exported.headers.etag) },
        payload: exported.body.replace("Native family day", "Edited in Apple Calendar") })).statusCode).toBe(204);
      expect((await app.inject({ url: "/v1/events", headers: bearer() })).json()[0].title).toBe("Edited in Apple Calendar");
    } finally { await app.close(); }
  });

  it("queries all-day Events using the connection zone and exclusive overlap bounds", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app, "America/Los_Angeles");
      const url = `/dav/calendars/${c.id}/family/`;
      const auth = basic(c.username, c.password);
      const payload = calendarData("DST family day").replace("DTSTART:20270104T150000Z", "DTSTART;VALUE=DATE:20270314")
        .replace("DTEND:20270104T160000Z", "DTEND;VALUE=DATE:20270315");
      await app.inject({ method: "PUT", url: url + "day.ics", headers: { ...auth, "content-type": "text/calendar", "if-none-match": "*" }, payload });
      const query = (start: string, end: string, extra = "") => `<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter>${extra}</c:calendar-query>`;
      for (const [start, end, included] of [
        ["20270314T073000Z", "20270314T080000Z", false],
        ["20270314T080000Z", "20270314T080100Z", true],
        ["20270315T065900Z", "20270315T070000Z", true],
        ["20270315T070000Z", "20270315T080000Z", false],
      ] as const) {
        const response = await app.inject({ method: REPORT, url, headers: { ...auth, "content-type": "application/xml" }, payload: query(start, end) });
        expect(response.statusCode).toBe(207);
        expect(response.body.includes("DST family day")).toBe(included);
      }
      const unsupported = await app.inject({ method: REPORT, url, headers: { ...auth, "content-type": "application/xml" },
        payload: query("20270314T000000Z", "20270315T000000Z", "<c:timezone>custom zone</c:timezone>") });
      expect(unsupported.statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it("protects all-day metadata from older clients and requires explicit conversion to timed", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app, "America/Los_Angeles");
      const url = `/dav/calendars/${c.id}/family/all-day.ics`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar" };
      const payload = calendarData().replace("DTSTART:20270104T150000Z", "DTSTART;VALUE=DATE:20270314")
        .replace("DTEND:20270104T160000Z", "DTEND;VALUE=DATE:20270315");
      await app.inject({ method: "PUT", url, headers: { ...headers, "if-none-match": "*" }, payload });
      const [event] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<{ id: string } & Record<string, unknown>>>();
      const { allDay, ...legacy } = event!;
      const save = (body: Record<string, unknown>) => app.inject({ method: "PUT", url: `/v1/events/${event!.id}`,
        headers: { ...bearer(), "idempotency-key": randomUUID() }, payload: body });
      expect((await save({ ...legacy, title: "Legacy title edit" })).statusCode).toBe(200);
      const retained = (await app.inject({ url: "/v1/events", headers: bearer() })).json()[0];
      expect(retained.allDay).toEqual(allDay);
      expect(retained.alertLeadTimeMinutes).toBeNull();
      expect((await save({ ...legacy, startTime: "2027-03-14T09:00:00.000Z" })).statusCode).toBe(409);
      expect((await save({ ...event, startTime: "2027-03-14T09:00:00.000Z" })).statusCode).toBe(400);
      expect((await save({ ...event, allDay: null, startTime: "2027-03-14T09:00:00.000Z" })).statusCode).toBe(200);
      const converted = await app.inject({ url, headers });
      expect(converted.body).toContain("DTSTART:20270314T090000Z");
      expect(converted.body).not.toContain("VALUE=DATE");
    } finally { await app.close(); }
  });

  it("anchors midnight gaps and folds to the first real instant and rejects a skipped date", async () => {
    const { app } = fixture();
    try {
      for (const [timeZone, day, next, expectedStart, expectedEnd] of [
        ["America/Sao_Paulo", "20181104", "20181105", "2018-11-04T03:00:00.000Z", "2018-11-05T02:00:00.000Z"],
        ["America/Havana", "20181104", "20181105", "2018-11-04T04:00:00.000Z", "2018-11-05T05:00:00.000Z"],
      ] as const) {
        const c = await connection(app, timeZone);
        const headers = { ...basic(c.username, c.password), "content-type": "text/calendar", "if-none-match": "*" };
        const payload = calendarData(timeZone, timeZone + "@example.test")
          .replace("DTSTART:20270104T150000Z", `DTSTART;VALUE=DATE:${day}`).replace("DTEND:20270104T160000Z", `DTEND;VALUE=DATE:${next}`);
        expect((await app.inject({ method: "PUT", url: `/dav/calendars/${c.id}/family/${c.id}.ics`, headers, payload })).statusCode).toBe(201);
        const events = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<Record<string, unknown>>>();
        expect(events.find((e) => e.title === timeZone)).toMatchObject({ startTime: expectedStart, endTime: expectedEnd });
      }
      const c = await connection(app, "Pacific/Apia");
      const payload = calendarData().replace("DTSTART:20270104T150000Z", "DTSTART;VALUE=DATE:20111230")
        .replace("DTEND:20270104T160000Z", "DTEND;VALUE=DATE:20111231");
      expect((await app.inject({ method: "PUT", url: `/dav/calendars/${c.id}/family/skipped.ics`,
        headers: { ...basic(c.username, c.password), "content-type": "text/calendar", "if-none-match": "*" }, payload })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it("creates once, preserves opaque UID and extension data, and rejects stale edits", async () => {
    const { app } = fixture();
    try {
      const created = await connection(app);
      const headers = { ...basic(created.username, created.password), "content-type": "text/calendar" };
      const url = `/dav/calendars/${created.id}/family/client-selected.ics`;
      const saved = await app.inject({ method: "PUT", url, headers: { ...headers, "if-none-match": "*" }, payload: calendarData() });
      expect(saved.statusCode).toBe(201);
      const fetched = await app.inject({ url, headers });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.body).toBe(calendarData());
      expect(fetched.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
      const oldETag = String(fetched.headers.etag);
      expect((await app.inject({ method: "PUT", url, headers: { ...headers, "if-none-match": "*" }, payload: calendarData() })).statusCode).toBe(412);
      expect((await app.inject({ method: "PUT", url, headers: { ...headers, "if-match": oldETag }, payload: calendarData("Updated") })).statusCode).toBe(204);
      expect((await app.inject({ method: "PUT", url, headers: { ...headers, "if-match": oldETag }, payload: calendarData("Stale") })).statusCode).toBe(412);
      expect((await app.inject({ method: "DELETE", url, headers: { ...headers, "if-match": oldETag } })).statusCode).toBe(412);
      const events = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<{ title: string }>>();
      expect(events).toHaveLength(1);
      expect(events[0]!.title).toBe("Updated");
      const current = await app.inject({ url, headers });
      expect(current.body).toContain("X-APPLE-CUSTOM:preserve-me");
      expect((await app.inject({ method: "DELETE", url, headers: { ...headers, "if-match": String(current.headers.etag) } })).statusCode).toBe(204);
      expect((await app.inject({ url, headers })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});

describe("CalDAV discovery and isolation", () => {
  it("discovers a calendar with arbitrary XML prefixes and reports unknown properties", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const headers = { ...basic(c.username, c.password), depth: "1", "content-type": "application/xml" };
      const root = await app.inject({ method: PROPFIND, url: "/dav/", headers,
        payload: '<x:propfind xmlns:x="DAV:"><x:prop><x:current-user-principal/><x:unknown-property/></x:prop></x:propfind>' });
      expect(root.statusCode).toBe(207);
      expect(root.body).toContain(`/dav/principals/${c.id}/`);
      expect(root.body).toContain("404 Not Found");
      const wellKnown = await app.inject({ method: PROPFIND, url: "/.well-known/caldav", headers,
        payload: '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' });
      expect(wellKnown.statusCode).toBe(307);
      expect(wellKnown.headers.location).toBe("https://calendar.example/dav/");
      const home = await app.inject({ method: PROPFIND, url: `/dav/calendars/${c.id}/`, headers });
      expect(home.statusCode).toBe(207);
      expect(home.body).toContain("family/");
      expect(home.body).toContain("Rallyroo Family");
      expect(home.body).not.toContain("sync-collection");
      expect((await app.inject({ method: PROPFIND, url: "/dav/", headers: { ...headers, depth: "infinity" } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it("queries overlapping timed events and multigets missing resources without cross-connection access", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const base = `/dav/calendars/${c.id}/family/`;
      const auth = basic(c.username, c.password);
      await app.inject({ method: "PUT", url: base + "event.ics", headers: { ...auth, "content-type": "text/calendar", "if-none-match": "*" }, payload: calendarData() });
      const query = (start: string, end: string) => `<q:calendar-query xmlns:q="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><d:getetag/><q:calendar-data/></d:prop><q:filter><q:comp-filter name="VCALENDAR"><q:comp-filter name="VEVENT"><q:time-range start="${start}" end="${end}"/></q:comp-filter></q:comp-filter></q:filter></q:calendar-query>`;
      const headers = { ...auth, "content-type": "application/xml" };
      const matched = await app.inject({ method: REPORT, url: base, headers, payload: query("20270104T153000Z", "20270104T170000Z") });
      expect(matched.statusCode).toBe(207);
      expect(matched.body).toContain("Dentist");
      const excluded = await app.inject({ method: REPORT, url: base, headers, payload: query("20270104T160000Z", "20270104T170000Z") });
      expect(excluded.statusCode).toBe(207);
      expect(excluded.body).not.toContain("Dentist");
      const multiget = (href: string) => `<c:calendar-multiget xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><c:calendar-data/></d:prop><d:href>${href}</d:href></c:calendar-multiget>`;
      const missing = await app.inject({ method: REPORT, url: base, headers, payload: multiget(base + "missing.ics") });
      expect(missing.statusCode).toBe(207);
      expect(missing.body).toContain("404 Not Found");
      expect((await app.inject({ method: REPORT, url: base, headers, payload: multiget("https://evil.example/private.ics") })).statusCode).toBe(403);
      expect((await app.inject({ url: `/dav/calendars/${randomUUID()}/family/event.ics`, headers: auth })).statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it("rejects DTDs, deep XML, malformed hrefs, and unsupported event semantics without saving", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const auth = basic(c.username, c.password);
      const malicious = '<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><x:propfind xmlns:x="DAV:">&leak;</x:propfind>';
      expect((await app.inject({ method: PROPFIND, url: "/dav/", headers: { ...auth, "content-type": "application/xml" }, payload: malicious })).statusCode).toBe(400);
      expect((await app.inject({ method: PROPFIND, url: "/dav/", headers: { ...auth, "content-type": "application/xml" }, payload: '<x xmlns="DAV:">'.repeat(20) + '</x>'.repeat(20) })).statusCode).toBe(400);
      const base = `/dav/calendars/${c.id}/family/`;
      const headers = { ...auth, "content-type": "text/calendar", "if-none-match": "*" };
      for (const payload of [
        calendarData().replace("SUMMARY:Dentist", "RRULE:FREQ=DAILY\r\nSUMMARY:Dentist"),
        calendarData().replace("DTSTART:20270104T150000Z", "DTSTART:20270104T150000"),
        calendarData().replace("SUMMARY:Dentist", "ATTENDEE:mailto:someone@example.test\r\nSUMMARY:Dentist"),
        calendarData().replace("SUMMARY:Dentist", "CLASS:PRIVATE\r\nSUMMARY:Dentist"),
        calendarData().replace("SUMMARY:Dentist", "TRANSP:TRANSPARENT\r\nSUMMARY:Dentist"),
        calendarData().replace("END:VEVENT", "BEGIN:VALARM\r\nACTION:PROCEDURE\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT"),
      ]) {
        expect((await app.inject({ method: "PUT", url: base + "unsupported.ics", headers, payload })).statusCode).toBe(403);
      }
      expect((await app.inject({ method: "PUT", url: base + "bad%2Fname.ics", headers, payload: calendarData() })).statusCode).toBe(400);
      expect((await app.inject({ url: "/v1/events", headers: bearer() })).json()).toEqual([]);
    } finally { await app.close(); }
  });

  it("preserves Family-only fields during calendar edits and invalidates ETags after native edits", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const base = `/dav/calendars/${c.id}/family/`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar" };
      const url = base + "event.ics";
      await app.inject({ method: "PUT", url, headers: { ...headers, "if-none-match": "*" }, payload: calendarData() });
      const [event] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<{ id: string }>>();
      const native = { id: event!.id, title: "Changed in Rallyroo", kidID: null, participantIDs: ["k"],
        startTime: "2027-01-04T15:00:00.000Z", endTime: "2027-01-04T16:00:00.000Z", location: null,
        arrivalTime: "2027-01-04T14:45:00.000Z", driver: "Grandparent", source: "manual", status: "confirmed" };
      const old = await app.inject({ url, headers });
      const changed = await app.inject({ method: "PUT", url: `/v1/events/${event!.id}`, headers: { ...bearer(), "idempotency-key": randomUUID() }, payload: native });
      expect(changed.statusCode).toBe(200);
      const current = await app.inject({ url, headers });
      expect(current.headers.etag).not.toBe(old.headers.etag);
      expect(current.body).toContain("Changed in Rallyroo");
      const edited = await app.inject({ method: "PUT", url, headers: { ...headers, "if-match": String(current.headers.etag) }, payload: calendarData("Changed in Apple Calendar") });
      expect(edited.statusCode).toBe(204);
      const [saved] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<Record<string, unknown>>>();
      expect(saved).toMatchObject({ title: "Changed in Apple Calendar", participantIDs: ["k"], driver: "Grandparent", arrivalTime: "2027-01-04T14:45:00.000Z" });
    } finally { await app.close(); }
  });

  it("accepts bounded self-contained time zones and positive durations without dropping original bytes", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const zone = ["BEGIN:VTIMEZONE", "TZID:Synthetic/Fixed", "BEGIN:STANDARD", "DTSTART:19700101T000000",
        "TZOFFSETFROM:-0500", "TZOFFSETTO:-0500", "END:STANDARD", "END:VTIMEZONE", ""].join("\r\n");
      const payload = calendarData("Café \\\\ picnic").replace("BEGIN:VEVENT", zone + "BEGIN:VEVENT")
        .replace("DTSTART:20270104T150000Z", "DTSTART;TZID=Synthetic/Fixed:20270104T150000")
        .replace("DTEND:20270104T160000Z", "DURATION:PT1H");
      const url = `/dav/calendars/${c.id}/family/zoned.ics`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar" };
      expect((await app.inject({ method: "PUT", url, headers: { ...headers, "if-none-match": "*" }, payload })).statusCode).toBe(201);
      expect((await app.inject({ url, headers })).body).toBe(payload);
      const [event] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<Record<string, unknown>>>();
      expect(event).toMatchObject({ startTime: "2027-01-04T20:00:00.000Z", endTime: "2027-01-04T21:00:00.000Z" });
    } finally { await app.close(); }
  });

  it("keeps a valid end when a native edit changes only the start of a duration-based event", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar" };
      const url = `/dav/calendars/${c.id}/family/duration.ics`;
      const payload = calendarData().replace("DTEND:20270104T160000Z", "DURATION:PT1H");
      expect((await app.inject({ method: "PUT", url, headers: { ...headers, "if-none-match": "*" }, payload })).statusCode).toBe(201);
      const [event] = (await app.inject({ url: "/v1/events", headers: bearer() })).json<Array<{ id: string } & Record<string, unknown>>>();
      expect((await app.inject({ method: "PUT", url: `/v1/events/${event!.id}`, headers: { ...bearer(), "idempotency-key": randomUUID() },
        payload: { ...event, startTime: "2027-01-04T15:30:00.000Z" } })).statusCode).toBe(200);
      const changed = await app.inject({ url, headers });
      expect(changed.statusCode).toBe(200);
      expect(changed.body).toContain("DTSTART:20270104T153000Z");
      expect(changed.body).toContain("DTEND:20270104T160000Z");
      expect(changed.body).not.toContain("DURATION:");
    } finally { await app.close(); }
  });

  it("rejects normalized invalid dates and unsafe time-zone expansion rules", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const base = `/dav/calendars/${c.id}/family/`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar", "if-none-match": "*" };
      const invalid = calendarData().replace("20270104T150000Z", "20270231T150000Z").replace("20270104T160000Z", "20270231T160000Z");
      expect((await app.inject({ method: "PUT", url: base + "invalid-date.ics", headers, payload: invalid })).statusCode).toBe(403);
      const zone = ["BEGIN:VTIMEZONE", "TZID:Synthetic/Unsafe", "BEGIN:STANDARD", "DTSTART:20260101T000000", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100",
        "RRULE:FREQ=SECONDLY;COUNT=1000000000", "END:STANDARD", "END:VTIMEZONE", ""].join("\r\n");
      // The unused zone must be rejected before any attempt to expand it.
      const unsafe = calendarData().replace("BEGIN:VEVENT", zone + "BEGIN:VEVENT");
      expect((await app.inject({ method: "PUT", url: base + "unsafe-zone.ics", headers, payload: unsafe })).statusCode).toBe(403);
      expect((await app.inject({ url: "/v1/events", headers: bearer() })).json()).toEqual([]);
    } finally { await app.close(); }
  });

  it("serializes racing creates and rejects UID conflicts and unconditioned writes", async () => {
    const { app } = fixture();
    try {
      const c = await connection(app);
      const base = `/dav/calendars/${c.id}/family/`;
      const headers = { ...basic(c.username, c.password), "content-type": "text/calendar", "if-none-match": "*" };
      const writes = await Promise.all([1, 2].map(() => app.inject({ method: "PUT", url: base + "same.ics", headers, payload: calendarData() })));
      expect(writes.map((r) => r.statusCode).sort()).toEqual([201, 412]);
      expect((await app.inject({ method: "PUT", url: base + "different.ics", headers, payload: calendarData() })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url: base + "unconditioned.ics", headers: { ...basic(c.username, c.password), "content-type": "text/calendar" }, payload: calendarData() })).statusCode).toBe(428);
    } finally { await app.close(); }
  });
});

describe("CalDAV calendar connections", () => {
  it("issues a parent-scoped password once, discovers the calendar, and revokes access", async () => {
    const { app } = fixture();
    try {
      const created = await connection(app);
      expect(created.serverURL).toBe("https://calendar.example/dav/");
      expect(created.password.length).toBeGreaterThanOrEqual(43);
      const listing = await app.inject({ url: "/v1/calendar-connections", headers: bearer() });
      expect(listing.statusCode).toBe(200);
      expect(listing.body).not.toContain(created.password);
      const discovery = await app.inject({ method: PROPFIND, url: "/dav/",
        headers: { ...basic(created.username, created.password), depth: "0" } });
      expect(discovery.statusCode).toBe(207);
      expect(discovery.body).toContain("current-user-principal");
      expect((await app.inject({ url: "/v1/events", headers: basic(created.username, created.password) })).statusCode).toBe(401);
      expect((await app.inject({ method: "DELETE", url: `/v1/calendar-connections/${created.id}`, headers: bearer("other") })).statusCode).toBe(404);
      expect((await app.inject({ method: "DELETE", url: `/v1/calendar-connections/${created.id}`, headers: bearer() })).statusCode).toBe(204);
      expect((await app.inject({ method: PROPFIND, url: "/dav/", headers: basic(created.username, created.password) })).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it("does not log calendar passwords, authorization values, private hrefs or calendar bodies", async () => {
    let log = "";
    const stream = new Writable({ write(chunk, _encoding, done) { log += chunk.toString(); done(); } });
    const { app } = fixture(true, { stream });
    const c = await connection(app);
    const authorization = basic(c.username, c.password);
    try {
      await app.inject({ method: "PUT", url: `/dav/calendars/${c.id}/family/private-calendar-name.ics`,
        headers: { ...authorization, "content-type": "text/calendar", "if-none-match": "*" }, payload: calendarData("Private calendar body") });
    } finally { await app.close(); }
    expect(log).toContain("/dav/[redacted]");
    expect(log).not.toContain(c.password);
    expect(log).not.toContain(authorization.authorization);
    expect(log).not.toContain("private-calendar-name");
    expect(log).not.toContain("Private calendar body");
  });

  it("validates and canonicalizes named calendar zones before issuing a password", async () => {
    const { app } = fixture();
    try {
      for (const payload of [{ timeZone: "Not/AZone" }, { timeZone: "+05:30" }, { timeZone: 123 }, { timeZone: "UTC", familyID: "other" }]) {
        expect((await app.inject({ method: "POST", url: "/v1/calendar-connections", headers: bearer(), payload })).statusCode).toBe(400);
      }
      expect((await app.inject({ url: "/v1/calendar-connections", headers: bearer() })).json().connections).toEqual([]);
      const created = await app.inject({ method: "POST", url: "/v1/calendar-connections", headers: bearer(), payload: { timeZone: "america/los_angeles" } });
      expect(created.statusCode).toBe(201);
      expect(created.json().timeZone).toBe("America/Los_Angeles");
    } finally { await app.close(); }
  });

  it("does not issue child credentials or expose disabled feature routes", async () => {
    const { app } = fixture();
    const disabled = fixture(false).app;
    try {
      expect((await app.inject({ method: "POST", url: "/v1/calendar-connections", headers: bearer("kid") })).statusCode).toBe(403);
      expect((await disabled.inject({ method: "POST", url: "/v1/calendar-connections", headers: bearer() })).statusCode).toBe(404);
    } finally { await app.close(); await disabled.close(); }
  });
});
