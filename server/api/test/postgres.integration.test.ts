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
let databaseURL = "";
let adminPool: Pool;
const repositories: PostgresRallyrooRepository[] = [];

function repositoryForTest(): PostgresRallyrooRepository {
  const repository = PostgresRallyrooRepository.fromConnectionString(databaseURL);
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

    const saved = await writer.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000099",
      headers: { authorization: "Bearer integration-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000099",
        title: "Integration rehearsal",
        kidID: null,
        participantIDs: [],
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
    await reader.close();
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
