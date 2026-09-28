# Household Expenses

Status: manual, parent-only Expenses implemented; receipt capture and reviewed suggestions implemented in a follow-up slice. Neither merge is proof of on-device acceptance or production promotion.

An Expense is a Family spending ledger entry, distinct from Shopping Purchase
records (item-level replenishment evidence). Expenses cover all categories,
including groceries. A Purchase never automatically creates an Expense and its
price is never added to the ledger again. No AI or photo capture is involved in
manual entry.

Parents can create, list, correct and delete Expenses in Household. Members
cannot access the ledger. V1 accepts positive USD amounts as integer cents;
no floating-point money arithmetic or implicit currency conversion. Dates are
calendar days and categories are bounded free text with common presets in iOS.
The merchant and note are optional. There is no budget, recurring expense or
automatic category inference. Listing uses a bounded cursor and a stable date/ID
ordering; category summaries across pages are deferred until they can be
computed correctly in the backend.

A client-created UUID makes a create retry idempotent. Reusing it with different
details is a conflict. Corrections and deletions check the expected version;
a repeated successful deletion returns no content, and deleted IDs cannot be
reused. Expense amounts, categories, merchants and notes are encrypted under
the Family data key. Only opaque IDs, dates, versions and timestamps are
queryable. The owner Family is checked before all reads and writes. Account
removal deletes the Family's expenses before its encryption key. Never put
financial data in logs, alerts or telemetry.

Migration `032_household_expenses.sql` requires a recent verified production
backup before promotion. iOS availability and backend rollout are separate
acceptance steps; a merged PR does not mean either was shipped.

## Receipt review

From Add Expense, a parent can select or take a receipt photo. Camera captures
are downsampled to 4,000 pixels on their longest edge and encoded within 5 MiB;
iOS checks images against 5 MiB / 24 MP limits and runs Vision OCR on-device. **Only bounded OCR text**
(up to 10,000 characters), not the image, goes to the authenticated, parent-only
API and private Ollama deployment. The photo and OCR text are not saved by the
Expense API; the draft remains transient in the editing sheet. Clear the sheet
to discard it. The extraction endpoint is rate limited and unavailable when
Ollama is not configured. Model output is schema-validated and errors never echo
OCR or financial details. If the private provider does not accept Ollama's
structured-output option, the fallback asks for the exact supported JSON field
names; malformed output still fails closed. The editor distinguishes local
photo/OCR failure from provider proposal failure without showing receipt text. The photo picker/camera needs an app update; merging
backend code alone cannot install UI on a device.

A receipt photo is transaction evidence, **not** an Expense until a parent
reviews and confirms the merchant, date, currency, total and category. AI may
misread discounts, tax, tips, line prices or item names: the UI always asks for
review, never claims that summed line items reconcile to the charged total.
Missing or unclear USD amounts require manual entry; the user is warned when
currency is unclear. Line item suggestions default unselected. A parent can
explicitly select reusable items to add to the Pantry catalog when saving an
Expense; duplicates may require manual resolution. A **second**, separately
unchecked choice explicitly creates a Family item request for future Shopping.
That request is evidence for the next parent-reviewed trip, not an automatic
Buy-list entry. This does not create Stock observations or automatically assume
purchased items are needed again. The same idempotent expense creation and
parent-only Shopping APIs handle confirmation; retry IDs are stable and
individually saved Pantry and request suggestions are not repeated.

Receipt capture must be verified with real sample photos on-device before
claiming acceptance. Never put receipts or OCR text in logs or support tickets.
