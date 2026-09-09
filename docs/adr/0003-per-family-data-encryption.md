# Protect descriptive Family data with per-Family envelope encryption

Rallyroo encrypts descriptive Event, Reminder, Member, invitation, calendar, and notification data with independent per-Family AES-256-GCM data keys, each wrapped by a backend-only 256-bit master key. Scheduling instants, recurrence and alert triggers, statuses, and opaque routing identifiers remain queryable so the backend can coordinate reminders and notifications; full client-side end-to-end encryption was rejected because it would prevent those backend responsibilities.

Ciphertext is authenticated against its Family, storage purpose, and key version so it cannot be moved between Families or fields. PostgreSQL adapters own protection at the persistence seam, legacy plaintext is migrated in bounded resumable batches, and missing or corrupt keys fail closed.
