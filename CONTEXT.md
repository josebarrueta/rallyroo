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

**Personal calendar**:
An imported calendar visible only to the parent who connected it.
_Avoid_: Private event, public calendar

**Family calendar**:
An imported calendar visible under the family's existing permissions.
_Avoid_: Public calendar
