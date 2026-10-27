# External TestFlight review and public beta

Status: **preparation, not submitted or approved**. Evidence checked 2026-10-26.
This is external **TestFlight App Review**, not an App Store production release.
Apple decides approval; neither this checklist nor passing CI guarantees it.

## Candidate and existing evidence

- App/bundle: Rallyroo, `dev.rallyroo.app`; Share Extension `dev.rallyroo.app.share`.
- Current internal candidate: marketing version **1.0, build 187**, source
  `176fc26b78a6964dd2dc8258b10b43c3b7d13a05`.
- Internal upload run `40264805635` and deployment `7323514597` succeeded.
  Main iOS run `40262693940` passed 61 UI tests and 237 core/live-contract tests.
- API `v0.11.26` responds healthy/ready. Privacy, terms, support and docs URLs
  returned HTTP 200 during this audit. This is a point-in-time check, not an SLA.
- #2 records earlier production acceptance of OAuth, APNs, privacy disclosures,
  invitations and account deletion. Reconfirm these against the candidate;
  historical checkboxes do not prove a fresh external review journey works.
- The uploader deliberately uses `skip_submission: true`, waits for processing,
  and passes no external groups. This **does not request external review**.
  It is also not evidence that Apple has marked the binary “TestFlight Internal
  Only”; verify actual external eligibility in App Store Connect (ASC).

CI-only changes need not replace build 187. If product fixes are needed, upload
and re-pin the replacement build/SHA before submission; do not submit a moving target.

## Repository preparation after build 187

The submission-readiness changes are **not in build 187** and are not evidence of
ASC approval or owner acceptance. They add:

- Privacy, Terms, Support and version/build in signed-in Settings for both roles,
  plus Support before sign-in and guidance for reporting privacy/safety concerns.
- Google Maps attribution beside Google address suggestions (not local results),
  and the official Apple Weather light/dark wordmarks beside weather/legal sources.
- Clearer schedule/receipt text-processing and speech disclosures; Share Extension
  privacy resources; purchase-history/financial-information manifest entries.
- Backup exclusion, session-end discard and hashed account ownership for queued
  screenshots, including cold-launch/account-switch filtering. Fresh shares made
  while explicitly signed out remain available after sign-in; legacy unscoped
  captures are discarded rather than attributed to an arbitrary Family. Original
  Photos are unchanged. Local conflict alerts are account-scoped too.
- Deferred native notification-center lookup until scheduling/cancellation after
  application launch, rather than constructing it in `App.init`. An unbundled
  simulator regression compiles the real scheduler and verifies its constructor
  does not require UIKit's application bundle registration.
- Source and compiled-bundle privacy/permission checks in CI and signed uploads;
  regression tests for legal-link access, provider attribution and screenshot expiry.
- Proposed public-policy updates covering household records and actual providers.
  The owner must approve this wording before deployment; this is not legal advice.

Google's compact text-attribution rules permit the exact non-localized **Google Maps**
name in constrained interfaces; the suggestion label uses a 14-point regular system
sans-serif with light/dark contrast. Recheck actual small-screen visibility and any
additional provider-specific terms. [Places policies][places]

Apple Weather assets are unmodified official PNGs from the English attribution
response at `https://weatherkit.apple.com/attribution/en-US` (`logoLight@3x` and
`logoDark@3x`, fetched 2026-10-26), bundled in `Assets.xcassets/AppleWeather.imageset`.
They are Apple's marks, used only to attribute Apple weather data. [WeatherKit][weatherkit]

## Apple-owned requirements

1. Create an internal group before an external group. An Account Holder, Admin
   or App Manager manages external testing. Add an eligible build to an external
   group and complete test information. A build explicitly marked **TestFlight
   Internal Only** cannot be added. [External testers][external]
2. Complete Beta App Description, Feedback Email and TestFlight App Review
   contact/access information. Beta metadata can differ from eventual App Store
   metadata. [Provide information][information]
3. The first submitted build requires full beta review; later same-version
   builds **might** not. One build per version may be in review at a time; Apple
   documents a six-submissions-per-24-hours limit. Do not promise a review time.
   [External testers][external]
4. Provide full reviewer access, accurate metadata, functional URLs and a live
   backend. TestFlight betas must comply with the Review Guidelines. If a demo
   mode substitutes for an account because of legal/security obligations,
   Guideline 2.1 calls for prior Apple approval. [Guidelines][guidelines]
5. Determine export compliance truthfully; an `ITSAppUsesNonExemptEncryption=false`
   build flag is not a legal determination. Attach documentation if required.
   [Export compliance][export]
6. After approval, distribute through email or an external group's public link.
   Public links may have a 1–10,000 tester limit and device/OS criteria. Anyone can
   re-share a link. Public-link testers' names/emails are **not displayed to the
   developer**; this does not mean Apple never collects them. [External testers][external]
7. Builds expire after 90 days. External TestFlight testing is distinct from an
   App Store production release. [Overview][overview]

## Stop/go checklist before clicking Submit Review

### Reviewer access — owner must prove this on a clean device/account

- [ ] Confirm build 187 has finished processing, is not expired and is selectable
  under **External Testing → group → Add Builds**. An internal upload success is
  not an external-eligibility check.
- [ ] Use an Apple/Google identity that is not a team/internal allow-listed tester
  to verify the entire sign-in, callback and first-Family journey. Verify Apple
  Hide My Email and Google consent behavior. #2 records production OAuth setup,
  but fresh-account acceptance is still a separate check.
- [ ] Choose a reviewer access route that works without the developer's personal
  Apple ID, Google password, phone approval or expiring one-use invitation.
  The normal new-account path provisions a Parent Family; test whether this gives
  reviewers complete access. Do not simply mark “sign-in not required.”
- [ ] If Apple needs a supplied demo account, resolve the OAuth-only access design
  before submitting: provide an honestly documented, isolated review experience
  through normal supported authentication. Do not add a hidden review bypass,
  hardcoded credentials or a special reviewer identity with privileged access.
- [ ] Use a dedicated **synthetic** Family with fictional events/places/members.
  Never give reviewers access to the developer's real Family. Store any necessary
  access secrets only in ASC's private review fields / the password manager,
  never in this repo, issues, CI logs or chat.
- [ ] Verify reviewer access stays usable throughout review. One-time invitation
  codes can expire or be consumed; they are not a durable demo login.

### Privacy, children, security and truthful claims

- [ ] Compare ASC App Privacy answers, `PrivacyInfo.xcprivacy`, the shipped app and
  the live privacy policy against actual data flows and providers. A parseable
  privacy manifest is **not** proof of complete or correct disclosure. Include
  names/email, Family schedules, locations, identifiers, calendar subscriptions,
  push tokens, optional speech/OCR/AI processing and operational data as applicable.
  [App Privacy][privacy], Guidelines 5.1.1–5.1.2.
- [ ] Confirm the intended audience/category and accurate age-rating answers.
  “Family organizer” does not automatically mean Kids Category; do not market as
  “For Kids” unless the stricter requirements really apply and are met. A guardian
  checkbox is not automatically legally sufficient parental consent. Review
  child-member invitations and any applicable privacy obligations with appropriate
  expertise; public-link device/OS criteria do **not** enforce an adult audience.
  Guidelines 1.3, 2.3.6, 2.3.8 and 5.1.4.
- [ ] Confirm applicable Google/Apple/transit attribution and provider storage
  terms, not just the presence of a footer. In particular, Google's selected-street-
  address exception does not authorize retaining arbitrary Places/POI data or
  coordinates indefinitely; reconcile Saved places and route-provider behavior
  with the actual agreement. [Places policies][places].
- [ ] Review closed-Family sharing / user-generated-content safeguards against
  Guideline 1.2 rather than assuming private sharing is automatically exempt.
- [ ] Exercise Apple and Google sign-in parity and withdrawal/account deletion.
  Explain exactly what happens to shared Family records and backup copies after
  deletion; do not promise instant erasure everywhere. Guidelines 4.8 and 5.1.1(v).
- [ ] **Resolve Apple grant revocation before submission.** The backend currently
  calls Stytch `users.delete` in `stytch-identity-provider.ts`. Do not equate deletion
  of a Stytch user or revocation of a Rallyroo session with revoking Apple's OAuth
  grant. Stytch documents Apple tokens as valid until revoked, but the reviewed
  public material does not establish whether user deletion performs that upstream
  revocation. Obtain explicit vendor confirmation and controlled disposable-account
  evidence; if it does not, implement and test the supported revocation flow before
  declaring deletion ready. Do not delete the operator's real account to test this,
  expose OAuth tokens, or add an undocumented token endpoint. [Apple guidance][apple-deletion],
  [Stytch OAuth][stytch-oauth]. Vendor question: “Does Consumer `users.delete` revoke
  upstream Sign in with Apple access/refresh tokens, and what supported integration
  satisfies Apple's account-deletion revocation requirement?”
- [ ] Verify optional microphone/camera/speech permission explanations and denied
  permission flows. Notifications must not be required for the core app. Explain
  where optional AI/speech data goes and obtain appropriate permission; do not
  claim all speech is on-device without verifying that device/language path.
- [ ] Reconcile encryption/export answers with the actual binary and backend use.
  The existing signed-archive check enforces the currently selected flag but
  cannot determine legal exemption. [Export compliance][export]
- [ ] Confirm support/feedback mailbox delivery and reply handling. HTTP 200 and
  a `mailto:` link do not prove an operator receives support mail.

### Current physical-device acceptance

- [ ] Clean-install and upgrade from the prior beta; launch, sign in, sign out,
  relaunch and account-switch without another Family's cached data appearing.
- [ ] Check signed-in Privacy/Terms/Support links and version, including the child
  role and largest supported text size. Confirm live policy wording matches the
  approved shipped build, not just this branch's proposed HTML.
- [ ] Check screenshot queue behavior across cold launch, expired credentials,
  sign-out and account switching; CI session-expiry coverage is not proof of all
  extension/OS lifecycle paths. Never expose another Family's queued image.
- [ ] Create/edit recurring Events, test unsaved drafts and native month dragging
  (partial cancellation, quick flicks, arrows, Today, year/short-month boundaries).
- [ ] Exercise Alerts All/Unread/older pages and badge settings; verify actual APNs
  receipt/tap destination on a real device, not only the simulated permission provider.
- [ ] Use synthetic data to test one-way calendar import and the screenshot Share
  Extension → OCR/draft review path. Nothing should be saved without confirmation.
- [ ] Check larger text, VoiceOver, offline/retry behavior and denied permissions.
- [ ] Test the oldest OS/device actually offered to the external cohort. The app
  targets iOS 16+, but current UI CI runs a 26.x runtime; SDK 26 is not evidence of
  testing every supported OS. If necessary, deliberately restrict the initial
  public link to tested iPhone/OS combinations and document that decision.
- [ ] Test account deletion only with a disposable Family. Keep the review/demo
  Family separate so a deletion test does not destroy reviewer access.

## Copy drafts — owner must finish and verify before pasting

### Beta App Description

> Rallyroo helps families coordinate a shared schedule. Organize Events and
> Reminders, assign participants and drivers, browse the week or swipe through
> months, and manage Alerts. Optional connected-calendar imports are one-way and
> read-only. Parents can review AI-assisted schedule drafts before choosing what
> to save. This beta is intended for feedback from adult Family organizers and
> their authorized Family members; please use fictional data while evaluating it.

Only use that audience wording after confirming it matches the product/category
and consent decisions above. Do not promise legal compliance or universal provider availability.

### What to Test

> Please test sign-in and first-Family setup; Event/Reminder creation and recurring
> edits; month swipes (including partial swipes that slide back); day selection;
> unsaved-change protection; Alerts filtering, older pages and permission status;
> Saved places; and searching Events, Reminders and Pantry. If available in your
> Family, test connected-calendar import and screenshot sharing into draft review.
> Check larger text, VoiceOver and offline recovery. Send the build number,
> reproduction steps and redacted screenshots through TestFlight feedback.
> Please do not include real children's information, credentials or private feed URLs.

### Private review notes outline — not ready to paste until every field is resolved

- **Purpose:** shared Family scheduling, responsibilities and optional planning;
  not a public social feed. Explain enabled optional modules, not future features.
- **Access:** `[operator supplies the tested sign-in/demo route privately in ASC]`.
  Describe the actual first-run adult/invitation flow and reviewer-visible sample
  data. Do not invent login details or tell Apple to contact the developer for 2FA.
- **Walkthrough:** sign in → Schedule → create a fictional Event/Reminder → calendar
  menu → Month → drag/swipe → Alerts → Settings → Saved places / connected calendars.
- **Share Extension:** share an eligible synthetic schedule image to Rallyroo and
  review extracted drafts before saving; document limits and supported sources.
- **Account deletion:** Settings → Delete Account, using only the disposable
  account provided for this test. Describe survivor/last-account behavior accurately.
- **Optional features:** state which permissions/providers are optional and how
  unavailable weather/routes are presented. AI drafts require review; do not claim
  the model independently verifies private facts or creates plans automatically.
- **Payments:** explain enabled behavior accurately. Grocery Purchase history is
  recordkeeping, not a payment checkout; verify whether any digital paid features
  exist before declaring there are no purchases/subscriptions.
- **Contact:** `[operator's real name, reachable phone and monitored email entered
  in ASC private fields]`. No placeholders may remain in the submitted notes.

## Operator submission journey

Only the human operator should approve legal declarations, private review access
and public distribution. Nothing in CI submits review or creates a public link.

1. Open [App Store Connect](https://appstoreconnect.apple.com/apps) → Rallyroo →
   **TestFlight → Additional → Test Information**. Complete localized description,
   feedback email, review contact, access details and notes. Resolve export status.
2. Under **External Testing**, create e.g. **Rallyroo Public Beta**. Add the exact
   approved candidate through **Add Builds** and fill **What to Test**. Check that
   the version/build is the intended one, not merely the newest row.
3. Keep automatic tester notification **off** for the first review if the owner
   wants a final distribution check. After all stop/go items are signed off,
   explicitly choose **Submit Review** (or the action ASC offers for its status).
4. Record build/version/SHA, submission time, group and current review status in
   the tracking ticket. Do not record credentials or private review contacts.
5. If rejected, read the exact App Review message and guideline; reproduce with
   the same build/account path, fix the cause, respond clearly with verified
   steps, and submit an updated build where needed. Never hide features or use
   review-only behavior to evade the rule. Apple owns the outcome/timing.
6. After approval, confirm the **Testing** state and notify testers if necessary.
   Create the group's public link with an owner-approved limit (recommend a small
   initial cohort, e.g. 25) and tested iPhone/OS criteria. Do not publish it until
   the owner explicitly approves. Validate installation from a non-team Apple ID.
7. Monitor crashes/feedback/support and expiry. Disable the public link to stop
   new enrollments; that does not revoke already installed builds. Expire/remove
   a build separately if testing must stop. [Overview][overview], [External testers][external]

## Closure evidence

Do not close the external-beta ticket just because an internal build uploaded.
Record completed readiness/device checks, reviewed metadata/access, exact approved
build/SHA and ASC review status, actual non-team installation, and owner-approved
public link/criteria/limit. Keep any sensitive values outside public evidence.

[places]: https://developers.google.com/maps/documentation/places/web-service/policies
[weatherkit]: https://developer.apple.com/weatherkit/#attribution-requirements
[apple-deletion]: https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple
[stytch-oauth]: https://stytch.com/docs/consumer-auth/authentication/oauth/overview
[external]: https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/
[information]: https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/
[overview]: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
[guidelines]: https://developer.apple.com/app-store/review/guidelines/
[privacy]: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
[export]: https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/
