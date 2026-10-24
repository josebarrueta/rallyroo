# iOS button conventions

Use the same treatment for the same kind of action, rather than making every control identical.

- **Navigation toolbar actions:** use `RallyrooToolbarLabel` for icon-only buttons and menus. It supplies a consistent symbol weight, purple accent, and a spoken title. Native toolbars own sizing, hit regions, pressed, and disabled behavior. Only symbols cap their Dynamic Type size; menu text continues to scale.
- **Bulk/secondary actions:** group related actions in one named menu instead of putting several long text buttons side by side in a navigation bar. Alerts uses **Alert actions** (ellipsis) for **Mark all read**, **Clear saved conflicts**, and **Delete all alerts**. Hide unavailable actions and the menu when empty; disable it while a bulk operation is running.
- **Sheet navigation:** keep native text buttons in `.cancellationAction` and `.confirmationAction` positions: Cancel on the leading side, Save/Done on the trailing side. Do not apply custom pill backgrounds or icon-only replacements to these controls.
- **Destructive actions:** always use `role: .destructive`; bulk/irreversible deletion requires confirmation with a non-destructive Cancel. Keep system red in menus, swipe actions, and confirmations—do not apply a global button tint that overrides destructive semantics.
- **Form/list actions:** retain native full-row buttons. Several independently tappable buttons in a row must use `.borderless` to avoid triggering the entire row.
- **Special controls:** Apple sign-in uses Apple's native control; authentication branding, selected weekday chips, calendar days, and selectable occurrence cards keep their specialized appearance. They are not navigation actions.

## Verification

Test Alert actions at default and largest accessibility text sizes on a narrow iPhone, including mark-all-read, delete confirmation, Cancel preserving the inbox, and the empty state. Check that toolbar symbols stay compact while menu labels remain readable. Test the Schedule, Reminders, Family, saved places, calendars, Expenses, and Shopping toolbars after changing the shared label. Automated labels/hit testing do not replace a manual VoiceOver device pass.
