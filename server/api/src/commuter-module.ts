import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Account } from "./domain.js";
import type { CaltrainStaticScheduleSnapshot } from "./caltrain-static-schedule.js";
import {
  searchCaltrainJourneys,
  type CaltrainJourneyOption,
  type CaltrainJourneySearch,
} from "./caltrain-schedule-search.js";

const subscriptionDetailsSchema = z.object({
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
  scheduleOptionID: z.string().trim().min(1).max(200).optional().nullable(),
  scheduledDepartureMinutes: z.number().int().min(0).max(1439).optional().nullable(),
  scheduledArrivalMinutes: z.number().int().min(0).max(1439).optional().nullable(),
  scheduleVersion: z.string().trim().min(1).max(200).optional().nullable(),
}).strict().refine((value) => value.originStopID !== value.destinationStopID)
  .refine((value) => value.windowEndMinutes > value.windowStartMinutes)
  .refine((value) => {
    const scheduleFields = [
      value.scheduleOptionID,
      value.scheduledDepartureMinutes,
      value.scheduledArrivalMinutes,
      value.scheduleVersion,
    ];
    return scheduleFields.every((field) => field === undefined || field === null)
      || scheduleFields.every((field) => field !== undefined && field !== null);
  });

const transitConditionSchema = z.object({
  scope: z.enum(["trip", "disruption"]).optional(),
  id: z.string().min(1).max(300),
  agencyID: z.literal("CT"),
  routeID: z.string().min(1).max(200),
  directionID: z.string().min(1).max(200),
  stopIDs: z.array(z.string().min(1).max(200)).max(500),
  serviceWeekday: z.number().int().min(1).max(7),
  scheduledMinutes: z.number().int().min(0).max(1439),
  scheduledStops: z.array(z.object({
    stopID: z.string().min(1).max(200),
    scheduledMinutes: z.number().int().min(0).max(1439),
    delayMinutes: z.number().int().min(0).max(1440),
  }).strict()).max(500).optional(),
  kind: z.enum(["delay", "cancellation"]),
  delayMinutes: z.number().int().min(0).max(1440),
  observedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
}).strict();

export interface CommuterInstallation {
  familyID: string;
  enabledByMemberID: string;
  status: "enabled" | "disabled";
}

export type CommuteSubscriptionVisibility = "personal" | "family";
export type CommuteSubscriptionStatus = "active" | "paused";
export type CommuteAlertKind = "delay" | "cancellation";

export interface CommuteSubscription {
  id: string;
  familyID: string;
  ownerMemberID: string;
  visibility: CommuteSubscriptionVisibility;
  agencyID: "CT";
  routeID: string;
  directionID: string;
  originStopID: string;
  destinationStopID: string;
  serviceWeekdays: number[];
  windowStartMinutes: number;
  windowEndMinutes: number;
  alertKinds: CommuteAlertKind[];
  minimumDelayMinutes: number;
  status: CommuteSubscriptionStatus;
  scheduleOptionID?: string | null;
  scheduledDepartureMinutes?: number | null;
  scheduledArrivalMinutes?: number | null;
  scheduleVersion?: string | null;
  scheduleAvailability?: "available" | "needs_reselection";
}

export interface NewCommuteSubscription {
  visibility: CommuteSubscriptionVisibility;
  agencyID: "CT";
  routeID: string;
  directionID: string;
  originStopID: string;
  destinationStopID: string;
  serviceWeekdays: number[];
  windowStartMinutes: number;
  windowEndMinutes: number;
  alertKinds: readonly CommuteAlertKind[];
  minimumDelayMinutes: number;
  scheduleOptionID?: string | null | undefined;
  scheduledDepartureMinutes?: number | null | undefined;
  scheduledArrivalMinutes?: number | null | undefined;
  scheduleVersion?: string | null | undefined;
}

export interface TransitCondition {
  scope?: "trip" | "disruption";
  id: string;
  agencyID: "CT";
  routeID: string;
  directionID: string;
  stopIDs: string[];
  serviceWeekday: number;
  scheduledMinutes: number;
  scheduledStops?: Array<{
    stopID: string;
    scheduledMinutes: number;
    delayMinutes: number;
  }>;
  kind: CommuteAlertKind;
  delayMinutes: number;
  observedAt: string;
  validUntil: string;
}

export interface CommuteAlertIntent {
  id: string;
  subscriptionID: string;
  familyID: string;
  conditionID: string;
  kind: CommuteAlertKind;
  delayMinutes: number;
  expiresAt: string;
  audience: { kind: "member"; memberID: string } | { kind: "family" };
}

export type CommuterProviderFeed = "catalog" | "realtime";
export type CommuterProviderHealth = "unavailable" | "healthy" | "degraded" | "stale";

export interface CommuterProviderFeedObservation {
  agencyID: "CT";
  feed: CommuterProviderFeed;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptSucceeded: boolean | null;
}

export interface CommuterProviderFeedStatus {
  state: CommuterProviderHealth;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
}

export interface CommuterProviderStatus {
  catalog: CommuterProviderFeedStatus;
  realtime: CommuterProviderFeedStatus;
}

export interface CaltrainStop {
  id: string;
  stationID: string;
  stationName: string;
  direction: "northbound" | "southbound" | "unknown";
  latitude: number;
  longitude: number;
  validFrom: string;
  validUntil: string;
}

export interface CaltrainStopsSnapshot {
  observedAt: string;
  stops: CaltrainStop[];
}

export interface CaltrainCatalog {
  status: CommuterProviderFeedStatus;
  observedAt: string | null;
  stops: CaltrainStop[];
}

export interface CaltrainJourneySearchResult {
  scheduleVersion: string;
  observedAt: string;
  validUntil: string;
  status: CommuterProviderFeedStatus;
  options: CaltrainJourneyOption[];
}

export interface CommuterState {
  installation: CommuterInstallation | null;
  subscriptions: CommuteSubscription[];
  providerStatus: CommuterProviderStatus;
}

export interface CommuterRepository {
  installation(familyID: string): Promise<CommuterInstallation | null>;
  saveInstallationIfAbsent(installation: CommuterInstallation): Promise<CommuterInstallation>;
  setInstallationStatus(
    familyID: string,
    status: CommuterInstallation["status"],
  ): Promise<CommuterInstallation | null>;
  removeInstallationAndState(familyID: string): Promise<void>;
  subscriptionsForFamily(familyID: string): Promise<CommuteSubscription[]>;
  saveSubscription(subscription: CommuteSubscription): Promise<void>;
  saveSubscriptionIfCapacity(subscription: CommuteSubscription, maximum: number): Promise<boolean>;
  subscription(familyID: string, subscriptionID: string): Promise<CommuteSubscription | null>;
  removeSubscription(familyID: string, subscriptionID: string): Promise<void>;
  activeSubscriptionsForAgency(agencyID: "CT"): Promise<CommuteSubscription[]>;
  saveAlertsIfAbsent(alerts: CommuteAlertIntent[]): Promise<CommuteAlertIntent[]>;
  providerFeedObservation(
    agencyID: "CT",
    feed: CommuterProviderFeed,
  ): Promise<CommuterProviderFeedObservation | null>;
  saveProviderFeedAttempt(
    agencyID: "CT",
    feed: CommuterProviderFeed,
    attemptedAt: string,
    succeeded: boolean,
  ): Promise<void>;
  replaceCaltrainCatalog(snapshot: CaltrainStopsSnapshot, attemptedAt: string): Promise<void>;
  caltrainCatalog(): Promise<{ observedAt: string | null; stops: CaltrainStop[] }>;
  replaceCaltrainSchedule(
    snapshot: CaltrainStaticScheduleSnapshot,
    attemptedAt: string,
  ): Promise<void>;
  caltrainSchedule(): Promise<CaltrainStaticScheduleSnapshot | null>;
}

export type CommuterModuleErrorReason =
  | "parent_required"
  | "module_not_enabled"
  | "invalid_subscription"
  | "invalid_journey_search"
  | "schedule_unavailable"
  | "subscription_not_found"
  | "subscription_limit_reached";

export class CommuterModuleError extends Error {
  constructor(public readonly reason: CommuterModuleErrorReason) {
    super(reason);
    this.name = "CommuterModuleError";
  }
}

export class CommuterModule {
  constructor(private readonly repository: CommuterRepository) {}

  async enable(account: Account): Promise<CommuterInstallation> {
    requireParent(account);
    const installation = await this.repository.saveInstallationIfAbsent({
      familyID: account.familyID,
      enabledByMemberID: account.memberID,
      status: "enabled",
    });
    if (installation.status === "enabled") return installation;
    const enabled = await this.repository.setInstallationStatus(account.familyID, "enabled");
    if (!enabled) throw new CommuterModuleError("module_not_enabled");
    return enabled;
  }

  async disable(account: Account): Promise<void> {
    requireParent(account);
    await this.repository.setInstallationStatus(account.familyID, "disabled");
  }

  async remove(account: Account): Promise<void> {
    requireParent(account);
    await this.repository.removeInstallationAndState(account.familyID);
  }

  async state(account: Account, now: Date = new Date()): Promise<CommuterState> {
    const providerStatus = await this.providerStatus(now);
    const installation = await this.repository.installation(account.familyID);
    if (!installation) return { installation: null, subscriptions: [], providerStatus };
    const visibleSubscriptions = (await this.repository.subscriptionsForFamily(account.familyID))
      .filter((subscription) => (
        subscription.visibility === "family" || subscription.ownerMemberID === account.memberID
      ));
    const needsSchedule = visibleSubscriptions.some((subscription) => subscription.scheduleOptionID);
    const schedule = needsSchedule ? await this.repository.caltrainSchedule() : null;
    const subscriptions = visibleSubscriptions.map((subscription) => (
      subscription.scheduleOptionID
        ? {
          ...subscription,
          scheduleAvailability: scheduledSubscriptionIsAvailable(
            subscription,
            schedule,
            caltrainLocalDate(now),
          )
            ? "available" as const
            : "needs_reselection" as const,
        }
        : subscription
    ));
    return { installation, subscriptions, providerStatus };
  }

  async providerStatus(now: Date): Promise<CommuterProviderStatus> {
    const [catalog, realtime] = await Promise.all([
      this.repository.providerFeedObservation("CT", "catalog"),
      this.repository.providerFeedObservation("CT", "realtime"),
    ]);
    return {
      catalog: feedStatus(catalog, now, 48 * 60 * 60 * 1_000),
      realtime: feedStatus(realtime, now, 3 * 60 * 1_000),
    };
  }

  async recordProviderSuccess(feed: CommuterProviderFeed, attemptedAt: Date): Promise<void> {
    requireValidObservationDate(attemptedAt);
    await this.repository.saveProviderFeedAttempt("CT", feed, attemptedAt.toISOString(), true);
  }

  async recordProviderFailure(feed: CommuterProviderFeed, attemptedAt: Date): Promise<void> {
    requireValidObservationDate(attemptedAt);
    await this.repository.saveProviderFeedAttempt("CT", feed, attemptedAt.toISOString(), false);
  }

  async replaceCatalog(snapshot: CaltrainStopsSnapshot, attemptedAt: Date): Promise<void> {
    requireValidObservationDate(attemptedAt);
    if (snapshot.stops.length < 1 || snapshot.stops.length > 500) {
      throw new Error("Invalid Caltrain catalog size");
    }
    await this.repository.replaceCaltrainCatalog(snapshot, attemptedAt.toISOString());
  }

  async catalog(now: Date): Promise<CaltrainCatalog> {
    const [stored, observation] = await Promise.all([
      this.repository.caltrainCatalog(),
      this.repository.providerFeedObservation("CT", "catalog"),
    ]);
    return {
      status: feedStatus(observation, now, 48 * 60 * 60 * 1_000),
      observedAt: stored.observedAt,
      stops: stored.stops,
    };
  }

  async replaceSchedule(
    snapshot: CaltrainStaticScheduleSnapshot,
    attemptedAt: Date,
  ): Promise<void> {
    requireValidObservationDate(attemptedAt);
    await this.repository.replaceCaltrainSchedule(snapshot, attemptedAt.toISOString());
  }

  async providerSchedule(): Promise<CaltrainStaticScheduleSnapshot | null> {
    return this.repository.caltrainSchedule();
  }

  async searchJourneys(
    account: Account,
    search: CaltrainJourneySearch,
    now: Date = new Date(),
  ): Promise<CaltrainJourneySearchResult> {
    requireParent(account);
    if ((await this.repository.installation(account.familyID))?.status !== "enabled") {
      throw new CommuterModuleError("module_not_enabled");
    }
    const schedule = await this.repository.caltrainSchedule();
    const today = caltrainLocalDate(now);
    if (!schedule || today < schedule.validFrom || today > schedule.validUntil) {
      throw new CommuterModuleError("schedule_unavailable");
    }
    const observation = await this.repository.providerFeedObservation("CT", "catalog");
    try {
      return {
        scheduleVersion: schedule.version,
        observedAt: schedule.observedAt,
        validUntil: schedule.validUntil,
        status: feedStatus(observation, now, 48 * 60 * 60 * 1_000),
        options: searchCaltrainJourneys(schedule, search, today),
      };
    } catch {
      throw new CommuterModuleError("invalid_journey_search");
    }
  }

  async createSubscription(
    account: Account,
    input: NewCommuteSubscription,
    now: Date = new Date(),
  ): Promise<CommuteSubscription> {
    requireParent(account);
    if ((await this.repository.installation(account.familyID))?.status !== "enabled") {
      throw new CommuterModuleError("module_not_enabled");
    }
    let details = validatedSubscriptionDetails(input);
    if (details.scheduleOptionID) {
      const schedule = await this.repository.caltrainSchedule();
      const today = caltrainLocalDate(now);
      if (!schedule || today < schedule.validFrom || today > schedule.validUntil) {
        throw new CommuterModuleError("schedule_unavailable");
      }
      if (details.scheduleVersion !== schedule.version) {
        throw new CommuterModuleError("invalid_subscription");
      }
      const origin = schedule.stops.find((stop) => stop.id === details.originStopID);
      const destination = schedule.stops.find((stop) => stop.id === details.destinationStopID);
      if (!origin || !destination) throw new CommuterModuleError("invalid_subscription");
      const option = searchCaltrainJourneys(schedule, {
        originStationID: origin.stationID,
        destinationStationID: destination.stationID,
        serviceWeekdays: details.serviceWeekdays,
      }, today).find((candidate) => candidate.id === details.scheduleOptionID);
      if (!option
        || option.originStopID !== details.originStopID
        || option.destinationStopID !== details.destinationStopID
        || option.directionID !== details.directionID
        || option.departureMinutes !== details.scheduledDepartureMinutes
        || option.arrivalMinutes !== details.scheduledArrivalMinutes) {
        throw new CommuterModuleError("invalid_subscription");
      }
      details = {
        ...details,
        routeID: "*",
        windowStartMinutes: option.departureMinutes,
        windowEndMinutes: Math.min(option.departureMinutes + 1, 1_440),
      };
    }
    const subscription: CommuteSubscription = {
      ...details,
      visibility: input.visibility,
      id: randomUUID(),
      familyID: account.familyID,
      ownerMemberID: account.memberID,
      serviceWeekdays: [...new Set(details.serviceWeekdays)].sort((left, right) => left - right),
      alertKinds: [...new Set(details.alertKinds)],
      status: "active",
      scheduleOptionID: details.scheduleOptionID ?? null,
      scheduledDepartureMinutes: details.scheduledDepartureMinutes ?? null,
      scheduledArrivalMinutes: details.scheduledArrivalMinutes ?? null,
      scheduleVersion: details.scheduleVersion ?? null,
    };
    if (!await this.repository.saveSubscriptionIfCapacity(subscription, 20)) {
      throw new CommuterModuleError("subscription_limit_reached");
    }
    return subscription;
  }

  async updateSubscription(
    account: Account,
    subscriptionID: string,
    input: NewCommuteSubscription,
    now: Date = new Date(),
  ): Promise<CommuteSubscription> {
    requireParent(account);
    if ((await this.repository.installation(account.familyID))?.status !== "enabled") {
      throw new CommuterModuleError("module_not_enabled");
    }
    const existing = await this.repository.subscription(account.familyID, subscriptionID);
    if (!existing
      || (existing.visibility === "personal" && existing.ownerMemberID !== account.memberID)
      || (input.visibility === "personal" && existing.ownerMemberID !== account.memberID)) {
      throw new CommuterModuleError("subscription_not_found");
    }
    let details = validatedSubscriptionDetails(input);
    if (details.scheduleOptionID) {
      const schedule = await this.repository.caltrainSchedule();
      const today = caltrainLocalDate(now);
      if (!schedule || today < schedule.validFrom || today > schedule.validUntil) {
        throw new CommuterModuleError("schedule_unavailable");
      }
      if (details.scheduleVersion !== schedule.version) {
        throw new CommuterModuleError("invalid_subscription");
      }
      const origin = schedule.stops.find((stop) => stop.id === details.originStopID);
      const destination = schedule.stops.find((stop) => stop.id === details.destinationStopID);
      if (!origin || !destination) throw new CommuterModuleError("invalid_subscription");
      const option = searchCaltrainJourneys(schedule, {
        originStationID: origin.stationID,
        destinationStationID: destination.stationID,
        serviceWeekdays: details.serviceWeekdays,
      }, today).find((candidate) => candidate.id === details.scheduleOptionID);
      if (!option
        || option.originStopID !== details.originStopID
        || option.destinationStopID !== details.destinationStopID
        || option.directionID !== details.directionID
        || option.departureMinutes !== details.scheduledDepartureMinutes
        || option.arrivalMinutes !== details.scheduledArrivalMinutes) {
        throw new CommuterModuleError("invalid_subscription");
      }
      details = {
        ...details,
        routeID: "*",
        windowStartMinutes: option.departureMinutes,
        windowEndMinutes: Math.min(option.departureMinutes + 1, 1_440),
      };
    }
    const updated: CommuteSubscription = {
      ...existing,
      ...details,
      visibility: input.visibility,
      serviceWeekdays: [...new Set(details.serviceWeekdays)].sort((left, right) => left - right),
      alertKinds: [...new Set(details.alertKinds)],
      scheduleOptionID: details.scheduleOptionID ?? null,
      scheduledDepartureMinutes: details.scheduledDepartureMinutes ?? null,
      scheduledArrivalMinutes: details.scheduledArrivalMinutes ?? null,
      scheduleVersion: details.scheduleVersion ?? null,
    };
    await this.repository.saveSubscription(updated);
    return updated;
  }

  async removeSubscription(account: Account, subscriptionID: string): Promise<void> {
    requireParent(account);
    const subscription = await this.repository.subscription(account.familyID, subscriptionID);
    if (
      !subscription
      || (subscription.visibility === "personal" && subscription.ownerMemberID !== account.memberID)
    ) {
      throw new CommuterModuleError("subscription_not_found");
    }
    await this.repository.removeSubscription(account.familyID, subscriptionID);
  }

  async processTransitConditions(
    conditions: TransitCondition[],
    now: Date,
  ): Promise<CommuteAlertIntent[]> {
    if (conditions.length > 5_000
      || conditions.some((condition) => !transitConditionSchema.safeParse(condition).success)) {
      throw new Error("Invalid Commuter provider snapshot");
    }
    const subscriptions = await this.repository.activeSubscriptionsForAgency("CT");
    const schedule = subscriptions.some((subscription) => subscription.scheduleOptionID)
      ? await this.repository.caltrainSchedule()
      : null;
    const candidates: CommuteAlertIntent[] = [];
    for (const condition of conditions) {
      if (!isFresh(condition, now)) continue;
      for (const subscription of subscriptions) {
        if (subscription.scheduleOptionID
          && !scheduledSubscriptionIsAvailable(
            subscription,
            schedule,
            caltrainLocalDate(now),
          )) continue;
        const matchedDelayMinutes = matchDelayMinutes(subscription, condition);
        if (matchedDelayMinutes === null) continue;
        if (candidates.length >= 10_000) {
          throw new Error("Commuter alert fan-out limit exceeded");
        }
        const alert: CommuteAlertIntent = {
          id: randomUUID(),
          subscriptionID: subscription.id,
          familyID: subscription.familyID,
          conditionID: condition.id,
          kind: condition.kind,
          delayMinutes: matchedDelayMinutes,
          expiresAt: condition.validUntil,
          audience: subscription.visibility === "personal"
            ? { kind: "member", memberID: subscription.ownerMemberID }
            : { kind: "family" },
        };
        candidates.push(alert);
      }
    }
    return this.repository.saveAlertsIfAbsent(candidates);
  }

  async setSubscriptionStatus(
    account: Account,
    subscriptionID: string,
    status: CommuteSubscriptionStatus,
  ): Promise<CommuteSubscription> {
    requireParent(account);
    const subscription = await this.repository.subscription(account.familyID, subscriptionID);
    if (
      !subscription
      || (subscription.visibility === "personal" && subscription.ownerMemberID !== account.memberID)
    ) {
      throw new CommuterModuleError("subscription_not_found");
    }
    const updated = { ...subscription, status };
    await this.repository.saveSubscription(updated);
    return updated;
  }
}

function requireParent(account: Account): void {
  if (account.role !== "parent") throw new CommuterModuleError("parent_required");
}

function validatedSubscriptionDetails(input: NewCommuteSubscription) {
  const { visibility, ...details } = input;
  const parsed = subscriptionDetailsSchema.safeParse(details);
  if ((visibility !== "personal" && visibility !== "family") || !parsed.success) {
    throw new CommuterModuleError("invalid_subscription");
  }
  return parsed.data;
}

export function parseCommuteSubscriptionDetails(plaintext: string) {
  const parsed = subscriptionDetailsSchema.parse(JSON.parse(plaintext));
  if (parsed.scheduleOptionID || parsed.scheduledDepartureMinutes !== undefined || parsed.scheduledArrivalMinutes !== undefined || parsed.scheduleVersion) {
    return {
      agencyID: parsed.agencyID,
      routeID: parsed.routeID,
      directionID: parsed.directionID,
      originStopID: parsed.originStopID,
      destinationStopID: parsed.destinationStopID,
      serviceWeekdays: parsed.serviceWeekdays,
      windowStartMinutes: parsed.windowStartMinutes,
      windowEndMinutes: parsed.windowEndMinutes,
      alertKinds: parsed.alertKinds,
      minimumDelayMinutes: parsed.minimumDelayMinutes,
      scheduleOptionID: parsed.scheduleOptionID ?? null,
      scheduledDepartureMinutes: parsed.scheduledDepartureMinutes ?? null,
      scheduledArrivalMinutes: parsed.scheduledArrivalMinutes ?? null,
      scheduleVersion: parsed.scheduleVersion ?? null,
    };
  }
  return parsed;
}

function feedStatus(
  observation: CommuterProviderFeedObservation | null,
  now: Date,
  staleAfterMilliseconds: number,
): CommuterProviderFeedStatus {
  if (!observation?.lastSuccessAt) {
    return {
      state: "unavailable",
      lastSuccessAt: null,
      lastAttemptAt: observation?.lastAttemptAt ?? null,
    };
  }
  const lastSuccess = new Date(observation.lastSuccessAt).getTime();
  const stale = !Number.isFinite(lastSuccess)
    || now.getTime() - lastSuccess > staleAfterMilliseconds;
  return {
    state: stale
      ? "stale"
      : observation.lastAttemptSucceeded === false ? "degraded" : "healthy",
    lastSuccessAt: observation.lastSuccessAt,
    lastAttemptAt: observation.lastAttemptAt,
  };
}

function caltrainLocalDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ""
  );
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function requireValidObservationDate(date: Date): void {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid Commuter provider observation date");
}

function isFresh(condition: TransitCondition, now: Date): boolean {
  const observedAt = new Date(condition.observedAt).getTime();
  const validUntil = new Date(condition.validUntil).getTime();
  return Number.isFinite(observedAt)
    && Number.isFinite(validUntil)
    && observedAt <= now.getTime() + 5 * 60 * 1_000
    && validUntil >= now.getTime();
}

function scheduledSubscriptionIsAvailable(
  subscription: CommuteSubscription,
  schedule: CaltrainStaticScheduleSnapshot | null,
  serviceDate: string,
): boolean {
  if (!subscription.scheduleOptionID) return true;
  if (!schedule) return false;
  const origin = schedule.stops.find((stop) => stop.id === subscription.originStopID);
  const destination = schedule.stops.find((stop) => stop.id === subscription.destinationStopID);
  if (!origin || !destination) return false;
  try {
    return searchCaltrainJourneys(schedule, {
      originStationID: origin.stationID,
      destinationStationID: destination.stationID,
      serviceWeekdays: subscription.serviceWeekdays,
    }, serviceDate).some((option) => option.id === subscription.scheduleOptionID
      && option.originStopID === subscription.originStopID
      && option.destinationStopID === subscription.destinationStopID
      && option.directionID === subscription.directionID
      && option.departureMinutes === subscription.scheduledDepartureMinutes
      && option.arrivalMinutes === subscription.scheduledArrivalMinutes);
  } catch {
    return false;
  }
}

function matchDelayMinutes(
  subscription: CommuteSubscription,
  condition: TransitCondition,
): number | null {
  const originIndex = condition.stopIDs.indexOf(subscription.originStopID);
  const destinationIndex = condition.stopIDs.indexOf(subscription.destinationStopID);
  const disruption = condition.scope === "disruption";
  const stopsMatch = disruption
    ? condition.stopIDs.length === 0
      || condition.stopIDs.includes(subscription.originStopID)
      || condition.stopIDs.includes(subscription.destinationStopID)
    : condition.stopIDs.length === 0 || (originIndex >= 0 && destinationIndex > originIndex);
  const originSchedule = condition.scheduledStops
    ?.find((stop) => stop.stopID === subscription.originStopID);
  const relevantScheduledMinutes = originSchedule?.scheduledMinutes ?? condition.scheduledMinutes;
  const relevantDelayMinutes = originSchedule?.delayMinutes ?? condition.delayMinutes;
  const timeWithinWindow = disruption && !originSchedule
    ? true
    : relevantScheduledMinutes >= subscription.windowStartMinutes
      && relevantScheduledMinutes <= subscription.windowEndMinutes;
  const timeMatchesSchedule = subscription.scheduleOptionID
    ? disruption && !originSchedule
      ? true
      : relevantScheduledMinutes === subscription.scheduledDepartureMinutes
        && subscription.scheduledArrivalMinutes !== undefined
    : true;
  const matches = subscription.status === "active"
    && subscription.agencyID === condition.agencyID
    && (condition.routeID === "*" || subscription.routeID === "*"
      || subscription.routeID === condition.routeID)
    && (condition.directionID === "*" || subscription.directionID === condition.directionID)
    && subscription.serviceWeekdays.includes(condition.serviceWeekday)
    && (subscription.scheduleOptionID ? timeMatchesSchedule : timeWithinWindow)
    && subscription.alertKinds.includes(condition.kind)
    && (condition.kind !== "delay" || disruption
      || relevantDelayMinutes >= subscription.minimumDelayMinutes)
    && stopsMatch;
  return matches ? relevantDelayMinutes : null;
}
