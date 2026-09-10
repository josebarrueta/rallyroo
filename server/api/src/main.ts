import "dotenv/config";
import { APNSPushNotificationProvider } from "./apns-push-notification-provider.js";
import { buildApp } from "./app.js";
import { calendarURLProtection, fetchPublicCalendarFeed } from "./calendar-source-adapters.js";
import { CalendarSourceModule } from "./calendar-source-module.js";
import { CaltrainScheduleRefresher } from "./caltrain-schedule-refresher.js";
import { CaltrainCommutePoller } from "./caltrain-commute-poller.js";
import { CaltrainPollingScheduler } from "./caltrain-polling-scheduler.js";
import { CommuterAlertDispatcher } from "./commuter-alert-dispatcher.js";
import { CommuterModule } from "./commuter-module.js";
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
import { ScheduleUpdateNotificationDispatcher } from "./schedule-update-notification-dispatcher.js";
import { RedisCache } from "./redis-cache.js";
import { ResendInvitationEmailSender } from "./resend-invitation-email-sender.js";
import {
  caltrainPollingConfiguration,
  configuredSecret,
} from "./runtime-configuration.js";
import { SF511Client } from "./sf511-client.js";
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

const familyDataEncryptionKey = configuredSecret("FAMILY_DATA_ENCRYPTION_KEY");
if (!familyDataEncryptionKey) {
  throw new Error("FAMILY_DATA_ENCRYPTION_KEY is required");
}
const repository = PostgresRallyrooRepository.fromConfiguration(
  databaseConfiguration,
  familyDataEncryptionKey,
);
await repository.validateFamilyDataEncryption();
const apnsPushNotificationProvider = APNSPushNotificationProvider.fromEnvironment();
const pushNotificationProvider = apnsPushNotificationProvider
  ?? new NoopPushNotificationProvider();
const reminderNotificationDispatcher = new ReminderNotificationDispatcher({
  repository,
  pushNotificationProvider,
});
const eventNotificationDispatcher = new EventNotificationDispatcher({
  repository,
  pushNotificationProvider,
});
const scheduleUpdateNotificationDispatcher = new ScheduleUpdateNotificationDispatcher({
  persistence: repository,
  recipients: repository,
  pushNotificationProvider,
});
const commuterAlertDispatcher = apnsPushNotificationProvider
  ? new CommuterAlertDispatcher({
    repository,
    pushNotificationProvider: apnsPushNotificationProvider,
  })
  : undefined;
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
const commuter = new CommuterModule(repository);
const caltrainPolling = caltrainPollingConfiguration();
const sf511APIKey = caltrainPolling.enabled ? configuredSecret("SF511_API_KEY") : undefined;
if (caltrainPolling.enabled && !sf511APIKey) {
  throw new Error("SF511_API_KEY is required when Caltrain polling is enabled");
}
const app = buildApp({
  identityProvider,
  repository,
  commuter,
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
let familyDataProtectionIsRunning = false;
const protectLegacyFamilyData = async (): Promise<void> => {
  if (familyDataProtectionIsRunning) return;
  familyDataProtectionIsRunning = true;
  try {
    const protectedCount = await repository.protectLegacyFamilyData(100);
    if (protectedCount > 0) {
      app.log.info({ protectedCount }, "Protected legacy Family data");
    }
  } catch (error) {
    app.log.error({ error }, "Legacy Family data protection failed");
  } finally {
    familyDataProtectionIsRunning = false;
  }
};
await protectLegacyFamilyData();
const familyDataProtectionInterval = setInterval(() => {
  void protectLegacyFamilyData();
}, 30_000);
familyDataProtectionInterval.unref();

let notificationDispatchIsRunning = false;
const notificationDispatchInterval = setInterval(async () => {
  if (notificationDispatchIsRunning) return;
  notificationDispatchIsRunning = true;
  try {
    const dispatches = [
      { name: "Reminder notification", operation: reminderNotificationDispatcher.dispatchDue() },
      { name: "Event notification", operation: eventNotificationDispatcher.dispatchDue() },
      { name: "Schedule update notification", operation: scheduleUpdateNotificationDispatcher.dispatchDue() },
      ...(commuterAlertDispatcher
        ? [{ name: "Commuter alert", operation: commuterAlertDispatcher.dispatchDue() }]
        : []),
    ];
    const results = await Promise.allSettled(dispatches.map((dispatch) => dispatch.operation));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        app.log.error({ error: result.reason }, `${dispatches[index]!.name} dispatch failed`);
      }
    });
  } finally {
    notificationDispatchIsRunning = false;
  }
}, 30_000);
notificationDispatchInterval.unref();

const caltrainPollingAbort = new AbortController();
let caltrainPollingTask: Promise<void> | undefined;
if (caltrainPolling.enabled && sf511APIKey) {
  const client = new SF511Client(sf511APIKey);
  const catalogRefresher = new CaltrainScheduleRefresher(client, commuter);
  const commutePoller = new CaltrainCommutePoller(client, commuter);
  let nextCatalogRefreshAtMilliseconds: number | undefined;
  const scheduler = new CaltrainPollingScheduler({
    intervalMilliseconds: caltrainPolling.intervalMilliseconds,
    maximumBackoffMilliseconds: caltrainPolling.maximumBackoffMilliseconds,
    poll: async (attemptedAt) => {
      if (nextCatalogRefreshAtMilliseconds === undefined) {
        const schedule = await commuter.providerSchedule();
        nextCatalogRefreshAtMilliseconds = schedule
          ? new Date(schedule.observedAt).getTime() + 24 * 60 * 60 * 1_000
          : 0;
      }
      const catalogIsDue = attemptedAt.getTime() >= nextCatalogRefreshAtMilliseconds;
      if (catalogIsDue) {
        // Advance before attempting so catalog failures do not starve real-time fan-out.
        nextCatalogRefreshAtMilliseconds = attemptedAt.getTime() + 24 * 60 * 60 * 1_000;
      }
      const startedAt = performance.now();
      const operation = catalogIsDue
        ? { name: "sf511_caltrain_catalog", run: () => catalogRefresher.refresh(attemptedAt) }
        : { name: "sf511_caltrain_realtime", run: () => commutePoller.poll(attemptedAt) };
      try {
        await operation.run();
        metrics.observeProvider(operation.name, "success", (performance.now() - startedAt) / 1_000);
      } catch (error) {
        metrics.observeProvider(operation.name, "failure", (performance.now() - startedAt) / 1_000);
        if (catalogIsDue && !await commuter.providerSchedule()) {
          nextCatalogRefreshAtMilliseconds = attemptedAt.getTime() + 60 * 60 * 1_000;
        }
        throw error;
      }
    },
    onFailure: ({ throttled, nextAttemptInSeconds }) => {
      app.log.warn({ throttled, nextAttemptInSeconds }, "Caltrain polling deferred");
    },
  });
  caltrainPollingTask = scheduler.run(caltrainPollingAbort.signal).catch((error) => {
    if (!caltrainPollingAbort.signal.aborted) {
      app.log.error({ error }, "Caltrain polling scheduler stopped");
    }
  });
}

app.addHook("onClose", async () => {
  clearInterval(familyDataProtectionInterval);
  clearInterval(notificationDispatchInterval);
  caltrainPollingAbort.abort();
  await caltrainPollingTask;
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
void scheduleUpdateNotificationDispatcher.dispatchDue().catch((error) => {
  app.log.error({ error }, "Initial schedule update notification dispatch failed");
});
if (commuterAlertDispatcher) {
  void commuterAlertDispatcher.dispatchDue().catch((error) => {
    app.log.error({ error }, "Initial Commuter alert dispatch failed");
  });
}
