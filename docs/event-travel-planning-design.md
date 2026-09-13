# Event travel planning design

## Goal

Rallyroo should let a parent record an optional arrival target that is distinct
from an Event's start, then optionally calculate and deliver a traffic-aware leave
alert. Travel planning must improve coordination without making an Event dependent
on a routing provider, silently tracking Members, or promising a notification that
has no eligible recipient.

## Product model

An Event retains its existing start-to-end activity range. An optional arrival
target says when travelers intend to be at the Event location and must be at or
before Event start. A separate Travel plan links an origin, the Event destination,
travel mode, responsible travelers, and a leave-alert preference to that Event.
The leave time is derived guidance and can move as estimates change.

These notifications remain separate:

| Notification | Trigger | Recipients |
|---|---|---|
| Event alert | Fixed lead time before Event start | Event participants and assigned driver under current rules |
| Leave alert | Latest calculated leave time | Explicitly authorized Travel plan recipients |
| Schedule update | Parent explicitly requests it while saving | Selected participants, excluding the saver where specified |

The Event remains valid when routing is unavailable. A Travel plan cannot alter the
Event's authoritative start/end range.

## User experience

### Event time

The Time section adds an optional `Arrive by` control. Enabling it initially uses
Event start. It supports an exact date and time, while moving Event start preserves
the existing arrival offset until the user edits the arrival target directly.
Recurring occurrences shift the arrival target by the same recurrence offset as
Event start.

### Travel planning

When arrival target and destination are present, a Travel section may offer:

```text
Leaving from       Home
Traveling by       Driving
Estimated travel   25–35 min
Leave by           8:15 AM
Notify              When it is time to leave
```

The leave-alert option is hidden until there is a destination, confirmed origin,
arrival target, and eligible recipient. Missing inputs are presented as actions
such as `Add location` or `Choose departure point`, not as a notification option
that cannot work.

The first release supports explicit driving origins and one route. Pickup legs,
transit, walking, cycling, and live device location are later capabilities.

### Progressive saved-place setup

Saved Places are optional and requested when a Member first enables travel
planning, not during mandatory onboarding. Suggested names are Home, Work, School,
and a user-defined label. Home may be Family-owned; Work defaults to Member-owned.
The user can always enter a one-time origin instead.

## Origin resolution

Origin confidence is ordered as follows:

1. an origin explicitly selected for this Travel plan;
2. a previously confirmed Saved place;
3. the location of a preceding Event involving the same traveler;
4. an explicitly configured weekly routine;
5. an optional, ephemeral device location in a future client-side refinement.

Only the first two are authoritative without another confirmation. Previous Event
and routine origins are suggestions that identify their source, for example:

> Suggested origin: Mateo's previous Event at Central Middle School

A personal imported Event may suggest an origin only for its owning Member. A
native Event may suggest one only for explicit participants. A Family calendar
Event without an unambiguous traveler cannot establish anyone's origin. Rallyroo
does not create or retain passive GPS history.

## Deep module and seam

Travel planning belongs behind a separate deep module rather than adding provider
and delivery state to Event. Its external interface should remain small:

```ts
interface TravelPlanningModule {
  preview(input: TravelPlanInput, now: Date): Promise<TravelPlanPreview>;
  reconcileEvent(eventID: string): Promise<void>;
  dispatchDueLeaveAlerts(now: Date, limit: number): Promise<void>;
}
```

`preview` supports the Event editor without saving provider output as authoritative
Event state. `reconcileEvent` creates, updates, or cancels occurrence guidance when
an Event or Travel plan changes. `dispatchDueLeaveAlerts` uses bounded durable
claims and submits typed intents to Notification Center.

The implementation hides origin resolution, provider calls, iterative leave-time
calculation, recurrence expansion, refresh timing, stale guidance, deduplication,
and provider failures. The routing-provider seam is internal to the module. A
Google Routes adapter serves production and a deterministic in-memory adapter
serves tests.

## Persistence

The authoritative inputs are provider-neutral:

- Event ID and Family ID;
- optional arrival target on Event;
- confirmed origin reference or protected one-time origin;
- travel mode;
- responsible traveler and notification recipient IDs;
- whether the leave alert is enabled;
- optional preparation allowance at the destination;
- revision and lifecycle timestamps.

Saved-place labels and addresses are Protected Family details. Store provider place
IDs where possible; encrypt human-readable place data using existing per-Family
envelope encryption. Do not put addresses, route details, or Member identity in
logs, metric labels, URLs, or notification deduplication keys.

Provider responses and calculated guidance are non-authoritative. Retain only what
is allowed by provider terms and needed for bounded scheduling and diagnostics.
Google permits Place IDs to be stored indefinitely but restricts caching of most
Routes content. Confirm that persisting a derived duration or leave instant complies
with current terms before implementation. Any displayed Google-derived guidance
must satisfy attribution requirements.

## Route calculation

Google Routes is the first server adapter because Rallyroo already uses Google
Places and needs server-side durable scheduling. Use a separately restricted key
with only required Routes capabilities and billing alerts.

For driving, use `TRAFFIC_AWARE_OPTIMAL` and `BEST_GUESS` by default. Google weighs
historical traffic more heavily for distant future departures and live traffic more
heavily as departure approaches. An opt-in conservative preference may use the
`PESSIMISTIC` traffic model.

Google accepts arrival time directly only for transit. Driving leave time therefore
requires a bounded fixed-point calculation:

1. start with an estimated departure;
2. request the traffic-aware duration for that departure;
3. subtract duration and preparation allowance from arrival target;
4. repeat until the proposed leave time stabilizes or the iteration limit is hit.

Only duration, distance when needed, fallback status, and provider-required
attribution should be requested through a narrow response field mask.

## Reconciliation and delivery

Recalculate when authoritative inputs change and approximately 24 hours, 2 hours,
and 30 minutes before the current leave estimate. Add jitter so many Events do not
call the provider simultaneously. Close to departure, current traffic should carry
more weight.

If a new estimate moves leave time into the past, submit the leave alert immediately
and explain that traffic changed. If the provider fails, retain visibly stale last
known guidance only where terms permit. Never claim that a fresh alert is guaranteed
without a valid estimate. Event alerts and all core Event behavior continue
independently.

Leave alerts become durable Notification Center intents. Deduplication includes the
Event occurrence, Travel plan revision, and recipient without exposing protected
values. Editing or deleting the Event invalidates pending old-revision guidance.
Recurring Events plan each occurrence independently.

## Travel feasibility

A calculated travel interval runs from leave time through arrival target. A later
phase can compare it with preceding Events and present a distinct warning:

> Mateo's previous Event ends at 8:25 AM, but travel requires leaving by 8:15 AM.

This does not modify ordinary Event overlap semantics or silently expand the Event
range.

## Failure and edge scenarios

- **No Event location:** Arrival target remains valid, but no Travel plan or leave
  alert is offered.
- **No recipient:** Travel guidance may be previewed, but notification controls are
  hidden and no intent is created.
- **Provider unavailable while saving:** Event saves; Travel plan reports that an
  estimate is unavailable.
- **Location changes:** Existing guidance is invalidated before recalculation.
- **Arrival target after Event start:** Validation rejects the mutation.
- **Two travelers at different origins:** The first release requires one confirmed
  route; it does not pretend one estimate serves both.
- **Pickup required:** Deferred to multi-leg planning rather than approximated as a
  single-origin route.
- **Imported calendar ambiguity:** No origin is inferred without an unambiguous
  owning Member or participant.
- **Traffic worsens after an alert:** Do not send repeated alerts for small changes;
  a materially earlier urgent update requires a separately defined threshold.

## Delivery plan

### Phase 1: arrival target

- Add nullable arrival target through PostgreSQL, server domain/transport, Swift
  domain/transport, recurrence editing, and schedule display.
- Enforce arrival target at or before Event start.
- Do not call a routing provider.

### Phase 2: explicit driving plan

- Add Saved Places and one-time explicit origins.
- Add one driving Travel plan per Event and explicit recipients.
- Add Google Routes preview, durable reconciliation, and leave alerts.
- Keep the alert control hidden until the plan is actionable.

### Phase 3: confirmed suggestions

- Suggest preceding Event locations and configured routines with provenance and
  confidence.
- Require confirmation before changing the authoritative origin.

### Phase 4: richer travel

- Add transit and other modes after provider behavior and required warnings are
  designed.
- Add pickup/intermediate-stop itineraries.
- Consider opt-in on-device location refinement without server-side location
  history.
- Add travel-feasibility warnings.

## Primary references

- [Google Routes: traffic data levels](https://developers.google.com/maps/documentation/routes/config_trade_offs)
- [Google Routes: traffic models](https://developers.google.com/maps/documentation/routes/traffic-model)
- [Google Routes: Compute Routes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes)
- [Google Routes policies and attribution](https://developers.google.com/maps/documentation/routes/policies)
- [Apple MapKit directions request](https://developer.apple.com/documentation/mapkit/mkdirections/request)
