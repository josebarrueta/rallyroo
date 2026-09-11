import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fastifyRateLimit } from "@fastify/rate-limit";
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import { z } from "zod";
import type { Account, FamilyEvent, FamilyMember, FamilyReminder } from "./domain.js";
import type { CalendarSourceModule } from "./calendar-source-module.js";
import { CommuterModuleError, type CommuterModule } from "./commuter-module.js";
import { EventMutationError, EventMutationModule } from "./event-mutation.js";
import { ScheduleUpdateNotificationDispatcher } from "./schedule-update-notification-dispatcher.js";
import type { IdentityProvider } from "./identity-provider.js";
import {
  NoopInvitationEmailSender,
  type InvitationEmailSender,
} from "./invitation-email-sender.js";
import {
  EmptyLocationSearchProvider,
  type LocationSearchProvider,
} from "./location-search-provider.js";
import { RallyrooMetrics } from "./metrics.js";
import {
  NoopPushNotificationProvider,
  type PushNotificationProvider,
} from "./push-notification-provider.js";
import type { RallyrooRepository } from "./repository.js";
import {
  ScheduleDraftProviderError,
  UnavailableScheduleDraftExtractor,
  scheduleDraftResultSchema,
  type ScheduleDraftExtractor,
} from "./schedule-draft-extractor.js";
import type { NotificationCenterModule } from "./notification-center.js";

declare module "fastify" {
  interface FastifyRequest {
    account: Account | null;
  }
}

const eventSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1),
  kidID: z.string().nullable().default(null),
  participantIDs: z.array(z.string()).default([]),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().nullable().default(null),
  driver: z.string().nullable().default(null),
  driverMemberID: z.string().trim().min(1).nullable().default(null),
  source: z.enum(["manual", "email_suggested", "voice"]),
  status: z.enum(["confirmed", "pending_review"]),
  alertLeadTimeMinutes: z.union([
    z.literal(0), z.literal(5), z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(1440), z.null(),
  ]).default(0),
  recurrence: z.object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().positive(),
    weekdays: z.array(z.union([
      z.literal(1), z.literal(2), z.literal(3), z.literal(4),
      z.literal(5), z.literal(6), z.literal(7),
    ])).min(1).transform((days) => [...new Set(days)].sort()).optional(),
    endDate: z.string().datetime(),
  }).refine((recurrence) => recurrence.frequency === "weekly" || recurrence.weekdays === undefined, {
    message: "weekdays are supported only for weekly recurrence",
  }).nullable().optional(),
}).refine((event) => !(event.driverMemberID && event.driver), {
  message: "driverMemberID and driver cannot both be set",
}).refine((event) => new Date(event.endTime) > new Date(event.startTime), {
  message: "endTime must follow startTime",
}).refine((event) => !event.recurrence || (
  new Date(event.recurrence.endDate) >= new Date(event.startTime)
  && new Date(event.recurrence.endDate).getTime() - new Date(event.startTime).getTime()
    <= 732 * 24 * 60 * 60 * 1_000
), {
  message: "recurrence must end within 732 days after startTime",
});

const recurringEditSchema = z.object({
  upserts: z.array(eventSchema),
  deleteIDs: z.array(z.string().min(1)),
   notifyParticipants: z.boolean().optional(),
});

const reminderSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  assigneeIDs: z.array(z.string().min(1)).min(1).transform((ids) => [...new Set(ids)]),
  dueAt: z.string().datetime(),
  alertLeadTimeMinutes: z.union([
    z.literal(0), z.literal(5), z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(1440), z.null(),
  ]).default(null),
});

const locationSearchSchema = z.object({ q: z.string().trim().min(2).max(200) });
const scheduleDraftRequestSchema = z.object({
  inputType: z.enum(["text", "voice", "image"]),
  text: z.string().trim().min(1).max(20_000),
  timeZone: z.string().min(1).max(100).refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      return true;
    } catch {
      return false;
    }
  }),
});
const oauthAuthorizationSchema = z.object({ codeChallenge: z.string().min(43).max(128) });
const oauthSessionSchema = z.object({
  oauthToken: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
  invitationCode: z.string().min(20).optional(),
});
const invitationSchema = z.object({
  role: z.enum(["parent", "kid"]),
  email: z.email().transform((email) => email.toLowerCase()),
  guardianConsent: z.boolean().default(false),
});

const memberSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  role: z.enum(["parent", "kid"]),
  gradeOrBirthYear: z.string().nullable().optional(),
  colorTag: z.string().min(1),
  canDrive: z.boolean().default(false),
});

const calendarSourceVisibilitySchema = z.object({
  visibility: z.enum(["personal", "family"]),
});

const commuterSubscriptionSchema = z.object({
  visibility: z.enum(["personal", "family"]),
  agencyID: z.literal("CT"),
  routeID: z.string().trim().min(1).max(200),
  directionID: z.string().trim().min(1).max(200),
  originStopID: z.string().trim().min(1).max(200),
  destinationStopID: z.string().trim().min(1).max(200),
  serviceWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  windowStartMinutes: z.number().int().min(0).max(1439),
  windowEndMinutes: z.number().int().min(1).max(1440),
  alertKinds: z.array(z.enum(["delay", "cancellation"])).min(1).max(2),
  minimumDelayMinutes: z.number().int().min(1).max(180),
  scheduleOptionID: z.string().regex(/^[a-f0-9]{64}$/).optional().nullable(),
  scheduledDepartureMinutes: z.number().int().min(0).max(1439).optional().nullable(),
  scheduledArrivalMinutes: z.number().int().min(0).max(1439).optional().nullable(),
  scheduleVersion: z.string().trim().min(1).max(200).optional().nullable(),
}).refine((value) => {
  const scheduleFields = [
    value.scheduleOptionID,
    value.scheduledDepartureMinutes,
    value.scheduledArrivalMinutes,
    value.scheduleVersion,
  ];
  return scheduleFields.every((field) => field === undefined || field === null)
    || scheduleFields.every((field) => field !== undefined && field !== null);
});
const commuterJourneySearchSchema = z.object({
  originStationID: z.string().trim().min(1).max(300),
  destinationStationID: z.string().trim().min(1).max(300),
  serviceWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(5),
});
const commuterInstallationStatusSchema = z.object({
  status: z.literal("disabled"),
});
const commuterSubscriptionStatusSchema = z.object({
  status: z.enum(["active", "paused"]),
});
const commuterSubscriptionIDSchema = z.string().uuid();

const calendarSourceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string()
    .transform((url) => url.replace(/^webcal:/i, "https:"))
    .pipe(z.url().refine((url) => new URL(url).protocol === "https:", "HTTPS is required")),
  participantIDs: z.array(z.string().min(1)).min(1),
  visibility: z.enum(["personal", "family"]).default("family"),
});

interface RouteRateLimit {
  max: number;
  timeWindow: number;
}

interface Dependencies {
  identityProvider: IdentityProvider;
  repository: RallyrooRepository;
  locationSearchProvider?: LocationSearchProvider;
  pushNotificationProvider?: PushNotificationProvider;
  invitationEmailSender?: InvitationEmailSender;
  calendarSources?: CalendarSourceModule;
  commuter?: CommuterModule;
  scheduleDraftExtractor?: ScheduleDraftExtractor;
  readinessCheck?: () => Promise<void>;
  rateLimits?: Partial<Record<"sessions" | "invitations" | "locations" | "scheduleDrafts", RouteRateLimit>>;
  metrics?: RallyrooMetrics;
  notificationCenter?: NotificationCenterModule;
  metricsBearerToken?: string;
  logger?: FastifyServerOptions["logger"];
}

export function buildApp({
  identityProvider,
  repository,
  locationSearchProvider = new EmptyLocationSearchProvider(),
  pushNotificationProvider = new NoopPushNotificationProvider(),
  invitationEmailSender = new NoopInvitationEmailSender(),
  calendarSources,
  commuter,
  scheduleDraftExtractor = new UnavailableScheduleDraftExtractor(),
  readinessCheck = async () => {},
  rateLimits = {},
  metrics = new RallyrooMetrics(),
  notificationCenter,
  metricsBearerToken,
  logger = false,
}: Dependencies) {
  const limits = {
    sessions: { max: 10, timeWindow: 60_000 },
    invitations: { max: 20, timeWindow: 60 * 60_000 },
    locations: { max: 60, timeWindow: 60_000 },
    scheduleDrafts: { max: 10, timeWindow: 60_000 },
    ...rateLimits,
  };
  const scheduleUpdateNotificationDispatcher = new ScheduleUpdateNotificationDispatcher({
    persistence: repository,
    recipients: repository,
    pushNotificationProvider,
    ...(notificationCenter ? { notificationCenter } : {}),
  });
  const eventMutations = new EventMutationModule({
    persistence: repository,
    importedEvents: {
      visibleEvents: (familyID, memberID) => calendarSources?.events(familyID, memberID) ?? Promise.resolve([]),
      sharedEvents: (familyID) => calendarSources?.sharedEvents(familyID) ?? Promise.resolve([]),
    },
    notificationDispatcher: scheduleUpdateNotificationDispatcher,
    ...(notificationCenter ? { notificationCenter } : {}),
  });
  const app = Fastify({ logger });
  fastifyRateLimit(
    app,
    { global: true, max: 120, timeWindow: 60_000 },
    () => {},
  );
  app.decorateRequest("account", null);
  const requestStarts = new WeakMap<object, bigint>();

  app.addHook("onRequest", async (request, reply) => {
    requestStarts.set(request, process.hrtime.bigint());
    reply.header("x-request-id", request.id);
  });
  app.addHook("onResponse", async (request, reply) => {
    const started = requestStarts.get(request);
    const duration = started ? Number(process.hrtime.bigint() - started) / 1_000_000_000 : 0;
    metrics.observeRequest(
      request.method,
      request.routeOptions.url ?? "unknown",
      reply.statusCode,
      duration,
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const suppliedStatus = typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
    const statusCode = typeof suppliedStatus === "number" && suppliedStatus < 500
      ? suppliedStatus
      : 500;
    const errorType = error instanceof Error ? error.name : "Error";
    request.log.error({ requestId: request.id, errorType, statusCode }, "request failed");
    return reply.code(statusCode).send({
      error: statusCode === 500 ? "internal_server_error" : errorType,
      requestID: request.id,
    });
  });

  app.addHook("onRequest", async (request, reply) => {
    const routeURL = request.routeOptions.url ?? "";
    if (
      routeURL === "/health" ||
      routeURL === "/ready" ||
      routeURL === "/metrics" ||
      routeURL === "/v1/auth/google" ||
      routeURL === "/v1/auth/apple"
    ) return;
    if (routeURL === "/v1/sessions" && request.method === "POST") return;
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "missing_bearer_token" });
    try {
      const identity = await identityProvider.verifySession(token);
      request.account = await repository.accountForIdentity(identity.subject);
      if (!request.account) return reply.code(403).send({ error: "account_not_provisioned" });
    } catch {
      return reply.code(401).send({ error: "invalid_session" });
    }
  });

  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  app.get("/ready", { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await readinessCheck();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  app.get("/metrics", { config: { rateLimit: false } }, async (request, reply) => {
    if (metricsBearerToken && bearerToken(request.headers.authorization) !== metricsBearerToken) {
      return reply.code(401).send({ error: "invalid_metrics_token" });
    }
    return reply.type(metrics.contentType).send(await metrics.render());
  });

  app.get("/v1/auth/google", async (request, reply) => {
    const parsed = oauthAuthorizationSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_code_challenge" });
    return reply.redirect(identityProvider.googleAuthorizationURL(parsed.data.codeChallenge));
  });

  app.get("/v1/auth/apple", async (request, reply) => {
    const parsed = oauthAuthorizationSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_code_challenge" });
    return reply.redirect(identityProvider.appleAuthorizationURL(parsed.data.codeChallenge));
  });

  app.post("/v1/sessions", {
    config: { rateLimit: limits.sessions },
  }, async (request, reply) => {
    const parsed = oauthSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_oauth_token" });
    try {
      const issued = await identityProvider.authenticateOAuthToken(
        parsed.data.oauthToken,
        parsed.data.codeVerifier,
      );
      const existingAccount = await repository.accountForIdentity(issued.identity.subject);
      let account: Account;
      if (parsed.data.invitationCode) {
        const consumption = await repository.consumeInvitation(
          invitationHash(parsed.data.invitationCode),
          issued.identity.subject,
          issued.identity.displayName,
        );
        if (consumption.status !== "accepted") {
          await identityProvider.revokeSession(issued.accessToken);
          return reply.code(consumption.status === "account_conflict" ? 409 : 403).send({
            error: consumption.status === "account_conflict"
              ? "invitation_account_conflict"
              : "invalid_invitation",
          });
        }
        account = consumption.account;
      } else {
        account = existingAccount ?? await repository.provisionParentAccount(
          issued.identity.subject,
          issued.identity.displayName,
        );
      }
      const members = await repository.membersForFamily(account.familyID);
      const member = members.find((candidate) => candidate.id === account.memberID);
      return {
        accountID: account.memberID,
        displayName: member?.name ?? issued.identity.displayName,
        role: account.role,
        accessToken: issued.accessToken,
      };
    } catch {
      return reply.code(401).send({ error: "invalid_oauth_token" });
    }
  });

  app.get("/v1/sessions", async (request) => {
    const account = requiredAccount(request);
    const members = await repository.membersForFamily(account.familyID);
    const member = members.find((candidate) => candidate.id === account.memberID);
    return {
      accountID: account.memberID,
      displayName: member?.name ?? account.memberID,
      role: account.role,
      accessToken: bearerToken(request.headers.authorization),
    };
  });

  app.delete("/v1/sessions", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "missing_bearer_token" });
    await identityProvider.revokeSession(token);
    return reply.code(204).send();
  });

  app.delete("/v1/account", async (request, reply) => {
    const account = requiredAccount(request);
    await identityProvider.deleteIdentity(account.identitySubject);
    await repository.deleteAccount(account.identitySubject);
    return reply.code(204).send();
  });

  app.post("/v1/invitations", {
    config: { rateLimit: limits.invitations },
  }, async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const parsed = invitationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_invitation" });
    if (parsed.data.role === "kid" && !parsed.data.guardianConsent) {
      return reply.code(400).send({ error: "guardian_consent_required" });
    }
    const code = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const id = randomUUID();
    await repository.saveInvitation({
      id,
      codeHash: invitationHash(code),
      familyID: account.familyID,
      recipientEmail: parsed.data.email,
      role: parsed.data.role,
      expiresAt,
      guardianConsentAt: parsed.data.role === "kid" ? new Date().toISOString() : null,
      guardianMemberID: parsed.data.role === "kid" ? account.memberID : null,
    });
    const members = await repository.membersForFamily(account.familyID);
    const inviterName = members.find((member) => member.id === account.memberID)?.name
      ?? "Your family";
    const invitationURL = invitationWebURL(code);
    try {
      await invitationEmailSender.send({
        recipientEmail: parsed.data.email,
        inviterName,
        role: parsed.data.role,
        invitationURL,
        expiresAt,
      });
    } catch {
      await repository.cancelInvitation(account.familyID, id);
      return reply.code(502).send({ error: "invitation_email_failed" });
    }
    await repository.markFamilyChanged(account.familyID);
    return reply.code(201).send({
      id,
      code,
      email: parsed.data.email,
      role: parsed.data.role,
      expiresAt,
    });
  });

  app.get("/v1/invitations", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    return (await repository.pendingInvitations(account.familyID)).map((invitation) => ({
      id: invitation.id,
      email: invitation.recipientEmail,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    }));
  });

  app.delete("/v1/invitations/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const cancelled = await repository.cancelInvitation(
      account.familyID,
      (request.params as { id: string }).id,
    );
    if (!cancelled) return reply.code(404).send({ error: "invitation_not_found" });
    await repository.markFamilyChanged(account.familyID);
    return reply.code(204).send();
  });

  app.post("/v1/invitations/:id/resend", {
    config: { rateLimit: limits.invitations },
  }, async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const invitationID = (request.params as { id: string }).id;
    const existing = (await repository.pendingInvitations(account.familyID))
      .find((invitation) => invitation.id === invitationID);
    if (!existing) return reply.code(404).send({ error: "invitation_not_found" });
    if (!existing.recipientEmail) {
      return reply.code(400).send({ error: "invitation_email_missing" });
    }
    const code = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const invitation = await repository.rotateInvitation(
      account.familyID,
      invitationID,
      invitationHash(code),
      expiresAt,
    );
    if (!invitation) return reply.code(404).send({ error: "invitation_not_found" });
    const members = await repository.membersForFamily(account.familyID);
    const inviterName = members.find((member) => member.id === account.memberID)?.name
      ?? "Your family";
    const invitationURL = invitationWebURL(code);
    try {
      await invitationEmailSender.send({
        recipientEmail: existing.recipientEmail,
        inviterName,
        role: invitation.role,
        invitationURL,
        expiresAt: invitation.expiresAt,
      });
    } catch {
      await repository.rotateInvitation(
        account.familyID,
        invitationID,
        existing.codeHash,
        existing.expiresAt,
      );
      return reply.code(502).send({ error: "invitation_email_failed" });
    }
    await repository.markFamilyChanged(account.familyID);
    return {
      id: invitation.id,
      code,
      email: existing.recipientEmail,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  });

  app.post("/v1/calendar-sources", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!calendarSources) return reply.code(503).send({ error: "calendar_sources_unavailable" });
    const parsed = calendarSourceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_calendar_source" });
    const familyMembers = await repository.membersForFamily(account.familyID);
    const memberIDs = new Set(familyMembers.map((member) => member.id));
    if (parsed.data.participantIDs.some((memberID) => !memberIDs.has(memberID))) {
      return reply.code(400).send({ error: "unknown_participant" });
    }
    const source = await calendarSources.connect({
      familyID: account.familyID,
      ownerMemberID: account.memberID,
      ...parsed.data,
    });
    if (source.visibility === "family") await repository.markFamilyChanged(account.familyID);
    return reply.code(201).send(source);
  });

  app.get("/v1/calendar-sources", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!calendarSources) return reply.code(503).send({ error: "calendar_sources_unavailable" });
    return calendarSources.list(account.familyID, account.memberID);
  });

  app.patch("/v1/calendar-sources/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!calendarSources) return reply.code(503).send({ error: "calendar_sources_unavailable" });
    const parsed = calendarSourceVisibilitySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_calendar_source_visibility" });
    const source = await calendarSources.updateVisibility(
      account.familyID,
      (request.params as { id: string }).id,
      account.memberID,
      parsed.data.visibility,
    );
    if (!source) return reply.code(404).send({ error: "calendar_source_not_found" });
    await repository.markFamilyChanged(account.familyID);
    return source;
  });

  app.delete("/v1/calendar-sources/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!calendarSources) return reply.code(503).send({ error: "calendar_sources_unavailable" });
    const deleted = await calendarSources.delete(
      account.familyID,
      (request.params as { id: string }).id,
      account.memberID,
    );
    if (!deleted) return reply.code(404).send({ error: "calendar_source_not_found" });
    if (deleted.visibility === "family") await repository.markFamilyChanged(account.familyID);
    return reply.code(204).send();
  });

  app.post("/v1/calendar-sources/:id/sync", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!calendarSources) return reply.code(503).send({ error: "calendar_sources_unavailable" });
    try {
      const source = await calendarSources.sync(
        account.familyID,
        (request.params as { id: string }).id,
        account.memberID,
      );
      if (!source) return reply.code(404).send({ error: "calendar_source_not_found" });
      if (source.visibility === "family") await repository.markFamilyChanged(account.familyID);
      return source;
    } catch {
      return reply.code(502).send({ error: "calendar_source_sync_failed" });
    }
  });

  app.get("/v1/modules/commuter", async (request, reply) => {
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    return clientCommuterState(await commuter.state(requiredAccount(request)));
  });

  app.get("/v1/modules/commuter/catalog", async (_request, reply) => {
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    return commuter.catalog(new Date());
  });

  app.put("/v1/modules/commuter", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    const installation = await commuter.enable(account);
    await repository.markFamilyChanged(account.familyID);
    return clientCommuterInstallation(installation);
  });

  app.patch("/v1/modules/commuter", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    const parsed = commuterInstallationStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_commuter_status" });
    await commuter.disable(account);
    await repository.markFamilyChanged(account.familyID);
    return reply.code(204).send();
  });

  app.delete("/v1/modules/commuter", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    await commuter.remove(account);
    await repository.markFamilyChanged(account.familyID);
    return reply.code(204).send();
  });

  app.post("/v1/modules/commuter/journeys/search", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    const parsed = commuterJourneySearchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_commuter_journey_search" });
    try {
      return await commuter.searchJourneys(account, parsed.data);
    } catch (error) {
      return commuterErrorReply(error, reply);
    }
  });

  app.post("/v1/modules/commuter/subscriptions", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    const parsed = commuterSubscriptionSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.originStopID === parsed.data.destinationStopID
      || parsed.data.windowEndMinutes <= parsed.data.windowStartMinutes) {
      return reply.code(400).send({ error: "invalid_commuter_subscription" });
    }
    try {
      const subscription = await commuter.createSubscription(account, parsed.data);
      if (subscription.visibility === "family") await repository.markFamilyChanged(account.familyID);
      return reply.code(201).send(clientCommuteSubscription(subscription));
    } catch (error) {
      return commuterErrorReply(error, reply);
    }
  });

  app.put("/v1/modules/commuter/subscriptions/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    const parsed = commuterSubscriptionSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.originStopID === parsed.data.destinationStopID
      || parsed.data.windowEndMinutes <= parsed.data.windowStartMinutes) {
      return reply.code(400).send({ error: "invalid_commuter_subscription" });
    }
    const parsedID = commuterSubscriptionIDSchema.safeParse((request.params as { id: string }).id);
    if (!parsedID.success) return reply.code(400).send({ error: "invalid_commuter_subscription_id" });
    const existing = (await commuter.state(account)).subscriptions
      .find((subscription) => subscription.id === parsedID.data);
    try {
      const subscription = await commuter.updateSubscription(account, parsedID.data, parsed.data);
      if (existing?.visibility === "family" || subscription.visibility === "family") {
        await repository.markFamilyChanged(account.familyID);
      }
      return clientCommuteSubscription(subscription);
    } catch (error) {
      return commuterErrorReply(error, reply);
    }
  });

  app.patch("/v1/modules/commuter/subscriptions/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    const parsed = commuterSubscriptionStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_commuter_subscription_status" });
    const parsedID = commuterSubscriptionIDSchema.safeParse((request.params as { id: string }).id);
    if (!parsedID.success) return reply.code(400).send({ error: "invalid_commuter_subscription_id" });
    try {
      const subscription = await commuter.setSubscriptionStatus(
        account,
        parsedID.data,
        parsed.data.status,
      );
      if (subscription.visibility === "family") await repository.markFamilyChanged(account.familyID);
      return clientCommuteSubscription(subscription);
    } catch (error) {
      return commuterErrorReply(error, reply);
    }
  });

  app.delete("/v1/modules/commuter/subscriptions/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    if (!commuter) return reply.code(503).send({ error: "commuter_unavailable" });
    const parsedID = commuterSubscriptionIDSchema.safeParse((request.params as { id: string }).id);
    if (!parsedID.success) return reply.code(400).send({ error: "invalid_commuter_subscription_id" });
    const subscriptionID = parsedID.data;
    const existing = (await commuter.state(account)).subscriptions
      .find((subscription) => subscription.id === subscriptionID);
    try {
      await commuter.removeSubscription(account, subscriptionID);
      if (existing?.visibility === "family") await repository.markFamilyChanged(account.familyID);
      return reply.code(204).send();
    } catch (error) {
      return commuterErrorReply(error, reply);
    }
  });

  app.get("/v1/reminders", async (request) => {
    const account = requiredAccount(request);
    const reminders = await repository.remindersForFamily(account.familyID);
    return reminders
      .filter((reminder) => account.role === "parent" || reminder.assigneeIDs.includes(account.memberID))
      .map(clientReminder);
  });

  app.put("/v1/reminders/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const parsed = reminderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_reminder", details: parsed.error.issues });
    const routeID = (request.params as { id: string }).id.toLowerCase();
    const reminderID = parsed.data.id.toLowerCase();
    if (routeID !== reminderID) return reply.code(400).send({ error: "reminder_id_mismatch" });
    const members = await repository.membersForFamily(account.familyID);
    const memberIDs = new Set(members.map((member) => member.id));
    if (parsed.data.assigneeIDs.some((memberID) => !memberIDs.has(memberID))) {
      return reply.code(400).send({ error: "unknown_assignee" });
    }
    const existing = (await repository.remindersForFamily(account.familyID))
      .find((reminder) => reminder.id.toLowerCase() === reminderID);
    const reminder: FamilyReminder = {
      ...parsed.data,
      id: reminderID,
      familyID: account.familyID,
      status: existing?.status ?? "open",
      completedAt: existing?.completedAt ?? null,
      completedByMemberID: existing?.completedByMemberID ?? null,
      createdByMemberID: existing?.createdByMemberID ?? account.memberID,
    };
    await repository.saveReminder(reminder);
    await repository.markFamilyChanged(account.familyID);
    return clientReminder(reminder);
  });

  app.post("/v1/reminders/:id/complete", async (request, reply) => {
    const account = requiredAccount(request);
    const reminderID = (request.params as { id: string }).id.toLowerCase();
    const reminder = (await repository.remindersForFamily(account.familyID))
      .find((candidate) => candidate.id.toLowerCase() === reminderID);
    if (!reminder) return reply.code(404).send({ error: "reminder_not_found" });
    if (account.role !== "parent" && !reminder.assigneeIDs.includes(account.memberID)) {
      return reply.code(403).send({ error: "reminder_assignee_required" });
    }
    if (reminder.status === "open") {
      reminder.status = "completed";
      reminder.completedAt = new Date().toISOString();
      reminder.completedByMemberID = account.memberID;
      await repository.saveReminder(reminder);
      await repository.markFamilyChanged(account.familyID);
    }
    return clientReminder(reminder);
  });

  app.post("/v1/reminders/:id/reopen", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const reminderID = (request.params as { id: string }).id.toLowerCase();
    const reminder = (await repository.remindersForFamily(account.familyID))
      .find((candidate) => candidate.id.toLowerCase() === reminderID);
    if (!reminder) return reply.code(404).send({ error: "reminder_not_found" });
    if (reminder.status === "completed") {
      reminder.status = "open";
      reminder.completedAt = null;
      reminder.completedByMemberID = null;
      await repository.saveReminder(reminder);
      await repository.markFamilyChanged(account.familyID);
    }
    return clientReminder(reminder);
  });

  app.delete("/v1/reminders/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const reminderID = (request.params as { id: string }).id.toLowerCase();
    const exists = (await repository.remindersForFamily(account.familyID))
      .some((candidate) => candidate.id.toLowerCase() === reminderID);
    if (!exists) return reply.code(404).send({ error: "reminder_not_found" });
    await repository.deleteReminder(account.familyID, reminderID);
    await repository.markFamilyChanged(account.familyID);
    return reply.code(204).send();
  });

  app.post("/v1/schedule-drafts", {
    config: { rateLimit: limits.scheduleDrafts },
  }, async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const parsed = scheduleDraftRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_schedule_draft_request" });
    const members = await repository.membersForFamily(account.familyID);
    const referenceDate = new Date();
    try {
      const result = scheduleDraftResultSchema.parse(await scheduleDraftExtractor.extract({
        ...parsed.data,
        referenceDate: referenceDate.toISOString(),
        members: members.map(({ id, name }) => ({ id, name })),
      }));
      const memberIDs = new Set(members.map(({ id }) => id));
      const earliest = referenceDate.getTime() - 366 * 24 * 60 * 60 * 1_000;
      const latest = referenceDate.getTime() + 2 * 366 * 24 * 60 * 60 * 1_000;
      for (const draft of result.drafts) {
        if (draft.memberIDs.some((id) => !memberIDs.has(id))) {
          throw new ScheduleDraftProviderError("invalid_response");
        }
        for (const value of [draft.startTime, draft.endTime, draft.dueAt]) {
          if (value && (new Date(value).getTime() < earliest || new Date(value).getTime() > latest)) {
            throw new ScheduleDraftProviderError("invalid_response");
          }
        }
      }
      return result;
    } catch (error) {
      const reason = error instanceof ScheduleDraftProviderError ? error.reason : "invalid_response";
      return reply.code(reason === "unavailable" ? 503 : 502).send({
        error: reason === "unavailable"
          ? "schedule_draft_extraction_unavailable"
          : "invalid_schedule_draft_response",
      });
    }
  });

  app.get("/v1/locations/search", {
    config: { rateLimit: limits.locations },
  }, async (request, reply) => {
    const parsed = locationSearchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_location_query" });
    try {
      return await locationSearchProvider.search(parsed.data.q);
    } catch {
      return reply.code(502).send({ error: "location_search_unavailable" });
    }
  });

  app.put("/v1/devices/:token", async (request, reply) => {
    const account = requiredAccount(request);
    const token = (request.params as { token: string }).token;
    if (token.length < 10 || token.length > 256) {
      return reply.code(400).send({ error: "invalid_device_token" });
    }
    await repository.saveDeviceToken(account.familyID, account.memberID, token);
    return reply.code(204).send();
  });

  app.delete("/v1/devices/:token", async (request, reply) => {
    const account = requiredAccount(request);
    await repository.deleteDeviceToken(
      account.memberID,
      (request.params as { token: string }).token,
    );
    return reply.code(204).send();
  });

  app.get("/v1/notifications", async (request, reply) => {
    const account = requiredAccount(request);
    if (!notificationCenter) return reply.code(503).send({ error: "notification_center_unavailable" });
    const records = await notificationCenter.list(account);
    return records.map(({ familyID: _familyID, memberID: _memberID,
      deduplicationDigest: _deduplicationDigest, ...record }) => record);
  });

  app.patch("/v1/notifications/:id/read", async (request, reply) => {
    const account = requiredAccount(request);
    if (!notificationCenter) return reply.code(503).send({ error: "notification_center_unavailable" });
    const id = (request.params as { id: string }).id;
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({ error: "invalid_notification_id" });
    }
    return await notificationCenter.markRead(account, id)
      ? reply.code(204).send()
      : reply.code(404).send({ error: "notification_not_found" });
  });

  app.delete("/v1/notifications/:id", async (request, reply) => {
    const account = requiredAccount(request);
    if (!notificationCenter) return reply.code(503).send({ error: "notification_center_unavailable" });
    const id = (request.params as { id: string }).id;
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({ error: "invalid_notification_id" });
    }
    return await notificationCenter.delete(account, id)
      ? reply.code(204).send()
      : reply.code(404).send({ error: "notification_not_found" });
  });

  app.get("/v1/changes", async (request) => {
    const account = requiredAccount(request);
    return { version: await repository.familyChangeVersion(account.familyID) };
  });

  app.get("/v1/events", async (request) => {
    const account = requiredAccount(request);
    const events = [
      ...await repository.eventsForFamily(account.familyID),
      ...(calendarSources ? await calendarSources.events(account.familyID, account.memberID) : []),
    ];
    const visible = account.role === "parent"
      ? events
      : events.filter((event) => event.participantIDs.includes(account.memberID));
    return visible.map(clientEvent);
  });

  app.put("/v1/events/:id", async (request, reply) => {
    const account = requiredAccount(request);
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_event", details: parsed.error.issues });
    const notifyParticipants = (request.query as { notifyParticipants?: string }).notifyParticipants !== "false";
    const routeID = (request.params as { id: string }).id.toLowerCase();
    const eventID = parsed.data.id.toLowerCase();
    if (routeID !== eventID) return reply.code(400).send({ error: "event_id_mismatch" });
    const idempotencyKey = mutationIdempotencyKey(request, reply);
    if (!idempotencyKey) return;
    const { recurrence, ...eventData } = parsed.data;
    try {
      return await eventMutations.save({
        account,
        idempotencyKey,
        notifyParticipants,
        event: {
          ...eventData,
          id: eventID,
          familyID: account.familyID,
          ...(recurrence !== undefined ? { recurrence } : {}),
        },
      });
    } catch (error) {
      if (error instanceof EventMutationError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      throw error;
    }
  });

  app.delete("/v1/events/:id", async (request, reply) => {
    const account = requiredAccount(request);
    const idempotencyKey = mutationIdempotencyKey(request, reply);
    if (!idempotencyKey) return;
    try {
      await eventMutations.delete({
        account,
        eventID: (request.params as { id: string }).id,
        idempotencyKey,
      });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof EventMutationError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post("/v1/events/recurring-edit", async (request, reply) => {
    const account = requiredAccount(request);
    const parsed = recurringEditSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_recurring_edit", details: parsed.error.issues });
    const idempotencyKey = mutationIdempotencyKey(request, reply);
     if (!idempotencyKey) return;
    const notifyParticipants = parsed.data.notifyParticipants ?? true;
    try {
      const result = await eventMutations.recurringEdit({
        account,
        idempotencyKey,
        notifyParticipants,
        upserts: parsed.data.upserts.map((parsedEvent) => {
          const { recurrence, ...eventData } = parsedEvent;
          return {
             ...eventData,
             id: parsedEvent.id.toLowerCase(),
             familyID: account.familyID,
              ...(recurrence !== undefined ? { recurrence } : {}),
             };
            }),
        deleteIDs: parsed.data.deleteIDs.map((id) => id.toLowerCase()),
          });
      return {
         conflicts: result.conflicts,
        notificationOutcome: result.notificationOutcome,
         };
       } catch (error) {
      if (error instanceof EventMutationError) {
        return reply.code(error.statusCode).send({ error: error.code });
         }
        throw error;
         }
     });

   app.get("/v1/family-members", async (request) => {
    const account = requiredAccount(request);
    return (await repository.membersForFamily(account.familyID)).map(clientMember);
  });

  app.put("/v1/family-members/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const parsed = memberSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_family_member", details: parsed.error.issues });
    const routeID = (request.params as { id: string }).id;
    if (routeID !== parsed.data.id) return reply.code(400).send({ error: "member_id_mismatch" });
    const { gradeOrBirthYear, ...memberData } = parsed.data;
    const member: FamilyMember = {
      ...memberData,
      familyID: account.familyID,
      ...(gradeOrBirthYear !== undefined ? { gradeOrBirthYear } : {}),
    };
    await repository.saveMember(member);
    await repository.markFamilyChanged(account.familyID);
    return reply.code(204).send();
  });

  app.delete("/v1/family-members/:id", async (request, reply) => {
    const account = await requireParent(request, reply);
    if (!account) return;
    const memberID = (request.params as { id: string }).id;
    const events = await repository.eventsForFamily(account.familyID);
    if (events.some((event) =>
      event.participantIDs.includes(memberID) || event.driverMemberID === memberID
    )) {
      return reply.code(409).send({ error: "member_has_scheduled_events" });
    }
    const reminders = await repository.remindersForFamily(account.familyID);
    if (reminders.some((reminder) =>
      reminder.status === "open" && reminder.assigneeIDs.includes(memberID)
    )) {
      return reply.code(409).send({ error: "member_has_open_reminders" });
    }
    await repository.deleteMember(account.familyID, memberID);
    await repository.markFamilyChanged(account.familyID);
    return reply.code(204).send();
  });

  return app;
}

function invitationWebURL(code: string): string {
  const url = new URL("https://rallyroo.dev/invite");
  url.hash = new URLSearchParams({ code }).toString();
  return url.toString();
}

function invitationHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function bearerToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function requiredAccount(request: FastifyRequest): Account {
  if (!request.account) throw new Error("Authentication hook did not provide an account");
  return request.account;
}

async function requireParent(request: FastifyRequest, reply: FastifyReply): Promise<Account | null> {
  const account = requiredAccount(request);
  if (account.role !== "parent") {
    await reply.code(403).send({ error: "parent_role_required" });
    return null;
  }
  return account;
}

function commuterErrorReply(error: unknown, reply: FastifyReply) {
  if (!(error instanceof CommuterModuleError)) throw error;
  switch (error.reason) {
  case "parent_required":
    return reply.code(403).send({ error: "parent_role_required" });
  case "module_not_enabled":
    return reply.code(409).send({ error: "commuter_not_enabled" });
  case "invalid_subscription":
    return reply.code(400).send({ error: "invalid_commuter_subscription" });
  case "invalid_journey_search":
    return reply.code(400).send({ error: "invalid_commuter_journey_search" });
  case "schedule_unavailable":
    return reply.code(503).send({ error: "commuter_schedule_unavailable" });
  case "subscription_not_found":
    return reply.code(404).send({ error: "commuter_subscription_not_found" });
  case "subscription_limit_reached":
    return reply.code(409).send({ error: "commuter_subscription_limit_reached" });
  }
}

function mutationIdempotencyKey(
  request: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const header = request.headers["idempotency-key"];
  if (header === undefined) return randomUUID();
  const parsed = z.string().uuid().safeParse(header);
  if (!parsed.success) {
    void reply.code(400).send({ error: "invalid_idempotency_key" });
    return null;
  }
  return parsed.data;
}

function clientCommuterState(state: Awaited<ReturnType<CommuterModule["state"]>>) {
  return {
    installation: state.installation
      ? clientCommuterInstallation(state.installation)
      : null,
    subscriptions: state.subscriptions.map(clientCommuteSubscription),
    providerStatus: state.providerStatus,
  };
}

function clientCommuterInstallation<Installation extends { familyID: string }>(
  { familyID: _familyID, ...installation }: Installation,
) {
  return installation;
}

function clientCommuteSubscription<Subscription extends { familyID: string }>(
  { familyID: _familyID, ...subscription }: Subscription,
) {
  return subscription;
}

function clientEvent({ familyID: _familyID, ...event }: FamilyEvent) {
  return event;
}

function clientReminder({ familyID: _familyID, createdByMemberID: _createdByMemberID, ...reminder }: FamilyReminder) {
  return reminder;
}

function clientMember({ familyID: _familyID, ...member }: FamilyMember) {
  return member;
}
