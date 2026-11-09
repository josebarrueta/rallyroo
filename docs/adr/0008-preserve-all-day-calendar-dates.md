# Preserve all-day calendar dates separately from instants

An All-day Event has Gregorian start and exclusive end dates plus a stable named anchor time zone, alongside the canonical instants used for Schedule conflicts and native alerts. Inferring all-day status from midnight or a 24-hour duration loses information across DST and device time-zone changes; calendar display therefore projects the saved dates into the viewer's zone without changing the stored Schedule range.

## Consequences

Date edits update metadata and matching instants in the same Family mutation transaction. Explicit null converts an Event to timed; omission by an older client can preserve existing all-day metadata only while its instants remain unchanged, and a database guard protects the same invariant during an API rollback. All-day recurrence remains explicitly unsupported until series rules and occurrence lifecycle operations preserve date-only semantics too.
