# Physical-iPhone calendar acceptance

Status: **previous temporary endpoint stopped; physical-device checks not yet performed**. The tester chose [in-app testing against the existing Family](caldav-in-app-testing.md). Build 201 has processed through TestFlight and backend 0.11.30 is activated for one verified parent. Tester installation and physical-device observations are still pending.

## Previous disposable environment (historical)

- A fresh loopback-only PostgreSQL cluster, migrations 001–039, a synthetic parent/Family, and a random Family encryption master key. No production database, identity provider, push provider, Google account, or existing Family was used.
- `server/api/test/support/caldav-device-preview.ts` runs the real API/repository/calendar modules with a private, random administrative bearer. Hosted OAuth is disabled. This entrypoint is separate from production startup and does not load `.env`.
- An HTTPS quick tunnel with a separate loopback gateway exposes only DAV/discovery, not the JSON API. Its Cloudflare process uses an empty config and isolated home, not production tunnel credentials. The public edge was checked to reject HTTP even with a forged forwarding header.
- Owner-only credentials/configuration and local instructions live outside the repository. The server expires within four hours; a separate local timer stops the tunnel and disposable database. Keep the hosting Mac online for the test.
- One native seed, **Preview native round-trip**, tomorrow at 10:00 in the configured connection zone. Current TestFlight still uses production and will not display this sandbox's events; native persistence is checked through its isolated API.

## Automated edge checks

19 checks passed through the public edge/local native interface: unauthenticated DAV rejection, public JSON exclusion, HTTP/forwarded-protocol enforcement, discovery redirect, principal/home discovery, full ETag listing, seed retrieval, native edit/content/ETag convergence, conditional DAV create/read/delete, and deletion from the native schedule. Probe data was removed; the seed remains. These checks do **not** establish Apple-client compatibility.

## Device observations

| Check | Expected | Actual |
| --- | --- | --- |
| Account discovery | iPhone accepts the CalDAV account with SSL enabled and no certificate warning | Not tested |
| Writable calendar | Seed appears in Apple Calendar; a manual event saves and reaches the isolated native API | Not tested |
| Default-calendar selection | The parent can explicitly select the preview under Default Calendar | Not tested |
| Generic Siri creation | A request without an app/calendar name reaches this calendar and the native API | Not tested |
| Edit convergence | Apple edits reach native storage; native edits appear on the phone after sync | Not tested |
| Deletion convergence | Deletion propagates both ways without stale resources reappearing | Not tested |

Record iOS version, connection zone, exact non-secret error messages, and any Siri disambiguation. Device observations alone do not prove server persistence; correlate with API state and redacted method/status logs. Never attach passwords, authorization headers, configuration files, or credential screenshots.

## Previous wizard procedure (not the chosen delivery path)

The temporary endpoint and wizard are no longer the requested route. The current plan uses the app's setup UI and normal TestFlight delivery; the notes below describe the earlier disposable procedure only.

The local ephemeral wizard opens the private account page and guides account creation, a manual write, explicit default selection, and generic Siri creation. Settings labels vary by iOS; keep SSL enabled and port 443, and use the supplied HTTPS `/dav/` account URL if Advanced settings require it. Never accept a downgrade to HTTP.

Use only dummy event titles, such as **Preview manual write** and **Preview dentist**. Record the previous default before changing it and restore it immediately after the Siri check. Leave the disposable account installed only long enough to verify edits/deletions; then remove that account, not existing Google calendars or server Events. If interrupted after changing the default, restore it manually before creating personal events.

The endpoint, credential page, wizard, and process-stop paths are session-specific and must not be committed. See [preview scope and limitations](caldav-preview.md) before interpreting any result.
