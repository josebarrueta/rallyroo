# Put Schedule draft intake behind one MainActor module

SwiftUI renders Schedule draft intake state and forwards user intent, while one `@MainActor` module owns typed, Speech, and image input transitions, pause detection, OCR-to-extraction ordering, timeout behavior, last-good drafts, review state, stable mutation identities, partial retries, and completion outcomes. Apple Speech and Vision implementations remain replaceable by deterministic test adapters, and only recognized text crosses the remote extraction seam.

## Consequences

Latest input wins and stale extraction or OCR results are ignored. Existing drafts remain available after a failed refresh, and successfully persisted drafts are deselected while failed drafts retain their entity IDs and idempotency keys for safe retry.

## Image-first review (#184)

`ScheduleDraftIntake.imagePresentation` distinguishes processing, single Event review, batch review, and correction. A single unambiguous Event goes directly to editable review; recognized text is an advanced correction option, not a required intermediate screen. Clarification remains non-importable until corrected source is extracted again. Mixed items retain explicit selection and Event/Reminder types. Persistence and authorization still use the existing mutation seams; no image creates an Event without explicit review and save.

OCR and extraction both use cancellation/generation checks and timeouts. At most 20,000 UTF-16 units of source text may cross the extraction seam (matching the API limit); oversized text remains on-device for correction rather than being silently truncated. Cancellation and successful completion clear transient source text. Images are retained only in the bounded on-device handoff queue and active capture, never sent to extraction.

The Share extension confirms the queued destination and asks the Member to tap Done and open Rallyroo manually. Apple's [`NSExtensionContext.open` documentation](https://developer.apple.com/documentation/foundation/nsextensioncontext/open(_:completionhandler:)) identifies Today and iMessage, not Share, as supported iOS extension points for opening URLs. No private APIs, responder-chain tricks, or unsupported app-opening attempts are used. The inbox holds one dequeued capture until review ends; an incoming capture cannot replace an active sheet and is presented after that sheet closes.
