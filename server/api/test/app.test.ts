import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";
import type { IdentityProvider } from "../src/identity-provider.js";
import type { InvitationEmailSender } from "../src/invitation-email-sender.js";
import type { LocationSearchProvider } from "../src/location-search-provider.js";
import type { PushNotificationProvider } from "../src/push-notification-provider.js";
import type { ScheduleDraftExtractor } from "../src/schedule-draft-extractor.js";
import { CalendarSourceModule } from "../src/calendar-source-module.js";
import { InMemoryCalendarSourceRepository } from "../src/in-memory-calendar-source-repository.js";
import { CommuterModule } from "../src/commuter-module.js";
import { InMemoryCommuterRepository } from "../src/in-memory-commuter-repository.js";
import { InMemoryNotificationCenterRepository } from "../src/in-memory-notification-center-repository.js";
import { NotificationCenterModule } from "../src/notification-center.js";

const codeChallenge = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const codeVerifier = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

const deletedIdentitySubjects: string[] = [];

const identityProvider: IdentityProvider = {
  googleAuthorizationURL(challenge) {
    if (challenge !== codeChallenge) throw new Error("invalid challenge");
    return "https://identity.example/google";
  },
  appleAuthorizationURL(challenge) {
    if (challenge !== codeChallenge) throw new Error("invalid challenge");
    return "https://identity.example/apple";
  },
  async authenticateOAuthToken(token, verifier) {
    if (verifier !== codeVerifier) throw new Error("invalid OAuth token");
    if (token === "oauth-token") {
      return {
        identity: { subject: "parent-subject", displayName: "Alex" },
        accessToken: "parent-token",
      };
    }
    if (token === "new-oauth-token") {
      return {
        identity: { subject: "new-parent-subject", displayName: "Sam Rivera" },
        accessToken: "new-parent-token",
      };
    }
    if (token === "stranded-oauth-token") {
      return {
        identity: { subject: "stranded-subject", displayName: "Taylor" },
        accessToken: "stranded-token",
      };
    }
    if (token === "occupied-oauth-token") {
      return {
        identity: { subject: "occupied-subject", displayName: "Morgan" },
        accessToken: "occupied-token",
      };
    }
    throw new Error("invalid OAuth token");
  },
  async verifySession(token) {
    if (token === "parent-token") return { subject: "parent-subject", displayName: "Alex" };
    if (token === "kid-token") return { subject: "kid-subject", displayName: "Emma" };
    if (token === "family-parent-token") return { subject: "family-parent-subject", displayName: "Jamie" };
    if (token === "other-parent-token") return { subject: "other-parent-subject", displayName: "Jordan" };
    throw new Error("invalid session");
  },
  async revokeSession() {},
  async deleteIdentity(subject) {
    deletedIdentitySubjects.push(subject);
  },
};

const locationSearchProvider: LocationSearchProvider = {
  async search(query) {
    return query === "123 Main" ? [{
      id: "place-1",
      address: "123 Main St, Springfield, IL, USA",
    }] : [];
  },
};

function repository() {
  return new InMemoryRallyrooRepository({
    accounts: [
      { identitySubject: "parent-subject", familyID: "family-1", memberID: "parent-1", role: "parent" },
      { identitySubject: "kid-subject", familyID: "family-1", memberID: "kid-1", role: "kid" },
      { identitySubject: "family-parent-subject", familyID: "family-1", memberID: "parent-3", role: "parent" },
      { identitySubject: "other-parent-subject", familyID: "family-2", memberID: "parent-2", role: "parent" },
      { identitySubject: "stranded-subject", familyID: "family-3", memberID: "parent-4", role: "parent" },
      { identitySubject: "occupied-subject", familyID: "family-4", memberID: "parent-5", role: "parent" },
    ],
    members: [
      { id: "parent-1", familyID: "family-1", name: "Alex", role: "parent", colorTag: "blue" },
      { id: "kid-1", familyID: "family-1", name: "Emma", role: "kid", colorTag: "purple" },
      { id: "kid-2", familyID: "family-1", name: "Noah", role: "kid", colorTag: "orange" },
      { id: "parent-3", familyID: "family-1", name: "Jamie", role: "parent", colorTag: "teal" },
      { id: "parent-2", familyID: "family-2", name: "Jordan", role: "parent", colorTag: "green" },
      { id: "parent-4", familyID: "family-3", name: "Taylor", role: "parent", colorTag: "blue" },
      { id: "parent-5", familyID: "family-4", name: "Morgan", role: "parent", colorTag: "blue" },
    ],
    events: [{
      id: "00000000-0000-4000-8000-000000000001",
      familyID: "family-1",
      title: "Soccer practice",
      kidID: "kid-1",
      participantIDs: ["kid-1"],
      startTime: "2026-08-23T16:00:00Z",
      endTime: "2026-08-23T17:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
    }, {
      id: "00000000-0000-4000-8000-000000000002",
      familyID: "family-4",
      title: "Keep this family",
      kidID: null,
      participantIDs: ["parent-5"],
      startTime: "2026-08-24T16:00:00Z",
      endTime: "2026-08-24T17:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
    }],
  });
}

describe("Rallyroo API", () => {
  it("lists and marks only the authenticated member's inbox records", async () => {
    const notificationCenter = new NotificationCenterModule(new InMemoryNotificationCenterRepository());
    const [record] = await notificationCenter.record({
      familyID: "family-1", recipientMemberIDs: ["parent-1"], kind: "schedule_update",
      deduplicationKey: "update-1", title: "Schedule updated", body: "Open Rallyroo.",
      destination: { kind: "event", id: "event-1" }, occurredAt: new Date("2030-09-10T16:00:00Z"),
    });
    const app = buildApp({ identityProvider, repository: repository(), notificationCenter });

    const parentList = await app.inject({
      method: "GET", url: "/v1/notifications", headers: { authorization: "Bearer parent-token" },
    });
    expect(parentList.statusCode).toBe(200);
    expect(parentList.json()).toEqual([expect.objectContaining({ id: record!.id, title: "Schedule updated" })]);
    expect(JSON.stringify(parentList.json())).not.toContain("deduplicationDigest");
    expect((await app.inject({
      method: "PATCH", url: `/v1/notifications/${record!.id}/read`,
      headers: { authorization: "Bearer kid-token" },
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "PATCH", url: `/v1/notifications/${record!.id}/read`,
      headers: { authorization: "Bearer parent-token" },
    })).statusCode).toBe(204);
    expect((await app.inject({
      method: "DELETE", url: `/v1/notifications/${record!.id}`,
      headers: { authorization: "Bearer kid-token" },
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "DELETE", url: `/v1/notifications/${record!.id}`,
      headers: { authorization: "Bearer parent-token" },
    })).statusCode).toBe(204);
    await app.close();
  });

  it("exposes parent-managed Commuter state without leaking personal subscriptions", async () => {
    const commuter = new CommuterModule(new InMemoryCommuterRepository());
    const app = buildApp({ identityProvider, repository: repository(), commuter });

    expect((await app.inject({
      method: "PUT",
      url: "/v1/modules/commuter",
      headers: { authorization: "Bearer parent-token" },
    })).statusCode).toBe(200);
    const unavailableSchedule = await app.inject({
      method: "POST",
      url: "/v1/modules/commuter/journeys/search",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        originStationID: "PA",
        destinationStationID: "SF",
        serviceWeekdays: [1, 4, 5],
      },
    });
    expect(unavailableSchedule.statusCode).toBe(503);
    expect(unavailableSchedule.json()).toEqual({ error: "commuter_schedule_unavailable" });
    expect((await app.inject({
      method: "POST",
      url: "/v1/modules/commuter/journeys/search",
      headers: { authorization: "Bearer kid-token" },
      payload: { originStationID: "PA", destinationStationID: "SF", serviceWeekdays: [1] },
    })).statusCode).toBe(403);

    const subscriptionPayload = {
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
    };
    const personalResponse = await app.inject({
      method: "POST",
      url: "/v1/modules/commuter/subscriptions",
      headers: { authorization: "Bearer parent-token" },
      payload: subscriptionPayload,
    });
    expect(personalResponse.statusCode).toBe(201);
    expect(personalResponse.json()).not.toHaveProperty("familyID");

    const updatedPersonalResponse = await app.inject({
      method: "PUT",
      url: `/v1/modules/commuter/subscriptions/${personalResponse.json().id}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        ...subscriptionPayload,
        alertKinds: ["cancellation"],
        minimumDelayMinutes: 30,
      },
    });
    expect(updatedPersonalResponse.statusCode).toBe(200);
    expect(updatedPersonalResponse.json()).toMatchObject({
      id: personalResponse.json().id,
      alertKinds: ["cancellation"],
      minimumDelayMinutes: 30,
      status: "active",
    });

    const kidState = await app.inject({
      method: "GET",
      url: "/v1/modules/commuter",
      headers: { authorization: "Bearer kid-token" },
    });
    expect(kidState.statusCode).toBe(200);
    expect(kidState.json().installation).not.toHaveProperty("familyID");
    expect(kidState.json().subscriptions).toEqual([]);
    expect(kidState.json().providerStatus).toMatchObject({
      catalog: { state: "unavailable" },
      realtime: { state: "unavailable" },
    });
    const catalog = await app.inject({
      method: "GET",
      url: "/v1/modules/commuter/catalog",
      headers: { authorization: "Bearer kid-token" },
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toMatchObject({ status: { state: "unavailable" }, stops: [] });
    expect((await app.inject({
      method: "POST",
      url: "/v1/modules/commuter/subscriptions",
      headers: { authorization: "Bearer kid-token" },
      payload: personalResponse.json(),
    })).statusCode).toBe(403);

    const familyResponse = await app.inject({
      method: "POST",
      url: "/v1/modules/commuter/subscriptions",
      headers: { authorization: "Bearer family-parent-token" },
      payload: { ...subscriptionPayload, visibility: "family" },
    });
    expect(familyResponse.statusCode).toBe(201);
    expect((await app.inject({
      method: "GET",
      url: "/v1/modules/commuter",
      headers: { authorization: "Bearer kid-token" },
    })).json().subscriptions).toHaveLength(1);
    expect((await app.inject({
      method: "PATCH",
      url: "/v1/modules/commuter/subscriptions/not-a-uuid",
      headers: { authorization: "Bearer parent-token" },
      payload: { status: "paused" },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "PATCH",
      url: "/v1/modules/commuter",
      headers: { authorization: "Bearer parent-token" },
      payload: { status: "disabled" },
    })).statusCode).toBe(204);
    const disabledState = await app.inject({
      method: "GET",
      url: "/v1/modules/commuter",
      headers: { authorization: "Bearer parent-token" },
    });
    expect(disabledState.json()).toMatchObject({
      installation: { status: "disabled" },
      subscriptions: [{ visibility: "personal" }, { visibility: "family" }],
    });
    await app.close();
  });

  it("separates dependency-free liveness from PostgreSQL readiness", async () => {
    const ready = buildApp({
      identityProvider,
      repository: repository(),
      readinessCheck: async () => {},
    });
    const unavailable = buildApp({
      identityProvider,
      repository: repository(),
      readinessCheck: async () => { throw new Error("database unavailable"); },
    });

    expect((await ready.inject({ method: "GET", url: "/ready" })).statusCode).toBe(200);
    expect((await unavailable.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
    expect((await unavailable.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    await ready.close();
    await unavailable.close();
  });

  it("rate limits session exchange without throttling health checks", async () => {
    const app = buildApp({
      identityProvider,
      repository: repository(),
      rateLimits: {
        sessions: { max: 1, timeWindow: 60_000 },
      },
    });
    const exchange = () => app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier },
    });

    expect((await exchange()).statusCode).toBe(200);
    const throttled = await exchange();
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers["retry-after"]).toBeDefined();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    await app.close();
  });

  it("exposes Prometheus metrics with optional bearer protection", async () => {
    const publicApp = buildApp({ identityProvider, repository: repository() });
    const health = await publicApp.inject({ method: "GET", url: "/health" });
    const publicMetrics = await publicApp.inject({ method: "GET", url: "/metrics" });

    expect(health.headers["x-request-id"]).toBeDefined();
    expect(publicMetrics.statusCode).toBe(200);
    expect(publicMetrics.body).toContain("rallyroo_http_requests_total");
    expect(publicMetrics.body).toContain('route="/health"');

    const protectedApp = buildApp({
      identityProvider,
      repository: repository(),
      metricsBearerToken: "metrics-secret",
    });
    expect((await protectedApp.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect((await protectedApp.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer metrics-secret" },
    })).statusCode).toBe(200);
    await publicApp.close();
    await protectedApp.close();
  });

  it("exposes backend-owned Google authorization and session exchange", async () => {
    const app = buildApp({ identityProvider, repository: repository() });

    const authorization = await app.inject({
      method: "GET",
      url: `/v1/auth/google?codeChallenge=${codeChallenge}`,
    });
    expect(authorization.statusCode).toBe(302);
    expect(authorization.headers.location).toBe("https://identity.example/google");

    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "oauth-token", codeVerifier },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      accountID: "parent-1",
      displayName: "Alex",
      role: "parent",
      accessToken: "parent-token",
    });
    await app.close();
  });

  it("exposes backend-owned Apple authorization", async () => {
    const app = buildApp({ identityProvider, repository: repository() });

    const authorization = await app.inject({
      method: "GET",
      url: `/v1/auth/apple?codeChallenge=${codeChallenge}`,
    });

    expect(authorization.statusCode).toBe(302);
    expect(authorization.headers.location).toBe("https://identity.example/apple");
    await app.close();
  });

  it("JIT provisions a new Google identity as an idempotent parent account", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });

    const signUp = () => app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "new-oauth-token", codeVerifier },
    });
    const first = await signUp();
    const retry = await signUp();

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      displayName: "Sam Rivera",
      role: "parent",
      accessToken: "new-parent-token",
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().accountID).toBe(first.json().accountID);
    const account = await data.accountForIdentity("new-parent-subject");
    expect(account?.role).toBe("parent");
    expect(await data.membersForFamily(account!.familyID)).toHaveLength(1);
    await app.close();
  });

  it("deletes an authenticated identity and its Rallyroo account", async () => {
    deletedIdentitySubjects.length = 0;
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });

    const response = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(response.statusCode).toBe(204);
    expect(deletedIdentitySubjects).toEqual(["parent-subject"]);
    expect(await data.accountForIdentity("parent-subject")).toBeNull();
    expect(await data.membersForFamily("family-1")).toEqual([
      expect.objectContaining({ id: "kid-1" }),
      expect.objectContaining({ id: "kid-2" }),
      expect.objectContaining({ id: "parent-3" }),
    ]);
    await app.close();
  });

  it("deletes all family data when the last account is deleted", async () => {
    deletedIdentitySubjects.length = 0;
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });

    const response = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { authorization: "Bearer other-parent-token" },
    });

    expect(response.statusCode).toBe(204);
    expect(deletedIdentitySubjects).toEqual(["other-parent-subject"]);
    expect(await data.accountForIdentity("other-parent-subject")).toBeNull();
    expect(await data.membersForFamily("family-2")).toEqual([]);
    await app.close();
  });

  it("creates a due-time reminder separately from scheduled events", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc101";

    const saved = await app.inject({
      method: "PUT",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: reminderID,
        title: "Bring the permission slip",
        assigneeIDs: ["kid-1"],
        dueAt: "2026-09-10T15:00:00Z",
        alertLeadTimeMinutes: 60,
      },
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/reminders",
      headers: { authorization: "Bearer kid-token" },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      id: reminderID,
      status: "open",
      completedAt: null,
      completedByMemberID: null,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([saved.json()]);
    expect((await data.eventsForFamily("family-1"))).toHaveLength(1);
    await app.close();
  });

  it("lets an assigned kid complete a reminder and a parent reopen it", async () => {
    const data = repository();
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc102";
    await data.saveReminder({
      id: reminderID,
      familyID: "family-1",
      title: "Pack lunch",
      assigneeIDs: ["kid-1"],
      dueAt: "2026-09-10T15:00:00Z",
      status: "open",
      completedAt: null,
      completedByMemberID: null,
      alertLeadTimeMinutes: 15,
      createdByMemberID: "parent-1",
    });
    const app = buildApp({ identityProvider, repository: data });

    const completed = await app.inject({
      method: "POST",
      url: `/v1/reminders/${reminderID}/complete`,
      headers: { authorization: "Bearer kid-token" },
    });
    const reopened = await app.inject({
      method: "POST",
      url: `/v1/reminders/${reminderID}/reopen`,
      headers: { authorization: "Bearer parent-token" },
    });

    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      status: "completed",
      completedByMemberID: "kid-1",
    });
    expect(completed.json().completedAt).toBeTruthy();
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({
      status: "open",
      completedAt: null,
      completedByMemberID: null,
    });
    await app.close();
  });

  it("keeps reminder management parent-only and hides unassigned reminders from kids", async () => {
    const data = repository();
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc103";
    await data.saveReminder({
      id: reminderID,
      familyID: "family-1",
      title: "Parent responsibility",
      assigneeIDs: ["parent-3"],
      dueAt: "2026-09-10T15:00:00Z",
      status: "open",
      completedAt: null,
      completedByMemberID: null,
      alertLeadTimeMinutes: null,
      createdByMemberID: "parent-1",
    });
    const app = buildApp({ identityProvider, repository: data });

    const kidList = await app.inject({
      method: "GET",
      url: "/v1/reminders",
      headers: { authorization: "Bearer kid-token" },
    });
    const kidEdit = await app.inject({
      method: "PUT",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer kid-token" },
      payload: {
        id: reminderID,
        title: "Changed",
        assigneeIDs: ["kid-1"],
        dueAt: "2026-09-10T15:00:00Z",
        alertLeadTimeMinutes: null,
      },
    });
    const kidComplete = await app.inject({
      method: "POST",
      url: `/v1/reminders/${reminderID}/complete`,
      headers: { authorization: "Bearer kid-token" },
    });
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer parent-token" },
    });

    expect(kidList.json()).toEqual([]);
    expect(kidEdit.statusCode).toBe(403);
    expect(kidComplete.statusCode).toBe(403);
    expect(removed.statusCode).toBe(204);
    expect(await data.remindersForFamily("family-1")).toEqual([]);
    await app.close();
  });

  it("blocks deleting a member who has an open reminder", async () => {
    const data = repository();
    await data.saveReminder({
      id: "abcdefab-cdef-4abc-8def-abcdefabc104",
      familyID: "family-1",
      title: "Return library books",
      assigneeIDs: ["kid-2"],
      dueAt: "2026-09-10T15:00:00Z",
      status: "open",
      completedAt: null,
      completedByMemberID: null,
      alertLeadTimeMinutes: null,
      createdByMemberID: "parent-1",
    });
    const app = buildApp({ identityProvider, repository: data });

    const response = await app.inject({
      method: "DELETE",
      url: "/v1/family-members/kid-2",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "member_has_open_reminders" });
    await app.close();
  });

  it("searches US addresses through the backend location provider", async () => {
    const app = buildApp({
      identityProvider,
      repository: repository(),
      locationSearchProvider,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/locations/search?q=123%20Main",
      headers: { authorization: "Bearer parent-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{
      id: "place-1",
      address: "123 Main St, Springfield, IL, USA",
    }]);
    await app.close();
  });

  it("returns a non-sensitive unavailable response when location search fails", async () => {
    const app = buildApp({
      identityProvider,
      repository: repository(),
      locationSearchProvider: {
        async search() { throw new Error("provider response containing sensitive details"); },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/locations/search?q=123%20Main",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "location_search_unavailable" });
    expect(response.body).not.toContain("sensitive details");
    await app.close();
  });

  it("requires guardian authorization before inviting a kid", async () => {
    const app = buildApp({ identityProvider, repository: repository() });

    const response = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "kid", email: "kid@example.com" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "guardian_consent_required" });
    await app.close();
  });

  it("lets only a parent send a family invitation email", async () => {
    const deliveries: Array<{ recipientEmail: string; role: string; invitationURL: string }> = [];
    const invitationEmailSender: InvitationEmailSender = {
      async send(delivery) {
        deliveries.push({
          recipientEmail: delivery.recipientEmail,
          role: delivery.role,
          invitationURL: delivery.invitationURL,
        });
      },
    };
    const app = buildApp({
      identityProvider,
      repository: repository(),
      invitationEmailSender,
    });

    const sent = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "kid", email: "NewKid@Example.com", guardianConsent: true },
    });
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer kid-token" },
      payload: { role: "parent", email: "parent@example.com" },
    });
    const resent = await app.inject({
      method: "POST",
      url: `/v1/invitations/${sent.json().id}/resend`,
      headers: { authorization: "Bearer parent-token" },
    });

    expect(sent.statusCode).toBe(201);
    expect(forbidden.statusCode).toBe(403);
    expect(resent.statusCode).toBe(200);
    expect(deliveries).toEqual([
      {
        recipientEmail: "newkid@example.com",
        role: "kid",
        invitationURL: `https://rallyroo.dev/invite#code=${sent.json().code}`,
      },
      {
        recipientEmail: "newkid@example.com",
        role: "kid",
        invitationURL: `https://rallyroo.dev/invite#code=${resent.json().code}`,
      },
    ]);
    await app.close();
  });

  it("does not leave a usable invitation when email delivery fails", async () => {
    const app = buildApp({
      identityProvider,
      repository: repository(),
      invitationEmailSender: {
        async send() { throw new Error("email provider unavailable"); },
      },
    });

    const failed = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "kid", email: "kid@example.com", guardianConsent: true },
    });
    const pending = await app.inject({
      method: "GET",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(failed.statusCode).toBe(502);
    expect(pending.json()).toEqual([]);
    await app.close();
  });

  it("lets a parent invite a kid into the same family", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "kid", email: "sam@example.com", guardianConsent: true },
    });
    expect(invitation.statusCode).toBe(201);
    const invitationCode = invitation.json().code as string;

    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { oauthToken: "new-oauth-token", codeVerifier, invitationCode },
    });

    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ displayName: "Sam Rivera", role: "kid" });
    const account = await data.accountForIdentity("new-parent-subject");
    expect(account?.familyID).toBe("family-1");
    expect(account?.role).toBe("kid");
    await app.close();
  });

  it("moves an existing account from an empty accidental family when accepting an invitation", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "parent", email: "parent@example.com" },
    });

    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "stranded-oauth-token",
        codeVerifier,
        invitationCode: invitation.json().code,
      },
    });

    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ displayName: "Taylor", role: "parent" });
    expect((await data.accountForIdentity("stranded-subject"))?.familyID).toBe("family-1");
    expect(await data.membersForFamily("family-3")).toEqual([]);
    await app.close();
  });

  it("does not discard an existing Family with schedule data when accepting an invitation", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "parent", email: "parent@example.com" },
    });

    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "occupied-oauth-token",
        codeVerifier,
        invitationCode: invitation.json().code,
      },
    });

    expect(session.statusCode).toBe(409);
    expect(session.json()).toEqual({ error: "invitation_account_conflict" });
    expect((await data.accountForIdentity("occupied-subject"))?.familyID).toBe("family-4");
    expect((await data.eventsForFamily("family-4"))).toHaveLength(1);
    await app.close();
  });

  it("lets only parents list pending family invitations", async () => {
    const app = buildApp({ identityProvider, repository: repository() });
    const created = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "kid", email: "kid@example.com", guardianConsent: true },
    });

    const pending = await app.inject({
      method: "GET",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/v1/invitations",
      headers: { authorization: "Bearer kid-token" },
    });

    expect(created.statusCode).toBe(201);
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toEqual([{
      id: created.json().id,
      email: "kid@example.com",
      role: "kid",
      expiresAt: created.json().expiresAt,
    }]);
    expect(forbidden.statusCode).toBe(403);
    await app.close();
  });

  it("lets a parent cancel only a pending invitation in their family", async () => {
    const app = buildApp({ identityProvider, repository: repository() });
    const created = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "parent", email: "parent@example.com" },
    });
    const id = created.json().id as string;

    const otherFamily = await app.inject({
      method: "DELETE",
      url: `/v1/invitations/${id}`,
      headers: { authorization: "Bearer other-parent-token" },
    });
    const cancelled = await app.inject({
      method: "DELETE",
      url: `/v1/invitations/${id}`,
      headers: { authorization: "Bearer parent-token" },
    });
    const repeated = await app.inject({
      method: "DELETE",
      url: `/v1/invitations/${id}`,
      headers: { authorization: "Bearer parent-token" },
    });
    const pending = await app.inject({
      method: "GET",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(otherFamily.statusCode).toBe(404);
    expect(cancelled.statusCode).toBe(204);
    expect(repeated.statusCode).toBe(404);
    expect(pending.json()).toEqual([]);
    await app.close();
  });

  it("rotates an invitation code when a parent resends it", async () => {
    const app = buildApp({ identityProvider, repository: repository() });
    const created = await app.inject({
      method: "POST",
      url: "/v1/invitations",
      headers: { authorization: "Bearer parent-token" },
      payload: { role: "kid", email: "kid@example.com", guardianConsent: true },
    });

    const resent = await app.inject({
      method: "POST",
      url: `/v1/invitations/${created.json().id}/resend`,
      headers: { authorization: "Bearer parent-token" },
    });
    const oldCodeSession = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "new-oauth-token",
        codeVerifier,
        invitationCode: created.json().code,
      },
    });
    const newCodeSession = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: {
        oauthToken: "new-oauth-token",
        codeVerifier,
        invitationCode: resent.json().code,
      },
    });

    expect(resent.statusCode).toBe(200);
    expect(resent.json()).toMatchObject({ id: created.json().id, role: "kid" });
    expect(resent.json().code).not.toBe(created.json().code);
    expect(oldCodeSession.statusCode).toBe(403);
    expect(newCodeSession.statusCode).toBe(200);
    expect(newCodeSession.json().role).toBe("kid");
    await app.close();
  });

  it("lets a parent extract review-only schedule drafts with family context", async () => {
    let suppliedMembers: Array<{ id: string; name: string }> = [];
    const scheduleDraftExtractor: ScheduleDraftExtractor = {
      async extract(request) {
        suppliedMembers = request.members;
        return { drafts: [{
          kind: "reminder",
          title: "Bring cleats",
          memberIDs: ["kid-1"],
          startTime: null,
          endTime: null,
          dueAt: new Date(new Date(request.referenceDate).getTime() + 24 * 60 * 60 * 1_000).toISOString(),
          location: null,
          alertLeadTimeMinutes: 0,
          clarification: null,
          confidence: 0.95,
        }] };
      },
    };
    const app = buildApp({
      identityProvider,
      repository: repository(),
      scheduleDraftExtractor,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/schedule-drafts",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        inputType: "voice",
        text: "Remind Emma to bring cleats tomorrow at four",
        timeZone: "America/Los_Angeles",
      },
    });
    const kidResponse = await app.inject({
      method: "POST",
      url: "/v1/schedule-drafts",
      headers: { authorization: "Bearer kid-token" },
      payload: { inputType: "text", text: "Add practice tomorrow", timeZone: "UTC" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().drafts[0]).toMatchObject({ kind: "reminder", memberIDs: ["kid-1"] });
    expect(suppliedMembers).toEqual([
      { id: "parent-1", name: "Alex" },
      { id: "kid-1", name: "Emma" },
      { id: "kid-2", name: "Noah" },
      { id: "parent-3", name: "Jamie" },
    ]);
    expect(kidResponse.statusCode).toBe(403);
    await app.close();
  });

  it("rejects provider drafts outside the family and bounded schedule window", async () => {
    for (const invalidDraft of [
      { memberIDs: ["another-family-member"], dueAt: new Date().toISOString() },
      { memberIDs: ["kid-1"], dueAt: "2040-01-01T00:00:00.000Z" },
    ]) {
      const scheduleDraftExtractor: ScheduleDraftExtractor = {
        async extract() {
          return { drafts: [{
            kind: "reminder",
            title: "Unsafe draft",
            ...invalidDraft,
            startTime: null,
            endTime: null,
            location: null,
            alertLeadTimeMinutes: 0,
            clarification: null,
            confidence: 1,
          }] };
        },
      };
      const app = buildApp({
        identityProvider,
        repository: repository(),
        scheduleDraftExtractor,
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/schedule-drafts",
        headers: { authorization: "Bearer parent-token" },
        payload: { inputType: "text", text: "Add it", timeZone: "UTC" },
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: "invalid_schedule_draft_response" });
      await app.close();
    }
  });

  it("advances the family change cursor after a mutation", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const before = await app.inject({
      method: "GET",
      url: "/v1/changes",
      headers: { authorization: "Bearer parent-token" },
    });
    const write = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000005",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000005",
        title: "Piano lesson",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-08-25T18:00:00Z",
        endTime: "2026-08-25T19:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed"
      },
    });
    const after = await app.inject({
      method: "GET",
      url: "/v1/changes",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(before.json()).toEqual({ version: 0 });
    expect(write.statusCode).toBe(200);
    expect(after.json()).toEqual({ version: 1 });
    await app.close();
  });

  it("pushes requested event updates only to participants", async () => {
    const pushes: Array<{ tokens: string[]; title: string }> = [];
    const pushNotificationProvider: PushNotificationProvider = {
      async send(tokens, notification) {
        pushes.push({ tokens, title: notification.title });
      },
    };
    const data = repository();
    const app = buildApp({
      identityProvider,
      repository: data,
      pushNotificationProvider,
    });
    const registration = await app.inject({
      method: "PUT",
      url: "/v1/devices/device-token-1",
      headers: { authorization: "Bearer kid-token" },
    });
    const write = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000006?notifyParticipants=true",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000006",
        title: "Band practice",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-08-26T18:00:00Z",
        endTime: "2026-08-26T19:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed"
      },
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(registration.statusCode).toBe(204);
    expect(write.statusCode).toBe(200);
    expect(listed.json().find(
      (event: { id: string }) => event.id === "00000000-0000-4000-8000-000000000006",
    )?.alertLeadTimeMinutes).toBe(0);
    expect(pushes).toEqual([{ tokens: ["device-token-1"], title: "Band practice" }]);
    await app.close();
  });

  it("replays an Event mutation idempotently without sending another schedule update notification", async () => {
    const pushes: string[][] = [];
    const data = repository();
    await data.saveDeviceToken("family-1", "kid-1", "kid-device");
    const app = buildApp({
      identityProvider,
      repository: data,
      pushNotificationProvider: { async send(tokens) { pushes.push(tokens); } },
    });
    const id = "00000000-0000-4000-8000-000000000095";
    const headers = {
      authorization: "Bearer parent-token",
      "idempotency-key": "55555555-5555-4555-8555-555555555595",
    };
    const payload = {
      id,
      title: "Band practice",
      kidID: "kid-1",
      participantIDs: ["kid-1"],
      startTime: "2026-08-26T18:00:00Z",
      endTime: "2026-08-26T19:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
    };

    const first = await app.inject({
      method: "PUT",
      url: `/v1/events/${id}?notifyParticipants=true`,
      headers,
      payload,
    });
    const replay = await app.inject({
      method: "PUT",
      url: `/v1/events/${id}?notifyParticipants=false`,
      headers,
      payload: { ...payload, title: "A transport retry must not replace the Event" },
    });

    expect(first.json().notificationOutcome).toBe("sent");
    expect(replay.json().notificationOutcome).toBe("sent");
    expect(pushes).toEqual([["kid-device"]]);
    expect((await data.eventsForFamily("family-1")).find((candidate) => candidate.id === id)?.title)
      .toBe("Band practice");
    expect(await data.familyChangeVersion("family-1")).toBe(1);
    await app.close();
  });

  it("saves an event without an immediate update push when notification is declined", async () => {
    const pushes: string[][] = [];
    const data = repository();
    await data.saveDeviceToken("family-1", "kid-1", "kid-device");
    const app = buildApp({
      identityProvider,
      repository: data,
      pushNotificationProvider: { async send(tokens) { pushes.push(tokens); } },
    });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000096?notifyParticipants=false",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000096",
        title: "Quiet update",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-08-27T18:00:00Z",
        endTime: "2026-08-27T19:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(pushes).toEqual([]);
    await app.close();
  });

  it("lets only parents create and list participant-scoped calendar subscriptions", async () => {
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => `protected:${url}`,
      revealURL: (protectedURL) => protectedURL.replace(/^protected:/, ""),
      fetchFeed: async () => ({ body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" }),
    });
    const app = buildApp({
      identityProvider,
      repository: repository(),
      calendarSources,
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "Emma TeamSnap",
        url: "https://ical.example/emma-secret-feed.ics",
        participantIDs: ["kid-1"],
      },
    });
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer kid-token" },
      payload: {
        name: "Not allowed",
        url: "https://ical.example/secret.ics",
        participantIDs: ["kid-1"],
      },
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: "Emma TeamSnap",
      ownerMemberID: "parent-1",
      visibility: "family",
      participantIDs: ["kid-1"],
      status: "ready",
    });
    expect(created.json()).not.toHaveProperty("url");
    expect(forbidden.statusCode).toBe(403);
    expect(listed.json()).toEqual([created.json()]);
    await app.close();
  });

  it("imports a calendar's complete initial snapshot when it is connected", async () => {
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:first@example",
        "SUMMARY:First imported activity",
        "DTSTART:20260912T180000Z",
        "DTEND:20260912T190000Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:second@example",
        "SUMMARY:Second imported activity",
        "DTSTART:20260913T180000Z",
        "DTEND:20260913T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });

    const connected = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "Activities",
        url: "https://ical.example/activities.ics",
        participantIDs: ["kid-1"],
        visibility: "family",
      },
    });
    const schedule = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(connected.statusCode).toBe(201);
    expect(connected.json()).toMatchObject({ status: "ready", visibility: "family" });
    expect(schedule.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "First imported activity" }),
      expect.objectContaining({ title: "Second imported activity" }),
    ]));
    await app.close();
  });

  it("rejects an initial calendar snapshot above the 5,000-event safety limit", async () => {
    const eventLines = Array.from({ length: 5_001 }, (_, index) => [
      "BEGIN:VEVENT",
      `UID:large-${index}@example`,
      `SUMMARY:Imported activity ${index}`,
      "DTSTART:20260912T180000Z",
      "DTEND:20260912T190000Z",
      "END:VEVENT",
    ].join("\r\n"));
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        ...eventLines,
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });

    const connected = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "Oversized calendar",
        url: "https://ical.example/oversized.ics",
        participantIDs: ["kid-1"],
        visibility: "family",
      },
    });

    expect(connected.statusCode).toBe(201);
    expect(connected.json()).toMatchObject({ status: "error", lastError: "sync_failed" });
    await app.close();
  });

  it("keeps a failed initial calendar connection available for retry", async () => {
    let feedBody = "not a calendar";
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: feedBody }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });

    const connected = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "Retry calendar",
        url: "https://ical.example/retry.ics",
        participantIDs: ["kid-1"],
        visibility: "family",
      },
    });
    expect(connected.statusCode).toBe(201);
    expect(connected.json()).toMatchObject({ status: "error", lastError: "sync_failed" });

    feedBody = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:retried@example",
      "SUMMARY:Imported after retry",
      "DTSTART:20260912T180000Z",
      "DTEND:20260912T190000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const retried = await app.inject({
      method: "POST",
      url: `/v1/calendar-sources/${connected.json().id}/sync`,
      headers: { authorization: "Bearer parent-token" },
    });
    const schedule = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ status: "ready", lastError: null });
    expect(schedule.body).toContain("Imported after retry");
    await app.close();
  });

  it("keeps a personal calendar and its events private to the parent who connected it", async () => {
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:private-work@example",
        "SUMMARY:Private work meeting",
        "DTSTART:20260912T180000Z",
        "DTEND:20260912T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const familyVersionBefore = await app.inject({
      method: "GET",
      url: "/v1/changes",
      headers: { authorization: "Bearer family-parent-token" },
    });
    const connected = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "Work",
        url: "https://ical.example/work.ics",
        participantIDs: ["parent-1"],
        visibility: "personal",
      },
    });
    const sourceID = connected.json().id;
    const familyVersionAfter = await app.inject({
      method: "GET",
      url: "/v1/changes",
      headers: { authorization: "Bearer family-parent-token" },
    });

    const ownerSources = await app.inject({
      method: "GET",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
    });
    const ownerEvents = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });
    const familySources = await app.inject({
      method: "GET",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer family-parent-token" },
    });
    const familyEvents = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer family-parent-token" },
    });
    const unrelatedParentEdit = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000078",
      headers: { authorization: "Bearer family-parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000078",
        title: "Family activity",
        kidID: "parent-1",
        participantIDs: ["parent-1"],
        startTime: "2026-09-12T18:30:00Z",
        endTime: "2026-09-12T19:30:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
      },
    });
    const forbiddenSync = await app.inject({
      method: "POST",
      url: `/v1/calendar-sources/${sourceID}/sync`,
      headers: { authorization: "Bearer family-parent-token" },
    });
    const forbiddenDelete = await app.inject({
      method: "DELETE",
      url: `/v1/calendar-sources/${sourceID}`,
      headers: { authorization: "Bearer family-parent-token" },
    });

    expect(familyVersionAfter.json()).toEqual(familyVersionBefore.json());
    expect(ownerSources.json()).toEqual([expect.objectContaining({
      id: sourceID,
      ownerMemberID: "parent-1",
      visibility: "personal",
    })]);
    expect(ownerEvents.body).toContain("Private work meeting");
    expect(familySources.json()).toEqual([]);
    expect(familyEvents.body).not.toContain("Private work meeting");
    expect(unrelatedParentEdit.json().conflicts).toEqual([]);
    expect(forbiddenSync.statusCode).toBe(404);
    expect(forbiddenDelete.statusCode).toBe(404);
    await app.close();
  });

  it("does not reveal personal-calendar conflicts in family push notifications", async () => {
    const pushedBodies: string[] = [];
    const pushNotificationProvider: PushNotificationProvider = {
      async send(_tokens, notification) {
        pushedBodies.push(notification.body);
      },
    };
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:private-conflict@example",
        "SUMMARY:Private meeting",
        "DTSTART:20260912T180000Z",
        "DTEND:20260912T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({
      identityProvider,
      repository: repository(),
      calendarSources,
      pushNotificationProvider,
    });
    await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "Work",
        url: "https://ical.example/work.ics",
        participantIDs: ["parent-1"],
        visibility: "personal",
      },
    });

    await app.inject({
      method: "PUT",
      url: "/v1/devices/private-conflict-test-device",
      headers: { authorization: "Bearer kid-token" },
    });
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000079",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000079",
        title: "Family activity",
        kidID: "parent-1",
        participantIDs: ["parent-1", "kid-1"],
        startTime: "2026-09-12T18:30:00Z",
        endTime: "2026-09-12T19:30:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
      },
    });

    expect(saved.json().conflicts).toEqual([
      expect.objectContaining({ kind: "overlapping_participant", memberID: "parent-1" }),
    ]);
    expect(pushedBodies).toEqual(["Your family schedule was updated."]);
    await app.close();
  });

  it("lets only the source owner change calendar visibility", async () => {
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:visibility@example",
        "SUMMARY:Visibility test",
        "DTSTART:20260912T180000Z",
        "DTEND:20260912T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const connected = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "Work",
        url: "https://ical.example/work.ics",
        participantIDs: ["parent-1"],
        visibility: "personal",
      },
    });
    const sourceURL = `/v1/calendar-sources/${connected.json().id}`;

    const forbidden = await app.inject({
      method: "PATCH",
      url: sourceURL,
      headers: { authorization: "Bearer family-parent-token" },
      payload: { visibility: "family" },
    });
    const shared = await app.inject({
      method: "PATCH",
      url: sourceURL,
      headers: { authorization: "Bearer parent-token" },
      payload: { visibility: "family" },
    });
    const familyEvents = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer family-parent-token" },
    });

    expect(forbidden.statusCode).toBe(404);
    expect(shared.statusCode).toBe(200);
    expect(shared.json()).toMatchObject({ visibility: "family" });
    expect(familyEvents.body).toContain("Visibility test");
    await app.close();
  });

  it("synchronizes duplicate calendar events as one schedule item with combined participants and provenance", async () => {
    const feeds = new Map([
      ["https://ical.example/emma.ics", [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:emma-party@example",
        "SUMMARY:Class Party",
        "DTSTART:20260912T180000Z",
        "DTEND:20260912T200000Z",
        "LOCATION:Lincoln School",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n")],
      ["https://ical.example/noah.ics", [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:noah-party@example",
        "SUMMARY:  CLASS PARTY  ",
        "DTSTART:20260912T180000Z",
        "DTEND:20260912T200000Z",
        "LOCATION:Lincoln School",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n")],
    ]);
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => `protected:${url}`,
      revealURL: (protectedURL) => protectedURL.replace(/^protected:/, ""),
      fetchFeed: async (url) => ({ body: feeds.get(url)! }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const createSource = async (url: string, participantID: string) => (await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: { name: participantID, url, participantIDs: [participantID] },
    })).json();
    const emma = await createSource("https://ical.example/emma.ics", "kid-1");
    const noah = await createSource("https://ical.example/noah.ics", "kid-2");

    for (const source of [emma, noah]) {
      const synced = await app.inject({
        method: "POST",
        url: `/v1/calendar-sources/${source.id}/sync`,
        headers: { authorization: "Bearer parent-token" },
      });
      expect(synced.statusCode).toBe(200);
    }
    const schedule = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });
    const imported = schedule.json().filter((event: { source: string }) => event.source === "calendar");

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      title: "Class Party",
      participantIDs: ["kid-1", "kid-2"],
      readOnly: true,
    });
    expect(imported[0].provenance).toHaveLength(2);
    await app.close();
  });

  it("expands recurring calendar events into distinct schedule occurrences", async () => {
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:weekly@example",
        "SUMMARY:Weekly practice",
        "DTSTART:20260915T180000Z",
        "DTEND:20260915T190000Z",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const source = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "TeamSnap",
        url: "https://ical.example/team.ics",
        participantIDs: ["kid-1"],
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/calendar-sources/${source.json().id}/sync`,
      headers: { authorization: "Bearer parent-token" },
    });

    const schedule = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });
    const imported = schedule.json().filter((event: { source: string }) => event.source === "calendar");
    expect(imported.map((event: { startTime: string }) => event.startTime)).toEqual([
      "2026-09-15T18:00:00.000Z",
      "2026-09-22T18:00:00.000Z",
    ]);
    await app.close();
  });

  it("includes imported calendar events in conflict detection", async () => {
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:practice@example",
        "SUMMARY:Team practice",
        "DTSTART:20260915T180000Z",
        "DTEND:20260915T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const source = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "TeamSnap",
        url: "https://ical.example/team.ics",
        participantIDs: ["kid-1"],
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/calendar-sources/${source.json().id}/sync`,
      headers: { authorization: "Bearer parent-token" },
    });

    const saved = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000077",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000077",
        title: "Piano",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-09-15T18:30:00Z",
        endTime: "2026-09-15T19:30:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
      },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().conflicts).toEqual([
      expect.objectContaining({ kind: "overlapping_participant", memberID: "kid-1" }),
    ]);
    await app.close();
  });

  it("rejects edits and event deletion for imported calendar events", async () => {
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:readonly@example",
        "SUMMARY:Read-only practice",
        "DTSTART:20260916T180000Z",
        "DTEND:20260916T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const source = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "TeamSnap",
        url: "https://ical.example/team.ics",
        participantIDs: ["kid-1"],
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/calendar-sources/${source.json().id}/sync`,
      headers: { authorization: "Bearer parent-token" },
    });
    const schedule = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });
    const imported = schedule.json().find((event: { source: string }) => event.source === "calendar");

    const uppercaseImportedID = imported.id.toUpperCase();
    const edited = await app.inject({
      method: "PUT",
      url: `/v1/events/${uppercaseImportedID}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        ...imported,
        id: uppercaseImportedID,
        title: "Changed locally",
        source: "manual",
        readOnly: undefined,
        provenance: undefined,
      },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/events/${uppercaseImportedID}`,
      headers: { authorization: "Bearer parent-token" },
    });

    expect(edited.statusCode).toBe(409);
    expect(deleted.statusCode).toBe(409);
    await app.close();
  });

  it("removes events missing from a refreshed calendar without changing native events", async () => {
    let feedBody = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:cancelled@example",
      "SUMMARY:Cancelled practice",
      "DTSTART:20260916T180000Z",
      "DTEND:20260916T190000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: feedBody }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const source = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "TeamSnap",
        url: "https://ical.example/team.ics",
        participantIDs: ["kid-1"],
      },
    });
    const sync = () => app.inject({
      method: "POST",
      url: `/v1/calendar-sources/${source.json().id}/sync`,
      headers: { authorization: "Bearer parent-token" },
    });
    await sync();
    feedBody = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
    await sync();

    const schedule = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });
    expect(schedule.json()).toEqual([
      expect.objectContaining({ title: "Soccer practice", source: "manual" }),
    ]);
    await app.close();
  });

  it("preserves the last good schedule when a calendar refresh fails", async () => {
    let feedBody = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:preserved@example",
      "SUMMARY:Preserved practice",
      "DTSTART:20260917T180000Z",
      "DTEND:20260917T190000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: feedBody }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const source = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "TeamSnap",
        url: "https://ical.example/team.ics",
        participantIDs: ["kid-1"],
      },
    });
    const sync = () => app.inject({
      method: "POST",
      url: `/v1/calendar-sources/${source.json().id}/sync`,
      headers: { authorization: "Bearer parent-token" },
    });
    expect((await sync()).statusCode).toBe(200);
    feedBody = "not a calendar";

    expect((await sync()).statusCode).toBe(502);
    const sources = await app.inject({
      method: "GET",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
    });
    const schedule = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });
    expect(sources.json()[0]).toMatchObject({ status: "error", lastError: "sync_failed" });
    expect(schedule.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Preserved practice" }),
    ]));
    await app.close();
  });

  it("lets a parent remove a calendar subscription and all of its imported events", async () => {
    const calendarSources = new CalendarSourceModule({
      repository: new InMemoryCalendarSourceRepository(),
      protectURL: (url) => url,
      revealURL: (url) => url,
      fetchFeed: async () => ({ body: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:removed@example",
        "SUMMARY:Removed practice",
        "DTSTART:20260917T180000Z",
        "DTEND:20260917T190000Z",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n") }),
    });
    const app = buildApp({ identityProvider, repository: repository(), calendarSources });
    const source = await app.inject({
      method: "POST",
      url: "/v1/calendar-sources",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        name: "TeamSnap",
        url: "https://ical.example/team.ics",
        participantIDs: ["kid-1"],
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/calendar-sources/${source.json().id}/sync`,
      headers: { authorization: "Bearer parent-token" },
    });

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/calendar-sources/${source.json().id}`,
      headers: { authorization: "Bearer parent-token" },
    });
    const schedule = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer parent-token" },
    });

    expect(removed.statusCode).toBe(204);
    expect(schedule.json().filter((event: { source: string }) => event.source === "calendar")).toEqual([]);
    await app.close();
  });

  it("requires a verified bearer session", async () => {
    const app = buildApp({ identityProvider, repository: repository() });
    const response = await app.inject({ method: "GET", url: "/v1/events" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("returns only a kid's own events", async () => {
    const app = buildApp({ identityProvider, repository: repository() });
    const response = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: "Bearer kid-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    await app.close();
  });

  it("blocks kid accounts from writing events", async () => {
    const app = buildApp({ identityProvider, repository: repository() });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000002",
      headers: { authorization: "Bearer kid-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000002",
        title: "Work meeting",
        kidID: "parent-1",
        participantIDs: ["parent-1"],
        startTime: "2026-08-23T16:30:00Z",
        endTime: "2026-08-23T17:30:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed"
      },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("rejects participants outside the authenticated family", async () => {
    const app = buildApp({ identityProvider, repository: repository() });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000003",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000003",
        title: "Unknown participant event",
        kidID: null,
        participantIDs: ["not-in-this-family"],
        startTime: "2026-08-23T18:00:00Z",
        endTime: "2026-08-23T19:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed"
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("unknown_participant");
    await app.close();
  });

  it("does not conflict with the same event when Swift sends an uppercase UUID", async () => {
    const data = repository();
    const eventID = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    await data.saveEvent({
      id: eventID,
      familyID: "family-1",
      title: "Soccer practice",
      kidID: "kid-1",
      participantIDs: ["kid-1"],
      startTime: "2026-08-23T18:00:00Z",
      endTime: "2026-08-23T19:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
    });
    const app = buildApp({ identityProvider, repository: data });
    const response = await app.inject({
      method: "PUT",
      url: `/v1/events/${eventID.toUpperCase()}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: eventID.toUpperCase(),
        title: "Renamed soccer practice",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-08-23T18:00:00Z",
        endTime: "2026-08-23T19:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().conflicts).toEqual([]);
    const matchingEvents = (await data.eventsForFamily("family-1"))
      .filter((event) => event.id.toLowerCase() === eventID);
    expect(matchingEvents).toHaveLength(1);
    expect(matchingEvents[0]?.title).toBe("Renamed soccer practice");
    await app.close();
  });

  it("still reports a separate event when an edit introduces a conflict", async () => {
    const data = repository();
    const eventID = "abcdefab-cdef-4abc-8def-abcdefabcdeb";
    await data.saveEvent({
      id: eventID,
      familyID: "family-1",
      title: "Doctor appointment",
      kidID: "kid-1",
      participantIDs: ["kid-1"],
      startTime: "2026-08-23T18:00:00Z",
      endTime: "2026-08-23T19:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
    });
    const app = buildApp({ identityProvider, repository: data });
    const response = await app.inject({
      method: "PUT",
      url: `/v1/events/${eventID.toUpperCase()}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: eventID.toUpperCase(),
        title: "Earlier doctor appointment",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-08-23T16:30:00Z",
        endTime: "2026-08-23T17:30:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().conflicts).toEqual([
      expect.objectContaining({
        kind: "overlapping_participant",
        memberID: "kid-1",
        eventIDs: ["00000000-0000-4000-8000-000000000001", eventID],
      }),
    ]);
    await app.close();
  });

  it("does not conflict with the same recurring series when it is renamed", async () => {
    const data = repository();
    const eventID = "abcdefab-cdef-4abc-8def-abcdefabcdea";
    const recurrence = {
      frequency: "weekly" as const,
      interval: 1,
      endDate: "2026-12-31T23:59:59Z",
    };
    await data.saveEvent({
      id: eventID,
      familyID: "family-1",
      title: "Weekly practice",
      kidID: "kid-1",
      participantIDs: ["kid-1"],
      startTime: "2026-08-23T18:00:00Z",
      endTime: "2026-08-23T19:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
      recurrence,
    });
    const app = buildApp({ identityProvider, repository: data });
    const response = await app.inject({
      method: "PUT",
      url: `/v1/events/${eventID.toUpperCase()}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: eventID.toUpperCase(),
        title: "Renamed weekly practice",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-08-23T18:00:00Z",
        endTime: "2026-08-23T19:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
        recurrence,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().conflicts).toEqual([]);
    await app.close();
  });

  it("reports a conflict on a future recurring occurrence", async () => {
    const app = buildApp({ identityProvider, repository: repository() });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000004",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000004",
        title: "Recurring soccer",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-08-16T16:00:00Z",
        endTime: "2026-08-16T17:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
        recurrence: {
          frequency: "weekly",
          interval: 1,
          endDate: "2026-09-30T23:59:59Z"
        }
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().conflicts[0]?.kind).toBe("overlapping_participant");
    await app.close();
  });

  it("preserves selected weekdays when an older client edits a multi-day series", async () => {
    const data = repository();
    const id = "00000000-0000-4000-8000-000000000097";
    await data.saveEvent({
      id,
      familyID: "family-1",
      title: "Practice",
      kidID: "kid-1",
      participantIDs: ["kid-1"],
      startTime: "2026-09-07T18:00:00Z",
      endTime: "2026-09-07T19:00:00Z",
      location: null,
      driver: null,
      source: "manual",
      status: "confirmed",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: [1, 3],
        endDate: "2027-01-01T18:00:00Z",
      },
    });
    const app = buildApp({ identityProvider, repository: data });

    const response = await app.inject({
      method: "PUT",
      url: `/v1/events/${id}?notifyParticipants=false`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id,
        title: "Renamed practice",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-09-07T18:00:00Z",
        endTime: "2026-09-07T19:00:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
        recurrence: {
          frequency: "weekly",
          interval: 1,
          endDate: "2027-01-01T18:00:00Z",
        },
      },
    });

    const saved = (await data.eventsForFamily("family-1")).find((event) => event.id === id);
    expect(response.statusCode).toBe(200);
    expect(saved?.recurrence?.weekdays).toEqual([1, 3]);
    await app.close();
  });

  it("stores recurrence and reports conflicts when a parent writes an event", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/events/00000000-0000-4000-8000-000000000002",
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: "00000000-0000-4000-8000-000000000002",
        title: "Doctor appointment",
        kidID: "kid-1",
        participantIDs: ["kid-1"],
        startTime: "2026-08-23T16:30:00Z",
        endTime: "2026-08-23T17:30:00Z",
        location: null,
        driver: null,
        source: "manual",
        status: "confirmed",
        recurrence: {
          frequency: "weekly",
          interval: 1,
          weekdays: [7, 3, 3],
          endDate: "2026-12-31T23:59:59Z"
        }
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().conflicts[0]).toMatchObject({
      kind: "overlapping_participant",
      memberID: "kid-1",
    });
    const saved = (await data.eventsForFamily("family-1")).find(
      (event) => event.id === "00000000-0000-4000-8000-000000000002",
    );
    expect(saved?.recurrence).toMatchObject({ frequency: "weekly", weekdays: [3, 7] });
    await app.close();
  });

  it("persists 30 and 45 minute Event alert lead times", async () => {
    for (const alertLeadTimeMinutes of [30, 45]) {
      const last12 = alertLeadTimeMinutes === 30 ? "000000000030" : "000000000045";
      const id = `00000000-0000-4000-8000-${last12}`;
      const data = repository();
      const app = buildApp({ identityProvider, repository: data });
      const write = await app.inject({
        method: "PUT",
        url: `/v1/events/${id}?notifyParticipants=false`,
        headers: { authorization: "Bearer parent-token" },
        payload: {
          id,
          title: "Lead time practice",
          kidID: "kid-1",
          participantIDs: ["kid-1"],
          startTime: "2026-08-26T18:00:00Z",
          endTime: "2026-08-26T19:00:00Z",
          source: "manual",
          status: "confirmed",
          alertLeadTimeMinutes,
         },
       });
      const listed = await app.inject({
        method: "GET",
        url: "/v1/events",
        headers: { authorization: "Bearer parent-token" },
       });
      expect(write.statusCode).toBe(200);
      expect(listed.json().find((event: { id: string }) => event.id === id)?.alertLeadTimeMinutes)
             .toBe(alertLeadTimeMinutes);
      await app.close();
       }
     });
});
