import "dotenv/config";
import { APNSPushNotificationProvider } from "./apns-push-notification-provider.js";
import { buildApp } from "./app.js";
import { calendarURLProtection, fetchPublicCalendarFeed } from "./calendar-source-adapters.js";
import { CalendarSourceModule } from "./calendar-source-module.js";
import { databasePoolConfiguration } from "./database-configuration.js";
import { InMemoryCache, type Cache } from "./cache.js";
import { CachedIdentityProvider } from "./cached-identity-provider.js";
import { CachedLocationSearchProvider } from "./cached-location-search-provider.js";
import {
  UnavailableInvitationEmailSender,
  type InvitationEmailSender,
} from "./invitation-email-sender.js";
import {
  EmptyLocationSearchProvider,
  GooglePlacesLocationSearchProvider,
  type LocationSearchProvider,
} from "./location-search-provider.js";
import { RallyrooMetrics } from "./metrics.js";
import { OllamaScheduleDraftExtractor } from "./ollama-schedule-draft-extractor.js";
import { PostgresRallyrooRepository } from "./postgres-repository.js";
import { NoopPushNotificationProvider } from "./push-notification-provider.js";
import { EventNotificationDispatcher } from "./event-notification-dispatcher.js";
import { ReminderNotificationDispatcher } from "./reminder-notification-dispatcher.js";
import { RedisCache } from "./redis-cache.js";
import { ResendInvitationEmailSender } from "./resend-invitation-email-sender.js";
import { configuredSecret } from "./runtime-configuration.js";
import { StytchIdentityProvider } from "./stytch-identity-provider.js";

const databaseConfiguration = await databasePoolConfiguration();

const cache: Cache = process.env.REDIS_URL
  ? await RedisCache.connect(process.env.REDIS_URL)
  : new InMemoryCache();
const metrics = new RallyrooMetrics();
const metricsBearerToken = configuredSecret("METRICS_BEARER_TOKEN");
const identityProvider = new CachedIdentityProvider(
  StytchIdentityProvider.fromEnvironment(),
  cache,
  60,
  metrics,
);
const googlePlacesAPIKey = configuredSecret("GOOGLE_PLACES_API_KEY");
const locationProvider: LocationSearchProvider = googlePlacesAPIKey
  ? new GooglePlacesLocationSearchProvider(googlePlacesAPIKey)
  : new EmptyLocationSearchProvider();

const repository = PostgresRallyrooRepository.fromConfiguration(databaseConfiguration);
const pushNotificationProvider = APNSPushNotificationProvider.fromEnvironment()
  ?? new NoopPushNotificationProvider();
const reminderNotificationDispatcher = new ReminderNotificationDispatcher({
  repository,
  pushNotificationProvider,
});
const eventNotificationDispatcher = new EventNotificationDispatcher({
  repository,
  pushNotificationProvider,
});
const calendarEncryptionKey = configuredSecret("CALENDAR_SOURCE_ENCRYPTION_KEY");
const calendarSources = calendarEncryptionKey
  ? new CalendarSourceModule({
    repository,
    ...calendarURLProtection(calendarEncryptionKey),
    fetchFeed: fetchPublicCalendarFeed,
  })
  : undefined;
const resendAPIKey = configuredSecret("RESEND_API_KEY");
const scheduleDraftExtractor = process.env.OLLAMA_BASE_URL
  ? new OllamaScheduleDraftExtractor({
    baseURL: new URL(process.env.OLLAMA_BASE_URL),
    model: process.env.OLLAMA_MODEL ?? "qwen3.8:27b-mlx",
  })
  : undefined;
const invitationEmailSender: InvitationEmailSender = resendAPIKey && process.env.INVITATION_EMAIL_FROM
  ? new ResendInvitationEmailSender({
    apiKey: resendAPIKey,
    from: process.env.INVITATION_EMAIL_FROM,
  })
  : new UnavailableInvitationEmailSender();
const app = buildApp({
  identityProvider,
  repository,
  invitationEmailSender,
  ...(calendarSources ? { calendarSources } : {}),
  ...(scheduleDraftExtractor ? { scheduleDraftExtractor } : {}),
  locationSearchProvider: new CachedLocationSearchProvider(
    locationProvider,
    cache,
    30 * 60,
    metrics,
  ),
  pushNotificationProvider,
  readinessCheck: () => repository.checkReadiness(),
  metrics,
  ...(metricsBearerToken
    ? { metricsBearerToken }
    : {}),
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "request.headers.authorization",
        "request.headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  },
});
let notificationDispatchIsRunning = false;
const notificationDispatchInterval = setInterval(async () => {
  if (notificationDispatchIsRunning) return;
  notificationDispatchIsRunning = true;
  try {
    const results = await Promise.allSettled([
      reminderNotificationDispatcher.dispatchDue(),
      eventNotificationDispatcher.dispatchDue(),
    ]);
    if (results[0]?.status === "rejected") {
      app.log.error({ error: results[0].reason }, "Reminder notification dispatch failed");
    }
    if (results[1]?.status === "rejected") {
      app.log.error({ error: results[1].reason }, "Event notification dispatch failed");
    }
  } finally {
    notificationDispatchIsRunning = false;
  }
}, 30_000);
notificationDispatchInterval.unref();

app.addHook("onClose", async () => {
  clearInterval(notificationDispatchInterval);
  await Promise.all([cache.close?.(), repository.close()]);
});

const port = Number(process.env.PORT ?? "3000");
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
void reminderNotificationDispatcher.dispatchDue().catch((error) => {
  app.log.error({ error }, "Initial reminder notification dispatch failed");
});
void eventNotificationDispatcher.dispatchDue().catch((error) => {
  app.log.error({ error }, "Initial event notification dispatch failed");
});
