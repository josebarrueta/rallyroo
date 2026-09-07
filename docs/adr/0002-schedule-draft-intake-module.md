# Put Schedule draft intake behind one MainActor module

SwiftUI renders Schedule draft intake state and forwards user intent, while one `@MainActor` module owns typed, Speech, and image input transitions, pause detection, OCR-to-extraction ordering, timeout behavior, last-good drafts, review state, stable mutation identities, partial retries, and completion outcomes. Apple Speech and Vision implementations remain replaceable by deterministic test adapters, and only recognized text crosses the remote extraction seam.

## Consequences

Latest input wins and stale extraction or OCR results are ignored. Existing drafts remain available after a failed refresh, and successfully persisted drafts are deselected while failed drafts retain their entity IDs and idempotency keys for safe retry.
