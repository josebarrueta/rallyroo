import { randomUUID } from "node:crypto";
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
import type { RallyrooRepository } from "./repository.js";
import type {
  CalendarSource,
  CalendarSourceRepository,
  ImportedCalendarEvent,
} from "./calendar-source-module.js";

export class PostgresRallyrooRepository implements RallyrooRepository, CalendarSourceRepository {
  constructor(private readonly pool: Pool) {}

  static fromConfiguration(config: PoolConfig): PostgresRallyrooRepository {
    return new PostgresRallyrooRepository(new Pool(config));
  }

  static fromConnectionString(connectionString: string): PostgresRallyrooRepository {
    return PostgresRallyrooRepository.fromConfiguration({ connectionString, max: 20 });
  }

  async checkReadiness(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
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
      await client.query(
        `INSERT INTO family_members (family_id, id, name, role, color_tag)
         VALUES ($1, $2, $3, 'parent', 'blue')`,
        [familyID, memberID, displayName],
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
        await client.query("DELETE FROM calendar_sources WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM device_tokens WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_invitations WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM events WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_reminders WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_change_versions WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM accounts WHERE family_id = $1", [row.family_id]);
        await client.query("DELETE FROM family_members WHERE family_id = $1", [row.family_id]);
      } else {
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
    await this.pool.query(
      `INSERT INTO family_invitations (
         id, code_hash, family_id, recipient_email, role, expires_at,
         guardian_consent_at, guardian_member_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        invitation.id,
        invitation.codeHash,
        invitation.familyID,
        invitation.recipientEmail,
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
    return result.rows.map((row) => ({
      id: row.id,
      codeHash: row.code_hash,
      familyID: row.family_id,
      recipientEmail: row.recipient_email,
      role: row.role,
      expiresAt: row.expires_at.toISOString(),
    }));
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
    return row ? {
      id: row.id,
      codeHash: row.code_hash,
      familyID: row.family_id,
      recipientEmail: row.recipient_email,
      role: row.role,
      expiresAt: row.expires_at.toISOString(),
    } : null;
  }

  async consumeInvitation(
    codeHash: string,
    subject: string,
    displayName: string,
  ): Promise<Account | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [subject]);
      const existing = await client.query<AccountRow>(
        `SELECT identity_subject, family_id, member_id, role
         FROM accounts WHERE identity_subject = $1`,
        [subject],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return accountFromRow(existing.rows[0]);
      }
      const invitationResult = await client.query<InvitationRow>(
        `SELECT family_id, role FROM family_invitations
         WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [codeHash],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) {
        await client.query("ROLLBACK");
        return null;
      }
      const memberID = `${invitation.role}-${randomUUID()}`;
      await client.query(
        `INSERT INTO family_members (family_id, id, name, role, color_tag)
         VALUES ($1, $2, $3, $4, 'blue')`,
        [invitation.family_id, memberID, displayName, invitation.role],
      );
      await client.query(
        `INSERT INTO accounts (identity_subject, family_id, member_id, role)
         VALUES ($1, $2, $3, $4)`,
        [subject, invitation.family_id, memberID, invitation.role],
      );
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
        identitySubject: subject,
        familyID: invitation.family_id,
        memberID,
        role: invitation.role,
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
    return result.rows.map(eventFromRow);
  }

  async eventMutationResult(
    familyID: string,
    idempotencyKey: string,
  ): Promise<StoredEventMutationResult | null> {
    const result = await this.pool.query<{ result: StoredEventMutationResult }>(
      "SELECT result FROM event_mutation_results WHERE family_id = $1 AND idempotency_key = $2",
      [familyID, idempotencyKey],
    );
    return result.rows[0]?.result ?? null;
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
      const prior = await client.query<{ result: StoredEventMutationResult }>(
        "SELECT result FROM event_mutation_results WHERE family_id = $1 AND idempotency_key = $2",
        [familyID, idempotencyKey],
      );
      if (prior.rows[0]) {
        await client.query("COMMIT");
        return prior.rows[0].result;
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
        events: events.rows.map(eventFromRow),
        members: members.rows.map(memberFromRow),
      });
      if (plan.action.kind === "save") {
        const event = plan.action.event;
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
          eventValues(event),
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
        await client.query(
          `INSERT INTO schedule_update_notifications (
             id, family_id, event_id, idempotency_key, title, body, participant_ids
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            plan.notification.id, familyID, plan.notification.eventID, idempotencyKey,
            plan.notification.title, plan.notification.body, plan.notification.participantIDs,
          ],
        );
      }
      await client.query(
        `INSERT INTO event_mutation_results (family_id, idempotency_key, result)
         VALUES ($1, $2, $3::jsonb)`,
        [familyID, idempotencyKey, JSON.stringify(plan.result)],
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
    return result.rows.map((row) => ({
      id: row.id,
      familyID: row.family_id,
      eventID: row.event_id,
      idempotencyKey: row.idempotency_key,
      title: row.title,
      body: row.body,
      participantIDs: row.participant_ids,
      claimedAt: new Date(row.claimed_at),
    }));
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
        await client.query(
          `UPDATE event_mutation_results
           SET result = jsonb_set(result, '{notificationOutcome}', to_jsonb($3::text)), updated_at = now()
           WHERE family_id = $1 AND idempotency_key = $2`,
          [notification.familyID, notification.idempotencyKey, outcome],
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
      eventValues(event),
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
      const due = events.rows.flatMap((row) => {
        const event = eventFromRow(row);
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
        source.familyID, source.id, source.ownerMemberID, source.visibility,
        source.name, source.protectedURL, source.participantIDs, source.status,
        source.lastSyncedAt, source.lastError, source.etag, source.lastModified,
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
    return result.rows[0] ? calendarSourceFromRow(result.rows[0]) : null;
  }

  async calendarSourcesForFamily(familyID: string): Promise<CalendarSource[]> {
    const result = await this.pool.query<CalendarSourceRow>(
      `SELECT family_id, id::text, owner_member_id, visibility, name,
              feed_url_ciphertext, participant_ids, status, last_synced_at,
              last_error, etag, last_modified
       FROM calendar_sources WHERE family_id = $1 ORDER BY name, id`,
      [familyID],
    );
    return result.rows.map(calendarSourceFromRow);
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
        await client.query(
          `INSERT INTO imported_calendar_events (
             family_id, source_id, external_uid, title, start_time, end_time,
             location, participant_ids, fingerprint
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            event.familyID, event.sourceID, event.externalUID, event.title,
            event.startTime, event.endTime, event.location, event.participantIDs,
            event.fingerprint,
          ],
        );
      }
      await client.query(
        `UPDATE calendar_sources SET
           owner_member_id=$3, visibility=$4, name=$5, feed_url_ciphertext=$6,
           participant_ids=$7, status=$8, last_synced_at=$9, last_error=$10,
           etag=$11, last_modified=$12
         WHERE family_id=$1 AND id=$2`,
        [
          source.familyID, source.id, source.ownerMemberID, source.visibility,
          source.name, source.protectedURL, source.participantIDs, source.status,
          source.lastSyncedAt, source.lastError, source.etag, source.lastModified,
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
    return result.rows.map((row) => ({
      familyID: row.family_id,
      sourceID: row.source_id,
      sourceName: row.source_name,
      sourceOwnerMemberID: row.source_owner_member_id,
      sourceVisibility: row.source_visibility,
      externalUID: row.external_uid,
      title: row.title,
      startTime: asISOString(row.start_time),
      endTime: asISOString(row.end_time),
      location: row.location,
      participantIDs: row.participant_ids,
      fingerprint: row.fingerprint,
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
    return result.rows.map(reminderFromRow);
  }

  async saveReminder(reminder: FamilyReminder): Promise<void> {
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
        reminder.familyID, reminder.id, reminder.title, reminder.assigneeIDs,
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
    return result.rows.map(reminderFromRow);
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
    return result.rows.map((row) => ({
      familyID: row.family_id,
      id: row.id,
      name: row.name,
      role: row.role,
      colorTag: row.color_tag,
      ...(row.grade_or_birth_year !== null ? { gradeOrBirthYear: row.grade_or_birth_year } : {}),
    }));
  }

  async saveMember(member: FamilyMember): Promise<void> {
    await this.pool.query(
      `INSERT INTO family_members (family_id, id, name, role, grade_or_birth_year, color_tag)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (family_id, id) DO UPDATE SET
         name=EXCLUDED.name, role=EXCLUDED.role,
         grade_or_birth_year=EXCLUDED.grade_or_birth_year,
         color_tag=EXCLUDED.color_tag`,
      [
        member.familyID, member.id, member.name, member.role,
        member.gradeOrBirthYear ?? null, member.colorTag,
      ],
    );
  }

  async deleteMember(familyID: string, memberID: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM family_members WHERE family_id = $1 AND id = $2",
      [familyID, memberID],
    );
  }
}

interface AccountRow {
  identity_subject: string;
  family_id: string;
  member_id: string;
  role: AccountRole;
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
