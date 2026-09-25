# Day Brief and Shopping Design

Status: Day Brief v1 and Shopping v1 catalog, evidence, reviewed trips, outcomes, and Purchase history implemented; receipt/barcode capture and learned consumption remain deferred.

## Goals

Rallyroo should:

1. Give each parent a useful private summary of the day before their first commitment.
2. Help a Family replenish groceries and household goods without relying on memory or buying long-lasting items unnecessarily.

Both capabilities follow the same trust rule: AI may explain verified Family data, but it does not create facts or make irreversible decisions.

## Day Brief

### Product behavior

The Day brief belongs to one Member. It can include:

- Native Event occurrences visible to the Member.
- Personal imported calendar Events owned by the Member.
- Family imported calendar Events visible to the Member.
- Events in which the Member participates or is the assigned driver.
- Arrival targets, Travel plans, and known leave times.
- Overlaps, tight transitions, and missing actionable details.
- Open or overdue Reminders assigned to the Member.
- Meaningful free periods between commitments.

A push notification presents the most important facts concisely. Tapping it opens a full Day brief with an at-a-glance section, chronological timeline, attention-needed section, and meaningful open periods.

### Delivery policy

Each Member has an enabled setting, IANA time zone, weekday time, weekend/holiday time, and early-event preparation margin.

Confirmed defaults:

- Weekdays: 7:00 AM local time.
- Weekends and configured public holidays: 8:30 AM local time.
- If the first actionable commitment is earlier, deliver before it using the configured preparation margin.
- Personal calendars contribute only to their owner's brief.
- An ordinary Day brief uses the normal active notification level and does not bypass Sleep Focus.

The first actionable commitment is the earliest provider-verified leave time for a Travel plan addressed to the Member, otherwise the earliest relevant Event start. A missing plan or unavailable route does not create an invented leave time. Reminder due times do not move the morning brief earlier unless a later product decision explicitly enables that behavior.

Delivery can catch up for at most 30 minutes after its computed local trigger, but never at or after the first actionable commitment. A preference enabled after that window waits until the next local day; a leave time on the previous local day cannot produce a late push. Enabled preferences are visited in bounded, ordered pages that rotate across dispatches rather than repeatedly selecting the first page. Verified leave guidance saved with a brief is encrypted and continues to bound inbox retries if routing later becomes unavailable.

The default preparation margin is 60 minutes and can be changed by the Member.

Public-holiday behavior requires a Member holiday region. The app should suggest the device's region during setup and let the Member change it. A calendar Event whose title appears to describe a holiday is not sufficient evidence that the date is a public holiday.

### iPhone sleep integration

Rallyroo cannot reliably read the configured iPhone Sleep schedule or next Sleep alarm. HealthKit exposes historical sleep-analysis samples, not an authoritative future wake schedule. Focus integrations let an app react to a configured app-specific Focus filter, but do not provide a dependable server-readable Sleep schedule.

Therefore the first release uses explicit Member delivery settings and lets iOS Focus rules govern interruption. It must not classify the routine summary as Time Sensitive merely to bypass Sleep Focus.

### Facts-first generation

The module constructs a structured `DayBriefFacts` value deterministically before invoking AI. The facts include stable source references so every statement can be traced to an authorized Event, Reminder, Travel plan, or conflict.

AI receives only the facts authorized for that Member and returns a bounded structured response. The response is validated before use. AI may:

- Choose which verified facts deserve the notification's limited space.
- Describe the day's pace.
- Group related driving responsibilities.
- Highlight verified conflicts or tight transitions.

AI may not:

- Invent preparation tasks, travel estimates, assignments, or schedule details.
- omit a fact marked mandatory by deterministic policy.
- infer private calendar information belonging to another Member.
- change delivery recipients or times.

If AI is unavailable, invalid, or late, deterministic formatting produces the notification and detailed brief. AI failure never suppresses the brief.

### Module seam

The external interface should remain small:

```ts
interface DayBriefModule {
  generate(member: Account, localDate: string): Promise<DayBrief>;
  dispatchDue(now: Date, limit: number): Promise<DayBriefDispatchResult>;
}
```

The implementation hides visibility filtering, occurrence expansion, time-zone arithmetic, holiday classification, travel and conflict enrichment, mandatory-fact selection, AI prompting and validation, deterministic fallback, deduplication, persistence, and Notification Center submission.

The module uses internal ports for the true external Ollama dependency and for schedule/calendar data owned by existing Rallyroo modules. Production and in-memory test adapters make those seams real.

### Persistence and privacy

- Preferences are Member-specific.
- Brief title, body, and detailed facts are protected Family details and encrypted at rest.
- Queryable metadata is limited to opaque IDs, Member ID, local date, trigger instant, generation status, and deduplication digest.
- Deduplication identity is Member plus local date plus the selected input version.
- The notification destination identifies the brief, not a descriptive Event title.
- Logs and telemetry contain statuses and timing only, never brief content or calendar details.

## Shopping and Pantry

### Product behavior

A Family can define multiple store-specific Shopping routines. For example, Costco may recur every two weeks while a neighborhood grocery routine recurs weekly.

A Pantry item can have:

- Name and optional category/unit.
- Relevant Shopping routines.
- Criticality.
- Expected duration after purchase.
- Optional minimum and target quantities.

Family Members may request items. Parents control the Pantry catalog, replenishment policies, and final Shopping trip plan.

Stock tracking defaults to three low-friction observations:

- Enough
- Low
- Out

Exact quantity remains optional.

### Trip preparation

Preparing a Shopping trip produces three explicit groups:

1. **Buy** — requested, low, out, critical and due, or parent-approved.
2. **Check at home** — purchase history or stale observations suggest uncertainty.
3. **Skip** — recent evidence says enough, or the normal duration indicates reconsideration is premature.

Every recommendation includes a concise reason. The system never claims that an item is still present based only on a prior purchase.

A parent reviews and finalizes the plan. AI may summarize the plan or group items, but may not silently add, remove, purchase, or skip a critical item.

### Trip completion

A parent marks every planned entry as purchased, skipped, unavailable, or deferred in one version-guarded completion. A purchased entry creates an encrypted Purchase record with optional quantity and price. Completion does not create a Stock observation; neither a Purchase nor a skip proves that stock remains at home. Retrying a completed trip is idempotent, and concurrent completion cannot duplicate Purchases. Family Members may read completed trips and Purchase history but only parents may complete them.

Receipt scanning, barcode capture, learned consumption intervals, and price optimization are later capabilities. They are not required for the initial release.

### Recommendation strategy

Trip preparation is implemented without AI. The freshness window is seven days, evaluated at the later of preparation time and the planned trip date (UTC calendar day). The implemented evidence precedence is:

1. Explicit unresolved Family request.
2. Recent Out or Low observation.
3. Recent Enough observation.
4. Missing or stale evidence, which yields Check at home rather than Buy or Skip.

Recent Purchase history now provides an uncertainty reason—“Purchased recently; check at home before buying”—when no Stock observation exists. The item's expected duration, or seven days by default, sets that window. A Purchase alone never yields Buy or Skip. A critical item without recent evidence remains Check at home; a parent makes the final decision. Open requests override Enough with an explicit conflicting-evidence reason. Learned consumption predictions remain deferred.

Conflicting evidence is surfaced for review rather than silently resolved. The exact freshness windows and confidence thresholds belong inside the module and can evolve without changing callers.

### Module seam

```ts
interface ShoppingModule {
  prepareTrip(account: Account, id: string, routineID: string, plannedFor: string): Promise<ShoppingTripPlan>;
  reviewTrip(account: Account, tripID: string, review: ShoppingTripReview): Promise<ShoppingTripPlan>;
  finalizeTrip(account: Account, tripID: string, expectedVersion: number): Promise<ShoppingTripPlan>;
  completeTrip(account: Account, tripID: string, expectedVersion: number, outcomes: ShoppingOutcomeInput[]): Promise<ShoppingTripPlan>;
  trips(account: Account): Promise<ShoppingTripPlan[]>;
  purchases(account: Account): Promise<ShoppingPurchase[]>;
}
```

Administrative setup for routines, Pantry items, and Replenishment policies may use resource-oriented authenticated operations, while recommendation complexity remains behind `prepareTrip`.

The implementation hides evidence ordering, stock staleness, recommendation reasons, Family requests, and protected persistence. Drafts are parent-only; finalized plans are Family-readable. Optimistic versions prevent stale parent edits. A finalized Buy decision resolves incorporated open requests; Check at home and Skip do not. Catalog resources used by a plan cannot be deleted, preserving its evidence and readability. There is one plan per routine and planned day; preparing it again returns the existing plan without overwriting decisions.

### Persistence and privacy

- Store names, Pantry item names, notes, reasons, quantities, prices, and Shopping list content are protected Family details and encrypted at rest.
- Opaque IDs, statuses, dates, cadence, and ordering metadata may remain queryable.
- Equivalent Pantry item detection cannot depend on plaintext columns; creation should be serialized per Family and compare revealed normalized names within the protected persistence seam.
- All mutations are Family-authorized and idempotent.
- Recommendation generation is reproducible from stored evidence and never requires AI availability.

## Release slices

### Day Brief v1

1. Member preferences and holiday region.
2. Deterministic fact gathering and formatting.
3. Detailed in-app Day brief.
4. Notification Center delivery and deep link.
5. Ollama narrative enhancement with schema validation and fallback.

### Shopping v1

1. Shopping routines and Pantry catalog. **Implemented.**
2. Family item requests and Stock observations. **Implemented.**
3. Deterministic Buy / Check at home / Skip preparation. **Implemented.**
4. Parent review and shared shopping experience. **Implemented.**
5. Trip outcomes and Purchase history. **Implemented.**

The Day Brief and Shopping modules should ship independently. Neither should delay or share persistence with the other merely because both can use AI wording.
