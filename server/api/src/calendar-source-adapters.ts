import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import ipaddr from "ipaddr.js";
import type {
  CalendarFeedResponse,
  CalendarFeedValidators,
} from "./calendar-source-module.js";

const maximumFeedBytes = 5 * 1024 * 1024;
const requestTimeoutMilliseconds = 15_000;

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
  return fetchWithRedirects(new URL(url), 0, validators);
}

async function fetchWithRedirects(
  url: URL,
  redirectCount: number,
  validators: CalendarFeedValidators,
): Promise<CalendarFeedResponse> {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Calendar feed must use HTTPS without embedded credentials");
  }
  if (redirectCount > 3) throw new Error("Calendar feed redirected too many times");

  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Calendar feed host must resolve only to public addresses");
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
      lookup: (_hostname, _options, callback) => {
        callback(null, selected.address, selected.family);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        const location = response.headers.location;
        if (!location) return reject(new Error("Calendar feed redirect omitted its location"));
        void fetchWithRedirects(new URL(location, url), redirectCount + 1, validators).then(resolve, reject);
        return;
      }
      if (status === 304) {
        response.resume();
        resolve({ body: "", notModified: true });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Calendar feed returned HTTP ${status}`));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > maximumFeedBytes) {
        response.resume();
        reject(new Error("Calendar feed exceeds the size limit"));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > maximumFeedBytes) {
          response.destroy(new Error("Calendar feed exceeds the size limit"));
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
    request.setTimeout(requestTimeoutMilliseconds, () => {
      request.destroy(new Error("Calendar feed request timed out"));
    });
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
