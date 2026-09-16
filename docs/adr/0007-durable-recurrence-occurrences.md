# Model recurrence occurrences as stable references with durable exceptions

A Schedule occurrence is identified by its kind, recurrence series, and original scheduled instant; this reference remains stable when effective details change. Rallyroo persists acknowledgement, disposition, completion, and override state when an occurrence diverges from its scheduled default, rather than eagerly materializing every future occurrence. This preserves individual lifecycle history and prevents deleted occurrences from being regenerated without multiplying rows for every untouched occurrence in a bounded series.

## Consequences

Acknowledgement is Member-specific, while scheduled/skipped/deleted disposition and Reminder completion are Family-wide. Modification is an override, not a lifecycle state, so an occurrence can be both modified and acknowledged. Notifications and deep links carry the stable occurrence reference instead of only a series identifier. Series rules remain the source of default occurrences, and durable occurrence records take precedence during expansion.
