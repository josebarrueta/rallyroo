# Family Activity Coordinator — Architecture & Build Plan (historical)

> **Archived planning document.** This captures early ideas, not the current product or deployment. In particular, Supabase hosting, Gmail polling, and Claude-based extraction below are **not** the shipped architecture. See the [repository README](README.md), [domain language](CONTEXT.md), [architecture decisions](docs/adr/), [API guide](server/api/README.md), and [GCP operations guide](deploy/gcp/README.md) for current behavior. Do not use the commands below as a deployment runbook.

## 1. Overview

A native iOS app for coordinating family activities (kids' games, practices, events),
built primarily for the parents to use day-to-day, with limited access for one kid
who has a phone. Beyond a shared calendar, the app has "agentic" features: it scans
email for game/activity info, accepts voice input to add events, and proactively
flags scheduling conflicts.

## 2. Users & Roles

| Role | Access |
|---|---|
| Parent (x2) | Full read/write on all events, kids, drivers. Approves AI-suggested events. |
| Kid (1, has a phone) | Read access to their own activities; can view schedule, no edit rights on others' events. |

## 3. Platform

- **Client:** Native iOS app, Swift + SwiftUI
- **Distribution (dev/family use):** TestFlight — no public App Store listing needed
- **Why native (not React Native/PWA):** direct access to EventKit, Siri Shortcuts /
  App Intents, and push notifications without cross-platform framework overhead

## 4. Backend

- **Client/backend boundary:** the iOS client depends on backend-neutral contracts
  (for example, `EventStore`), not a specific vendor SDK or transport.
- **Initial backend implementation:** TypeScript + Fastify with PostgreSQL;
  deployable on a general host or behind Supabase infrastructure
- **Images (local use):** regular image files bundled with the app (Xcode asset catalog) or selected from the device photo library; do not use Supabase Storage for local images.
- **Why Supabase initially:** free/near-free at family scale, no server to manage,
  built-in cron support for scheduled polling, Swift client SDK available. A custom
  API or another backend can implement the same client contracts later.
- **Local development:** Supabase CLI, which runs the full stack (Postgres, Auth,
  Edge Functions runtime, local Studio UI) as Docker containers
  - `supabase init` / `supabase start` — spins up local stack
  - `supabase functions serve` — run Edge Functions locally
  - `supabase db push` / `supabase functions deploy` — promote to the cloud project
    when ready
- **Environment switching:** app config (e.g. `Config.swift` with `#if DEBUG` or an
  `.xcconfig`) points to `localhost` in dev builds, real Supabase project URL in
  release builds

## 5. Data Model (initial)

Minimal v1 schema — expected to evolve:

- **kids**: id, name, birth_year_or_grade (no exact DOB), color_tag
- **family_members**: id, name, role (`parent` | `kid`), grade_or_birth_year
  (kids only), color_tag
- **events**: id, title, participant_ids (one or more family members; supports
  parent work/appointment events and kid activities), start_time, end_time,
  location, driver, source (`manual` | `email_suggested` | `voice` | `calendar`), status
  (`confirmed` | `pending_review`); imported calendar projections also retain read-only provenance
- **users**: id, role (`parent` | `kid`), auth link to Supabase Auth
- **conflicts** (derived, not stored): computed at write-time by checking new events
  against existing ones for overlapping times or the same driver double-booked

## 6. Core Features (v1)

- Parent sign-in (Stytch with Apple and Google identity providers)
- Add / edit / delete events manually (kid, time, location, driver)
- Weekly view, color-coded per kid
- Data synced across family devices through a lightweight family change cursor;
  clients refresh automatically when the cursor advances or the app becomes active
- Parent-managed HTTPS iCalendar subscriptions for TeamSnap, school, work, and
  sports schedules. Connecting a source imports its initial snapshot; each source
  is Personal to its owning parent or Shared with family. Access filtering precedes
  read-only provenance, recurrence expansion, conflict detection, notifications,
  and deterministic exact deduplication so personal details cannot leak.

## 7. Agentic Features (v2+)

### 7.1 Email scanning for games/activities
- Supabase Edge Function on a cron schedule (every 10–15 min)
- Polls Gmail via the Gmail API (OAuth-scoped to read only)
- Each new email is sent to Claude (Anthropic API) with a prompt to extract:
  is this about a kid's game/activity, and if so, date/time/location/opponent
- High-confidence extractions are written to `events` with
  `status = pending_review` and `source = email_suggested`
- Push notification to parents: "New event detected — review to confirm"
- Explicitly NOT auto-confirmed — false positives would erode trust

### 7.2 Voice input
- **On-device (fast path):** Siri Shortcuts / App Intents (iOS 16+) for simple,
  well-structured phrases ("add soccer practice Tuesday at 4")
- **NLP path (for casual/complex phrasing):** transcribed text sent to Claude API
  to parse into a structured event (kid, date, time, location), then written the
  same way manual entries are

### 7.3 Conflict detection
- Pure logic, no LLM needed
- On any event write (manual, email-suggested, or voice), check for:
  - overlapping times for any shared family member (parent or kid)
  - the same driver double-booked across family members
- In local-first v1, show an immediate in-app conflict alert to the parent adding
  the event. With synced accounts, send push notifications to the affected
  parent(s)/family based on notification preferences.

## 8. Tech Stack Summary

| Layer | Choice | Why |
|---|---|---|
| iOS app | Swift + SwiftUI | Native EventKit/Siri/push access |
| Backend logic | TypeScript + Fastify | Strong Stytch, Gmail, Calendar, and Anthropic SDKs; fast iteration for prompt-heavy logic |
| Identity | Stytch (Apple and Google OAuth) behind an `IdentityProvider` seam | Managed session/JWT security without coupling Rallyroo authorization to an identity vendor |
| Database | PostgreSQL (provider-neutral repository adapter) | Scalable relational storage; can be hosted by Supabase or another PostgreSQL provider |
| Cache | Redis behind a provider-neutral cache seam | Shared short-lived identity and Places caching across API instances; correctness falls back to source providers |
| LLM | Claude (Anthropic API) | Email parsing, voice-text parsing |
| Local dev | Supabase CLI + Docker; local image files | Full backend stack runs locally; image assets stay in the app bundle/device rather than Supabase Storage |
| Hosting | Supabase free tier (serverless) | $0–10/month at family scale; main variable cost is LLM API usage, expected to be low |

## 9. Build Phases

**Phase 1 — Core app**
- PostgreSQL + local TypeScript API development environment
- Local image assets in the Xcode asset catalog (no Supabase Storage)
- Data model (kids, events)
- SwiftUI app: parent sign-in, add/edit events, weekly list view
- Realtime sync between both parents' devices
- TestFlight build for family testing

**Phase 2 — Kid access + notifications**
- Restricted kid login/view
- Push notifications for new/updated events

**Phase 3 — Agentic features**
- Email-polling Edge Function + Claude-based extraction
- Pending-review UI for AI-suggested events
- Conflict-detection logic + notifications

**Phase 4 — Voice input**
- Siri Shortcuts / App Intents integration
- Claude-based NLP parsing for casual voice phrasing

## 10. Open Questions / Decisions to Revisit

- Whether to sync events to the iPhone's native Calendar app (EventKit) in addition
  to the in-app view, or keep the app as the sole source of truth
- Whether Gmail polling should move from cron-based polling to Gmail push
  notifications (Pub/Sub) later for lower latency, which would require an
  always-on service (e.g. Fly.io) instead of pure serverless
- Carpool coordination across other families (out of scope for v1–v4, noted as a
  possible future direction)
