import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import https from "node:https";
import ipaddr from "ipaddr.js";
import type {
  CalendarFeedResponse,
  CalendarFeedValidators,
} from "./calendar-source-module.js";

const maximumFeedBytes = 5 * 1024 * 1024;
const requestTimeoutMilliseconds = 15_000;
const maximumCalendarURLLength = 2_048;

export class CalendarFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarFeedError";
  }
}

export function validateCalendarFeedURL(value: string): boolean {
  if (value.length > maximumCalendarURLLength) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && !url.hash && (url.port === "" || url.port === "443")
      && !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value);
  } catch {
    return false;
  }
}

export function calendarURLProtection(encodedKey: string): {
  protectURL: (url: string) => string;
  revealURL: (protectedURL: string) => string;
} {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("CALENDAR_SOURCE_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return {
    protectURL(url) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const ciphertext = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
      return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
    },
    revealURL(protectedURL) {
      const [version, nonceValue, tagValue, ciphertextValue, ...extra] = protectedURL.split(".");
      if (version !== "v1" || !nonceValue || !tagValue || !ciphertextValue || extra.length > 0) {
        throw new Error("Invalid protected calendar URL");
      }
      const nonce = decodeCanonicalBase64URL(nonceValue);
      const tag = decodeCanonicalBase64URL(tagValue);
      const ciphertext = decodeCanonicalBase64URL(ciphertextValue);
      if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
        throw new Error("Invalid protected calendar URL");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

function decodeCanonicalBase64URL(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid protected calendar URL");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("Invalid protected calendar URL");
  return decoded;
}

export async function fetchPublicCalendarFeed(
  url: string,
  validators: CalendarFeedValidators = {},
): Promise<CalendarFeedResponse> {
  if (!validateCalendarFeedURL(url)) throw new CalendarFeedError("Calendar feed must use a valid HTTPS link");
  return fetchWithRedirects(new URL(url), 0, validators);
}

async function fetchWithRedirects(
  url: URL,
  redirectCount: number,
  validators: CalendarFeedValidators,
): Promise<CalendarFeedResponse> {
  if (!validateCalendarFeedURL(url.href)) {
    throw new CalendarFeedError("Calendar feed must use a valid HTTPS link");
  }
  if (redirectCount > 3) throw new CalendarFeedError("Calendar feed redirected too many times");

  // Bound DNS resolution as well as the HTTP transfer; slow feeds must not
  // hold a worker indefinitely. The pending OS lookup cannot start a request.
  let dnsTimer: NodeJS.Timeout | undefined;
  let addresses: LookupAddress[];
  try {
    addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new CalendarFeedError("Calendar feed request timed out")), requestTimeoutMilliseconds);
        dnsTimer.unref();
      }),
    ]);
  } finally {
    if (dnsTimer) clearTimeout(dnsTimer);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new CalendarFeedError("Calendar feed host must resolve only to public addresses");
  }
  const selected = addresses[0]!;

  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      headers: {
        accept: "text/calendar, application/ics, text/plain;q=0.5",
        "user-agent": "Rallyroo-Calendar-Sync/1.0",
        ...(validators.etag ? { "if-none-match": validators.etag } : {}),
        ...(validators.lastModified ? { "if-modified-since": validators.lastModified } : {}),
      },
      // Node's autoSelectFamily asks lookup for all addresses. Return only the
      // vetted, pinned address in either callback form (no second DNS lookup).
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        const location = response.headers.location;
        if (!location) return reject(new CalendarFeedError("Calendar feed redirect omitted its location"));
        let target: URL;
        try {
          if (location.includes("\\") || /[\u0000-\u001f\u007f]/.test(location)) throw new Error("Invalid location");
          target = new URL(location, url);
        } catch {
          return reject(new CalendarFeedError("Calendar feed redirect has an invalid location"));
        }
        void fetchWithRedirects(
          target, redirectCount + 1, target.origin === url.origin ? validators : {},
        ).then(resolve, reject);
        return;
      }
      if (status === 304) {
        response.destroy();
        if (!validators.etag && !validators.lastModified) {
          reject(new CalendarFeedError("Calendar feed returned HTTP 304 without a cached snapshot"));
        } else {
          resolve({ body: "", notModified: true });
        }
        return;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new CalendarFeedError(`Calendar feed returned HTTP ${status}`));
        return;
      }
      const declaredType = response.headers["content-type"];
      if (typeof declaredType === "string" && !/^(text\/calendar|application\/(ics|octet-stream|x-ical)|text\/(plain|x-vcalendar))(?:\s*;|\s*$)/i.test(declaredType)) {
        response.destroy();
        reject(new CalendarFeedError("Calendar feed is not an iCalendar file"));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > maximumFeedBytes) {
        response.destroy();
        reject(new CalendarFeedError("Calendar feed exceeds the size limit"));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > maximumFeedBytes) {
          response.destroy(new CalendarFeedError("Calendar feed exceeds the size limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        ...(typeof response.headers.etag === "string" ? { etag: response.headers.etag } : {}),
        ...(typeof response.headers["last-modified"] === "string"
          ? { lastModified: response.headers["last-modified"] }
          : {}),
      }));
      response.on("error", reject);
    });
    const timer = setTimeout(() => request.destroy(new CalendarFeedError("Calendar feed request timed out")), requestTimeoutMilliseconds);
    timer.unref();
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end();
  });
}

function isPublicAddress(address: string): boolean {
  const parsed = ipaddr.parse(address);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    return parsed.toIPv4Address().range() === "unicast";
  }
  return parsed.range() === "unicast";
}
