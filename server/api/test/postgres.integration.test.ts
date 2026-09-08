import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { CalendarSourceModule } from "../src/calendar-source-module.js";
import type { IdentityProvider } from "../src/identity-provider.js";
import { PostgresRallyrooRepository } from "../src/postgres-repository.js";

const adminURL = process.env.INTEGRATION_DATABASE_URL;
const databaseName = `rallyroo_test_${randomUUID().replaceAll("-", "")}`;
const migrationsDirectory = fileURLToPath(new URL("../migrations/pre", import.meta.url));
const familyDataEncryptionKey = Buffer.alloc(32, 7).toString("base64");
let databaseURL = "";
let adminPool: Pool;
const repositories: PostgresRallyrooRepository[] = [];

function repositoryForTest(): PostgresRallyrooRepository {
  const repository = PostgresRallyrooRepository.fromConnectionString(
    databaseURL,
    familyDataEncryptionKey,
  );
  repositories.push(repository);
  return repository;
}

const identityProvider: IdentityProvider = {
  googleAuthorizationURL: () => "https://identity.example/google",
  appleAuthorizationURL: () => "https://identity.example/apple",
  async authenticateOAuthToken(token) {
    const identities: Record<string, { subject: string; displayName: string; accessToken: string }> = {
      "oauth-token": { subject: "integration-parent", displayName: "Alex", accessToken: "integration-token" },
      "child-oauth-token": { subject: "integration-child", displayName: "Sam", accessToken: "child-token" },
      "other-oauth-token": { subject: "other-parent", displayName: "Jordan", accessToken: "other-token" },
      "deleting-owner-oauth-token": {
        subject: "deleting-calendar-owner",
        displayName: "Taylor",
        accessToken: "deleting-owner-token",
      },
      "successor-oauth-token": {
        subject: "calendar-owner-successor",
        displayName: "Morgan",
        accessToken: "successor-token",
      },
      "recovery-oauth-token": {
        subject: "invitation-recovery-parent",
        displayName: "Riley",
        accessToken: "recovery-token",
      },
    };
    const identity = identities[token];
    if (!identity) throw new Error("invalid OAuth token");
    return {
      identity: { subject: identity.subject, displayName: identity.displayName },
      accessToken: identity.accessToken,
    };
  },
  async verifySession(token) {
    const identities: Record<string, { subject: string; displayName: string }> = {
      "integration-token": { subject: "integration-parent", displayName: "Alex" },
      "child-token": { subject: "integration-child", displayName: "Sam" },
      "other-token": { subject: "other-parent", displayName: "Jordan" },
      "deleting-owner-token": { subject: "deleting-calendar-owner", displayName: "Taylor" },
      "successor-token": { subject: "calendar-owner-successor", displayName: "Morgan" },
      "recovery-token": { subject: "invitation-recovery-parent", displayName: "Riley" },
    };
    const identity = identities[token];
    if (!identity) throw new Error("invalid session");
    return identity;
  },
  async revokeSession() {},
  async deleteIdentity() {},
};

describe.skipIf(!adminURL)("PostgreSQL HTTP integration", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: adminURL });
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(adminURL!);
    url.pathname = `/${databaseName}`;
    databaseURL = url.toString();
    const migrationPool = new Pool({ connectionString: databaseURL });
    try {
      for (const filename of (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort()) {
        await migrationPool.query(await readFile(`${migrationsDirectory}/${filename}`, "utf8"));
      }
    } finally {
      await migrationPool.end();
    }
  });

  afterEach(async () => {
    await Promise.all(repositories.splice(0).map((repository) => repository.close()));
  });

  afterAll(async () => {
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
      [databaseName],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await adminPool.end();
  });

  it("persists an HTTP event across PostgreSQL repository instances", async () => {
    const writerRepository = repositoryForTest();
    const writer = buildApp({
      identityProvider,
      repository: writerRepository,
      readinessCheck: () => writerRepository.checkReadiness(),
    });
    const session = await writer.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    expect(session.statusCode).toBe(200);
    const account = (await writerRepository.accountForIdentity("integration-parent"))!;
    const participantID = "integration-participant";
    await writerRepository.saveMember({
      familyID: account.familyID,
      id: participantID,
      name: "Casey",
      role: "kid",
      colorTag: "green",
    });

    const saved = await writer.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000099?notifyParticipants=true",
      headers: { authorization: "Bearer integration-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000099",
        title: "Integration rehearsal",
        kidID: null,
        participantIDs: [participantID],
        startTime: "2026-09-01T18:00:00Z",
        endTime: "2026-09-01T19:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
      },
    });
    expect(saved.statusCode).toBe(200);
    await writer.close();

    const readerRepository = repositoryForTest();
    const reader = buildApp({
      identityProvider,
      repository: readerRepository,
      readinessCheck: () => readerRepository.checkReadiness(),
    });
    expect((await reader.inject({ method: "GET", url: "/ready" })).statusCode).toBe(200);
    const events = await reader.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer integration-token" },
    });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toEqual([
      expect.objectContaining({ id: "00000000-0000-4000-8000-000000000099", title: "Integration rehearsal" }),
    ]);

    const inspectionPool = new Pool({ connectionString: databaseURL });
    const stored = await inspectionPool.query<{
      title: string;
      start_time: Date;
      end_time: Date;
      wrapped_key: string;
      result: unknown | null;
      result_ciphertext: string | null;
      notification_title: string;
      notification_body: string;
    }>(
      `SELECT event.title, event.start_time, event.end_time, family_key.wrapped_key,
              mutation.result, mutation.result_ciphertext,
              notification.title AS notification_title,
              notification.body AS notification_body
       FROM events event
       JOIN family_data_keys family_key ON family_key.family_id = event.family_id
       JOIN event_mutation_results mutation ON mutation.family_id = event.family_id
       JOIN schedule_update_notifications notification
         ON notification.family_id = event.family_id AND notification.event_id = event.id
       WHERE event.id = $1 AND family_key.active`,
      ["00000000-0000-4000-8000-000000000099"],
    );
    await inspectionPool.end();
    expect(stored.rows[0]?.title).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.title).not.toContain("Integration rehearsal");
    expect(stored.rows[0]?.wrapped_key).toMatch(/^rrk1\.1\./);
    expect(stored.rows[0]?.result).toBeNull();
    expect(stored.rows[0]?.result_ciphertext).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.notification_title).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.notification_body).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.start_time.toISOString()).toBe("2026-09-01T18:00:00.000Z");
    expect(stored.rows[0]?.end_time.toISOString()).toBe("2026-09-01T19:00:00.000Z");
    await reader.close();
  });

  it("migrates existing protected details without changing schedule metadata", async () => {
    const familyID = "legacy-family";
    const memberID = "legacy-parent";
    const eventID = "00000000-0000-4000-8000-000000000098";
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc300";
    const seed = new Pool({ connectionString: databaseURL });
    await seed.query(
      `INSERT INTO family_members (family_id, id, name, role, color_tag)
       VALUES ($1, $2, 'Legacy Person', 'parent', 'blue')`,
      [familyID, memberID],
    );
    await seed.query(
      `INSERT INTO accounts (identity_subject, family_id, member_id, role)
       VALUES ('legacy-subject', $1, $2, 'parent')`,
      [familyID, memberID],
    );
    await seed.query(
      `INSERT INTO events (
         family_id, id, title, kid_id, participant_ids, start_time, end_time,
         location, driver, source, status
       ) VALUES ($1,$2,'Legacy appointment',NULL,$3,'2026-09-12T18:00:00Z',
                 '2026-09-12T19:00:00Z','Legacy clinic','Legacy driver','manual','confirmed')`,
      [familyID, eventID, [memberID]],
    );
    await seed.query(
      `INSERT INTO family_reminders (
         family_id, id, title, assignee_ids, due_at, status, created_by_member_id
       ) VALUES ($1,$2,'Legacy medication',$3,'2026-09-12T17:00:00Z','open',$4)`,
      [familyID, reminderID, [memberID], memberID],
    );
    await seed.end();

    const repository = repositoryForTest();
    expect(await repository.protectLegacyFamilyData(100)).toBe(5);
    expect(await repository.eventsForFamily(familyID)).toEqual([
      expect.objectContaining({
        title: "Legacy appointment",
        location: "Legacy clinic",
        driver: "Legacy driver",
        startTime: "2026-09-12T18:00:00.000Z",
        endTime: "2026-09-12T19:00:00.000Z",
      }),
    ]);
    expect(await repository.remindersForFamily(familyID)).toEqual([
      expect.objectContaining({ title: "Legacy medication", dueAt: "2026-09-12T17:00:00.000Z" }),
    ]);
    expect(await repository.membersForFamily(familyID)).toEqual([
      expect.objectContaining({ name: "Legacy Person" }),
    ]);

    const inspection = new Pool({ connectionString: databaseURL });
    const plaintextCount = await inspection.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM (
         SELECT name AS value FROM family_members WHERE family_id = $1
         UNION ALL SELECT title FROM events WHERE family_id = $1
         UNION ALL SELECT location FROM events WHERE family_id = $1
         UNION ALL SELECT driver FROM events WHERE family_id = $1
         UNION ALL SELECT title FROM family_reminders WHERE family_id = $1
       ) protected_details WHERE value IS NOT NULL AND value NOT LIKE 'rr1.%'`,
      [familyID],
    );
    await inspection.end();
    expect(plaintextCount.rows[0]?.count).toBe("0");
  });

  it("serializes concurrent Event mutations before calculating conflicts", async () => {
    const repository = repositoryForTest();
    const app = buildApp({ identityProvider, repository });
    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    const participantID = session.json().accountID;
    const eventPayload = (id: string, title: string) => ({
      id,
      title,
      kidID: null,
      participantIDs: [participantID],
      startTime: "2026-10-01T18:00:00Z",
      endTime: "2026-10-01T19:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
    });

    const responses = await Promise.all([
      app.inject({
        method: "PUT",
        url: "/v1/events/10000000-0000-4000-8000-000000000001?notifyParticipants=false",
        headers: {
          authorization: "Bearer integration-token",
          "idempotency-key": "10000000-0000-4000-8000-000000000011",
        },
        payload: eventPayload("10000000-0000-4000-8000-000000000001", "First concurrent Event"),
      }),
      app.inject({
        method: "PUT",
        url: "/v1/events/10000000-0000-4000-8000-000000000002?notifyParticipants=false",
        headers: {
          authorization: "Bearer integration-token",
          "idempotency-key": "10000000-0000-4000-8000-000000000012",
        },
        payload: eventPayload("10000000-0000-4000-8000-000000000002", "Second concurrent Event"),
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses.map((response) => response.json().conflicts.length).sort()).toEqual([0, 1]);
    await app.close();
  });

  it("persists reminder completion across PostgreSQL repository instances", async () => {
    const writerRepository = repositoryForTest();
    const writer = buildApp({ identityProvider, repository: writerRepository });
    const session = await writer.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc301";
    expect((await writer.inject({
      method: "PUT",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer integration-token" },
      payload: {
        id: reminderID,
        title: "Persistent reminder",
        assigneeIDs: [session.json().accountID],
        dueAt: "2026-09-10T15:00:00Z",
        alertLeadTimeMinutes: 15,
      },
    })).statusCode).toBe(200);
    expect((await writer.inject({
      method: "POST",
      url: `/v1/reminders/${reminderID}/complete`,
      headers: { authorization: "Bearer integration-token" },
    })).statusCode).toBe(200);
    await writer.close();

    const readerRepository = repositoryForTest();
    const reader = buildApp({ identityProvider, repository: readerRepository });
    const reminders = await reader.inject({
      method: "GET",
      url: "/v1/reminders",
      headers: { authorization: "Bearer integration-token" },
    });
    expect(reminders.json()).toEqual([
      expect.objectContaining({
        id: reminderID,
        title: "Persistent reminder",
        status: "completed",
        completedByMemberID: session.json().accountID,
      }),
    ]);
    const members = await reader.inject({
      method: "GET",
      url: "/v1/family-members",
      headers: { authorization: "Bearer integration-token" },
    });
    expect(members.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Alex" }),
    ]));

    const inspectionPool = new Pool({ connectionString: databaseURL });
    const stored = await inspectionPool.query<{ reminder_title: string; member_name: string }>(
      `SELECT reminder.title AS reminder_title, member.name AS member_name
       FROM family_reminders reminder
       JOIN family_members member ON member.family_id = reminder.family_id
       WHERE reminder.id = $1 AND member.id = $2`,
      [reminderID, session.json().accountID],
    );
    await inspectionPool.end();
    expect(stored.rows[0]?.reminder_title).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.reminder_title).not.toContain("Persistent reminder");
    expect(stored.rows[0]?.member_name).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.member_name).not.toContain("Alex");
    await reader.close();
  });

  it("claims a due reminder once across concurrent notification workers", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("notification-worker-parent", "Notifier");
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc302";
    await data.saveReminder({
      id: reminderID,
      familyID: account.familyID,
      title: "Due reminder",
      assigneeIDs: [account.memberID],
      dueAt: "2026-09-10T15:00:00Z",
      status: "open",
      completedAt: null,
      completedByMemberID: null,
      alertLeadTimeMinutes: 60,
      createdByMemberID: account.memberID,
    });
    const now = new Date("2026-09-10T14:00:00Z");

    const claims = await Promise.all([
      data.claimDueReminderNotifications(now, 100),
      data.claimDueReminderNotifications(now, 100),
    ]);

    expect(claims.flat().map((reminder) => reminder.id)).toEqual([reminderID]);
    await data.releaseReminderNotificationClaim(account.familyID, reminderID, now);
    expect((await data.claimDueReminderNotifications(now, 100)).map((reminder) => reminder.id))
      .toEqual([reminderID]);
  });

  it("claims a due recurring event occurrence once across concurrent workers", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("event-notification-parent", "Notifier");
    const eventID = "abcdefab-cdef-4abc-8def-abcdefabc303";
    await data.saveEvent({
      id: eventID,
      familyID: account.familyID,
      title: "Daily practice",
      kidID: null,
      participantIDs: [account.memberID],
      startTime: "2026-09-10T15:00:00Z",
      endTime: "2026-09-10T16:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
      alertLeadTimeMinutes: 60,
      recurrence: {
        frequency: "daily",
        interval: 1,
        endDate: "2026-09-12T15:00:00Z",
      },
    });
    const now = new Date("2026-09-11T14:00:00Z");

    const claims = await Promise.all([
      data.claimDueEventNotifications(now, 100),
      data.claimDueEventNotifications(now, 100),
    ]);

    const claimed = claims.flat();
    expect(claimed.map((notification) => notification.occurrenceStart))
      .toEqual(["2026-09-11T15:00:00.000Z"]);
    await data.releaseEventNotificationClaim(
      account.familyID,
      eventID,
      claimed[0]!.occurrenceStart,
      now,
    );
    expect((await data.claimDueEventNotifications(now, 100))).toHaveLength(1);
  });

  it("persists synchronized calendar sources and imported events across API instances", async () => {
    const writerRepository = repositoryForTest();
    const feedBody = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:persisted-calendar@example",
      "SUMMARY:Persisted team practice",
      "DTSTART:20260920T180000Z",
      "DTEND:20260920T190000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const moduleFor = (repository: PostgresRallyrooRepository) => new CalendarSourceModule({
      repository,
      protectURL: (url) => `encrypted:${url}`,
      revealURL: (url) => url.replace(/^encrypted:/, ""),
      fetchFeed: async () => ({ body: feedBody }),
    });
    const writer = buildApp({
      identityProvider,
      repository: writerRepository,
      calendarSources: moduleFor(writerRepository),
    });
    await writer.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    const created = await writer.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer integration-token" },
      payload: {
        name: "TeamSnap",
        url: "https://ical.example/team.ics",
        participantIDs: [(await writerRepository.accountForIdentity("integration-parent"))!.memberID],
        visibility: "family",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      ownerMemberID: (await writerRepository.accountForIdentity("integration-parent"))!.memberID,
      visibility: "family",
      status: "ready",
    });
    await writer.close();

    const readerRepository = repositoryForTest();
    const reader = buildApp({
      identityProvider,
      repository: readerRepository,
      calendarSources: moduleFor(readerRepository),
    });
    const sources = await reader.inject({
      method: "GET",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer integration-token" },
    });
    const events = await reader.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer integration-token" },
    });
    expect(sources.json()).toEqual([
      expect.objectContaining({ name: "TeamSnap", visibility: "family", status: "ready" }),
    ]);
    expect(events.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Persisted team practice", source: "calendar", readOnly: true }),
    ]));

    const inspectionPool = new Pool({ connectionString: databaseURL });
    const stored = await inspectionPool.query<{
      source_name: string;
      event_title: string;
      external_uid: string;
      feed_url_ciphertext: string;
    }>(
      `SELECT source.name AS source_name, source.feed_url_ciphertext,
              event.title AS event_title, event.external_uid
       FROM calendar_sources source
       JOIN imported_calendar_events event
         ON event.family_id = source.family_id AND event.source_id = source.id
       WHERE source.id = $1`,
      [created.json().id],
    );
    await inspectionPool.end();
    expect(stored.rows[0]?.source_name).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.event_title).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.external_uid).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.feed_url_ciphertext).toMatch(/^rr1\.1\./);
    expect(stored.rows[0]?.source_name).not.toContain("TeamSnap");
    expect(stored.rows[0]?.event_title).not.toContain("Persisted team practice");
    expect(stored.rows[0]?.external_uid).not.toContain("persisted-calendar@example");
    await reader.close();
  });

  it("redeems invitations atomically and isolates them from another family", async () => {
    const repository = repositoryForTest();
    const app = buildApp({ identityProvider, repository });
    await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer integration-token" },
      payload: { role: "kid", email: "child@example.com", guardianConsent: true },
    });
    expect(invitation.statusCode).toBe(201);

    await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "other-oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    const isolatedList = await app.inject({
      method: "GET",
      url: "/v1/invitations",
      headers: { authorization: "Bearer other-token" },
    });
    const isolatedDelete = await app.inject({
      method: "DELETE",
      url: `/v1/invitations/${invitation.json().id}`,
      headers: { authorization: "Bearer other-token" },
    });
    expect(isolatedList.json()).toEqual([]);
    expect(isolatedDelete.statusCode).toBe(404);

    const inspectionPool = new Pool({ connectionString: databaseURL });
    const storedInvitation = await inspectionPool.query<{ recipient_email: string }>(
      "SELECT recipient_email FROM family_invitations WHERE id = $1",
      [invitation.json().id],
    );
    await inspectionPool.end();
    expect(storedInvitation.rows[0]?.recipient_email).toMatch(/^rr1\.1\./);
    expect(storedInvitation.rows[0]?.recipient_email).not.toContain("child@example.com");

    const joined = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "child-oauth-token",
        codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
        invitationCode: invitation.json().code,
      },
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().role).toBe("kid");
    const pending = await app.inject({
      method: "GET",
      url: "/v1/invitations",
      headers: { authorization: "Bearer integration-token" },
    });
    expect(pending.json()).toEqual([]);
    await app.close();
  });

  it("atomically moves an existing account and device from an empty accidental family", async () => {
    const repository = repositoryForTest();
    const app = buildApp({ identityProvider, repository });
    const owner = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    const accidental = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "recovery-oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    const oldAccount = await repository.accountForIdentity("invitation-recovery-parent");
    expect(oldAccount).not.toBeNull();
    expect(oldAccount?.familyID).not.toBe((await repository.accountForIdentity("integration-parent"))?.familyID);
    await repository.saveDeviceToken(oldAccount!.familyID, oldAccount!.memberID, "recovery-device-token");
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer integration-token" },
      payload: { role: "parent", email: "recovery@example.com" },
    });

    const recovered = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "recovery-oauth-token",
        codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
        invitationCode: invitation.json().code,
      },
    });

    expect(owner.statusCode).toBe(200);
    expect(accidental.statusCode).toBe(200);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ role: "parent", displayName: "Riley" });
    const recoveredAccount = await repository.accountForIdentity("invitation-recovery-parent");
    expect(recoveredAccount?.familyID).toBe((await repository.accountForIdentity("integration-parent"))?.familyID);
    expect(await repository.membersForFamily(oldAccount!.familyID)).toEqual([]);
    expect(await repository.deviceTokensForFamily(oldAccount!.familyID)).toEqual([]);
    expect(await repository.deviceTokensForMembers(
      recoveredAccount!.familyID,
      [recoveredAccount!.memberID],
    )).toEqual(["recovery-device-token"]);
    await app.close();
  });

  it("deletes personal calendars and transfers shared calendars when their owner deletes their account", async () => {
    const data = repositoryForTest();
    const calendarSources = new CalendarSourceModule({
      repository: data,
      protectURL: (url) => `encrypted:${url}`,
      revealURL: (url) => url.replace(/^encrypted:/, ""),
      fetchFeed: async () => ({ body: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n" }),
    });
    const app = buildApp({ identityProvider, repository: data, calendarSources });
    const ownerSession = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "deleting-owner-oauth-token",
        codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
      },
    });
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer deleting-owner-token" },
      payload: { role: "parent", email: "successor@example.com" },
    });
    const successorSession = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "successor-oauth-token",
        codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
        invitationCode: invitation.json().code,
      },
    });
    const participantIDs = [ownerSession.json().accountID, successorSession.json().accountID];
    const connect = (name: string, visibility: "personal" | "family") => app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer deleting-owner-token" },
      payload: {
        name,
        url: `https://ical.example/${name.toLowerCase()}.ics`,
        participantIDs,
        visibility,
      },
    });
    await connect("Personal", "personal");
    await connect("Shared", "family");

    expect((await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { authorization: "Bearer deleting-owner-token" },
    })).statusCode).toBe(204);
    const remaining = await app.inject({
      method: "GET",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer successor-token" },
    });

    expect(remaining.json()).toEqual([
      expect.objectContaining({
        name: "Shared",
        visibility: "family",
        ownerMemberID: successorSession.json().accountID,
      }),
    ]);
    await app.close();
  });

  it("deletes the complete PostgreSQL family dataset for its last account", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("deletion-subject", "Delete Me");
    await data.saveEvent({
      id: "00000000-0000-4000-8000-000000000199",
      familyID: account.familyID,
      title: "Delete this event",
      kidID: null,
      participantIDs: [account.memberID],
      startTime: "2026-09-20T18:00:00Z",
      endTime: "2026-09-20T19:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
    });

    await data.deleteAccount("deletion-subject");

    expect(await data.accountForIdentity("deletion-subject")).toBeNull();
    expect(await data.membersForFamily(account.familyID)).toEqual([]);
    expect(await data.eventsForFamily(account.familyID)).toEqual([]);
  });
});
