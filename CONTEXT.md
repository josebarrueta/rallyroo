# Rallyroo Family Coordination

Rallyroo helps a family coordinate scheduled activities and alert-oriented responsibilities without treating those concepts as interchangeable.

## Language

**Family**:
The private coordination group whose members share events, family reminders, and configuration according to their roles.
_Avoid_: Public group, household account

**Member**:
A parent or kid represented within a family and eligible to participate in events or receive reminders.
_Avoid_: User, attendee

**Event**:
A scheduled family activity occupying a start-to-end time range and participating in overlap conflict detection.
_Avoid_: Reminder, task

**Reminder**:
An alert-oriented family responsibility with one due instant, one or more assignees, and no duration. It never participates in event overlap conflicts.
_Avoid_: Event, appointment

**Event mutation**:
A parent-authorized create, update, or delete of a native Event, serialized per Family and identified by a stable idempotency key. Its authoritative Event change, Family change cursor, and optional schedule update notification intent are recorded atomically before external delivery is attempted.
_Avoid_: Imported calendar refresh, Event occurrence, transport retry

**Recurrence series**:
The rule and shared details from which bounded Event or Reminder occurrences are scheduled.
_Avoid_: Occurrence, copied Event

**Schedule occurrence**:
One logically stable scheduled instance of a recurrence series, identified by its kind, series, and original scheduled instant even when its effective details are later overridden.
_Avoid_: Series template, notification delivery

**Occurrence acknowledgement**:
A Member-specific record that the Member has seen a schedule occurrence. It does not alter the Family schedule or another Member's acknowledgement.
_Avoid_: Completion, skip, notification delivery receipt

**Occurrence disposition**:
The Family-wide scheduling status of an occurrence: scheduled, skipped, or deleted. A skipped occurrence remains in Family history; a deleted occurrence is hidden but retains a durable tombstone so recurrence expansion cannot recreate it.
_Avoid_: Member acknowledgement, Reminder completion, modification

**Occurrence override**:
Changed effective details for one schedule occurrence. Modification is not a disposition: an overridden occurrence remains scheduled unless separately skipped or deleted.
_Avoid_: New recurrence series, occurrence acknowledgement

**Assignee**:
A family member responsible for a reminder. A reminder occurrence may have multiple assignees, but its completion state is shared.
_Avoid_: Participant, attendee

**Due instant**:
The date and time by which a reminder should be completed.
_Avoid_: Start time, event time

**Completion**:
The shared state transition that marks one Reminder occurrence complete for every assignee and records when and by which Member it was completed.
_Avoid_: Per-assignee completion, occurrence acknowledgement

**Alert lead time**:
The optional supported interval before a reminder's due instant or an event occurrence's start when the responsible members should be notified. Reminder alerts go to assignees; event alerts go to participants.
_Avoid_: Event duration, snooze

**Arrival target**:
The optional latest instant by which travelers intend to reach an Event location. It is at or before the Event start and does not change the Event's occupied time range.
_Avoid_: Start time, leave time, Event alert

**Travel plan**:
An optional, Event-associated intention describing how identified travelers get from a confirmed origin to the Event destination by its arrival target.
_Avoid_: Event, commute subscription, route response

**Saved place**:
A Member- or Family-owned named location that may be explicitly selected as a travel origin or destination.
_Avoid_: Location history, inferred position

**Leave time**:
A recalculated travel-guidance instant derived from an arrival target, route estimate, and applicable preparation allowance. It is not a user-authored Event time.
_Avoid_: Arrival target, Event start

**Leave alert**:
A dynamic notification intent telling authorized recipients to begin an Event's Travel plan at its latest calculated leave time. It remains distinct from the Event alert tied to Event start.
_Avoid_: Event alert, schedule update notification, commute alert

**Notification intent**:
A typed, durable request to create one authorized Member inbox record and eligible channel-delivery work per recipient. It has a stable deduplication key and is recorded atomically with the authoritative domain change when one exists.
_Avoid_: APNs payload, delivery receipt, transient banner

**Member inbox record**:
Durable user-visible notification state belonging to exactly one Member, with independent read state and a typed opaque destination. Its existence does not claim that APNs or local delivery succeeded.
_Avoid_: Push history, Family-wide alert, delivery attempt

**Channel delivery**:
A bounded, retryable attempt to present a Member inbox record through APNs or on-device local notification scheduling. Delivery state is separate from inbox/read state.
_Avoid_: Notification intent, member inbox record

**Schedule update notification**:
A durable, one-time notification intent recorded atomically when a parent saves an event and explicitly chooses to notify its participants. Delivery is attempted promptly and retried after provider failure. It summarizes the saved series once, excludes the saving parent, and is separate from occurrence-based event alerts.
_Avoid_: Event alert, reminder alert, best-effort push

**Schedule draft**:
A temporary, review-only event or reminder proposal extracted from typed, transcribed, or recognized text. It does not enter the family schedule until a parent explicitly confirms it.
_Avoid_: Imported event, saved event, automatic action

**Clarification**:
A question attached to a schedule draft when required information is ambiguous. A draft needing clarification cannot be saved until the parent revises the source text and receives a complete proposal.
_Avoid_: Model guess, default date

**Protected Family detail**:
Human-readable information describing a Family, Member, Event, Reminder, invitation, calendar source, commute subscription, Shopping routine, Pantry item, Shopping list, Purchase, or notification. Scheduling instants, alert triggers, statuses, cadences, and opaque coordination identifiers are not protected Family details because Rallyroo must query them to coordinate the Family.
_Avoid_: Schedule metadata, trigger, ciphertext

**Commuter installation**:
The parent-enabled, Family-level activation of Rallyroo's shipped Commuter capability. Installation state is independent from provider health and individual commute subscriptions.
_Avoid_: Downloaded plugin, commute subscription

**Commute subscription**:
A personal or Family-visible preference for receiving alerts about a bounded transit route, direction, stop pair, service window, and condition. It is neither an Event nor a Reminder.
_Avoid_: Event, Reminder, live departure

**Commute alert**:
A short-lived, deduplicated report of a matching fresh transit condition. Personal commute alerts target only their owning parent; Family commute alerts use Family visibility.
_Avoid_: Event alert, schedule update notification

**Personal calendar**:
An imported calendar visible only to the parent who connected it.
_Avoid_: Private event, public calendar

**Family calendar**:
An imported calendar visible under the family's existing permissions.
_Avoid_: Public calendar

**Caltrain catalog**:
The bounded, normalized last-good set of public Caltrain stations and directional stops used to configure commute subscriptions. A failed refresh changes Provider status but never replaces the catalog with malformed or empty data.
_Avoid_: Live departure, commute subscription

**Provider status**:
The independently reported freshness and availability of Commuter's static catalog and real-time feeds. A recent failed attempt is degraded; an expired last success is stale. Provider failure must not silently disable an installation or erase its last-good static catalog.
_Avoid_: Installation status, subscription status

**Day brief**:
A private, Member-specific start-of-day summary of schedule facts visible to that Member, including relevant Events, driving responsibilities, travel guidance, conflicts, and assigned Reminders. AI may explain or prioritize verified facts but cannot create facts or broaden calendar visibility.
_Avoid_: Family-wide digest, schedule source, AI-authored schedule

**Shopping routine**:
A Family shopping cadence associated with one store, such as a Costco trip every two weeks. It organizes trip planning without becoming an Event unless a parent separately schedules one.
_Avoid_: Recurrence series, Event, shopping trip

**Pantry item**:
A Family-owned grocery or household good whose replenishment need may be tracked across shopping routines.
_Avoid_: Shopping list entry, exact inventory count

**Stock observation**:
Timestamped evidence that a Pantry item is enough, low, out, or at an optionally known quantity. It becomes less reliable as it ages and is not silently treated as current inventory.
_Avoid_: Purchase record, prediction

**Replenishment policy**:
The Family's expectation for when and where a Pantry item should be reconsidered, based on criticality, normal duration, and optional minimum or target quantity.
_Avoid_: Purchase history, automatic order

**Family item request**:
A Member-authored request to consider one Pantry item for replenishment. It remains evidence until cancelled, resolved, or incorporated into a parent-finalized Shopping trip plan; it does not silently become a purchase decision.
_Avoid_: Stock observation, Shopping list entry, automatic purchase

**Shopping trip plan**:
A proposal for one occurrence of a Shopping routine that separates items to buy, check at home, or skip, with the evidence behind each recommendation. A parent finalizes it before shopping.
_Avoid_: Shopping routine, authoritative inventory

**Shopping list entry**:
A parent-approved decision about an item for a specific Shopping trip plan, including its buy, check, skipped, or purchased state. It may be informed by a Family item request but is not the request itself.
_Avoid_: Pantry item, Family item request, AI recommendation

**Purchase record**:
Timestamped evidence that a Pantry item was purchased at a store, with optional quantity and price. It informs replenishment without proving how much remains.
_Avoid_: Stock observation, receipt image

## Live Train Positions

Caltrain GTFS-RT Vehicle Positions provide real-time GPS coordinates for active trains. The server refreshes these positions periodically and caches them. The `GET /v1/modules/commuter/live-trains` endpoint returns the latest cached positions to authorized clients.

