# API input and calendar-fetch security boundaries

This is a boundary inventory, **not** a claim that every API or dependency has been security-audited. Keep receipt, financial, Family, calendar URL and provider contents out of logs, tickets and diagnostic responses.

## Current controls

- Fastify has a global 1 MiB request-body ceiling, a global 120/min rate limit and authenticated-by-default routes. Resource routes apply Family/role checks; many mutating routes parse typed Zod schemas. Errors must return stable codes, not submitted values. All responses carry `X-Content-Type-Options: nosniff`; JSON is data, not HTML. Browser-facing clients must continue to render untrusted strings as text, not injected markup.
- The receipt proposal route adds a 16 KiB body ceiling, a strict bounded JSON shape, a 5/min limit, parent authorization and validated AI output. It has no writes. Text that resembles HTML, SQL or model instructions is not proof of an attack and is not rejected via a keyword blacklist. Database calls must use parameters rather than string concatenation.
- Calendar-source creation requires a parent, a bounded HTTPS URL with no credentials, fragments, nonstandard port, ambiguous backslashes or control characters, and bounded participants. The encrypted feed URL is never returned in API responses. Each server-side feed fetch resolves all addresses, rejects non-public and known IPv4-transition IPv6 ranges, pins a vetted result to a fresh TLS connection, rechecks redirects and drops validators across origins. Requests have a 15-second timeout; replies are limited to 5 MiB with a calendar content-type check. Imported iCalendar text is parsed into event fields; `URL`/`ATTACH` properties are **not fetched or opened by the import pipeline**. Event descriptions remain untrusted text.

## Follow-up review (not yet certified)

- Inventory **every** route's query/path/body limits, schema unknown-field behavior, authorization and error handling. Some older schemas strip extra fields or permit long strings/arrays; prioritize auth, invites, event mutations, Shopping, Commuter and external-provider requests. Do not change these contracts en masse without client compatibility tests.
- Review *every* outbound network adapter (not only calendar feeds) for destination restrictions, redirect/DNS rebinding, timeouts, response limits and secret propagation. Defense-in-depth egress controls on production hosts should deny metadata, loopback and private destinations even if application checks regress.
- Audit render sinks (web and native), dynamic SQL usage, third-party parser dependencies, traffic/proxy limits, and repeatable authorization tests with different Families and roles. `nosniff` does not replace context-aware HTML escaping or parameterized SQL.
- NAT64 can use a network-specific prefix outside the well-known ranges. Application DNS checks cannot guarantee network-level SSRF isolation; require restrictive egress policy and regression testing against the deployment network.

No calendar URL, feed content or receipt text should be pasted into audit artifacts. Use synthetic fixtures.
