# 511 SF Bay integration research for optional Rallyroo modules

## Question

How should Rallyroo use 511 SF Bay Open Data for an optional Caltrain Commuter module now, while leaving a sound path for a separate Traffic module later?

## Source note

The URLs' directory dates are not document version dates:

- The supplied Transit PDF identifies itself as **version 1.35, November 16, 2022**, despite living under a `2025-05` URL path (Transit PDF, cover and document history, pp. 1–7).
- The supplied Overview PDF identifies itself as **version 1.1, June 19, 2020**, despite living under a `2026-04` URL path (Overview PDF, cover and document history, pp. 1–3).

Treat those internal dates and versions as authoritative. The public portal was checked on **September 7, 2026**; authenticated live-feed sampling is still required because the PDFs may lag production.

## Specification facts

### Authentication, formats, and operating constraints

- Every documented transit request requires an Open511 key. The specifications require the token in an `api_key` query parameter (Transit PDF, §§2.1–2.20; Overview PDF, §3.2, p. 14).
- Query-oriented 511 resources use HTTP GET. JSON is generally the default for query resources; XML is also supported. GTFS-Realtime Trip Updates and Vehicle Positions use Protocol Buffers unless a supported format is explicitly requested (Transit PDF, §§2.1–2.20, pp. 9–40).
- The Overview distinguishes mostly-static **configuration data** (such as routes, stops, and roadway networks) from short-lived **real-time data** (such as departure predictions, incidents, and roadway travel times). It recommends downloading/storing configuration data and requesting real-time data as needed (Overview PDF, §2.1, pp. 4–6).
- The current Transit and Traffic portal pages state a default quota of **60 requests per 3,600 seconds per API token**. Higher limits may be requested based on need and use case. This is too low for independent per-Family polling and reinforces shared agency-level polling.
- The current portal asks rate-limit requests to be sent to `511sfbaydeveloperresources@googlegroups.com` **without the API key**. The FAQ conflicts with this by naming another address and requesting the key; follow the safer current portal instruction and never email a credential unless 511 confirms the process through a trusted channel.
- Transit sections document common 401, 404, and 500 responses (Transit PDF, §§2.1–2.20, pp. 9–40).
- A single requested token accesses transit, traffic, and toll endpoints. The portal describes the data as free, but access is conditioned on accepting the Data Disseminator Agreement.
- Current portal documentation uses both HTTP and HTTPS examples. Production code should require HTTPS and reject redirects or origins outside the allowlisted 511 API host.

### Current license and attribution

The current Data Disseminator Agreement grants a nonexclusive, royalty-free, worldwide, non-transferable license to use, sublicense, copy, distribute, store, display, and create derivative works from the data, subject to these important conditions:

- use commercially reasonable efforts to keep public information current;
- do not sell the data as received on a standalone basis without MTC's written agreement;
- downstream sublicenses must accept the same terms in writing;
- do not use Data Supplier names, marks, or logos without separate permission;
- within 30 days after launch, provide MTC documentation of the product and its attribution compliance;
- display **“powered by 511.org”** or **“data provided by 511.org”**, linked to `http://www.511.org`, in visual proximity to the user's access to the data;
- do not use “511,” “511.org,” or 511 marks in Rallyroo product naming or marketing beyond the permitted attribution;
- treat data as “AS IS,” “AS AVAILABLE,” and subject to change; the agreement includes broad disclaimers and indemnification obligations;
- either party may terminate with 30 days' notice, and MTC may introduce fees with at least 90 days' notice.

Caching and derived normalized records are permitted by the express rights to store data and create derivative works, but the freshness obligation means Rallyroo must display stale/provider-unavailable state rather than silently presenting old real-time data as current. The agreement should receive legal review before launch.

### Transit resources useful to Commuter

| Purpose | Resource | Relevant inputs/format | Source |
|---|---|---|---|
| Discover agency identifiers and feed generation time | `GET /transit/gtfsoperators` | key; JSON/XML | Transit PDF §2.17, p. 37 |
| Download static agency or regional GTFS | `GET /transit/datafeeds` | `operator_id`; ZIP attachment; `RG` denotes regional feed | Transit PDF §2.18, p. 38 |
| Discover lines | `GET /transit/lines` | `operator_id` required; optional `line_id`; JSON/XML | Transit PDF §2.2, pp. 11–12 |
| Discover stops | `GET /transit/stops` | `operator_id` required; optional line/direction/pattern filters; JSON/XML | Transit PDF §2.3, pp. 12–15 |
| Resolve ordered stops and directions | `GET /transit/patterns` | `operator_id` and `line_id`; optional `pattern_id`; JSON/XML | Transit PDF §2.5, pp. 19–22 |
| Retrieve scheduled stop departures | `GET /transit/stoptimetable` | `OperatorRef`, `MonitoringRef`, optional line/time window; JSON/XML | Transit PDF §2.9, p. 30 |
| Retrieve real-time predictions at a stop | `GET /transit/StopMonitoring` | `agency`; optional `stopCode`; JSON/XML | Transit PDF §2.10, pp. 30–31 |
| Retrieve agency/regional trip changes | `GET /Transit/TripUpdates` | `agency`, including `RG`; Protocol Buffers | Transit PDF §2.15, pp. 35–36 |
| Retrieve agency/regional disruptions | `GET /transit/servicealerts` | optional `agency`; JSON/XML/Protocol Buffers | Transit PDF §2.19, pp. 39–40 |
| Retrieve vehicle positions | `GET /Transit/VehiclePositions` | `agency`, including `RG`; Protocol Buffers | Transit PDF §2.16, pp. 36–37 |

The document does not establish Caltrain's current operator identifier. Resolve it from `gtfsoperators` rather than assuming or hard-coding it.

### Freshness and cancellation signals

- Stop Monitoring records `ResponseTimestamp` and per-visit `RecordedAtTime`, and distinguishes aimed versus expected arrival/departure times. It can carry visit cancellations and line notices (Transit PDF, §2.10 and Appendix C §C.1.10, pp. 30–31 and 100–106).
- Vehicle Monitoring includes `RecordedAtTime` and `ValidUntilTime` as required fields and can carry activity cancellations (Transit PDF, §2.11 and Appendix C §C.1.11, pp. 31–32 and 106–110).
- GTFS-Realtime Service Alerts include active periods and informed entities, which may identify affected agencies, routes, stops, or trips according to GTFS-Realtime structure (Transit PDF, §2.19 and Appendix C §C.1.15, pp. 39–40 and 114).
- The specification marks SIRI Production Timetable and Estimated Timetable resources as possible future implementations. They should not be dependencies for the first release (Transit PDF, §§2.12–2.13, pp. 32–34).
- Announcement and General Announcement resources are explicitly discontinued; use GTFS Service Alerts instead (Transit PDF, §§2.8 and 2.14, pp. 29 and 34–35).

### Current portal behavior

- The live Transit page still advertises static GTFS, GTFS-Realtime Trip Updates, Vehicle Positions, and Service Alerts, plus the SIRI/NeTEx-style query APIs listed above.
- Agency identifiers remain discoverable through `gtfsoperators` and `operators`; the FAQ says an operator's `Monitored` value indicates real-time support.
- The portal advertises regional static and real-time feeds under agency code `RG`.
- Upcoming service changes may appear in GTFS **three days in advance**. Adding `status=active` to the static data-feed request restricts it to currently active service. Rallyroo should ingest advance changes into a staged snapshot and activate service by GTFS calendar semantics rather than treating download time as effective time.
- The unauthenticated portal confirms Caltrain is included in real-time departure coverage, but it does not expose Caltrain's current API operator ID or prove each feed's quality.

### Authenticated Caltrain sample validation

A credential-safe local probe on **September 8, 2026 at approximately 02:48 UTC** established the following point-in-time behavior without logging the token or complete request URLs:

- Both `gtfsoperators` and `operators` identify Caltrain as operator **`CT`**. The operator record reports `Monitored: true`.
- The operator record reports `TimeZone: America/Vancouver`, despite Caltrain operating in the Bay Area. Do not trust this metadata as the schedule timezone; validate and normalize against GTFS `agency_timezone` and service-date rules.
- The Caltrain static GTFS request returned HTTP 200 and a valid ZIP with 19 files, including all core files. The sample contained 5 routes, 106 stops, 260 trips, and 5,468 stop times.
- Its `feed_info.txt` reported version `20260611` and service coverage from January 31, 2026 through January 31, 2027. The operator discovery record also reported generation on June 11, 2026. A valid future service range does not prove freshness; refresh monitoring should compare versions, generation times, calendars, and observed changes.
- The Caltrain GTFS-Realtime Trip Updates endpoint returned HTTP 200, GTFS-Realtime version 1.0, a current feed timestamp, 10 entities, and 136 stop-time updates. Sample trip descriptors omitted `start_date`, so matching cannot require that optional field.
- The Caltrain Service Alerts endpoint returned HTTP 200 with a valid but empty dataset at that instant. Empty alerts must mean “no currently published alert records,” not provider failure.
- Static stop discovery returned distinct Palo Alto platform IDs: northbound `70171` and southbound `70172`.
- Stop Monitoring for northbound Palo Alto returned HTTP 200 with three visits. Provider timestamps were approximately one second old and included distinct aimed and expected arrival/departure times.
- The Stops API rejected an implicit `Accept-Encoding: identity` request with HTTP 406 and stated that only gzip or deflate is supported for that service type. The adapter must explicitly request and decode gzip/deflate, and its contract tests must preserve this provider quirk.

A follow-up **15-minute bounded soak probe** ran from 03:01–03:15 UTC on September 8, 2026. It polled Caltrain Trip Updates and Service Alerts once per minute, staying within the default quota:

- all 30 requests returned HTTP 200; none returned HTTP 429;
- both feed timestamps advanced on every sample, with 60–63 second intervals;
- Trip Updates changed on every sample, ranged from 10–12 entities and 136–140 stop-time updates, and had a feed timestamp within approximately -2.0 to +0.9 seconds of the Rallyroo host clock (small negative values indicate provider/host clock skew);
- Service Alerts remained a valid zero-entity dataset throughout, while its header timestamp continued advancing;
- Trip Updates latency ranged from 115–2,399 ms (387 ms average); Service Alerts ranged from 114–2,991 ms (378 ms average);
- no transport or parse failures occurred.

This short soak establishes healthy minute-level Caltrain updates at that time, not long-term reliability. Longer observation is still needed for cancellation samples, actual service-alert records, outages, ID changes, and daily/static feed transitions.

### Traffic path

- The current Traffic specification is **version 1.7, August 22, 2025**, despite its `2026-04` URL path. It covers the enhanced Open511 Traffic Event API and WZDx API; older APIs were removed or revised over the document history.
- The current Traffic page advertises `GET /traffic/events` for active and planned major-highway incidents, `GET /traffic/wzdx` for planned and active closures/detours, and `GET /toll/programs` for bridge and express-lane tolls.
- WZDx covers participating local streets as well as freeways and state highways. By default the provider maps non-standard direction `both` to `undefined`; `includeAllDefinedEnums=true` retains `both`, so a future Traffic adapter must normalize this deliberately.
- Traffic remains a separate typed module. Its current specification removes the earlier documentation blocker, but authenticated sample validation is still required before designing corridor matching, deduplication, and freshness policy.

## Rallyroo recommendations (inference, not 511 requirements)

### Provider seam

Start with one 511 transit adapter inside a deep Commuter module. Do not expose SIRI, NeTEx, GTFS, or GTFS-Realtime shapes to iOS or to the rest of Rallyroo. Normalize them behind an internal seam into:

- agencies, routes, directions, stops, and scheduled journeys;
- predicted calls with source timestamps and expiry;
- disruptions with stable provider identity, affected transit entities, severity/effect, and active period.

There is only one provider adapter today, so a public multi-provider seam would be hypothetical. If a second provider adapter is implemented, that becomes a real seam.

### Static and real-time ingestion

1. Download and validate agency GTFS on a bounded schedule; atomically replace the last-good static snapshot.
2. Resolve subscriptions against normalized, provider-qualified identifiers such as `(provider, agency, route, direction, originStop, destinationStop)`.
3. Poll an agency-level GTFS-Realtime Trip Updates feed and Service Alerts feed once, then fan results out to all matching subscriptions.
4. Use Stop Monitoring only where stop-specific predictions add necessary value; never request all stops per family.
5. Do not require Vehicle Positions for the initial alert-only release.
6. Preserve the last-good static catalog during outages. Mark expired real-time data stale and never turn missing/stale data into an “on time” assertion.

This keeps provider request volume proportional to agencies/feeds rather than Family or subscription count.

### Credential and logging policy

Because 511 requires a query-string key:

- keep the key on the backend; never ship it in the iOS bundle;
- store it as a narrowly mounted production Secret;
- construct provider URLs only inside the adapter;
- redact full provider URLs/query strings from logs, exceptions, tracing attributes, and metrics labels;
- never persist the key in subscriptions, module configuration, Helm values, artifacts, or test fixtures.

### Domain separation

- A `Commute subscription` is neither an Event nor a Reminder. It is a member's or Family's preference for transit conditions and alert delivery.
- A `Commute alert` is short-lived provider information, not an Event alert or schedule update notification.
- Live departures should not be bulk-created as Events.
- A parent may explicitly turn a planned commute into a native Event through Event mutation. Once created, the Event remains after Commuter is disabled or removed.
- Personal commute subscriptions and their stops/routes must not leak to other Family members through notifications, logs, metrics, sync payloads, or conflict details.

### Optional-module architecture

Share only the small installation lifecycle across optional modules: available, enabled for a member or Family, disabled, and removed. Keep Commuter's typed configuration and provider logic inside Commuter. A later Traffic module may reuse installation and notification delivery infrastructure, but should own typed roadway corridors/incidents rather than pretending they are transit routes.

## Unknowns to resolve before implementation

1. Authenticated live responses, supported resource versions, and production behavior for every endpoint Rallyroo will consume.
2. Caltrain feed reliability over time; operator ID `CT`, current Trip Updates, and current Stop Monitoring were confirmed only by a point-in-time sample.
3. A quota approved for Rallyroo's proposed shared polling intervals; the default 60 requests/hour cannot support frequent polling of multiple feeds.
4. Provider timestamp/expiry behavior over time, payload-size bounds, cancellations, ID stability, and outage/recovery behavior under a bounded Caltrain soak probe.
5. Written confirmation that the registered account and requested quota cover backend fan-out to all Rallyroo families.
6. Final legal/product review of the Data Disseminator Agreement, in-app attribution placement, 30-day post-launch documentation, and shutdown behavior if the license ends.

## Primary sources

- [511 SF Bay Open Data Portal](https://511.org/open-data)
- [Current Transit portal and endpoint catalog](https://511.org/open-data/transit)
- [Current Traffic portal and endpoint catalog](https://511.org/open-data/traffic)
- [511 Open Data FAQs](https://511.org/open-data/faqs)
- [511 Data Disseminator Agreement](https://511.org/sites/default/files/2026-04/511_Data_Agreement_Final_2026.pdf)
- [511 SF Bay Open Data Specification — Transit](https://511.org/sites/default/files/2025-05/511%20SF%20Bay%20Open%20Data%20Specification%20-%20Transit.pdf)
- [511 SF Bay Open Data Specification — Overview](https://511.org/sites/default/files/2026-04/511%20SF%20Bay%20Open%20Data%20Specification%20-%20Overview_2026.pdf)
- [511 SF Bay Open Data Specification — Traffic](https://511.org/sites/default/files/2026-04/511%20SF%20Bay%20Open%20Data%20Specification%20-%20Traffic_2026.pdf)
