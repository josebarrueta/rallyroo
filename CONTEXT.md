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

**Assignee**:
A family member responsible for a reminder. A reminder may have multiple assignees, but its completion state is shared.
_Avoid_: Participant, attendee

**Due instant**:
The date and time by which a reminder should be completed.
_Avoid_: Start time, event time

**Completion**:
The shared state transition that marks a reminder complete for every assignee and records when and by which member it was completed.
_Avoid_: Per-assignee completion

**Alert lead time**:
The optional supported interval before a reminder's due instant or an event occurrence's start when the responsible members should be notified. Reminder alerts go to assignees; event alerts go to participants.
_Avoid_: Event duration, snooze

**Schedule update notification**:
A durable, one-time notification intent recorded atomically when a parent saves an event and explicitly chooses to notify its participants. Delivery is attempted promptly and retried after provider failure. It summarizes the saved series once, excludes the saving parent, and is separate from occurrence-based event alerts.
_Avoid_: Event alert, reminder alert, best-effort push

**Schedule draft**:
A temporary, review-only event or reminder proposal extracted from typed, transcribed, or recognized text. It does not enter the family schedule until a parent explicitly confirms it.
_Avoid_: Imported event, saved event, automatic action

**Clarification**:
A question attached to a schedule draft when required information is ambiguous. A draft needing clarification cannot be saved until the parent revises the source text and receives a complete proposal.
_Avoid_: Model guess, default date

**Personal calendar**:
An imported calendar visible only to the parent who connected it.
_Avoid_: Private event, public calendar

**Family calendar**:
An imported calendar visible under the family's existing permissions.
_Avoid_: Public calendar
