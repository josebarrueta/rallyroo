import { SaxesParser } from "saxes";
import { CalendarError } from "./caldav-persistence.js";

export const DAV = "DAV:";
export const CAL = "urn:ietf:params:xml:ns:caldav";
export const SERVER = "http://calendarserver.org/ns/";
export const APPLE = "http://apple.com/ns/ical/";
export const escapeXML = (value: string) => value.replace(/[<>&"']/g, (c) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
})[c]!);
export const key = (uri: string, name: string) => `${uri}|${name}`;
export interface CalendarXML { uri: string; name: string; attributes: Record<string, string>; text: string; children: CalendarXML[] }

/** Namespace-aware, bounded XML. DTDs and processing instructions are never accepted. */
export function parseCalendarXML(body: unknown): CalendarXML | undefined {
  if (body === undefined || body === "") return undefined;
  if (typeof body !== "string" || Buffer.byteLength(body) > 65536) throw new CalendarError(413, "request-too-large");
  const stack: CalendarXML[] = [];
  let root: CalendarXML | undefined;
  let nodes = 0;
  const parser = new SaxesParser({ xmlns: true });
  try {
    parser.on("doctype", () => { throw new Error(); });
    parser.on("processinginstruction", () => { throw new Error(); });
    parser.on("error", () => { throw new Error(); });
    parser.on("opentag", (tag) => {
      if (++nodes > 2048 || stack.length >= 16) throw new Error();
      const node: CalendarXML = { uri: tag.uri, name: tag.local, text: "", children: [], attributes: Object.create(null) as Record<string, string> };
      for (const attribute of Object.values(tag.attributes)) {
        if (attribute.uri === "") node.attributes[attribute.local] = attribute.value;
      }
      if (stack.length) stack.at(-1)!.children.push(node);
      else if (!root) root = node;
      else throw new Error();
      stack.push(node);
    });
    parser.on("text", (text) => { if (stack.length) stack.at(-1)!.text += text; });
    parser.on("cdata", (text) => { if (stack.length) stack.at(-1)!.text += text; });
    parser.on("closetag", () => { stack.pop(); });
    parser.write(body).close();
    if (!root || stack.length) throw new Error();
    return root;
  } catch { throw new CalendarError(400, "invalid-xml"); }
}
export const child = (node: CalendarXML | undefined, uri: string, name: string) => node?.children.find((n) => n.uri === uri && n.name === name);
export const children = (node: CalendarXML | undefined, uri: string, name: string) => node?.children.filter((n) => n.uri === uri && n.name === name) ?? [];
export const xmlElement = (uri: string, name: string, content = "") => `<P:${name} xmlns:P="${escapeXML(uri)}">${content}</P:${name}>`;
export const hrefXML = (href: string) => `<D:href>${escapeXML(href)}</D:href>`;
export const multiStatus = (responses: string[]) => `<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:">${responses.join("")}</D:multistatus>`;

export function propertyResponse(href: string, properties: Map<string, string>, request?: CalendarXML): string {
  const requested = child(request, DAV, "prop");
  const names = child(request, DAV, "propname") !== undefined;
  const targets = requested ? requested.children.map((n) => [n.uri, n.name] as const)
    : [...properties.keys()].map((k) => k.split("|") as [string, string]);
  const found: string[] = [];
  const missing: string[] = [];
  for (const [uri, name] of targets) {
    const value = properties.get(key(uri, name));
    if (value !== undefined) found.push(xmlElement(uri, name, names ? "" : value));
    else missing.push(xmlElement(uri, name));
  }
  const status = (parts: string[], code: string) => parts.length
    ? `<D:propstat><D:prop>${parts.join("")}</D:prop><D:status>HTTP/1.1 ${code}</D:status></D:propstat>` : "";
  return `<D:response>${hrefXML(href)}${status(found, "200 OK")}${status(missing, "404 Not Found")}</D:response>`;
}
export const missingResponse = (href: string) => `<D:response>${hrefXML(href)}<D:status>HTTP/1.1 404 Not Found</D:status></D:response>`;
export function calendarErrorXML(condition: string): string {
  const namespace = ["valid-calendar-data", "supported-calendar-data", "supported-calendar-component", "no-uid-conflict", "supported-filter"].includes(condition)
    ? CAL : ["supported-report", "number-of-matches-within-limits"].includes(condition) ? DAV : "urn:dev:rallyroo:caldav-preview";
  return `<?xml version="1.0"?><D:error xmlns:D="DAV:">${xmlElement(namespace, condition)}</D:error>`;
}
