# Make Event mutations transactional and idempotent

Rallyroo routes authenticate and decode requests, while the Event mutation module owns parent authorization, imported Event protection, Member validation, recurrence compatibility, conflict privacy, and create/update/delete invariants. PostgreSQL serializes mutations per Family and atomically records the Event change, Family change cursor, idempotency result, and optional schedule update notification intent; APNs delivery happens after commit through a durable retrying outbox because external delivery must not control the authoritative schedule transaction.

## Consequences

Clients use a stable UUID idempotency key for each user action. A save can succeed with a `queuedForRetry` or `noRecipients` notification outcome, and APNs uses the notification intent ID as its collapse identifier to reduce duplicate presentation under at-least-once delivery.
