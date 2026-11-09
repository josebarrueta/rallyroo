import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { calendarTimeZoneIsValid, canonicalCalendarTimeZone } from "./all-day-event.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { EventMutationModule } from "./event-mutation.js";
import { calendarETag, calendarResourcesForEvents, maximumCalendarBytes, parseCalendarEvent } from "./caldav-resource.js";
import type { CalendarResource, CalendarCondition } from "./caldav-persistence.js";
import { DAV, CAL, SERVER, APPLE, child, children, parseCalendarXML, propertyResponse, missingResponse,
  multiStatus, key, hrefXML, escapeXML, calendarErrorXML } from "./caldav-xml.js";
import type { Account } from "./domain.js";
import type { RallyrooRepository } from "./repository.js";
import { CalendarError } from "./caldav-persistence.js";

export interface CalendarConfiguration { publicOrigin: string; allowedIdentitySubjects: readonly string[] }
const calendarConfigurationSchema = z.object({
  publicOrigin: z.string().refine((value) => {
    try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && !url.username && !url.password; }
    catch { return false; }
  }),
  allowedIdentitySubjects: z.array(z.string().min(1).max(300).refine((s) => s === s.trim() && s !== "*")).max(100),
}).strict();

export function calendarPreviewConfiguration(environment: NodeJS.ProcessEnv = process.env): CalendarConfiguration | undefined {
  const publicOrigin = environment.CALDAV_PREVIEW_PUBLIC_ORIGIN;
  const subjects = environment.CALDAV_PREVIEW_IDENTITY_SUBJECTS;
  if (!publicOrigin && !subjects) return undefined;
  try {
    const parsed = calendarConfigurationSchema.safeParse({ publicOrigin, allowedIdentitySubjects: JSON.parse(subjects ?? "") });
    if (parsed.success) return parsed.data;
  } catch { /* Never include private identity configuration in diagnostics. */ }
  throw new Error("Invalid calendar preview configuration");
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = (value: string) => createHash("sha256").update(value).digest();
export function registerCalendarRoutes(app: FastifyInstance, repository: RallyrooRepository,
  configuration: CalendarConfiguration, eventMutations: EventMutationModule) {
  const parsed = calendarConfigurationSchema.safeParse(configuration);
  if (!parsed.success) throw new Error("Invalid calendar preview configuration");
  const origin = new URL(parsed.data.publicOrigin);
  // Snapshot the explicit cohort: no wildcard or implicit all-parent enrollment.
  const allowedIdentities = new Set(parsed.data.allowedIdentitySubjects);
  const serverURL = `${origin.origin}/dav/`;
  for (const method of ["PROPFIND", "REPORT"]) {
    if (!app.supportedMethods.includes(method)) app.addHttpMethod(method, { hasBody: true });
  }
  app.post("/v1/calendar-connections", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const account = request.account!;
    if (account.role !== "parent") return reply.code(403).send({ error: "parent_role_required" });
    if (!allowedIdentities.has(account.identitySubject)) return reply.code(403).send({ error: "calendar_preview_unavailable" });
    const input = z.object({ timeZone: z.string().refine(calendarTimeZoneIsValid).default("UTC") }).strict().safeParse(request.body ?? {});
    if (!input.success) return reply.code(400).send({ error: "invalid_calendar_time_zone" });
    const timeZone = canonicalCalendarTimeZone(input.data.timeZone)!;
    const id = randomUUID();
    const password = randomBytes(32).toString("base64url");
    const createdAt = new Date().toISOString();
    const created = await repository.createCalendarConnection({
      id, identitySubject: account.identitySubject, familyID: account.familyID, memberID: account.memberID,
      passwordHash: digest(password).toString("hex"), createdAt, timeZone,
    });
    if (!created) return reply.code(409).send({ error: "calendar_connection_limit" });
    return reply.code(201).send({ id, username: id, password, createdAt, serverURL, timeZone });
  });
  app.get("/v1/calendar-connections", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (request.account!.role !== "parent") return reply.code(403).send({ error: "parent_role_required" });
    if (!allowedIdentities.has(request.account!.identitySubject)) return reply.code(403).send({ error: "calendar_preview_unavailable" });
    const connections = await repository.calendarConnections(request.account!);
    return { serverURL, connections: connections.map(({ id, createdAt, timeZone }) => ({ id, username: id, createdAt, timeZone: timeZone ?? "UTC" })) };
  });
  app.delete<{ Params: { id: string } }>("/v1/calendar-connections/:id", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (request.account!.role !== "parent") return reply.code(403).send({ error: "parent_role_required" });
    if (!uuid.test(request.params.id) || !await repository.revokeCalendarConnection(request.account!, request.params.id)) {
      return reply.code(404).send({ error: "calendar_connection_not_found" });
    }
    return reply.code(204).send();
  });
  // Parsers are encapsulated to DAV routes; XML/calendar bodies cannot alter JSON decoding.
  app.register(async (dav) => {
    for (const contentType of ["application/xml", "text/xml", "text/calendar"]) {
      dav.addContentTypeParser(contentType, { parseAs: "string", bodyLimit: maximumCalendarBytes }, (_request, body, done) => done(null, body));
    }
    dav.route({ method: ["GET", "PROPFIND"], url: "/.well-known/caldav", handler: async (_request, reply) => reply.redirect(serverURL, 307) });
    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("cache-control", "no-store");
      try {
        const auth = await authenticateCalendar(request, repository, allowedIdentities);
        if (!auth) return reply.header("www-authenticate", 'Basic realm="Rallyroo Calendar", charset="UTF-8"').code(401).send();
        const principal = `/dav/principals/${auth.connectionID}/`;
        const home = `/dav/calendars/${auth.connectionID}/`;
        const collection = `${home}family/`;
        const path = request.url;
        const isCollection = ["/dav/", principal, home, collection].includes(path);
        let name: string | undefined;
        if (!isCollection) {
          if (!path.startsWith(collection)) throw new CalendarError(404, "resource-not-found");
          try { name = decodeURIComponent(path.slice(collection.length)); } catch { throw new CalendarError(400, "invalid-resource-name"); }
          if (!name || name.length > 512 || /[\\/\\\\?\x00-\x1f\x7f]/.test(name) || [".", ".."].includes(name)) {
            throw new CalendarError(400, "invalid-resource-name");
          }
        }
        if (request.method === "OPTIONS") {
          // This gated interoperability profile does not yet claim full RFC 4791 conformance.
          return reply.header("allow", "OPTIONS, PROPFIND, REPORT, GET, HEAD, PUT, DELETE").code(204).send();
        }
        const condition: CalendarCondition = { ifMatch: request.headers["if-match"], ifNoneMatch: request.headers["if-none-match"] };
        if (request.method === "PUT" || request.method === "DELETE") {
          if (!name) throw new CalendarError(403, "collection-write-forbidden");
          if (request.headers["if"] !== undefined) throw new CalendarError(400, "unsupported-precondition");
          if (condition.ifMatch === undefined && condition.ifNoneMatch !== "*") throw new CalendarError(428, "precondition-required");
          if (request.method === "DELETE") {
            await eventMutations.delete({ account: auth.account, eventID: randomUUID(), idempotencyKey: randomUUID(), calendar: { ...condition, name } });
            return reply.code(204).send();
          }
          if (!request.headers["content-type"]?.toLowerCase().startsWith("text/calendar") || typeof request.body !== "string") {
            throw new CalendarError(415, "supported-calendar-data");
          }
          // Decode structure first. The transaction resolves an existing Event's
          // stable all-day anchor rather than replacing it with this device's zone.
          const fields = parseCalendarEvent(request.body);
          await eventMutations.save({ account: auth.account, idempotencyKey: randomUUID(), notifyParticipants: true,
            event: { id: randomUUID(), familyID: auth.account.familyID, title: fields.title, startTime: fields.startTime,
              endTime: fields.endTime, allDay: fields.allDay, location: fields.location, kidID: null, participantIDs: [], driver: null, source: "manual", status: "confirmed" },
            calendar: { ...condition, name, uid: fields.uid, data: request.body, timeZone: auth.timeZone },
          });
          // No strong PUT ETag: subsequent native normalization can transform a representation.
          return reply.code(condition.ifNoneMatch === "*" ? 201 : 204).send();
        }
        const { events, resources: bindings } = await repository.calendarSnapshot(auth.account.familyID);
        if (events.length > 1000) throw new CalendarError(507, "number-of-matches-within-limits");
        if (bindings.reduce((bytes, r) => bytes + Buffer.byteLength(r.data), 0) > 1024 * 1024) {
          throw new CalendarError(507, "number-of-matches-within-limits");
        }
        const resources = calendarResourcesForEvents(events, bindings);
        const href = (resource: CalendarResource) => collection + encodeURIComponent(resource.name);
        const resource = name === undefined ? undefined : resources.find((r) => r.name === name);
        if (name !== undefined && !resource) throw new CalendarError(404, "resource-not-found");
        if (request.method === "GET" || request.method === "HEAD") {
          if (!resource) throw new CalendarError(405, "resource-required");
          const etag = calendarETag(resource.data);
          reply.header("etag", etag).type("text/calendar; charset=utf-8");
          if (condition.ifNoneMatch === etag || condition.ifNoneMatch === "*") return reply.code(304).send();
          return reply.send(resource.data);
        }
        const body = parseCalendarXML(request.body);
        const ctag = calendarETag(JSON.stringify(resources.map((r) => [r.name, calendarETag(r.data)]).sort()));
        const props = (target: string, r?: CalendarResource, includeData = false) => {
          const values = new Map<string, string>([
            [key(DAV, "displayname"), target === collection ? "Rallyroo Family (calendar preview)" : "Rallyroo"],
            [key(DAV, "resourcetype"), r ? "" : target === principal ? "<D:principal/>" : `<D:collection/>${target === collection ? `<C:calendar xmlns:C="${CAL}"/>` : ""}`],
            [key(DAV, "current-user-principal"), hrefXML(principal)],
            [key(DAV, "owner"), hrefXML(principal)],
            [key(DAV, "current-user-privilege-set"), ["read", "write-content", "bind", "unbind"].map((p) => `<D:privilege><D:${p}/></D:privilege>`).join("")],
          ]);
          if (target === principal || target === "/dav/") values.set(key(CAL, "calendar-home-set"), hrefXML(home));
          if (target === collection) {
            values.set(key(CAL, "supported-calendar-component-set"), `<C:comp xmlns:C="${CAL}" name="VEVENT"/>`);
            values.set(key(CAL, "supported-calendar-data"), `<C:calendar-data xmlns:C="${CAL}" content-type="text/calendar" version="2.0"/>`);
            values.set(key(CAL, "calendar-description"), escapeXML(`Experimental: timed and all-day non-recurring native Family events. No invitations. Floating-date report zone: ${auth.timeZone}.`));
            values.set(key(CAL, "max-resource-size"), String(maximumCalendarBytes));
            values.set(key(SERVER, "getctag"), escapeXML(ctag));
            values.set(key(APPLE, "calendar-color"), "#6750A4FF");
            values.set(key(DAV, "supported-report-set"), ["calendar-query", "calendar-multiget"].map((n) => `<D:supported-report><D:report><C:${n} xmlns:C="${CAL}"/></D:report></D:supported-report>`).join(""));
          }
          if (r) {
            values.set(key(DAV, "getetag"), escapeXML(calendarETag(r.data)));
            values.set(key(DAV, "getcontenttype"), "text/calendar; charset=utf-8");
            values.set(key(DAV, "getcontentlength"), String(Buffer.byteLength(r.data)));
            if (includeData) values.set(key(CAL, "calendar-data"), escapeXML(r.data));
          }
          return values;
        };
        let responses: string[];
        if (request.method === "PROPFIND") {
          if (body && (body.uri !== DAV || body.name !== "propfind")) throw new CalendarError(400, "invalid-xml");
          const depth = request.headers.depth ?? "0";
          if (depth !== "0" && depth !== "1") throw new CalendarError(403, "finite-depth-required");
          responses = [propertyResponse(path, props(path, resource), body)];
          if (depth === "1" && !resource) {
            if (path === collection) responses.push(...resources.map((r) => propertyResponse(href(r), props(href(r), r), body)));
            else if (path === home) responses.push(propertyResponse(collection, props(collection), body));
            else if (path === "/dav/") responses.push(propertyResponse(principal, props(principal), body));
          }
        } else if (request.method === "REPORT") {
          if (!body || body.uri !== CAL || path !== collection) throw new CalendarError(403, "supported-report");
          // Do not silently ignore a client-supplied floating-date time zone.
          // General VTIMEZONE report overrides remain a separate compatibility gate.
          if (child(body, CAL, "timezone")) throw new CalendarError(403, "supported-calendar-data");
          const requestedData = child(child(body, DAV, "prop"), CAL, "calendar-data");
          if (requestedData && (requestedData.children.length
            || (requestedData.attributes["content-type"] && requestedData.attributes["content-type"] !== "text/calendar")
            || (requestedData.attributes.version && requestedData.attributes.version !== "2.0"))) throw new CalendarError(403, "supported-calendar-data");
          if (body.name === "calendar-multiget") {
            const targets = children(body, DAV, "href");
            if (!targets.length || targets.length > 100) throw new CalendarError(400, "invalid-href-count");
            responses = targets.map((target) => {
              let url: URL;
              try { url = new URL(target.text, origin); } catch { throw new CalendarError(400, "invalid-href"); }
              if (url.origin !== origin.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(collection)) throw new CalendarError(403, "invalid-href");
              const found = resources.find((r) => href(r) === url.pathname);
              return found ? propertyResponse(href(found), props(href(found), found, true), body) : missingResponse(url.pathname);
            });
          } else if (body.name === "calendar-query") {
            const filter = child(body, CAL, "filter");
            const rootFilter = child(filter, CAL, "comp-filter");
            const eventFilter = child(rootFilter, CAL, "comp-filter");
            if (!rootFilter || rootFilter.attributes.name !== "VCALENDAR" || rootFilter.children.length !== 1
              || !eventFilter || eventFilter.attributes.name !== "VEVENT"
              || eventFilter.children.length > 1 || eventFilter.children.some((n) => n.uri !== CAL || n.name !== "time-range")) throw new CalendarError(403, "supported-filter");
            const range = child(eventFilter, CAL, "time-range");
            const start = reportTime(range?.attributes.start, -Infinity);
            const end = reportTime(range?.attributes.end, Infinity);
            if (start >= end || (range && !range.attributes.start && !range.attributes.end)) throw new CalendarError(400, "invalid-filter");
            responses = resources.filter((r) => {
              const event = parseCalendarEvent(r.data, auth.timeZone);
              return new Date(event.startTime).getTime() < end && new Date(event.endTime).getTime() > start;
            }).map((r) => propertyResponse(href(r), props(href(r), r, true), body));
          } else throw new CalendarError(403, "supported-report");
        } else throw new CalendarError(405, "unsupported-method");
        const response = multiStatus(responses);
        if (Buffer.byteLength(response) > 4 * 1024 * 1024) throw new CalendarError(507, "number-of-matches-within-limits");
        return reply.type("application/xml; charset=utf-8").code(207).send(response);
      } catch (error) {
        if (error instanceof CalendarError) return reply.type("application/xml; charset=utf-8").code(error.statusCode).send(calendarErrorXML(error.condition));
        throw error;
      }
    };
    for (const url of ["/dav/", "/dav/*"]) dav.route({ url, method: ["OPTIONS", "PROPFIND", "REPORT", "GET", "HEAD", "PUT", "DELETE"], bodyLimit: maximumCalendarBytes, handler });
  });
}

export async function authenticateCalendar(request: FastifyRequest, repository: RallyrooRepository, allowedIdentities: ReadonlySet<string>): Promise<{ account: Account; connectionID: string; timeZone: string } | null> {
  const header = request.headers.authorization;
  if (!header || header.length > 1024 || !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(header)) return null;
  const encoded = header.slice(6);
  const decodedBytes = Buffer.from(encoded, "base64");
  if (decodedBytes.toString("base64") !== encoded) return null;
  const decoded = decodedBytes.toString("utf8");
  const separator = decoded.indexOf(":");
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (separator < 0 || !uuid.test(username) || !/^[A-Za-z0-9_-]{43}$/.test(password)) return null;
  const connection = await repository.calendarConnection(username);
  // Uniform constant-time comparison; passwords are server-generated 256-bit secrets.
  const expected = connection?.passwordHash ?? "0".repeat(64);
  if (!timingSafeEqual(digest(password), Buffer.from(expected, "hex")) || !connection) return null;
  if (!allowedIdentities.has(connection.identitySubject)) return null;
  const account = await repository.accountForIdentity(connection.identitySubject);
  if (!account || account.role !== "parent" || account.familyID !== connection.familyID || account.memberID !== connection.memberID) return null;
  return { account, connectionID: connection.id, timeZone: connection.timeZone ?? "UTC" };
}

function reportTime(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d{8}T\d{6}Z$/.test(value)) throw new CalendarError(400, "invalid-filter");
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== iso) throw new CalendarError(400, "invalid-filter");
  return time;
}

export function calendarProtocolRoute(url: string): boolean {
  return url === "/dav/" || url === "/dav/*" || url === "/.well-known/caldav";
}
