import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { CalendarSourceModule } from "../src/calendar-source-module.js";
import { CommuterModule } from "../src/commuter-module.js";
import type { CaltrainStaticScheduleSnapshot } from "../src/caltrain-static-schedule.js";
import type { IdentityProvider } from "../src/identity-provider.js";
import { PostgresRallyrooRepository } from "../src/postgres-repository.js";
import { NotificationCenterModule } from "../src/notification-center.js";
import type { FamilyEvent } from "../src/domain.js";
import { ShoppingModule, ShoppingModuleError } from "../src/shopping-module.js";

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

  it("persists Shopping catalog details encrypted and preserves idempotent resource updates", async () => {
    const repository = repositoryForTest();
    const account = await repository.provisionParentAccount("shopping-parent", "Shopping Parent");
    const shopping = new ShoppingModule(repository, () => new Date("2026-10-01T12:00:00.000Z"));
    const routineID = "10000000-0000-4000-8000-000000000001";
    const itemID = "20000000-0000-4000-8000-000000000001";

    await shopping.saveRoutine(account, routineID, {
      storeName: "Private Market",
      intervalWeeks: 2,
      preferredWeekday: 6,
    });
    await shopping.saveRoutine(account, routineID, {
      storeName: "Private Market",
      intervalWeeks: 3,
      preferredWeekday: 7,
    });
    await shopping.savePantryItem(account, itemID, {
      name: "Secret cereal",
      category: "Breakfast",
      unit: "boxes",
      critical: false,
      expectedDurationDays: 14,
      minimumQuantity: 1,
      targetQuantity: 3,
      routineIDs: [routineID],
    });

    expect(await shopping.catalog(account)).toMatchObject({
      routines: [{ id: routineID, storeName: "Private Market", intervalWeeks: 3 }],
      items: [{ id: itemID, name: "Secret cereal", routineIDs: [routineID] }],
    });
    const requestID = "30000000-0000-4000-8000-000000000001";
    const observationID = "40000000-0000-4000-8000-000000000001";
    const request = await shopping.requestItem(account, requestID, {
      itemID, quantity: 2, note: "Private request note",
    });
    const observation = await shopping.observeStock(account, observationID, itemID, {
      level: "low", quantity: 0.5, note: "Private observation note",
    });
    expect(await shopping.evidence(account)).toEqual({
      openRequests: [request], latestObservations: [observation],
    });
    await shopping.closeRequest(account, requestID, "resolved");
    expect((await shopping.evidence(account)).openRequests).toEqual([]);

    const inspection = new Pool({ connectionString: databaseURL });
    try {
      const stored = await inspection.query<{ details_ciphertext: string }>(
        `SELECT details_ciphertext FROM shopping_routines WHERE family_id = $1
         UNION ALL
         SELECT details_ciphertext FROM pantry_items WHERE family_id = $1
         UNION ALL
         SELECT details_ciphertext FROM shopping_item_requests WHERE family_id = $1
         UNION ALL
         SELECT details_ciphertext FROM stock_observations WHERE family_id = $1`,
        [account.familyID],
      );
      expect(stored.rows).toHaveLength(4);
      for (const row of stored.rows) expect(row.details_ciphertext).toMatch(/^rr1\./);
      expect(stored.rows.map((row) => row.details_ciphertext).join(" ")).not.toContain("Private Market");
      expect(stored.rows.map((row) => row.details_ciphertext).join(" ")).not.toContain("Secret cereal");
      expect(stored.rows.map((row) => row.details_ciphertext).join(" ")).not.toContain("Private request note");
      expect(stored.rows.map((row) => row.details_ciphertext).join(" ")).not.toContain("Private observation note");
    } finally {
      await inspection.end();
    }
  });

  it("preserves concurrent Shopping evidence writes and resolves resource-ID replays", async () => {
    const firstRepository = repositoryForTest();
    const secondRepository = repositoryForTest();
    const account = await firstRepository.provisionParentAccount(
      "shopping-evidence-concurrency-parent",
      "Shopping Parent",
    );
    const first = new ShoppingModule(
      firstRepository,
      () => new Date("2026-10-02T12:00:00.000Z"),
    );
    const second = new ShoppingModule(
      secondRepository,
      () => new Date("2026-10-03T12:00:00.000Z"),
    );
    const itemID = "20000000-0000-4000-8000-000000000021";
    const requestID = "30000000-0000-4000-8000-000000000021";
    await first.savePantryItem(account, itemID, {
      name: "Concurrent milk", critical: false, routineIDs: [],
    });

    const requests = await Promise.all([
      first.requestItem(account, requestID, { itemID, quantity: 1, note: "Shared request" }),
      second.requestItem(account, requestID, { itemID, quantity: 1, note: "Shared request" }),
    ]);
    expect(requests[0]).toEqual(requests[1]);

    await Promise.all([
      first.observeStock(account, "40000000-0000-4000-8000-000000000021", itemID, {
        level: "enough", quantity: 1, note: null,
      }),
      second.observeStock(account, "40000000-0000-4000-8000-000000000022", itemID, {
        level: "out", quantity: 0, note: null,
      }),
    ]);
    const evidence = await first.evidence(account);
    expect(evidence.openRequests).toHaveLength(1);
    expect(evidence.latestObservations).toMatchObject([{ itemID, level: "out" }]);
  });

  it("persists encrypted Shopping trip plans and rejects concurrent stale reviews", async () => {
    const firstRepository = repositoryForTest();
    const secondRepository = repositoryForTest();
    const account = await firstRepository.provisionParentAccount(
      "shopping-trip-parent",
      "Shopping Parent",
    );
    const first = new ShoppingModule(
      firstRepository,
      () => new Date("2026-10-10T12:00:00.000Z"),
    );
    const second = new ShoppingModule(
      secondRepository,
      () => new Date("2026-10-10T13:00:00.000Z"),
    );
    const routineID = "10000000-0000-4000-8000-000000000031";
    const itemID = "20000000-0000-4000-8000-000000000031";
    const tripID = "50000000-0000-4000-8000-000000000031";
    await first.saveRoutine(account, routineID, {
      storeName: "Private trip store", intervalWeeks: 1, preferredWeekday: null,
    });
    await first.savePantryItem(account, itemID, {
      name: "Private trip item", critical: false, routineIDs: [routineID],
    });
    const [draft, duplicate] = await Promise.all([
      first.prepareTrip(account, tripID, routineID, "2026-10-11"),
      second.prepareTrip(account, "50000000-0000-4000-8000-000000000032", routineID, "2026-10-11"),
    ]);
    expect(duplicate).toEqual(draft);

    const reviews = await Promise.allSettled([
      first.reviewTrip(account, tripID, {
        expectedVersion: draft.version,
        entries: [{ itemID, decision: "buy" }],
      }),
      second.reviewTrip(account, tripID, {
        expectedVersion: draft.version,
        entries: [{ itemID, decision: "skip" }],
      }),
    ]);
    expect(reviews.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(reviews.filter((result) => result.status === "rejected")).toHaveLength(1);
    const reviewed = (await first.trips(account))[0]!;
    const finalized = await first.finalizeTrip(account, tripID, reviewed.version);
    const kid = { ...account, memberID: "unpersisted-kid", role: "kid" as const };
    await expect(second.trips(kid)).resolves.toEqual([finalized]);
    await expect(first.deletePantryItem(account, itemID))
      .rejects.toEqual(new ShoppingModuleError("shopping_trip_catalog_in_use"));
    await expect(first.deleteRoutine(account, routineID))
      .rejects.toEqual(new ShoppingModuleError("shopping_trip_catalog_in_use"));

    const inspection = new Pool({ connectionString: databaseURL });
    try {
      const stored = await inspection.query<{ details_ciphertext: string }>(
        "SELECT details_ciphertext FROM shopping_trip_plans WHERE family_id = $1 AND id = $2",
        [account.familyID, tripID],
      );
      expect(stored.rows[0]?.details_ciphertext).toMatch(/^rr1\./);
      expect(stored.rows[0]?.details_ciphertext).not.toContain("Parent decision");
      expect(stored.rows[0]?.details_ciphertext).not.toContain("Private trip item");
    } finally {
      await inspection.end();
    }
  });

  it("atomically completes a Shopping trip once and encrypts Purchase details", async () => {
    const first = repositoryForTest();
    const second = repositoryForTest();
    const account = await first.provisionParentAccount("purchase-parent", "Parent");
    const shopping = new ShoppingModule(first, () => new Date("2026-10-11T12:00:00Z"));
    const routineID = "10000000-0000-4000-8000-000000000055";
    const itemID = "20000000-0000-4000-8000-000000000055";
    const tripID = "50000000-0000-4000-8000-000000000055";
    await shopping.saveRoutine(account, routineID, {
      storeName: "Market", intervalWeeks: 1, preferredWeekday: null,
    });
    await shopping.savePantryItem(account, itemID, {
      name: "Rice", critical: false, routineIDs: [routineID],
    });
    const draft = await shopping.prepareTrip(account, tripID, routineID, "2026-10-11");
    const finalized = await shopping.finalizeTrip(account, tripID, draft.version);
    const outcomes = [{ itemID, status: "purchased" as const, quantity: 3, price: 12.75 }];
    const results = await Promise.allSettled([
      shopping.completeTrip(account, tripID, finalized.version, outcomes),
      new ShoppingModule(second).completeTrip(account, tripID, finalized.version, outcomes),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const purchases = await second.purchases(account.familyID);
    expect(purchases).toMatchObject([{ tripID, itemID, quantity: 3, price: 12.75 }]);
    expect((await second.trips(account.familyID))[0]).toMatchObject({
      status: "completed", outcomes: [{ status: "purchased" }],
    });
    expect((await shopping.evidence(account)).latestObservations).toEqual([]);

    const inspection = new Pool({ connectionString: databaseURL });
    try {
      const stored = await inspection.query<{ details_ciphertext: string }>(
        `SELECT details_ciphertext FROM shopping_purchases WHERE family_id = $1
         UNION ALL SELECT details_ciphertext FROM shopping_trip_plans WHERE family_id = $1`,
        [account.familyID],
      );
      expect(stored.rows).toHaveLength(2);
      for (const row of stored.rows) {
        expect(row.details_ciphertext).toMatch(/^rr1\./);
        expect(row.details_ciphertext).not.toContain("12.75");
      }
    } finally {
      await inspection.end();
    }
  });

  it("serializes concurrent normalized Shopping names inside protected persistence", async () => {
    const firstRepository = repositoryForTest();
    const secondRepository = repositoryForTest();
    const account = await firstRepository.provisionParentAccount(
      "shopping-concurrency-parent",
      "Shopping Parent",
    );
    const first = new ShoppingModule(firstRepository);
    const second = new ShoppingModule(secondRepository);

    const outcomes = await Promise.allSettled([
      first.saveRoutine(account, "10000000-0000-4000-8000-000000000011", {
        storeName: "Costco",
        intervalWeeks: 2,
        preferredWeekday: null,
      }),
      second.saveRoutine(account, "10000000-0000-4000-8000-000000000012", {
        storeName: "  COSTCO  ",
        intervalWeeks: 2,
        preferredWeekday: null,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await first.catalog(account)).routines).toHaveLength(1);
  });

  it("persists private Day brief preferences and encrypted idempotent briefs", async () => {
    const repository = repositoryForTest();
    const account = await repository.provisionParentAccount("day-brief-parent", "Day Brief Parent");
    await repository.savePreferences({
      familyID: account.familyID,
      memberID: account.memberID,
      enabled: true,
      timeZone: "America/Los_Angeles",
      weekdayTime: "07:00",
      weekendHolidayTime: "08:30",
      earlyEventLeadMinutes: 60,
      holidayRegion: "US",
    });
    expect(await repository.preferences(account.familyID, account.memberID)).toMatchObject({
      weekdayTime: "07:00",
      weekendHolidayTime: "08:30",
      holidayRegion: "US",
    });

    const record = {
      familyID: account.familyID,
      memberID: account.memberID,
      localDate: "2026-10-05",
      timeZone: "America/Los_Angeles",
      facts: { events: [], reminders: [] },
      title: "Private Day title",
      body: "Private Day details",
      generatedAt: "2026-10-05T14:00:00.000Z",
    };
    const insertions = await Promise.all([
      repository.saveDayBriefIfAbsent(record),
      repository.saveDayBriefIfAbsent(record),
    ]);
    expect(insertions.sort()).toEqual([false, true]);
    expect(await repository.dayBrief(account.familyID, account.memberID, record.localDate))
      .toEqual(record);

    const inspection = new Pool({ connectionString: databaseURL });
    try {
      const stored = await inspection.query<{ details_ciphertext: string }>(
        `SELECT details_ciphertext FROM day_briefs
         WHERE family_id = $1 AND member_id = $2`,
        [account.familyID, account.memberID],
      );
      expect(stored.rows[0]!.details_ciphertext).toMatch(/^rr1\./);
      expect(stored.rows[0]!.details_ciphertext).not.toContain("Private Day");
    } finally {
      await inspection.end();
    }
  });

  it("atomically persists the last-good static Caltrain schedule", async () => {
    const repository = repositoryForTest();
    const snapshot: CaltrainStaticScheduleSnapshot = {
      observedAt: "2026-08-10T00:00:00.000Z",
      version: "integration-v1",
      timeZone: "America/Los_Angeles",
      validFrom: "2026-08-01",
      validUntil: "2026-12-31",
      stops: [
        {
          id: "A-N", stationID: "A", stationName: "Alpha", direction: "northbound",
          latitude: 37, longitude: -122,
          validFrom: "2026-08-01T00:00:00.000Z", validUntil: "2026-12-31T23:59:59.999Z",
        },
        {
          id: "B-N", stationID: "B", stationName: "Beta", direction: "northbound",
          latitude: 38, longitude: -122,
          validFrom: "2026-08-01T00:00:00.000Z", validUntil: "2026-12-31T23:59:59.999Z",
        },
      ],
      services: [{
        id: "a".repeat(64), weekdays: [1, 2, 3, 4, 5],
        startsOn: "2026-08-01", endsOn: "2026-12-31", addedDates: [], removedDates: [],
      }],
      journeys: [{
        id: "b".repeat(64), serviceID: "a".repeat(64), routeID: "c".repeat(64),
        direction: "northbound",
        calls: [
          { stopID: "A-N", sequence: 1, arrivalSeconds: 25_140, departureSeconds: 25_200 },
          { stopID: "B-N", sequence: 2, arrivalSeconds: 27_000, departureSeconds: 27_060 },
        ],
      }],
    };

    await repository.replaceCaltrainSchedule(snapshot, snapshot.observedAt);
    const reader = repositoryForTest();
    expect(await reader.caltrainSchedule()).toEqual(snapshot);
    await reader.replaceCaltrainSchedule(
      { ...snapshot, observedAt: "2026-08-09T00:00:00.000Z", version: "older" },
      "2026-08-09T00:00:00.000Z",
    );
    expect((await repository.caltrainSchedule())?.version).toBe("integration-v1");
  });

  it("persists encrypted member inbox records with idempotent replay", async () => {
    const repository = repositoryForTest();
    const app = buildApp({ identityProvider, repository });
    await app.inject({
      method: "POST", url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    await app.close();
    const account = await repository.accountForIdentity("integration-parent");
    expect(account).not.toBeNull();
    const center = new NotificationCenterModule(repository);
    const intent = {
      familyID: account!.familyID,
      recipientMemberIDs: [account!.memberID],
      kind: "schedule_update" as const,
      deduplicationKey: "event-1:update-1",
      title: "Private family title",
      body: "Private family details",
      destination: { kind: "event" as const, id: "event-1" },
      occurredAt: new Date("2030-09-10T16:00:00Z"),
    };

    const first = await center.record(intent);
    const replay = await center.record(intent);
    expect(replay[0]?.id).toBe(first[0]?.id);
    const rawPool = new Pool({ connectionString: databaseURL });
    const raw = await rawPool.query<{ details_ciphertext: string }>(
      "SELECT details_ciphertext FROM member_notification_inbox WHERE id = $1", [first[0]!.id],
    );
    await rawPool.end();
    expect(raw.rows[0]?.details_ciphertext).toMatch(/^rr1\./);
    expect(raw.rows[0]?.details_ciphertext).not.toContain("Private family");
    expect((await center.list(account!))[0]).toMatchObject({
      title: "Private family title", body: "Private family details", readAt: null,
    });
    const claimAt = new Date(Date.now() + 60_000);
    const [claim] = await repository.claimNotificationDeliveries(claimAt, 10, [first[0]!.id]);
    expect(claim?.record.id).toBe(first[0]!.id);
    await repository.releaseNotificationDelivery(
      claim!.record.id, claim!.claimedAt, "provider_unavailable", claimAt,
    );
    expect(await repository.claimNotificationDeliveries(claimAt, 10, [first[0]!.id])).toEqual([]);
    const [retry] = await repository.claimNotificationDeliveries(
      new Date(claimAt.getTime() + 60 * 60_000), 10, [first[0]!.id],
    );
    expect(retry?.attemptCount).toBe(2);
    await repository.completeNotificationDelivery(
      retry!.record.id, retry!.claimedAt, "delivered", new Date(claimAt.getTime() + 60 * 60_000),
    );
  });

  it("prunes member inbox records after the retention window", async () => {
    const repository = repositoryForTest();
    const app = buildApp({ identityProvider, repository });
    await app.inject({
      method: "POST", url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" },
    });
    await app.close();
    const account = await repository.accountForIdentity("integration-parent");
    const center = new NotificationCenterModule(repository);
    const [expired] = await center.record({
      familyID: account!.familyID,
      recipientMemberIDs: [account!.memberID],
      kind: "schedule_update",
      deduplicationKey: "expired-event:update-1",
      title: "Expired update",
      body: "This update is outside the retention window.",
      destination: { kind: "event", id: "expired-event" },
      occurredAt: new Date("2030-01-01T00:00:00Z"),
    });

    expect(await center.prune(new Date("2030-07-01T00:00:01Z"))).toBe(1);
    expect((await center.list(account!)).map((record) => record.id)).not.toContain(expired!.id);
  });

  it("persists encrypted Commuter state and durable alert deduplication", async () => {
    const writerRepository = repositoryForTest();
    const app = buildApp({
      identityProvider,
      repository: writerRepository,
      readinessCheck: () => writerRepository.checkReadiness(),
    });
    await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "oauth-token",
        codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
      },
    });
    await app.close();
    const account = await writerRepository.accountForIdentity("integration-parent");
    expect(account).not.toBeNull();
    const writer = new CommuterModule(writerRepository);
    await writer.enable(account!);
    const subscription = await writer.createSubscription(account!, {
      visibility: "personal",
      agencyID: "CT",
      routeID: "caltrain-local",
      directionID: "northbound",
      originStopID: "70171",
      destinationStopID: "70011",
      serviceWeekdays: [1, 2, 3, 4, 5],
      windowStartMinutes: 420,
      windowEndMinutes: 540,
      alertKinds: ["delay", "cancellation"],
      minimumDelayMinutes: 15,
    });

    const rawPool = new Pool({ connectionString: databaseURL });
    const stored = await rawPool.query<{ details_ciphertext: string }>(
      "SELECT details_ciphertext FROM commuter_subscriptions WHERE id = $1",
      [subscription.id],
    );
    await rawPool.end();
    expect(stored.rows[0]?.details_ciphertext).toMatch(/^rr1\./);
    expect(stored.rows[0]?.details_ciphertext).not.toContain("70171");

    const readerRepository = repositoryForTest();
    const reader = new CommuterModule(readerRepository);
    expect((await reader.state(account!)).subscriptions).toEqual([subscription]);
    const condition = {
      id: "trip-123:2030-09-09",
      agencyID: "CT" as const,
      routeID: "caltrain-local",
      directionID: "northbound",
      stopIDs: ["70171", "70011"],
      serviceWeekday: 3,
      scheduledMinutes: 480,
      kind: "delay" as const,
      delayMinutes: 20,
      observedAt: "2030-09-09T14:59:00Z",
      validUntil: "2030-09-10T15:02:00Z",
    };
    expect(await writer.processTransitConditions(
      [condition],
      new Date("2030-09-09T15:00:00Z"),
    )).toHaveLength(1);
    const alertPool = new Pool({ connectionString: databaseURL });
    const storedAlert = await alertPool.query<{ details_ciphertext: string; status: string }>(
      "SELECT details_ciphertext, status FROM commuter_alert_outbox WHERE subscription_id = $1",
      [subscription.id],
    );
    await alertPool.end();
    expect(storedAlert.rows[0]?.details_ciphertext).toMatch(/^rr1\./);
    expect(storedAlert.rows[0]?.details_ciphertext).not.toContain(condition.id);
    expect(storedAlert.rows[0]?.status).toBe("pending");

    const dispatchAt = new Date("2030-09-09T15:01:00Z");
    const expiredAlertID = randomUUID();
    await writerRepository.saveAlertsIfAbsent([{
      id: expiredAlertID,
      subscriptionID: subscription.id,
      familyID: account!.familyID,
      conditionID: "expired-condition",
      kind: "cancellation",
      delayMinutes: 0,
      expiresAt: new Date(dispatchAt.getTime() - 1).toISOString(),
      audience: { kind: "member", memberID: account!.memberID },
    }]);
    const claimed = await readerRepository.claimDueCommuteAlerts(dispatchAt, 10);
    expect(claimed).toHaveLength(1);
    const [claimedAlert] = claimed;
    expect(claimedAlert).toMatchObject({
      subscriptionID: subscription.id,
      familyID: account!.familyID,
      kind: "delay",
      delayMinutes: 20,
      audience: { kind: "member", memberID: account!.memberID },
      attemptCount: 1,
      claimedAt: dispatchAt,
    });
    const expiredPool = new Pool({ connectionString: databaseURL });
    const expired = await expiredPool.query<{ status: string }>(
      "SELECT status FROM commuter_alert_outbox WHERE id = $1",
      [expiredAlertID],
    );
    await expiredPool.end();
    expect(expired.rows[0]?.status).toBe("failed");

    await readerRepository.releaseCommuteAlertClaim(claimedAlert!, dispatchAt);
    expect(await readerRepository.claimDueCommuteAlerts(new Date(dispatchAt.getTime() + 29_000), 10)).toEqual([]);
    const [retriedAlert] = await readerRepository.claimDueCommuteAlerts(
      new Date(dispatchAt.getTime() + 30_000),
      10,
    );
    expect(retriedAlert).toMatchObject({ id: claimedAlert!.id, attemptCount: 2 });
    await readerRepository.markCommuteAlertDelivered(
      retriedAlert!,
      new Date(dispatchAt.getTime() + 31_000),
    );
    const deliveryPool = new Pool({ connectionString: databaseURL });
    const delivery = await deliveryPool.query<{ status: string; claimed_at: Date | null }>(
      "SELECT status, claimed_at FROM commuter_alert_outbox WHERE id = $1",
      [claimedAlert!.id],
    );
    await deliveryPool.end();
    expect(delivery.rows[0]).toMatchObject({ status: "delivered", claimed_at: null });

    const retryLimitPool = new Pool({ connectionString: databaseURL });
    await retryLimitPool.query(
      `UPDATE commuter_alert_outbox
       SET status = 'pending', attempt_count = 7, next_attempt_at = $2, delivered_at = NULL
       WHERE id = $1`,
      [claimedAlert!.id, dispatchAt.toISOString()],
    );
    await retryLimitPool.end();
    const [lastAttempt] = await readerRepository.claimDueCommuteAlerts(
      new Date(dispatchAt.getTime() + 60_000),
      10,
    );
    expect(lastAttempt).toMatchObject({ attemptCount: 8 });
    await readerRepository.releaseCommuteAlertClaim(
      lastAttempt!,
      new Date(dispatchAt.getTime() + 60_000),
    );
    const failedPool = new Pool({ connectionString: databaseURL });
    const failed = await failedPool.query<{ status: string }>(
      "SELECT status FROM commuter_alert_outbox WHERE id = $1",
      [claimedAlert!.id],
    );
    await failedPool.end();
    expect(failed.rows[0]?.status).toBe("failed");

    expect(await reader.processTransitConditions(
      [condition],
      new Date("2026-09-09T15:01:00Z"),
    )).toEqual([]);
    await writer.recordProviderSuccess("catalog", new Date("2026-09-09T15:00:00Z"));
    await writer.recordProviderSuccess("realtime", new Date("2026-09-09T15:00:00Z"));
    await reader.recordProviderFailure("realtime", new Date("2026-09-09T15:01:00Z"));
    expect(await reader.providerStatus(new Date("2026-09-09T15:01:00Z"))).toMatchObject({
      catalog: { state: "healthy" },
      realtime: { state: "degraded", lastSuccessAt: "2026-09-09T15:00:00.000Z" },
    });
    await writer.replaceCatalog({
      observedAt: "2026-09-09T14:59:00.000Z",
      stops: [{
        id: "70171",
        stationID: "palo_alto",
        stationName: "Palo Alto",
        direction: "northbound",
        latitude: 37.443,
        longitude: -122.1649,
        validFrom: "2026-01-31T08:00:00.000Z",
        validUntil: "2027-02-01T07:59:00.000Z",
      }],
    }, new Date("2026-09-09T15:02:00Z"));
    expect(await reader.catalog(new Date("2026-09-09T15:02:00Z"))).toMatchObject({
      status: { state: "healthy" },
      observedAt: "2026-09-09T14:59:00.000Z",
      stops: [{ id: "70171", stationName: "Palo Alto" }],
    });
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
        arrivalTime: "2026-09-01T17:30:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
        alertLeadTimeMinutes: 30,
        recurrence: {
          frequency: "weekly",
          interval: 1,
          weekdays: [2],
          endDate: "2027-03-01T18:00:00Z",
        },
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
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
      expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000099",
        title: "Integration rehearsal",
        arrivalTime: "2026-09-01T17:30:00.000Z",
        alertLeadTimeMinutes: 30,
        recurrence: expect.objectContaining({ frequency: "weekly", weekdays: [2] }),
      }),
    ]);

    const inspectionPool = new Pool({ connectionString: databaseURL });
    const stored = await inspectionPool.query<{
      title: string;
      start_time: Date;
      end_time: Date;
      arrival_time: Date;
      wrapped_key: string;
      result: unknown | null;
      result_ciphertext: string | null;
      notification_title: string;
      notification_body: string;
    }>(
      `SELECT event.title, event.start_time, event.end_time, event.arrival_time,
              family_key.wrapped_key,
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
    expect(stored.rows[0]?.arrival_time.toISOString()).toBe("2026-09-01T17:30:00.000Z");
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
        arrivalTime: null,
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
        recurrenceFrequency: null,
        recurrenceInterval: null,
        recurrenceWeekdays: [],
        recurrenceEndDate: null,
        recurrenceSeriesID: null,
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

  it("atomically replaces recurring-series rows and replays the mutation receipt", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("recurring-edit-parent", "Editor");
    const seriesID = "abcdefab-cdef-4abc-8def-abcdefabc310";
    const obsoleteID = "abcdefab-cdef-4abc-8def-abcdefabc311";
    const newID = "abcdefab-cdef-4abc-8def-abcdefabc312";
    const source: FamilyEvent = {
      id: seriesID,
      familyID: account.familyID,
      title: "Practice",
      kidID: null,
      participantIDs: [account.memberID],
      startTime: "2026-09-10T15:00:00Z",
      endTime: "2026-09-10T16:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
      recurrenceSeriesID: seriesID,
      recurrence: {
        frequency: "weekly", interval: 1, weekdays: [4], endDate: "2026-12-31T15:00:00Z",
      },
    };
    await data.saveEvent(source);
    await data.saveEvent({
      ...source,
      id: obsoleteID,
      startTime: "2026-09-17T15:00:00Z",
      endTime: "2026-09-17T16:00:00Z",
    });
    const replacement = { ...source, title: "Carpool" };
    const generated = {
      ...replacement,
      id: newID,
      startTime: "2026-09-24T15:00:00Z",
      endTime: "2026-09-24T16:00:00Z",
    };

    const idempotencyKey = "abcdefab-cdef-4abc-8def-abcdefabc313";
    const first = await data.performEventMutation(account.familyID, idempotencyKey, () => ({
      action: {
        kind: "replaceRecurringSeries",
        events: [replacement, generated],
        deleteIDs: [obsoleteID],
      },
      result: { conflicts: [], notificationOutcome: "notRequested" },
      occurrenceOverride: {
        reference: {
          kind: "event",
          seriesID,
          scheduledAt: "2026-09-17T15:00:00.000Z",
        },
        overrideEntityID: newID,
      },
    }));
    const replay = await data.performEventMutation(account.familyID, idempotencyKey, () => {
      throw new Error("idempotent replay must not rebuild the plan");
    });

    expect(replay).toEqual(first);
    const rows = await data.eventsForFamily(account.familyID);
    expect(rows.map((event) => event.id).sort()).toEqual([newID, seriesID].sort());
    expect(rows.every((event) => event.recurrenceSeriesID === seriesID)).toBe(true);
    expect(await data.occurrenceStatesForFamily(account.familyID)).toEqual([
      expect.objectContaining({
        reference: {
          kind: "event",
          seriesID,
          scheduledAt: "2026-09-17T15:00:00.000Z",
        },
        overrideEntityID: newID,
      }),
    ]);
  });

  it("atomically records concurrent Member acknowledgements for one occurrence", async () => {
    const first = repositoryForTest();
    const second = repositoryForTest();
    const account = await first.provisionParentAccount("occurrence-parent", "Parent");
    await first.saveMember({
      id: "kid-occurrence", familyID: account.familyID, name: "Kid",
      role: "kid", colorTag: "purple",
    });
    const reference = {
      kind: "event" as const, seriesID: "abcdefab-cdef-4abc-8def-abcdefabc399",
      scheduledAt: "2026-09-17T00:30:00.000Z",
    };
    await Promise.all([
      first.acknowledgeOccurrence(account.familyID, reference, account.memberID),
      second.acknowledgeOccurrence(account.familyID, reference, "kid-occurrence"),
    ]);
    const state = await first.acknowledgeOccurrence(account.familyID, reference, account.memberID);
    expect(state.acknowledgedMemberIDs).toEqual(["kid-occurrence", account.memberID].sort());
    expect(state.disposition).toBe("scheduled");
  });

  it("does not claim a skipped recurring Event occurrence", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("skipped-event-parent", "Parent");
    const eventID = "abcdefab-cdef-4abc-8def-abcdefabc398";
    await data.saveEvent({
      id: eventID, familyID: account.familyID, title: "Daily practice", kidID: null,
      participantIDs: [account.memberID], startTime: "2026-09-10T15:00:00Z",
      endTime: "2026-09-10T16:00:00Z", location: null, driver: null,
      source: "manual", status: "confirmed", alertLeadTimeMinutes: 60,
      recurrenceSeriesID: eventID,
      recurrence: {
        frequency: "daily", interval: 1, timeZone: "UTC",
        endDate: "2026-09-12T15:00:00Z",
      },
    });
    await data.setOccurrenceDisposition(account.familyID, {
      kind: "event", seriesID: eventID, scheduledAt: "2026-09-11T15:00:00.000Z",
    }, "skipped");
    expect(await data.claimDueEventNotifications(new Date("2026-09-11T14:00:00Z"), 100))
      .toEqual([]);
  });

  it("does not claim a deleted recurring Event occurrence", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("deleted-event-parent", "Parent");
    const eventID = "abcdefab-cdef-4abc-8def-abcdefabc397";
    await data.saveEvent({
      id: eventID, familyID: account.familyID, title: "Daily practice", kidID: null,
      participantIDs: [account.memberID], startTime: "2026-09-10T15:00:00Z",
      endTime: "2026-09-10T16:00:00Z", location: null, driver: null,
      source: "manual", status: "confirmed", alertLeadTimeMinutes: 60,
      recurrenceSeriesID: eventID,
      recurrence: {
        frequency: "daily", interval: 1, timeZone: "UTC",
        endDate: "2026-09-12T15:00:00Z",
      },
    });
    await data.setOccurrenceDisposition(account.familyID, {
      kind: "event", seriesID: eventID, scheduledAt: "2026-09-11T15:00:00.000Z",
    }, "deleted");
    expect(await data.claimDueEventNotifications(new Date("2026-09-11T14:00:00Z"), 100))
        .toEqual([]);
    });

  it("skips all future occurrences via scoped disposition", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("scoped-skip-parent", "Parent");
    const eventID = "abcdefab-cdef-4abc-8def-abcdefabc400";
    await data.saveEvent({
      id: eventID, familyID: account.familyID, title: "Daily walk", kidID: null,
      participantIDs: [account.memberID], startTime: "2026-09-15T08:00:00.000Z",
      endTime: "2026-09-15T09:00:00.000Z", location: null, driver: null,
      source: "manual", status: "confirmed", alertLeadTimeMinutes: 60,
      recurrenceSeriesID: eventID,
      recurrence: {
        frequency: "daily", interval: 1, timeZone: "UTC",
        endDate: "2026-09-18T08:00:00.000Z",
        },
      });
    await data.setOccurrenceDisposition(account.familyID, {
      kind: "event", seriesID: eventID, scheduledAt: "2026-09-15T08:00:00.000Z",
      }, "skipped");
    const claimsAfterOneSkip = await data.claimDueEventNotifications(
        new Date("2026-09-16T07:00:00Z"), 100);
     expect(claimsAfterOneSkip.map((c) => c.occurrenceStart)).not.toEqual([]);
     for (const day of ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]) {
      await data.setOccurrenceDisposition(account.familyID, {
        kind: "event", seriesID: eventID, scheduledAt: `${day}T08:00:00.000Z`,
        }, "skipped");
      }
    const claimsAfterAllSkip = await data.claimDueEventNotifications(
        new Date("2026-09-16T07:00:00Z"), 100);
     expect(claimsAfterAllSkip).toEqual([]);
    await data.deleteEvent(account.familyID, eventID);
   });

  it("serializes concurrent scoped disposition writes on the same series", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("concurrency-skip-parent", "Parent");
    const eventID = "abcdefab-cdef-4abc-8def-abcdefabc401";
    await data.saveEvent({
      id: eventID, familyID: account.familyID, title: "Concurrent skip", kidID: null,
      participantIDs: [account.memberID], startTime: "2026-09-15T08:00:00.000Z",
      endTime: "2026-09-15T09:00:00.000Z", location: null, driver: null,
      source: "manual", status: "confirmed", alertLeadTimeMinutes: 60,
      recurrenceSeriesID: eventID,
      recurrence: {
        frequency: "daily", interval: 1, timeZone: "UTC",
        endDate: "2026-09-16T08:00:00.000Z",
        },
      });
    const ref15 = { kind: "event" as const, seriesID: eventID, scheduledAt: "2026-09-15T08:00:00.000Z" };
    const ref16 = { kind: "event" as const, seriesID: eventID, scheduledAt: "2026-09-16T08:00:00.000Z" };
    await Promise.all([
        data.setOccurrenceDisposition(account.familyID, ref15, "skipped"),
        data.setOccurrenceDisposition(account.familyID, ref16, "deleted"),
      ]);
    const states = await data.occurrenceStatesForFamily(account.familyID);
    const s15 = states.find((s) =>
        s.reference.seriesID === eventID &&
        s.reference.scheduledAt === "2026-09-15T08:00:00.000Z");
    const s16 = states.find((s) =>
        s.reference.seriesID === eventID &&
        s.reference.scheduledAt === "2026-09-16T08:00:00.000Z");
     expect(s15?.disposition).toBe("skipped");
     expect(s16?.disposition).toBe("deleted");
   await data.deleteEvent(account.familyID, eventID);
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
        timeZone: "UTC",
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

    const accidentalCommuter = new CommuterModule(repository);
    await accidentalCommuter.enable(oldAccount!);
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "recovery-oauth-token",
        codeVerifier: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
        invitationCode: invitation.json().code,
      },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: "invitation_account_conflict" });
    await accidentalCommuter.remove(oldAccount!);

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
    const ownerAccount = await data.accountForIdentity("deleting-calendar-owner");
    const commuter = new CommuterModule(data);
    await commuter.enable(ownerAccount!);
    await commuter.createSubscription(ownerAccount!, {
      visibility: "personal",
      agencyID: "CT",
      routeID: "personal-route",
      directionID: "northbound",
      originStopID: "70171",
      destinationStopID: "70011",
      serviceWeekdays: [1],
      windowStartMinutes: 420,
      windowEndMinutes: 540,
      alertKinds: ["delay"],
      minimumDelayMinutes: 15,
    });
    await commuter.createSubscription(ownerAccount!, {
      visibility: "family",
      agencyID: "CT",
      routeID: "shared-route",
      directionID: "northbound",
      originStopID: "70171",
      destinationStopID: "70011",
      serviceWeekdays: [1],
      windowStartMinutes: 420,
      windowEndMinutes: 540,
      alertKinds: ["delay"],
      minimumDelayMinutes: 15,
    });

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
    const successorAccount = await data.accountForIdentity("calendar-owner-successor");
    expect((await commuter.state(successorAccount!)).subscriptions).toEqual([
      expect.objectContaining({
        routeID: "shared-route",
        visibility: "family",
        ownerMemberID: successorSession.json().accountID,
      }),
    ]);
    await app.close();
  });

  it("deletes the complete PostgreSQL family dataset for its last account", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("deletion-subject", "Delete Me");
    const commuter = new CommuterModule(data);
    await commuter.enable(account);
    await commuter.createSubscription(account, {
      visibility: "personal",
      agencyID: "CT",
      routeID: "delete-route",
      directionID: "northbound",
      originStopID: "70171",
      destinationStopID: "70011",
      serviceWeekdays: [1],
      windowStartMinutes: 420,
      windowEndMinutes: 540,
      alertKinds: ["delay"],
      minimumDelayMinutes: 15,
    });
    const shopping = new ShoppingModule(data);
    await shopping.saveRoutine(account, "10000000-0000-4000-8000-000000000199", {
      storeName: "Delete this store",
      intervalWeeks: 1,
      preferredWeekday: null,
    });
    await shopping.savePantryItem(account, "20000000-0000-4000-8000-000000000199", {
      name: "Delete this item",
      critical: false,
      routineIDs: ["10000000-0000-4000-8000-000000000199"],
    });
    const deletionTrip = await shopping.prepareTrip(account,
      "50000000-0000-4000-8000-000000000199",
      "10000000-0000-4000-8000-000000000199", "2026-10-11");
    const finalizedTrip = await shopping.finalizeTrip(account, deletionTrip.id, deletionTrip.version);
    await shopping.completeTrip(account, finalizedTrip.id, finalizedTrip.version, [{
      itemID: "20000000-0000-4000-8000-000000000199",
      status: "purchased", quantity: 2, price: null,
    }]);
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
    expect(await shopping.catalog(account)).toEqual({ routines: [], items: [] });
    expect(await shopping.trips(account)).toEqual([]);
    expect(await commuter.state(account)).toMatchObject({ installation: null, subscriptions: [] });
  });

  it("serializes concurrent equivalent Saved place creation across repository instances", async () => {
    const firstRepository = repositoryForTest();
    const secondRepository = repositoryForTest();
    const account = await firstRepository.provisionParentAccount("saved-place-dedupe-parent", "Parent");
    const timestamp = "2026-09-15T00:00:00Z";
    const firstID = "00000000-0000-4000-8000-000000000241";
    const secondID = "00000000-0000-4000-8000-000000000242";

    const [first, second] = await Promise.all([
      firstRepository.saveSavedPlace({
        id: firstID,
        familyID: account.familyID,
        ownerMemberID: null,
        visibility: "family",
        label: "Home",
        waypoint: { address: "First address" },
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      secondRepository.saveSavedPlace({
        id: secondID,
        familyID: account.familyID,
        ownerMemberID: null,
        visibility: "family",
        label: "  HOME  ",
        waypoint: { address: "Second address" },
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ]);

    expect(first.id).toBe(second.id);
    expect(await firstRepository.savedPlacesForFamily(account.familyID)).toHaveLength(1);
  });

  it("encrypts and round-trips Saved places and Event travel plans", async () => {
    const data = repositoryForTest();
    const account = await data.provisionParentAccount("travel-parent", "Travel Parent");
    const eventID = "00000000-0000-4000-8000-000000000251";
    const placeID = "00000000-0000-4000-8000-000000000252";
    await data.saveEvent({
      id: eventID,
      familyID: account.familyID,
      title: "Travel event",
      kidID: null,
      participantIDs: [account.memberID],
      startTime: "2026-09-20T18:30:00Z",
      endTime: "2026-09-20T19:30:00Z",
      arrivalTime: "2026-09-20T18:00:00Z",
      location: "Secret destination",
      driver: null,
      driverMemberID: account.memberID,
      source: "manual",
      status: "confirmed",
    });
    await data.saveSavedPlace({
      id: placeID,
      familyID: account.familyID,
      ownerMemberID: account.memberID,
      visibility: "personal",
      label: "Secret Home",
      waypoint: { placeID: "SecretGooglePlaceID" },
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    });
    await data.saveTravelPlan({
      familyID: account.familyID,
      eventID,
      revision: 1,
      origin: { kind: "one_time", waypoint: { address: "Secret origin address" } },
      preparationMinutes: 20,
      trafficPreference: "best_guess",
      recipientMemberIDs: [account.memberID],
      leaveAlertEnabled: true,
      createdByMemberID: account.memberID,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    });

    const inspection = new Pool({ connectionString: databaseURL });
    try {
      const placeRow = await inspection.query<{ details_ciphertext: string }>(
        "SELECT details_ciphertext FROM saved_places WHERE family_id = $1 AND id = $2::uuid",
        [account.familyID, placeID],
      );
      const planRow = await inspection.query<{ details_ciphertext: string }>(
        "SELECT details_ciphertext FROM event_travel_plans WHERE family_id = $1 AND event_id = $2::uuid",
        [account.familyID, eventID],
      );
      expect(placeRow.rows[0]!.details_ciphertext).toMatch(/^rr1\./);
      expect(placeRow.rows[0]!.details_ciphertext).not.toContain("Secret Home");
      expect(placeRow.rows[0]!.details_ciphertext).not.toContain("SecretGooglePlaceID");
      expect(planRow.rows[0]!.details_ciphertext).toMatch(/^rr1\./);
      expect(planRow.rows[0]!.details_ciphertext).not.toContain("Secret origin address");
    } finally {
      await inspection.end();
    }

    expect(await data.savedPlacesForFamily(account.familyID)).toEqual([{
      id: placeID,
      familyID: account.familyID,
      ownerMemberID: account.memberID,
      visibility: "personal",
      label: "Secret Home",
      waypoint: { placeID: "SecretGooglePlaceID" },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }]);
    expect((await data.travelPlanForEvent(account.familyID, eventID))?.origin).toEqual({
      kind: "one_time",
      waypoint: { address: "Secret origin address" },
    });
    expect(await data.travelPlanForEvent("another-family", eventID)).toBeNull();

    await data.saveTravelPlan({
      familyID: account.familyID,
      eventID,
      revision: 2,
      origin: { kind: "saved_place", savedPlaceID: placeID },
      preparationMinutes: 30,
      trafficPreference: "pessimistic",
      recipientMemberIDs: [account.memberID],
      leaveAlertEnabled: false,
      createdByMemberID: account.memberID,
      createdAt: "2026-09-10T00:00:00Z",
      updatedAt: "2026-09-10T00:00:00Z",
    });
    const updated = await data.travelPlanForEvent(account.familyID, eventID);
    expect(updated).toMatchObject({
      revision: 2,
      origin: { kind: "saved_place", savedPlaceID: placeID },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
    await expect(data.saveTravelPlan({ ...updated!, updatedAt: "2026-09-11T00:00:00Z" }))
      .rejects.toThrow("changed concurrently");

    await data.deleteEvent(account.familyID, eventID);
    expect(await data.travelPlanForEvent(account.familyID, eventID)).toBeNull();
    expect(await data.savedPlacesForFamily(account.familyID)).toHaveLength(1);
  });
});
