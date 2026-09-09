import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import type {
  Account,
  AccountRole,
  EventRecurrence,
  FamilyEvent,
  FamilyInvitation,
  FamilyMember,
  FamilyReminder,
} from "./domain.js";
import type { DueEventNotification } from "./event-notification-dispatcher.js";
import type {
  ClaimedScheduleUpdateNotification,
  EventMutationPlan,
  StoredEventMutationResult,
  EventMutationSnapshot,
} from "./event-mutation-persistence.js";
import { eventOccurrenceStarts } from "./event-recurrence.js";
import {
  FamilyDataProtector,
  type FamilyDataKeyStore,
  type WrappedFamilyDataKey,
} from "./family-data-protection.js";
import type { InvitationConsumptionResult, RallyrooRepository } from "./repository.js";
import type {
  CalendarSource,
  CalendarSourceRepository,
  ImportedCalendarEvent,
} from "./calendar-source-module.js";
import { parseCommuteSubscriptionDetails } from "./commuter-module.js";
import type {
  CommuterInstallation,
  CommuterRepository,
  CommuteAlertIntent,
  CommuteSubscription,
} from "./commuter-module.js";

export class PostgresRallyrooRepository implements RallyrooRepository, CalendarSourceRepository, CommuterRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly familyDataProtector: FamilyDataProtector,
  ) {}

  static fromConfiguration(
    config: PoolConfig,
    familyDataEncryptionKey: string,
  ): PostgresRallyrooRepository {
    const pool = new Pool(config);
    const familyDataProtector = FamilyDataProtector.fromEncodedMasterKey(
      familyDataEncryptionKey,
      new PostgresFamilyDataKeyStore(pool),
    );
    return new PostgresRallyrooRepository(pool, familyDataProtector);
  }

  static fromConnectionString(
    connectionString: string,
    familyDataEncryptionKey: string,
  ): PostgresRallyrooRepository {
    return PostgresRallyrooRepository.fromConfiguration(
      { connectionString, max: 20 },
      familyDataEncryptionKey,
    );
  }

  async validateFamilyDataEncryption(): Promise<void> {
    const result = await this.pool.query<{ family_id: string }>(
      `SELECT family_id FROM family_data_keys WHERE active
       ORDER BY family_id LIMIT 1`,
    );
    const familyID = result.rows[0]?.family_id;
    if (familyID) await this.familyDataProtector.validateActiveFamilyKey(familyID);
  }

  async rotateFamilyDataKey(familyID: string): Promise<void> {
    await this.familyDataProtector.rotateFamilyKey(familyID);
  }

  async protectLegacyFamilyData(batchSize = 100): Promise<number> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new Error("Family data protection batch size must be between 1 and 1000");
    }
    const client = await this.pool.connect();
    let protectedCount = 0;
    const remaining = (): number => batchSize - protectedCount;
    try {
      await client.query("BEGIN");

      if (remaining() > 0) {
        const members = await client.query<MemberRow>(
          `SELECT family_id, id, name, role, grade_or_birth_year, color_tag
           FROM family_members
           WHERE name NOT LIKE 'rr1.%'
              OR (grade_or_birth_year IS NOT NULL AND grade_or_birth_year NOT LIKE 'rr1.%')
           ORDER BY family_id, id FOR UPDATE SKIP LOCKED LIMIT $1`,
          [remaining()],
        );
        for (const row of members.rows) {
          if (!this.familyDataProtector.isProtected(row.name) && remaining() > 0) {
            const value = await this.familyDataProtector.protect(
              row.family_id,
              `family_members/${row.id}/name`,
              row.name,
            );
            await client.query(
              "UPDATE family_members SET name = $3 WHERE family_id = $1 AND id = $2",
              [row.family_id, row.id, value],
            );
            protectedCount += 1;
          }
          if (
            row.grade_or_birth_year !== null
            && !this.familyDataProtector.isProtected(row.grade_or_birth_year)
            && remaining() > 0
          ) {
            const value = await this.familyDataProtector.protect(
              row.family_id,
              `family_members/${row.id}/grade_or_birth_year`,
              row.grade_or_birth_year,
            );
            await client.query(
              `UPDATE family_members SET grade_or_birth_year = $3
               WHERE family_id = $1 AND id = $2`,
              [row.family_id, row.id, value],
            );
            protectedCount += 1;
          }
        }
      }

      if (remaining() > 0) {
        const events = await client.query<EventRow>(
          `SELECT family_id, id::text, title, kid_id, participant_ids, start_time,
                  end_time, location, driver, source, status, alert_lead_time_minutes, recurrence
           FROM events
           WHERE title NOT LIKE 'rr1.%'
              OR (location IS NOT NULL AND location NOT LIKE 'rr1.%')
              OR (driver IS NOT NULL AND driver NOT LIKE 'rr1.%')
           ORDER BY family_id, id FOR UPDATE SKIP LOCKED LIMIT $1`,
          [remaining()],
        );
        for (const row of events.rows) {
          for (const [column, value] of [
            ["title", row.title],
            ["location", row.location],
            ["driver", row.driver],
          ] as const) {
            if (value === null || this.familyDataProtector.isProtected(value) || remaining() < 1) {
              continue;
            }
            const protectedValue = await this.familyDataProtector.protect(
              row.family_id,
              `events/${row.id}/${column}`,
              value,
            );
            await client.query(
              `UPDATE events SET ${column} = $3 WHERE family_id = $1 AND id = $2`,
              [row.family_id, row.id, protectedValue],
            );
            protectedCount += 1;
          }
        }
      }

      if (remaining() > 0) {
        const reminders = await client.query<ReminderRow>(
          `SELECT family_id, id::text, title, assignee_ids, due_at, status,
                  completed_at, completed_by_member_id, alert_lead_time_minutes,
                  created_by_member_id
           FROM family_reminders WHERE title NOT LIKE 'rr1.%'
           ORDER BY family_id, id FOR UPDATE SKIP LOCKED LIMIT $1`,
          [remaining()],
        );
        for (const row of reminders.rows) {
          const value = await this.familyDataProtector.protect(
            row.family_id,
            `family_reminders/${row.id}/title`,
            row.title,
          );
          await client.query(
            "UPDATE family_reminders SET title = $3 WHERE family_id = $1 AND id = $2",
            [row.family_id, row.id, value],
          );
          protectedCount += 1;
        }
      }

      if (remaining() > 0) {
        const invitations = await client.query<InvitationRecordRow>(
          `SELECT id::text, code_hash, family_id, recipient_email, role, expires_at
           FROM family_invitations
           WHERE recipient_email IS NOT NULL AND recipient_email NOT LIKE 'rr1.%'
           ORDER BY family_id, id FOR UPDATE SKIP LOCKED LIMIT $1`,
          [remaining()],
        );
        for (const row of invitations.rows) {
          const value = await this.familyDataProtector.protect(
            row.family_id,
            `family_invitations/${row.id}/recipient_email`,
            row.recipient_email!,
          );
          await client.query(
            "UPDATE family_invitations SET recipient_email = $2 WHERE id = $1",
            [row.id, value],
          );
          protectedCount += 1;
        }
      }

      if (remaining() > 0) {
        const sources = await client.query<CalendarSourceRow>(
          `SELECT family_id, id::text, owner_member_id, visibility, name,
                  feed_url_ciphertext, participant_ids, status, last_synced_at,
                  last_error, etag, last_modified
           FROM calendar_sources
           WHERE name NOT LIKE 'rr1.%'
              OR feed_url_ciphertext NOT LIKE 'rr1.%'
              OR (last_error IS NOT NULL AND last_error NOT LIKE 'rr1.%')
           ORDER BY family_id, id FOR UPDATE SKIP LOCKED LIMIT $1`,
          [remaining()],
        );
        for (const row of sources.rows) {
          for (const [column, value] of [
            ["name", row.name],
            ["feed_url_ciphertext", row.feed_url_ciphertext],
            ["last_error", row.last_error],
          ] as const) {
            if (value === null || this.familyDataProtector.isProtected(value) || remaining() < 1) {
              continue;
            }
            const protectedValue = await this.familyDataProtector.protect(
              row.family_id,
              `calendar_sources/${row.id}/${column}`,
              value,
            );
            await client.query(
              `UPDATE calendar_sources SET ${column} = $3 WHERE family_id = $1 AND id = $2`,
              [row.family_id, row.id, protectedValue],
            );
            protectedCount += 1;
          }
        }
      }

      if (remaining() > 0) {
        const importedEvents = await client.query<ImportedCalendarEventRow>(
          `SELECT event.family_id, event.source_id::text,
                  ''::text AS source_name, ''::text AS source_owner_member_id,
                  'family'::text AS source_visibility, event.external_uid,
                  event.title, event.start_time, event.end_time, event.location,
                  event.participant_ids, event.fingerprint
           FROM imported_calendar_events event
           WHERE event.external_uid NOT LIKE 'rr1.%'
              OR event.title NOT LIKE 'rr1.%'
              OR (event.location IS NOT NULL AND event.location NOT LIKE 'rr1.%')
           ORDER BY event.family_id, event.source_id, event.external_uid
           FOR UPDATE SKIP LOCKED LIMIT $1`,
          [remaining()],
        );
        for (const row of importedEvents.rows) {
          for (const [column, value] of [
            ["title", row.title],
            ["location", row.location],
          ] as const) {
            if (value === null || this.familyDataProtector.isProtected(value) || remaining() < 1) {
              continue;
            }
            const protectedValue = await this.familyDataProtector.protect(
              row.family_id,
              `imported_calendar_events/${row.source_id}/${row.external_uid}/${column}`,
              value,
            );
            await client.query(
              `UPDATE imported_calendar_events SET ${column} = $4
               WHERE family_id = $1 AND source_id = $2 AND external_uid = $3`,
              [row.family_id, row.source_id, row.external_uid, protectedValue],
            );
            protectedCount += 1;
          }
          if (!this.familyDataProtector.isProtected(row.external_uid) && remaining() > 0) {
            const protectedExternalUID = await this.familyDataProtector.protect(
              row.family_id,
              `imported_calendar_events/${row.source_id}/${row.fingerprint}/external_uid`,
              row.external_uid,
            );
            await client.query(
              `UPDATE imported_calendar_events SET external_uid = $4
               WHERE family_id = $1 AND source_id = $2 AND external_uid = $3`,
              [row.family_id, row.source_id, row.external_uid, protectedExternalUID],
            );
            protectedCount += 1;
          }
        }
      }

      if (remaining() > 0) {
        const mutationResults = await client.query<{
          family_id: string;
          idempotency_key: string;
          result: StoredEventMutationResult;
        }>(
          `SELECT family_id, idempotency_key::text, result
           FROM event_mutation_results WHERE result IS NOT NULL
           ORDER BY family_id, idempotency_key FOR UPDATE SKIP LOCKED LIMIT $1`,
          [remaining()],
        );
        for (const row of mutationResults.rows) {
          const value = await this.familyDataProtector.protect(
            row.family_id,
            `event_mutation_results/${row.idempotency_key}/result`,
            JSON.stringify(row.result),
          );
          await client.query(
            `UPDATE event_mutation_results
             SET result = NULL, result_ciphertext = $3, updated_at = now()
             WHERE family_id = $1 AND idempotency_key = $2`,
            [row.family_id, row.idempotency_key, value],
          );
          protectedCount += 1;
        }
      }

      if (remaining() > 0) {
        const notifications = await client.query<ScheduleUpdateNotificationRow>(
          `SELECT id::text, family_id, event_id::text, idempotency_key::text,
                  title, body, participant_ids, claimed_at
           FROM schedule_update_notifications
           WHERE title NOT LIKE 'rr1.%' OR body NOT LIKE 'rr1.%'
           ORDER BY family_id, id FOR UPDATE SKIP LOCKED LIMIT $1`,
          [remaining()],
        );
        for (const row of notifications.rows) {
          for (const [column, value] of [
            ["title", row.title],
            ["body", row.body],
          ] as const) {
            if (this.familyDataProtector.isProtected(value) || remaining() < 1) continue;
            const protectedValue = await this.familyDataProtector.protect(
              row.family_id,
              `schedule_update_notifications/${row.id}/${column}`,
              value,
            );
            await client.query(
              `UPDATE schedule_update_notifications SET ${column} = $2 WHERE id = $1`,
              [row.id, protectedValue],
            );
            protectedCount += 1;
          }
        }
      }

      await client.query("COMMIT");
      return protectedCount;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async checkReadiness(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private async protectedCommuteDetails(subscription: CommuteSubscription): Promise<string> {
    return this.familyDataProtector.protect(
      subscription.familyID,
      `commuter_subscriptions/${subscription.id}/details`,
      JSON.stringify({
        agencyID: subscription.agencyID,
        routeID: subscription.routeID,
        directionID: subscription.directionID,
        originStopID: subscription.originStopID,
        destinationStopID: subscription.destinationStopID,
        serviceWeekdays: subscription.serviceWeekdays,
        windowStartMinutes: subscription.windowStartMinutes,
        windowEndMinutes: subscription.windowEndMinutes,
        alertKinds: subscription.alertKinds,
        minimumDelayMinutes: subscription.minimumDelayMinutes,
      }),
    );
  }

  private async commuteSubscriptionFromRow(
    row: CommuterSubscriptionRow,
  ): Promise<CommuteSubscription> {
    const plaintext = await this.familyDataProtector.reveal(
      row.family_id,
      `commuter_subscriptions/${row.id}/details`,
      row.details_ciphertext,
    );
    const details = parseCommuteSubscriptionDetails(plaintext);
    return {
      id: row.id,
      familyID: row.family_id,
      ownerMemberID: row.owner_member_id,
      visibility: row.visibility,
      status: row.status,
      ...details,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async installation(familyID: string): Promise<CommuterInstallation | null> {
    const result = await this.pool.query<CommuterInstallationRow>(
      `SELECT family_id, enabled_by_member_id, status
       FROM commuter_installations WHERE family_id = $1`,
      [familyID],
    );
    const row = result.rows[0];
    return row ? {
      familyID: row.family_id,
      enabledByMemberID: row.enabled_by_member_id,
      status: row.status,
    } : null;
  }

  async saveInstallationIfAbsent(
    installation: CommuterInstallation,
  ): Promise<CommuterInstallation> {
    const result = await this.pool.query<CommuterInstallationRow>(
      `INSERT INTO commuter_installations (family_id, enabled_by_member_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (family_id) DO UPDATE SET family_id = EXCLUDED.family_id
       RETURNING family_id, enabled_by_member_id, status`,
      [installation.familyID, installation.enabledByMemberID, installation.status],
    );
    const row = result.rows[0]!;
    return {
      familyID: row.family_id,
      enabledByMemberID: row.enabled_by_member_id,
      status: row.status,
    };
  }

  async setInstallationStatus(
    familyID: string,
    status: CommuterInstallation["status"],
  ): Promise<CommuterInstallation | null> {
    const result = await this.pool.query<CommuterInstallationRow>(
      `UPDATE commuter_installations SET status = $2
       WHERE family_id = $1
       RETURNING family_id, enabled_by_member_id, status`,
      [familyID, status],
    );
    const row = result.rows[0];
    return row ? {
      familyID: row.family_id,
      enabledByMemberID: row.enabled_by_member_id,
      status: row.status,
    } : null;
  }

  async removeInstallationAndState(familyID: string): Promise<void> {
    await this.pool.query("DELETE FROM commuter_installations WHERE family_id = $1", [familyID]);
  }

  async subscriptionsForFamily(familyID: string): Promise<CommuteSubscription[]> {
    const result = await this.pool.query<CommuterSubscriptionRow>(
      `SELECT id::text, family_id, owner_member_id, visibility, status, details_ciphertext
       FROM commuter_subscriptions WHERE family_id = $1 ORDER BY created_at, id`,
      [familyID],
    );
    return Promise.all(result.rows.map((row) => this.commuteSubscriptionFromRow(row)));
  }

  async saveSubscription(subscription: CommuteSubscription): Promise<void> {
    const details = await this.protectedCommuteDetails(subscription);
    await this.pool.query(
      `INSERT INTO commuter_subscriptions
         (id, family_id, owner_member_id, visibility, status, details_ciphertext)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         visibility = EXCLUDED.visibility,
         status = EXCLUDED.status,
         details_ciphertext = EXCLUDED.details_ciphertext,
         updated_at = now()
       WHERE commuter_subscriptions.family_id = EXCLUDED.family_id
         AND commuter_subscriptions.owner_member_id = EXCLUDED.owner_member_id`,
      [
        subscription.id,
        subscription.familyID,
        subscription.ownerMemberID,
        subscription.visibility,
        subscription.status,
        details,
      ],
    );
  }

  async saveSubscriptionIfCapacity(
    subscription: CommuteSubscription,
    maximum: number,
  ): Promise<boolean> {
    const details = await this.protectedCommuteDetails(subscription);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [`commuter:${subscription.familyID}`],
      );
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM commuter_subscriptions WHERE family_id = $1",
        [subscription.familyID],
      );
      if (Number(count.rows[0]?.count ?? maximum) >= maximum) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO commuter_subscriptions
           (id, family_id, owner_member_id, visibility, status, details_ciphertext)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
        [
          subscription.id,
          subscription.familyID,
          subscription.ownerMemberID,
          subscription.visibility,
          subscription.status,
          details,
        ],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async subscription(
    familyID: string,
    subscriptionID: string,
  ): Promise<CommuteSubscription | null> {
    const result = await this.pool.query<CommuterSubscriptionRow>(
      `SELECT id::text, family_id, owner_member_id, visibility, status, details_ciphertext
       FROM commuter_subscriptions WHERE family_id = $1 AND id = $2::uuid`,
      [familyID, subscriptionID],
    );
    const row = result.rows[0];
    return row ? this.commuteSubscriptionFromRow(row) : null;
  }

  async removeSubscription(familyID: string, subscriptionID: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM commuter_subscriptions WHERE family_id = $1 AND id = $2::uuid",
      [familyID, subscriptionID],
    );
  }

  async activeSubscriptionsForAgency(agencyID: "CT"): Promise<CommuteSubscription[]> {
    if (agencyID !== "CT") return [];
    const result = await this.pool.query<CommuterSubscriptionRow>(
      `SELECT subscription.id::text, subscription.family_id,
              subscription.owner_member_id, subscription.visibility,
              subscription.status, subscription.details_ciphertext
       FROM commuter_subscriptions subscription
       JOIN commuter_installations installation ON installation.family_id = subscription.family_id
       WHERE subscription.status = 'active' AND installation.status = 'enabled'
       ORDER BY subscription.family_id, subscription.created_at, subscription.id
       LIMIT 10001`,
    );
    if (result.rows.length > 10_000) {
      throw new Error("Commuter active subscription processing limit exceeded");
    }
    const subscriptions = await Promise.all(
      result.rows.map((row) => this.commuteSubscriptionFromRow(row)),
    );
    return subscriptions.filter((item) => item.agencyID === agencyID);
  }

  async saveAlertsIfAbsent(alerts: CommuteAlertIntent[]): Promise<CommuteAlertIntent[]> {
    if (alerts.length === 0) return [];
    const prepared: Array<{
      alert: CommuteAlertIntent;
      digest: string;
      details: string;
    }> = [];
    for (const alert of alerts) {
      prepared.push({
        alert,
        digest: createHash("sha256").update(alert.conditionID, "utf8").digest("hex"),
        details: await this.familyDataProtector.protect(
          alert.familyID,
          `commuter_alert_outbox/${alert.id}/details`,
          JSON.stringify({
            conditionID: alert.conditionID,
            delayMinutes: alert.delayMinutes,
            audience: alert.audience,
          }),
        ),
      });
    }
    const client = await this.pool.connect();
    const claimed: CommuteAlertIntent[] = [];
    try {
      await client.query("BEGIN");
      for (const { alert, digest, details } of prepared) {
        const result = await client.query(
          `INSERT INTO commuter_alert_outbox
             (id, family_id, subscription_id, condition_digest, kind, details_ciphertext)
           VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6)
           ON CONFLICT (family_id, subscription_id, condition_digest, kind) DO NOTHING`,
          [alert.id, alert.familyID, alert.subscriptionID, digest, alert.kind, details],
        );
        if ((result.rowCount ?? 0) === 1) claimed.push(alert);
      }
      await client.query("COMMIT");
      return claimed;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async accountForIdentity(subject: string): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT identity_subject, family_id, member_id, role
       FROM accounts WHERE identity_subject = $1`,
      [subject],
    );
    const row = result.rows[0];
    return row ? accountFromRow(row) : null;
  }

  async provisionParentAccount(subject: string, displayName: string): Promise<Account> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [subject]);
      const existing = await client.query<AccountRow>(
        `SELECT identity_subject, family_id, member_id, role
         FROM accounts WHERE identity_subject = $1`,
        [subject],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        await client.query("COMMIT");
        return accountFromRow(existingRow);
      }

      const familyID = `family-${randomUUID()}`;
      const memberID = `parent-${randomUUID()}`;
      const protectedDisplayName = await this.familyDataProtector.protect(
        familyID,
        `family_members/${memberID}/name`,
        displayName,
      );
      await client.query(
        `INSERT INTO family_members (family_id, id, name, role, color_tag)
         VALUES ($1, $2, $3, 'parent', 'blue')`,
        [familyID, memberID, protectedDisplayName],
      );
      await client.query(
        `INSERT INTO accounts (identity_subject, family_id, member_id, role)
         VALUES ($1, $2, $3, 'parent')`,
        [subject, familyID, memberID],
      );
      await client.query("COMMIT");
      return { identitySubject: subject, familyID, memberID, role: "parent" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteAccount(subject: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const accountResult = await client.query<AccountRow>(
        `SELECT identity_subject, family_id, member_id, role
         FROM accounts WHERE identity_subject = $1 FOR UPDATE`,
        [subject],
      );
      const row = accountResult.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return;
      }
      const familyAccounts = await client.query<{ identity_subject: string }>(
        "SELECT identity_subject FROM accounts WHERE family_id = $1 FOR UPDATE",
        [row.family_id],
      );

      if (familyAccounts.rowCount === 1) {
        await client.query("DELETE FROM commuter_installations WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM calendar_sources WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM device_tokens WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_invitations WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM events WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_reminders WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_change_versions WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM accounts WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_members WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_data_keys WHERE family_id = $1", [row.family_id]);
      } else {
        await client.query(
          `DELETE FROM commuter_subscriptions
           WHERE family_id = $1 AND owner_member_id = $2 AND visibility = 'personal'`,
          [row.family_id, row.member_id],
        );
        await client.query(
          `UPDATE commuter_subscriptions
           SET owner_member_id = (
             SELECT account.member_id
             FROM accounts account
             WHERE account.family_id = $1 AND account.identity_subject <> $3
             ORDER BY CASE WHEN account.role = 'parent' THEN 0 ELSE 1 END,
                      account.identity_subject
             LIMIT 1
           ), updated_at = now()
           WHERE family_id = $1 AND owner_member_id = $2 AND visibility = 'family'`,
          [row.family_id, row.member_id, subject],
        );
        await client.query(
          `UPDATE commuter_installations
           SET enabled_by_member_id = (
             SELECT account.member_id
             FROM accounts account
             WHERE account.family_id = $1 AND account.identity_subject <> $3
             ORDER BY CASE WHEN account.role = 'parent' THEN 0 ELSE 1 END,
                      account.identity_subject
             LIMIT 1
           )
           WHERE family_id = $1 AND enabled_by_member_id = $2`,
          [row.family_id, row.member_id, subject],
        );
        await client.query(
          `DELETE FROM calendar_sources
           WHERE family_id = $1 AND owner_member_id = $2 AND visibility = 'personal'`,
          [row.family_id, row.member_id],
        );
        await client.query(
          `UPDATE calendar_sources
           SET owner_member_id = (
             SELECT account.member_id
             FROM accounts account
             WHERE account.family_id = $1 AND account.identity_subject <> $3
             ORDER BY CASE WHEN account.role = 'parent' THEN 0 ELSE 1 END,
                      account.identity_subject
             LIMIT 1
           )
           WHERE family_id = $1 AND owner_member_id = $2 AND visibility = 'family'`,
          [row.family_id, row.member_id, subject],
        );
        await client.query("DELETE FROM accounts WHERE identity_subject = $1", [subject]);
        await client.query(
          `DELETE FROM calendar_sources
           WHERE family_id = $1 AND cardinality(array_remove(participant_ids, $2)) = 0`,
          [row.family_id, row.member_id],
        );
        await client.query(
          `UPDATE calendar_sources SET participant_ids = array_remove(participant_ids, $2)
           WHERE family_id = $1 AND $2 = ANY(participant_ids)`,
          [row.family_id, row.member_id],
        );
        await client.query(
          `UPDATE imported_calendar_events SET participant_ids = array_remove(participant_ids, $2)
           WHERE family_id = $1 AND $2 = ANY(participant_ids)`,
          [row.family_id, row.member_id],
        );
        await client.query(
          `UPDATE family_invitations SET guardian_member_id = NULL
           WHERE family_id = $1 AND guardian_member_id = $2`,
          [row.family_id, row.member_id],
        );
        await client.query(
          `UPDATE events SET participant_ids = array_remove(participant_ids, $2),
                            kid_id = CASE WHEN kid_id = $2 THEN NULL ELSE kid_id END
           WHERE family_id = $1`,
          [row.family_id, row.member_id],
        );
        await client.query(
          `DELETE FROM family_reminders
           WHERE family_id = $1 AND cardinality(array_remove(assignee_ids, $2)) = 0`,
          [row.family_id, row.member_id],
        );
        await client.query(
          `UPDATE family_reminders
           SET assignee_ids = array_remove(assignee_ids, $2), updated_at = now()
           WHERE family_id = $1 AND $2 = ANY(assignee_ids)`,
          [row.family_id, row.member_id],
        );
        await client.query(
          "DELETE FROM family_members WHERE family_id = $1 AND id = $2",
          [row.family_id, row.member_id],
        );
        await client.query(
          `INSERT INTO family_change_versions (family_id, version) VALUES ($1, 1)
           ON CONFLICT (family_id) DO UPDATE
           SET version = family_change_versions.version + 1, updated_at = now()`,
          [row.family_id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveInvitation(invitation: FamilyInvitation): Promise<void> {
    const protectedRecipientEmail = invitation.recipientEmail === null
      ? null
      : await this.familyDataProtector.protect(
        invitation.familyID,
        `family_invitations/${invitation.id}/recipient_email`,
        invitation.recipientEmail,
      );
    await this.pool.query(
      `INSERT INTO family_invitations (
         id, code_hash, family_id, recipient_email, role, expires_at,
         guardian_consent_at, guardian_member_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        invitation.id,
        invitation.codeHash,
        invitation.familyID,
        protectedRecipientEmail,
        invitation.role,
        invitation.expiresAt,
        invitation.guardianConsentAt ?? null,
        invitation.guardianMemberID ?? null,
      ],
    );
  }

  async pendingInvitations(familyID: string): Promise<FamilyInvitation[]> {
    const result = await this.pool.query<InvitationRecordRow>(
      `SELECT id::text, code_hash, family_id, recipient_email, role, expires_at
       FROM family_invitations
       WHERE family_id = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY expires_at`,
      [familyID],
    );
    return Promise.all(result.rows.map((row) => this.invitationFromRow(row)));
  }

  async cancelInvitation(familyID: string, invitationID: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM family_invitations
       WHERE id = $1 AND family_id = $2 AND consumed_at IS NULL AND expires_at > now()`,
      [invitationID, familyID],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async rotateInvitation(
    familyID: string,
    invitationID: string,
    codeHash: string,
    expiresAt: string,
  ): Promise<FamilyInvitation | null> {
    const result = await this.pool.query<InvitationRecordRow>(
      `UPDATE family_invitations
       SET code_hash = $3, expires_at = $4
       WHERE id = $1 AND family_id = $2 AND consumed_at IS NULL AND expires_at > now()
       RETURNING id::text, code_hash, family_id, recipient_email, role, expires_at`,
      [invitationID, familyID, codeHash, expiresAt],
    );
    const row = result.rows[0];
    return row ? this.invitationFromRow(row) : null;
  }

  async consumeInvitation(
    codeHash: string,
    subject: string,
    displayName: string,
  ): Promise<InvitationConsumptionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [subject]);
      const existingResult = await client.query<AccountRow>(
        `SELECT identity_subject, family_id, member_id, role
         FROM accounts WHERE identity_subject = $1
         FOR UPDATE`,
        [subject],
      );
      const invitationResult = await client.query<InvitationRow>(
        `SELECT family_id, role FROM family_invitations
         WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [codeHash],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) {
        await client.query("ROLLBACK");
        return { status: "invalid" };
      }

      const existingRow = existingResult.rows[0];
      const affectedFamilyIDs = [...new Set([
        invitation.family_id,
        ...(existingRow ? [existingRow.family_id] : []),
      ])].sort();
      for (const familyID of affectedFamilyIDs) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
          [familyID],
        );
      }

      if (existingRow?.family_id === invitation.family_id) {
        await client.query(
          "UPDATE family_invitations SET consumed_at = now() WHERE code_hash = $1",
          [codeHash],
        );
        await client.query("COMMIT");
        return { status: "accepted", account: accountFromRow(existingRow) };
      }

      const memberID = `${invitation.role}-${randomUUID()}`;
      const protectedDisplayName = await this.familyDataProtector.protect(
        invitation.family_id,
        `family_members/${memberID}/name`,
        displayName,
      );
      if (existingRow) {
        const disposableResult = await client.query<{ disposable: boolean }>(
          `SELECT
             (SELECT count(*) = 1 FROM accounts WHERE family_id = $1) AND
             (SELECT count(*) = 1 FROM family_members WHERE family_id = $1) AND
             NOT EXISTS (SELECT 1 FROM events WHERE family_id = $1) AND
             NOT EXISTS (SELECT 1 FROM family_reminders WHERE family_id = $1) AND
             NOT EXISTS (SELECT 1 FROM family_invitations WHERE family_id = $1) AND
             NOT EXISTS (SELECT 1 FROM calendar_sources WHERE family_id = $1) AND
             NOT EXISTS (SELECT 1 FROM commuter_installations WHERE family_id = $1) AND
             NOT EXISTS (SELECT 1 FROM event_mutation_results WHERE family_id = $1) AND
             NOT EXISTS (SELECT 1 FROM schedule_update_notifications WHERE family_id = $1)
             AS disposable`,
          [existingRow.family_id],
        );
        if (!disposableResult.rows[0]?.disposable) {
          await client.query("ROLLBACK");
          return { status: "account_conflict" };
        }

        await client.query(
          `INSERT INTO family_members (family_id, id, name, role, color_tag)
           VALUES ($1, $2, $3, $4, 'blue')`,
          [invitation.family_id, memberID, protectedDisplayName, invitation.role],
        );
        await client.query(
          `UPDATE accounts SET family_id = $1, member_id = $2, role = $3
           WHERE identity_subject = $4`,
          [invitation.family_id, memberID, invitation.role, subject],
        );
        await client.query(
          `UPDATE device_tokens SET family_id = $1, member_id = $2, updated_at = now()
           WHERE family_id = $3 AND member_id = $4`,
          [invitation.family_id, memberID, existingRow.family_id, existingRow.member_id],
        );
        await client.query(
          "DELETE FROM family_members WHERE family_id = $1 AND id = $2",
          [existingRow.family_id, existingRow.member_id],
        );
        await client.query("DELETE FROM family_change_versions WHERE family_id = $1", [existingRow.family_id]);
        await client.query("DELETE FROM family_data_keys WHERE family_id = $1", [existingRow.family_id]);
      } else {
        await client.query(
          `INSERT INTO family_members (family_id, id, name, role, color_tag)
           VALUES ($1, $2, $3, $4, 'blue')`,
          [invitation.family_id, memberID, protectedDisplayName, invitation.role],
        );
        await client.query(
          `INSERT INTO accounts (identity_subject, family_id, member_id, role)
           VALUES ($1, $2, $3, $4)`,
          [subject, invitation.family_id, memberID, invitation.role],
        );
      }

      await client.query(
        "UPDATE family_invitations SET consumed_at = now() WHERE code_hash = $1",
        [codeHash],
      );
      await client.query(
        `INSERT INTO family_change_versions (family_id, version) VALUES ($1, 1)
         ON CONFLICT (family_id) DO UPDATE
         SET version = family_change_versions.version + 1, updated_at = now()`,
        [invitation.family_id],
      );
      await client.query("COMMIT");
      return {
        status: "accepted",
        account: {
          identitySubject: subject,
          familyID: invitation.family_id,
          memberID,
          role: invitation.role,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async familyChangeVersion(familyID: string): Promise<number> {
    const result = await this.pool.query<{ version: string }>(
      "SELECT version::text FROM family_change_versions WHERE family_id = $1",
      [familyID],
    );
    return Number(result.rows[0]?.version ?? 0);
  }

  async markFamilyChanged(familyID: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO family_change_versions (family_id, version) VALUES ($1, 1)
       ON CONFLICT (family_id) DO UPDATE
       SET version = family_change_versions.version + 1, updated_at = now()`,
      [familyID],
    );
  }

  async saveDeviceToken(familyID: string, memberID: string, token: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO device_tokens (token, family_id, member_id) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET
       family_id = EXCLUDED.family_id, member_id = EXCLUDED.member_id, updated_at = now()`,
      [token, familyID, memberID],
    );
  }

  async deleteDeviceToken(memberID: string, token: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM device_tokens WHERE token = $1 AND member_id = $2",
      [token, memberID],
    );
  }

  async deviceTokensForFamily(familyID: string): Promise<string[]> {
    const result = await this.pool.query<{ token: string }>(
      "SELECT token FROM device_tokens WHERE family_id = $1",
      [familyID],
    );
    return result.rows.map((row) => row.token);
  }

  async deviceTokensForMembers(familyID: string, memberIDs: string[]): Promise<string[]> {
    if (memberIDs.length === 0) return [];
    const result = await this.pool.query<{ token: string }>(
      "SELECT token FROM device_tokens WHERE family_id = $1 AND member_id = ANY($2::text[])",
      [familyID, memberIDs],
    );
    return result.rows.map((row) => row.token);
  }

  async eventsForFamily(familyID: string): Promise<FamilyEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT family_id, id::text, title, kid_id, participant_ids, start_time,
              end_time, location, driver, source, status, alert_lead_time_minutes, recurrence
       FROM events WHERE family_id = $1 ORDER BY start_time`,
      [familyID],
    );
    return Promise.all(result.rows.map((row) => this.eventFromRow(row)));
  }

  async eventMutationResult(
    familyID: string,
    idempotencyKey: string,
  ): Promise<StoredEventMutationResult | null> {
    const result = await this.pool.query<EventMutationResultRow>(
      `SELECT result, result_ciphertext FROM event_mutation_results
       WHERE family_id = $1 AND idempotency_key = $2`,
      [familyID, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? this.eventMutationResultFromRow(familyID, idempotencyKey, row) : null;
  }

  async performEventMutation(
    familyID: string,
    idempotencyKey: string,
    prepare: (snapshot: EventMutationSnapshot) => EventMutationPlan,
  ): Promise<StoredEventMutationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [familyID]);
      const prior = await client.query<EventMutationResultRow>(
        `SELECT result, result_ciphertext FROM event_mutation_results
         WHERE family_id = $1 AND idempotency_key = $2`,
        [familyID, idempotencyKey],
      );
      if (prior.rows[0]) {
        const priorResult = await this.eventMutationResultFromRow(
          familyID,
          idempotencyKey,
          prior.rows[0],
        );
        await client.query("COMMIT");
        return priorResult;
      }
      const events = await client.query<EventRow>(
        `SELECT family_id, id::text, title, kid_id, participant_ids, start_time,
                end_time, location, driver, source, status, alert_lead_time_minutes, recurrence
         FROM events WHERE family_id = $1 ORDER BY start_time`,
        [familyID],
      );
      const members = await client.query<MemberRow>(
        `SELECT family_id, id, name, role, grade_or_birth_year, color_tag
         FROM family_members WHERE family_id = $1 ORDER BY name`,
        [familyID],
      );
      const plan = prepare({
        events: await Promise.all(events.rows.map((row) => this.eventFromRow(row))),
        members: await Promise.all(members.rows.map((row) => this.memberFromRow(row))),
      });
      if (plan.action.kind === "save") {
        const event = plan.action.event;
        const protectedEvent = await this.protectEvent(event);
        await client.query(
          `INSERT INTO events (
             family_id, id, title, kid_id, participant_ids, start_time, end_time,
             location, driver, source, status, alert_lead_time_minutes, recurrence
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (family_id, id) DO UPDATE SET
             title=EXCLUDED.title, kid_id=EXCLUDED.kid_id,
             participant_ids=EXCLUDED.participant_ids, start_time=EXCLUDED.start_time,
             end_time=EXCLUDED.end_time, location=EXCLUDED.location,
             driver=EXCLUDED.driver, source=EXCLUDED.source, status=EXCLUDED.status,
             alert_lead_time_minutes=EXCLUDED.alert_lead_time_minutes,
             recurrence=EXCLUDED.recurrence`,
          eventValues(protectedEvent),
        );
      } else {
        await client.query(
          "DELETE FROM events WHERE family_id = $1 AND id = $2",
          [familyID, plan.action.eventID],
        );
      }
      await client.query(
        `INSERT INTO family_change_versions (family_id, version) VALUES ($1, 1)
         ON CONFLICT (family_id) DO UPDATE
         SET version = family_change_versions.version + 1, updated_at = now()`,
        [familyID],
      );
      if (plan.notification) {
        const protectedTitle = await this.familyDataProtector.protect(
          familyID,
          `schedule_update_notifications/${plan.notification.id}/title`,
          plan.notification.title,
        );
        const protectedBody = await this.familyDataProtector.protect(
          familyID,
          `schedule_update_notifications/${plan.notification.id}/body`,
          plan.notification.body,
        );
        await client.query(
          `INSERT INTO schedule_update_notifications (
             id, family_id, event_id, idempotency_key, title, body, participant_ids
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            plan.notification.id, familyID, plan.notification.eventID, idempotencyKey,
            protectedTitle, protectedBody, plan.notification.participantIDs,
          ],
        );
      }
      const protectedResult = await this.familyDataProtector.protect(
        familyID,
        `event_mutation_results/${idempotencyKey}/result`,
        JSON.stringify(plan.result),
      );
      await client.query(
        `INSERT INTO event_mutation_results (
           family_id, idempotency_key, result, result_ciphertext
         ) VALUES ($1, $2, NULL, $3)`,
        [familyID, idempotencyKey, protectedResult],
      );
      await client.query("COMMIT");
      return plan.result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimScheduleUpdateNotifications(
    now: Date,
    limit: number,
    notificationID?: string,
  ): Promise<ClaimedScheduleUpdateNotification[]> {
    const result = await this.pool.query<ScheduleUpdateNotificationRow>(
      `WITH candidates AS (
         SELECT id FROM schedule_update_notifications
         WHERE ($3::uuid IS NULL OR id = $3)
           AND (status = 'pending' OR (status = 'claimed' AND claimed_at < $1::timestamptz - interval '5 minutes'))
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE schedule_update_notifications AS notification
       SET status = 'claimed', claimed_at = $1, attempt_count = attempt_count + 1
       FROM candidates
       WHERE notification.id = candidates.id
       RETURNING notification.id::text, notification.family_id, notification.event_id::text,
                 notification.idempotency_key::text, notification.title, notification.body,
                 notification.participant_ids, notification.claimed_at`,
      [now.toISOString(), limit, notificationID ?? null],
    );
    return Promise.all(result.rows.map(async (row) => ({
      id: row.id,
      familyID: row.family_id,
      eventID: row.event_id,
      idempotencyKey: row.idempotency_key,
      title: await this.revealLegacyValue(
        row.family_id,
        `schedule_update_notifications/${row.id}/title`,
        row.title,
      ),
      body: await this.revealLegacyValue(
        row.family_id,
        `schedule_update_notifications/${row.id}/body`,
        row.body,
      ),
      participantIDs: row.participant_ids,
      claimedAt: new Date(row.claimed_at),
    })));
  }

  async completeScheduleUpdateNotification(
    notification: ClaimedScheduleUpdateNotification,
    outcome: "sent" | "noRecipients",
    completedAt: Date,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const completed = await client.query(
        `UPDATE schedule_update_notifications
         SET status = 'sent', claimed_at = NULL, sent_at = $3, last_error_category = NULL
         WHERE id = $1 AND status = 'claimed' AND claimed_at = $2
         RETURNING family_id, idempotency_key`,
        [notification.id, notification.claimedAt.toISOString(), completedAt.toISOString()],
      );
      if (completed.rows[0]) {
        const stored = await client.query<EventMutationResultRow>(
          `SELECT result, result_ciphertext FROM event_mutation_results
           WHERE family_id = $1 AND idempotency_key = $2 FOR UPDATE`,
          [notification.familyID, notification.idempotencyKey],
        );
        if (stored.rows[0]) {
          const mutationResult = await this.eventMutationResultFromRow(
            notification.familyID,
            notification.idempotencyKey,
            stored.rows[0],
          );
          mutationResult.notificationOutcome = outcome;
          const protectedResult = await this.familyDataProtector.protect(
            notification.familyID,
            `event_mutation_results/${notification.idempotencyKey}/result`,
            JSON.stringify(mutationResult),
          );
          await client.query(
            `UPDATE event_mutation_results
             SET result = NULL, result_ciphertext = $3, updated_at = now()
             WHERE family_id = $1 AND idempotency_key = $2`,
            [notification.familyID, notification.idempotencyKey, protectedResult],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseScheduleUpdateNotification(
    notification: ClaimedScheduleUpdateNotification,
    errorCategory: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE schedule_update_notifications
       SET status = 'pending', claimed_at = NULL, last_error_category = $3
       WHERE id = $1 AND status = 'claimed' AND claimed_at = $2`,
      [notification.id, notification.claimedAt.toISOString(), errorCategory],
    );
  }

  async saveEvent(event: FamilyEvent): Promise<void> {
    const protectedEvent = await this.protectEvent(event);
    await this.pool.query(
      `INSERT INTO events (
         family_id, id, title, kid_id, participant_ids, start_time, end_time,
         location, driver, source, status, alert_lead_time_minutes, recurrence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (family_id, id) DO UPDATE SET
         title=EXCLUDED.title, kid_id=EXCLUDED.kid_id,
         participant_ids=EXCLUDED.participant_ids, start_time=EXCLUDED.start_time,
         end_time=EXCLUDED.end_time, location=EXCLUDED.location,
         driver=EXCLUDED.driver, source=EXCLUDED.source, status=EXCLUDED.status,
         alert_lead_time_minutes=EXCLUDED.alert_lead_time_minutes,
         recurrence=EXCLUDED.recurrence`,
      eventValues(protectedEvent),
    );
  }

  async deleteEvent(familyID: string, eventID: string): Promise<void> {
    await this.pool.query("DELETE FROM events WHERE family_id = $1 AND id = $2", [familyID, eventID]);
  }

  async claimDueEventNotifications(now: Date, limit: number): Promise<DueEventNotification[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const events = await client.query<EventRow>(
        `SELECT family_id, id::text, title, kid_id, participant_ids, start_time,
                end_time, location, driver, source, status, alert_lead_time_minutes, recurrence
         FROM events
         WHERE alert_lead_time_minutes IS NOT NULL
           AND start_time <= $1::timestamptz + interval '1 day'
           AND (
             (recurrence IS NULL AND start_time >= $1::timestamptz - interval '5 minutes')
             OR
             (recurrence IS NOT NULL
              AND (recurrence->>'endDate')::timestamptz >= $1::timestamptz - interval '5 minutes')
           )`,
        [now.toISOString()],
      );
      const revealedEvents = await Promise.all(
        events.rows.map((row) => this.eventFromRow(row)),
      );
      const due = revealedEvents.flatMap((event) => {
        const through = new Date(now.getTime() + event.alertLeadTimeMinutes! * 60 * 1_000);
        return eventOccurrenceStarts(event, through)
          .filter((start) => {
            const notifyAt = start.getTime() - event.alertLeadTimeMinutes! * 60 * 1_000;
            return notifyAt <= now.getTime() && start.getTime() >= now.getTime() - 5 * 60 * 1_000;
          })
          .map((start) => ({ event, occurrenceStart: start.toISOString() }));
      }).sort((left, right) => left.occurrenceStart.localeCompare(right.occurrenceStart));
      const claimed: DueEventNotification[] = [];
      for (const notification of due) {
        if (claimed.length >= limit) break;
        const result = await client.query(
          `INSERT INTO event_notification_deliveries (
             family_id, event_id, occurrence_start, notification_claimed_at
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (family_id, event_id, occurrence_start) DO UPDATE
           SET notification_claimed_at = EXCLUDED.notification_claimed_at
           WHERE event_notification_deliveries.notification_sent_at IS NULL
             AND (
               event_notification_deliveries.notification_claimed_at IS NULL
               OR event_notification_deliveries.notification_claimed_at < $4::timestamptz - interval '5 minutes'
             )
           RETURNING occurrence_start`,
          [
            notification.event.familyID,
            notification.event.id,
            notification.occurrenceStart,
            now.toISOString(),
          ],
        );
        if (result.rows[0]) claimed.push(notification);
      }
      await client.query("COMMIT");
      return claimed;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markEventNotificationSent(
    familyID: string,
    eventID: string,
    occurrenceStart: string,
    claimedAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE event_notification_deliveries
       SET notification_claimed_at = NULL, notification_sent_at = $4
       WHERE family_id = $1 AND event_id = $2 AND occurrence_start = $3
         AND notification_claimed_at = $4`,
      [familyID, eventID, occurrenceStart, claimedAt.toISOString()],
    );
  }

  async releaseEventNotificationClaim(
    familyID: string,
    eventID: string,
    occurrenceStart: string,
    claimedAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE event_notification_deliveries SET notification_claimed_at = NULL
       WHERE family_id = $1 AND event_id = $2 AND occurrence_start = $3
         AND notification_sent_at IS NULL AND notification_claimed_at = $4`,
      [familyID, eventID, occurrenceStart, claimedAt.toISOString()],
    );
  }

  async saveCalendarSource(source: CalendarSource): Promise<void> {
    const protectedSource = await this.protectCalendarSource(source);
    await this.pool.query(
      `INSERT INTO calendar_sources (
         family_id, id, owner_member_id, visibility, name, feed_url_ciphertext,
         participant_ids, status, last_synced_at, last_error, etag, last_modified
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (family_id, id) DO UPDATE SET
         owner_member_id=EXCLUDED.owner_member_id, visibility=EXCLUDED.visibility,
         name=EXCLUDED.name, feed_url_ciphertext=EXCLUDED.feed_url_ciphertext,
         participant_ids=EXCLUDED.participant_ids, status=EXCLUDED.status,
         last_synced_at=EXCLUDED.last_synced_at, last_error=EXCLUDED.last_error,
         etag=EXCLUDED.etag, last_modified=EXCLUDED.last_modified`,
      [
        protectedSource.familyID, protectedSource.id, protectedSource.ownerMemberID,
        protectedSource.visibility, protectedSource.name, protectedSource.protectedURL,
        protectedSource.participantIDs, protectedSource.status, protectedSource.lastSyncedAt,
        protectedSource.lastError, protectedSource.etag, protectedSource.lastModified,
      ],
    );
  }

  async calendarSource(familyID: string, sourceID: string): Promise<CalendarSource | null> {
    const result = await this.pool.query<CalendarSourceRow>(
      `SELECT family_id, id::text, owner_member_id, visibility, name,
              feed_url_ciphertext, participant_ids, status, last_synced_at,
              last_error, etag, last_modified
       FROM calendar_sources WHERE family_id = $1 AND id = $2`,
      [familyID, sourceID],
    );
    return result.rows[0] ? this.calendarSourceFromRow(result.rows[0]) : null;
  }

  async calendarSourcesForFamily(familyID: string): Promise<CalendarSource[]> {
    const result = await this.pool.query<CalendarSourceRow>(
      `SELECT family_id, id::text, owner_member_id, visibility, name,
              feed_url_ciphertext, participant_ids, status, last_synced_at,
              last_error, etag, last_modified
       FROM calendar_sources WHERE family_id = $1 ORDER BY name, id`,
      [familyID],
    );
    const sources = await Promise.all(result.rows.map((row) => this.calendarSourceFromRow(row)));
    return sources.sort((left, right) => (
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    ));
  }

  async deleteCalendarSource(familyID: string, sourceID: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM calendar_sources WHERE family_id = $1 AND id = $2",
      [familyID, sourceID],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async replaceCalendarEvents(
    source: CalendarSource,
    events: ImportedCalendarEvent[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT 1 FROM calendar_sources WHERE family_id = $1 AND id = $2 FOR UPDATE",
        [source.familyID, source.id],
      );
      if (!locked.rows[0]) throw new Error("Calendar source no longer exists");
      await client.query("DELETE FROM imported_calendar_events WHERE source_id = $1", [source.id]);
      for (const event of events) {
        const protectedEvent = await this.protectImportedCalendarEvent(event);
        await client.query(
          `INSERT INTO imported_calendar_events (
             family_id, source_id, external_uid, title, start_time, end_time,
             location, participant_ids, fingerprint
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            protectedEvent.familyID, protectedEvent.sourceID, protectedEvent.externalUID,
            protectedEvent.title, protectedEvent.startTime, protectedEvent.endTime,
            protectedEvent.location, protectedEvent.participantIDs, protectedEvent.fingerprint,
          ],
        );
      }
      const protectedSource = await this.protectCalendarSource(source);
      await client.query(
        `UPDATE calendar_sources SET
           owner_member_id=$3, visibility=$4, name=$5, feed_url_ciphertext=$6,
           participant_ids=$7, status=$8, last_synced_at=$9, last_error=$10,
           etag=$11, last_modified=$12
         WHERE family_id=$1 AND id=$2`,
        [
          protectedSource.familyID, protectedSource.id, protectedSource.ownerMemberID,
          protectedSource.visibility, protectedSource.name, protectedSource.protectedURL,
          protectedSource.participantIDs, protectedSource.status, protectedSource.lastSyncedAt,
          protectedSource.lastError, protectedSource.etag, protectedSource.lastModified,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async calendarEventsForFamily(familyID: string): Promise<ImportedCalendarEvent[]> {
    const result = await this.pool.query<ImportedCalendarEventRow>(
      `SELECT event.family_id, event.source_id::text, source.name AS source_name,
              source.owner_member_id AS source_owner_member_id,
              source.visibility AS source_visibility,
              event.external_uid, event.title, event.start_time, event.end_time,
              event.location, event.participant_ids, event.fingerprint
       FROM imported_calendar_events event
       JOIN calendar_sources source
         ON source.family_id = event.family_id AND source.id = event.source_id
       WHERE event.family_id = $1 ORDER BY event.start_time, event.source_id`,
      [familyID],
    );
    return Promise.all(result.rows.map(async (row) => {
      const externalUID = await this.revealLegacyValue(
        row.family_id,
        `imported_calendar_events/${row.source_id}/${row.fingerprint}/external_uid`,
        row.external_uid,
      );
      return {
        familyID: row.family_id,
        sourceID: row.source_id,
        sourceName: await this.revealLegacyValue(
          row.family_id,
          `calendar_sources/${row.source_id}/name`,
          row.source_name,
        ),
        sourceOwnerMemberID: row.source_owner_member_id,
        sourceVisibility: row.source_visibility,
        externalUID,
        title: await this.revealLegacyValue(
          row.family_id,
          `imported_calendar_events/${row.source_id}/${externalUID}/title`,
          row.title,
        ),
        startTime: asISOString(row.start_time),
        endTime: asISOString(row.end_time),
        location: row.location === null
          ? null
          : await this.revealLegacyValue(
            row.family_id,
            `imported_calendar_events/${row.source_id}/${externalUID}/location`,
            row.location,
          ),
        participantIDs: row.participant_ids,
        fingerprint: row.fingerprint,
      };
    }));
  }

  async remindersForFamily(familyID: string): Promise<FamilyReminder[]> {
    const result = await this.pool.query<ReminderRow>(
      `SELECT family_id, id::text, title, assignee_ids, due_at, status,
              completed_at, completed_by_member_id, alert_lead_time_minutes,
              created_by_member_id
       FROM family_reminders WHERE family_id = $1 ORDER BY due_at`,
      [familyID],
    );
    return Promise.all(result.rows.map((row) => this.reminderFromRow(row)));
  }

  async saveReminder(reminder: FamilyReminder): Promise<void> {
    const protectedTitle = await this.familyDataProtector.protect(
      reminder.familyID,
      `family_reminders/${reminder.id}/title`,
      reminder.title,
    );
    await this.pool.query(
      `INSERT INTO family_reminders (
         family_id, id, title, assignee_ids, due_at, status, completed_at,
         completed_by_member_id, alert_lead_time_minutes, created_by_member_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (family_id, id) DO UPDATE SET
         title=EXCLUDED.title, assignee_ids=EXCLUDED.assignee_ids,
         due_at=EXCLUDED.due_at, status=EXCLUDED.status,
         completed_at=EXCLUDED.completed_at,
         completed_by_member_id=EXCLUDED.completed_by_member_id,
         alert_lead_time_minutes=EXCLUDED.alert_lead_time_minutes,
         notification_claimed_at=NULL, notification_sent_at=NULL, updated_at=now()`,
      [
        reminder.familyID, reminder.id, protectedTitle, reminder.assigneeIDs,
        reminder.dueAt, reminder.status, reminder.completedAt,
        reminder.completedByMemberID, reminder.alertLeadTimeMinutes,
        reminder.createdByMemberID,
      ],
    );
  }

  async deleteReminder(familyID: string, reminderID: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM family_reminders WHERE family_id = $1 AND id = $2",
      [familyID, reminderID],
    );
  }

  async claimDueReminderNotifications(now: Date, limit: number): Promise<FamilyReminder[]> {
    const result = await this.pool.query<ReminderRow>(
      `WITH due AS (
         SELECT family_id, id
         FROM family_reminders
         WHERE status = 'open'
           AND notification_sent_at IS NULL
           AND (notification_claimed_at IS NULL OR notification_claimed_at < $1::timestamptz - interval '5 minutes')
           AND alert_lead_time_minutes IS NOT NULL
           AND due_at - make_interval(mins => alert_lead_time_minutes) <= $1
           AND due_at >= $1::timestamptz - interval '24 hours'
         ORDER BY due_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE family_reminders AS reminder
       SET notification_claimed_at = $1, updated_at = now()
       FROM due
       WHERE reminder.family_id = due.family_id AND reminder.id = due.id
       RETURNING reminder.family_id, reminder.id::text, reminder.title,
                 reminder.assignee_ids, reminder.due_at, reminder.status,
                 reminder.completed_at, reminder.completed_by_member_id,
                 reminder.alert_lead_time_minutes, reminder.created_by_member_id`,
      [now.toISOString(), limit],
    );
    return Promise.all(result.rows.map((row) => this.reminderFromRow(row)));
  }

  async markReminderNotificationSent(familyID: string, reminderID: string, sentAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE family_reminders
       SET notification_claimed_at = NULL, notification_sent_at = $3, updated_at = now()
       WHERE family_id = $1 AND id = $2 AND notification_claimed_at = $3`,
      [familyID, reminderID, sentAt.toISOString()],
    );
  }

  async releaseReminderNotificationClaim(familyID: string, reminderID: string, claimedAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE family_reminders SET notification_claimed_at = NULL, updated_at = now()
       WHERE family_id = $1 AND id = $2 AND notification_sent_at IS NULL
         AND notification_claimed_at = $3`,
      [familyID, reminderID, claimedAt.toISOString()],
    );
  }

  async membersForFamily(familyID: string): Promise<FamilyMember[]> {
    const result = await this.pool.query<MemberRow>(
      `SELECT family_id, id, name, role, grade_or_birth_year, color_tag
       FROM family_members WHERE family_id = $1 ORDER BY name`,
      [familyID],
    );
    const members = await Promise.all(result.rows.map((row) => this.memberFromRow(row)));
    return members.sort((left, right) => left.name.localeCompare(right.name));
  }

  async saveMember(member: FamilyMember): Promise<void> {
    const protectedName = await this.familyDataProtector.protect(
      member.familyID,
      `family_members/${member.id}/name`,
      member.name,
    );
    const protectedGradeOrBirthYear = member.gradeOrBirthYear == null
      ? null
      : await this.familyDataProtector.protect(
        member.familyID,
        `family_members/${member.id}/grade_or_birth_year`,
        member.gradeOrBirthYear,
      );
    await this.pool.query(
      `INSERT INTO family_members (family_id, id, name, role, grade_or_birth_year, color_tag)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (family_id, id) DO UPDATE SET
         name=EXCLUDED.name, role=EXCLUDED.role,
         grade_or_birth_year=EXCLUDED.grade_or_birth_year,
         color_tag=EXCLUDED.color_tag`,
      [
        member.familyID, member.id, protectedName, member.role,
        protectedGradeOrBirthYear, member.colorTag,
      ],
    );
  }

  async deleteMember(familyID: string, memberID: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM family_members WHERE family_id = $1 AND id = $2",
      [familyID, memberID],
    );
  }

  private async invitationFromRow(row: InvitationRecordRow): Promise<FamilyInvitation> {
    return {
      id: row.id,
      codeHash: row.code_hash,
      familyID: row.family_id,
      recipientEmail: row.recipient_email === null
        ? null
        : await this.revealLegacyValue(
          row.family_id,
          `family_invitations/${row.id}/recipient_email`,
          row.recipient_email,
        ),
      role: row.role,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  private async protectCalendarSource(source: CalendarSource): Promise<CalendarSource> {
    return {
      ...source,
      name: await this.familyDataProtector.protect(
        source.familyID,
        `calendar_sources/${source.id}/name`,
        source.name,
      ),
      protectedURL: await this.familyDataProtector.protect(
        source.familyID,
        `calendar_sources/${source.id}/feed_url_ciphertext`,
        source.protectedURL,
      ),
      lastError: source.lastError === null
        ? null
        : await this.familyDataProtector.protect(
          source.familyID,
          `calendar_sources/${source.id}/last_error`,
          source.lastError,
        ),
    };
  }

  private async calendarSourceFromRow(row: CalendarSourceRow): Promise<CalendarSource> {
    return {
      ...calendarSourceFromRow(row),
      name: await this.revealLegacyValue(
        row.family_id,
        `calendar_sources/${row.id}/name`,
        row.name,
      ),
      protectedURL: await this.revealLegacyValue(
        row.family_id,
        `calendar_sources/${row.id}/feed_url_ciphertext`,
        row.feed_url_ciphertext,
      ),
      lastError: row.last_error === null
        ? null
        : await this.revealLegacyValue(
          row.family_id,
          `calendar_sources/${row.id}/last_error`,
          row.last_error,
        ),
    };
  }

  private async protectImportedCalendarEvent(
    event: ImportedCalendarEvent,
  ): Promise<ImportedCalendarEvent> {
    return {
      ...event,
      externalUID: await this.familyDataProtector.protect(
        event.familyID,
        `imported_calendar_events/${event.sourceID}/${event.fingerprint}/external_uid`,
        event.externalUID,
      ),
      title: await this.familyDataProtector.protect(
        event.familyID,
        `imported_calendar_events/${event.sourceID}/${event.externalUID}/title`,
        event.title,
      ),
      location: event.location === null
        ? null
        : await this.familyDataProtector.protect(
          event.familyID,
          `imported_calendar_events/${event.sourceID}/${event.externalUID}/location`,
          event.location,
        ),
    };
  }

  private async eventMutationResultFromRow(
    familyID: string,
    idempotencyKey: string,
    row: EventMutationResultRow,
  ): Promise<StoredEventMutationResult> {
    if (row.result_ciphertext !== null) {
      const plaintext = await this.familyDataProtector.reveal(
        familyID,
        `event_mutation_results/${idempotencyKey}/result`,
        row.result_ciphertext,
      );
      return JSON.parse(plaintext) as StoredEventMutationResult;
    }
    if (row.result !== null) return row.result;
    throw new Error("Event mutation result has no payload");
  }

  private async memberFromRow(row: MemberRow): Promise<FamilyMember> {
    return {
      ...memberFromRow(row),
      name: await this.revealLegacyValue(
        row.family_id,
        `family_members/${row.id}/name`,
        row.name,
      ),
      ...(row.grade_or_birth_year !== null ? {
        gradeOrBirthYear: await this.revealLegacyValue(
          row.family_id,
          `family_members/${row.id}/grade_or_birth_year`,
          row.grade_or_birth_year,
        ),
      } : {}),
    };
  }

  private async reminderFromRow(row: ReminderRow): Promise<FamilyReminder> {
    return {
      ...reminderFromRow(row),
      title: await this.revealLegacyValue(
        row.family_id,
        `family_reminders/${row.id}/title`,
        row.title,
      ),
    };
  }

  private async protectEvent(event: FamilyEvent): Promise<FamilyEvent> {
    return {
      ...event,
      title: await this.familyDataProtector.protect(
        event.familyID,
        `events/${event.id}/title`,
        event.title,
      ),
      location: event.location === null ? null : await this.familyDataProtector.protect(
        event.familyID,
        `events/${event.id}/location`,
        event.location,
      ),
      driver: event.driver === null ? null : await this.familyDataProtector.protect(
        event.familyID,
        `events/${event.id}/driver`,
        event.driver,
      ),
    };
  }

  private async eventFromRow(row: EventRow): Promise<FamilyEvent> {
    return {
      ...eventFromRow(row),
      title: await this.revealLegacyValue(row.family_id, `events/${row.id}/title`, row.title),
      location: row.location === null
        ? null
        : await this.revealLegacyValue(row.family_id, `events/${row.id}/location`, row.location),
      driver: row.driver === null
        ? null
        : await this.revealLegacyValue(row.family_id, `events/${row.id}/driver`, row.driver),
    };
  }

  private async revealLegacyValue(
    familyID: string,
    purpose: string,
    value: string,
  ): Promise<string> {
    return this.familyDataProtector.isProtected(value)
      ? this.familyDataProtector.reveal(familyID, purpose, value)
      : value;
  }
}

class PostgresFamilyDataKeyStore implements FamilyDataKeyStore {
  constructor(private readonly pool: Pool) {}

  async activeKey(familyID: string): Promise<WrappedFamilyDataKey | null> {
    const result = await this.pool.query<FamilyDataKeyRow>(
      `SELECT family_id, version, wrapped_key
       FROM family_data_keys WHERE family_id = $1 AND active`,
      [familyID],
    );
    return result.rows[0] ? wrappedFamilyDataKeyFromRow(result.rows[0]) : null;
  }

  async key(familyID: string, version: number): Promise<WrappedFamilyDataKey | null> {
    const result = await this.pool.query<FamilyDataKeyRow>(
      `SELECT family_id, version, wrapped_key
       FROM family_data_keys WHERE family_id = $1 AND version = $2`,
      [familyID, version],
    );
    return result.rows[0] ? wrappedFamilyDataKeyFromRow(result.rows[0]) : null;
  }

  async saveKeyIfAbsent(key: WrappedFamilyDataKey): Promise<WrappedFamilyDataKey> {
    const inserted = await this.pool.query<FamilyDataKeyRow>(
      `INSERT INTO family_data_keys (family_id, version, wrapped_key, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT DO NOTHING
       RETURNING family_id, version, wrapped_key`,
      [key.familyID, key.version, key.wrappedKey],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow) return wrappedFamilyDataKeyFromRow(insertedRow);
    const existing = await this.activeKey(key.familyID);
    if (!existing) throw new Error("Unable to create Family data key");
    return existing;
  }

  async rotateKey(key: WrappedFamilyDataKey, priorVersion: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const retired = await client.query(
        `UPDATE family_data_keys SET active = false, retired_at = now()
         WHERE family_id = $1 AND version = $2 AND active`,
        [key.familyID, priorVersion],
      );
      if (retired.rowCount !== 1) throw new Error("Family data key changed during rotation");
      await client.query(
        `INSERT INTO family_data_keys (family_id, version, wrapped_key, active)
         VALUES ($1, $2, $3, true)`,
        [key.familyID, key.version, key.wrappedKey],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface FamilyDataKeyRow {
  family_id: string;
  version: number;
  wrapped_key: string;
}

function wrappedFamilyDataKeyFromRow(row: FamilyDataKeyRow): WrappedFamilyDataKey {
  return {
    familyID: row.family_id,
    version: row.version,
    wrappedKey: row.wrapped_key,
  };
}

interface AccountRow {
  identity_subject: string;
  family_id: string;
  member_id: string;
  role: AccountRole;
}

interface CommuterInstallationRow {
  family_id: string;
  enabled_by_member_id: string;
  status: CommuterInstallation["status"];
}

interface CommuterSubscriptionRow {
  id: string;
  family_id: string;
  owner_member_id: string;
  visibility: CommuteSubscription["visibility"];
  status: CommuteSubscription["status"];
  details_ciphertext: string;
}

interface InvitationRow {
  family_id: string;
  role: AccountRole;
}

interface InvitationRecordRow extends InvitationRow {
  id: string;
  code_hash: string;
  recipient_email: string | null;
  expires_at: Date;
}

interface EventRow {
  family_id: string;
  id: string;
  title: string;
  kid_id: string | null;
  participant_ids: string[];
  start_time: Date | string;
  end_time: Date | string;
  location: string | null;
  driver: string | null;
  source: FamilyEvent["source"];
  status: FamilyEvent["status"];
  alert_lead_time_minutes: Exclude<FamilyEvent["alertLeadTimeMinutes"], undefined>;
  recurrence: EventRecurrence | null;
}

interface EventMutationResultRow {
  result: StoredEventMutationResult | null;
  result_ciphertext: string | null;
}

interface ScheduleUpdateNotificationRow {
  id: string;
  family_id: string;
  event_id: string;
  idempotency_key: string;
  title: string;
  body: string;
  participant_ids: string[];
  claimed_at: Date | string;
}

interface ReminderRow {
  family_id: string;
  id: string;
  title: string;
  assignee_ids: string[];
  due_at: Date | string;
  status: FamilyReminder["status"];
  completed_at: Date | string | null;
  completed_by_member_id: string | null;
  alert_lead_time_minutes: FamilyReminder["alertLeadTimeMinutes"];
  created_by_member_id: string;
}

interface CalendarSourceRow {
  family_id: string;
  id: string;
  owner_member_id: string;
  visibility: CalendarSource["visibility"];
  name: string;
  feed_url_ciphertext: string;
  participant_ids: string[];
  status: CalendarSource["status"];
  last_synced_at: Date | string | null;
  last_error: string | null;
  etag: string | null;
  last_modified: string | null;
}

interface ImportedCalendarEventRow {
  family_id: string;
  source_id: string;
  source_name: string;
  source_owner_member_id: string;
  source_visibility: CalendarSource["visibility"];
  external_uid: string;
  title: string;
  start_time: Date | string;
  end_time: Date | string;
  location: string | null;
  participant_ids: string[];
  fingerprint: string;
}

interface MemberRow {
  family_id: string;
  id: string;
  name: string;
  role: AccountRole;
  grade_or_birth_year: string | null;
  color_tag: string;
}

function calendarSourceFromRow(row: CalendarSourceRow): CalendarSource {
  return {
    familyID: row.family_id,
    id: row.id,
    ownerMemberID: row.owner_member_id,
    visibility: row.visibility,
    name: row.name,
    protectedURL: row.feed_url_ciphertext,
    participantIDs: row.participant_ids,
    status: row.status,
    lastSyncedAt: row.last_synced_at ? asISOString(row.last_synced_at) : null,
    lastError: row.last_error,
    etag: row.etag,
    lastModified: row.last_modified,
  };
}

function accountFromRow(row: AccountRow): Account {
  return {
    identitySubject: row.identity_subject,
    familyID: row.family_id,
    memberID: row.member_id,
    role: row.role,
  };
}

function memberFromRow(row: MemberRow): FamilyMember {
  return {
    familyID: row.family_id,
    id: row.id,
    name: row.name,
    role: row.role,
    colorTag: row.color_tag,
    ...(row.grade_or_birth_year !== null ? { gradeOrBirthYear: row.grade_or_birth_year } : {}),
  };
}

function eventValues(event: FamilyEvent): unknown[] {
  return [
    event.familyID, event.id, event.title, event.kidID, event.participantIDs,
    event.startTime, event.endTime, event.location, event.driver,
    event.source, event.status, event.alertLeadTimeMinutes ?? null,
    event.recurrence ? JSON.stringify(event.recurrence) : null,
  ];
}

function eventFromRow(row: EventRow): FamilyEvent {
  return {
    familyID: row.family_id,
    id: row.id,
    title: row.title,
    kidID: row.kid_id,
    participantIDs: row.participant_ids,
    startTime: asISOString(row.start_time),
    endTime: asISOString(row.end_time),
    location: row.location,
    driver: row.driver,
    source: row.source,
    status: row.status,
    alertLeadTimeMinutes: row.alert_lead_time_minutes,
    recurrence: row.recurrence,
  };
}

function reminderFromRow(row: ReminderRow): FamilyReminder {
  return {
    familyID: row.family_id,
    id: row.id,
    title: row.title,
    assigneeIDs: row.assignee_ids,
    dueAt: asISOString(row.due_at),
    status: row.status,
    completedAt: row.completed_at ? asISOString(row.completed_at) : null,
    completedByMemberID: row.completed_by_member_id,
    alertLeadTimeMinutes: row.alert_lead_time_minutes,
    createdByMemberID: row.created_by_member_id,
  };
}

function asISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
