# Install Commuter once per Family and scope subscriptions by visibility

Rallyroo enables the shipped Commuter capability once per Family through a parent-authorized installation. Commute subscriptions, rather than installations, carry `personal` or `family` visibility. Personal subscriptions and alerts remain visible only to their owning parent; Family subscriptions are visible and manageable under Family permissions.

The Commuter module owns installation authorization, typed Caltrain subscription validation, visibility, matching, freshness, and an idempotent encrypted alert outbox. Commute details are protected with the Family data key. Provider ingestion remains separate from module installation, polls each agency feed once, preserves last-good static data, and does not activate in production until quota and fan-out approval are confirmed.

Commute subscriptions and alerts are not Events or Reminders. Live transit never mutates the schedule automatically. A native Event may be created only through an explicit parent action and thereafter survives Commuter disablement or removal. Traffic and Activities remain separate typed modules; Rallyroo will not introduce a generic provider abstraction until a second adapter establishes a real seam.
