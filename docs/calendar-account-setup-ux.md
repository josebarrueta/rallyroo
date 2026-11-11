# Guided Apple Calendar setup

Status: **implemented and tested locally; not yet in a new TestFlight build**. Build 201 still uses the earlier form. This is an iOS-only usability update; the account-restricted backend and permissions are unchanged.

## The setup flow

The Apple Calendar screen now has three numbered Rallyroo-themed cards instead of a long form: create a private login, copy the account fields into Settings, and choose a default calendar. Creation still requires explicit consent. Issuing a password automatically brings the account fields into view.

Server, Username, and Password each have a large, labeled Copy button and confirmation. Server copies only the hostname, not a URL/path that belongs in Advanced settings. The full Account URL, SSL/port guidance, and calendar zone are available under Advanced settings. iOS still requires the parent to add the account and explicitly choose Default Calendar; no private Settings URLs or configuration profiles are used.

Existing connections remain manageable, with explicit revocation and separate non-secret detail viewing. A saved connection is described as a password that was issued, not proof that the iPhone account is connected. Google events are not migrated, and default-calendar/Siri acceptance remains a device test.

## Password and clipboard policy

The previous screen discarded the password whenever the app lost focus. That made copying the separate Settings fields unnecessarily difficult. The revised setup keeps the password **in memory only for a fixed ten-minute session**, masks it by default, and masks it again whenever the app becomes inactive. Returning from Settings permits an explicit copy/reveal during that session without generating another password.

Expiry, leaving the setup screen, explicit “Finish & clear password,” and revoking that connection erase the setup password. Normal metadata remains copyable after expiry. A cleared password cannot be restored by the session. The session is deliberately not Codable and its normal/debug descriptions are redacted; no password is cached to disk or retrieved from listing responses.

Clipboard writes are explicit user actions, local-only (no Universal Clipboard), and expire within 90 seconds; password copies never outlive the setup deadline. Finishing or leaving clears the password clipboard only when its change counter still matches the app's own write, so another app's later clipboard contents are not erased. The app does not read clipboard contents. Pasting a value into another app is controlled by the user and is outside this retention policy.

These limits concern the temporary setup display/clipboard, **not** the lifetime of the server calendar credential. The calendar account remains active until revoked.

## Accessibility and verification

- Rallyroo purple/coral/mint accents, adaptive grouped cards, and dark appearance.
- Copy controls stack below their values at accessibility text sizes; no text-size clamping. Password masking uses a short label rather than wrapping decorative dots at large sizes.
- 280 Swift core/live-contract tests passed, including deadline, early-clock, field mapping, erasure and redacted-description cases.
- Enrollment visibility, consent/copy/clear/revocation, background→foreground masking with recopy, and navigation erasure passed in simulator UI tests.
- Largest-accessibility-text copy controls passed, with genuine dark appearance verified from a masked synthetic screenshot. The case is included in the narrow-screen CI list.
- Simulator test targets and an unsigned device build succeeded. Required CI and normal signed TestFlight delivery remain pending for this revision; no claim of physical-iPhone Siri acceptance is made.
