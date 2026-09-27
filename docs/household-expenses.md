# Household Expenses

Status: manual, parent-only Expenses implemented; receipt capture remains planned.

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

## Receipt follow-up

A receipt photo is transaction evidence, **not** an Expense until a parent
reviews and confirms the merchant, date, currency, total and category. Line
items can only become Pantry or Shopping candidates after explicit selection.
Receipt capture must bound image/OCR work, reconcile totals, protect Family
financial data, avoid logging receipt contents and discard original photos by
default. See issue #155.
