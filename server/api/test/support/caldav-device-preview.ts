// Deliberately separate from main.ts: disposable physical-device testing only.
// No dotenv, hosted identity, production database, push, or external integrations.
import { timingSafeEqual } from "node:crypto";
import { readFile, stat, appendFile } from "node:fs/promises";
import { createServer, request as proxyRequest } from "node:http";
import { buildApp } from "../../src/app.js";
import { PostgresRallyrooRepository } from "../../src/postgres-repository.js";
import type { IdentityProvider } from "../../src/identity-provider.js";

const file = process.argv[2];
if (!file || (await stat(file)).mode & 0o077) throw new Error("Owner-only preview configuration required");
const config = JSON.parse(await readFile(file, "utf8")) as {
  publicOrigin: string; nativePort: number; gatewayPort: number; databasePort: number;
  databasePassword: string; masterKey: string; token: string; expiresAt: string; requestLog: string;
};
const origin = new URL(config.publicOrigin);
if (origin.origin !== config.publicOrigin || origin.protocol !== "https:"
  || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(origin.hostname)) throw new Error("Temporary preview origin required");
const remaining = Date.parse(config.expiresAt) - Date.now();
if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 4 * 3600_000) throw new Error("Preview must expire within four hours");
const secret = Buffer.from(config.token);
if (secret.length < 43) throw new Error("Random preview bearer required");
const unavailable = (): never => { throw new Error("Hosted authentication disabled in disposable preview"); };
const identityProvider: IdentityProvider = {
  googleAuthorizationURL: unavailable, appleAuthorizationURL: unavailable,
  authenticateOAuthToken: async () => unavailable(),
  verifySession: async (token) => {
    const candidate = Buffer.from(token);
    if (candidate.length !== secret.length || !timingSafeEqual(candidate, secret)) throw new Error("Invalid preview session");
    return { subject: "caldav-device-preview-parent", displayName: "Preview Parent" };
  },
  revokeSession: async () => unavailable(), deleteIdentity: async () => unavailable(),
};
const repository = PostgresRallyrooRepository.fromConfiguration({
  host: "127.0.0.1", port: config.databasePort, user: "rallyroo_preview", database: "caldav_preview",
  password: config.databasePassword, max: 5,
}, config.masterKey);
await repository.validateFamilyDataEncryption();
await repository.provisionParentAccount("caldav-device-preview-parent", "Preview Parent");
const app = buildApp({ repository, identityProvider, caldav: { publicOrigin: config.publicOrigin, allowedIdentitySubjects: ["caldav-device-preview-parent"] }, logger: false });
await app.listen({ port: config.nativePort, host: "127.0.0.1" });

// The tunnel exposes only DAV, never the synthetic session provider or JSON API.
// X-Forwarded-Proto is trusted ONLY at this loopback-only Cloudflare gateway;
// verify at the public edge that Cloudflare overwrites client-supplied values.
const methods = new Set(["GET", "HEAD", "OPTIONS", "PROPFIND", "REPORT", "PUT", "DELETE"]);
const gateway = createServer((incoming, outgoing) => {
  const pathname = new URL(incoming.url ?? "/", "http://localhost").pathname;
  const scope = pathname === "/.well-known/caldav" ? "discovery" : pathname === "/dav/" ? "root"
    : pathname.startsWith("/dav/principals/") ? "principal"
    : pathname.startsWith("/dav/calendars/") ? (pathname.endsWith("/family/") ? "collection" : "calendar-child") : "other";
  outgoing.on("finish", () => {
    // Never record hrefs, credentials, query strings, XML, calendar bytes or titles.
    void appendFile(config.requestLog, JSON.stringify({ at: new Date().toISOString(),
      method: methods.has(incoming.method ?? "") ? incoming.method : "other", scope, status: outgoing.statusCode }) + "\n", { mode: 0o600 }).catch(() => {});
  });
  if (Date.now() >= Date.parse(config.expiresAt)) { outgoing.writeHead(410).end(); return; }
  if (incoming.headers["x-forwarded-proto"] !== "https") { outgoing.writeHead(403).end(); return; }
  if (!(pathname.startsWith("/dav/") || pathname === "/.well-known/caldav") || !methods.has(incoming.method ?? "")) {
    outgoing.writeHead(404).end(); return;
  }
  const upstream = proxyRequest({ hostname: "127.0.0.1", port: config.nativePort,
    method: incoming.method, path: incoming.url, headers: incoming.headers }, response => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
  incoming.on("aborted", () => upstream.destroy());
  incoming.pipe(upstream);
});
gateway.requestTimeout = 30_000;
gateway.headersTimeout = 15_000;
await new Promise<void>((resolve, reject) => { gateway.once("error", reject); gateway.listen(config.gatewayPort, "127.0.0.1", resolve); });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  gateway.closeAllConnections();
  await new Promise<void>(resolve => gateway.close(() => resolve()));
  await app.close();
  await repository.close();
}
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
setTimeout(() => { void shutdown(); }, remaining).unref();
console.log("Disposable calendar preview ready; credentials and request bodies are not logged.");
