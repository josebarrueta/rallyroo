import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Account } from "./domain.js";

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
}).strict().refine((value) => value.originStopID !== value.destinationStopID)
  .refine((value) => value.windowEndMinutes > value.windowStartMinutes);

const transitConditionSchema = z.object({
  id: z.string().min(1).max(300),
  agencyID: z.literal("CT"),
  routeID: z.string().min(1).max(200),
  directionID: z.string().min(1).max(200),
  stopIDs: z.array(z.string().min(1).max(200)).max(500),
  serviceWeekday: z.number().int().min(1).max(7),
  scheduledMinutes: z.number().int().min(0).max(1439),
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
}

export interface TransitCondition {
  id: string;
  agencyID: "CT";
  routeID: string;
  directionID: string;
  stopIDs: string[];
  serviceWeekday: number;
  scheduledMinutes: number;
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
  audience: { kind: "member"; memberID: string } | { kind: "family" };
}

export interface CommuterState {
  installation: CommuterInstallation | null;
  subscriptions: CommuteSubscription[];
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
}

export type CommuterModuleErrorReason =
  | "parent_required"
  | "module_not_enabled"
  | "invalid_subscription"
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

  async state(account: Account): Promise<CommuterState> {
    const installation = await this.repository.installation(account.familyID);
    if (!installation) return { installation: null, subscriptions: [] };
    const subscriptions = (await this.repository.subscriptionsForFamily(account.familyID))
      .filter((subscription) => (
        subscription.visibility === "family" || subscription.ownerMemberID === account.memberID
      ));
    return { installation, subscriptions };
  }

  async createSubscription(
    account: Account,
    input: NewCommuteSubscription,
  ): Promise<CommuteSubscription> {
    requireParent(account);
    if ((await this.repository.installation(account.familyID))?.status !== "enabled") {
      throw new CommuterModuleError("module_not_enabled");
    }
    const details = validatedSubscriptionDetails(input);
    const subscription: CommuteSubscription = {
      ...details,
      visibility: input.visibility,
      id: randomUUID(),
      familyID: account.familyID,
      ownerMemberID: account.memberID,
      serviceWeekdays: [...new Set(details.serviceWeekdays)].sort((left, right) => left - right),
      alertKinds: [...new Set(details.alertKinds)],
      status: "active",
    };
    if (!await this.repository.saveSubscriptionIfCapacity(subscription, 20)) {
      throw new CommuterModuleError("subscription_limit_reached");
    }
    return subscription;
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
    const candidates: CommuteAlertIntent[] = [];
    for (const condition of conditions) {
      if (!isFresh(condition, now)) continue;
      for (const subscription of subscriptions) {
        if (!matches(subscription, condition)) continue;
        if (candidates.length >= 10_000) {
          throw new Error("Commuter alert fan-out limit exceeded");
        }
        const alert: CommuteAlertIntent = {
          id: randomUUID(),
          subscriptionID: subscription.id,
          familyID: subscription.familyID,
          conditionID: condition.id,
          kind: condition.kind,
          delayMinutes: condition.delayMinutes,
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
  return subscriptionDetailsSchema.parse(JSON.parse(plaintext));
}

function isFresh(condition: TransitCondition, now: Date): boolean {
  const observedAt = new Date(condition.observedAt).getTime();
  const validUntil = new Date(condition.validUntil).getTime();
  return Number.isFinite(observedAt)
    && Number.isFinite(validUntil)
    && observedAt <= now.getTime() + 5 * 60 * 1_000
    && validUntil >= now.getTime();
}

function matches(subscription: CommuteSubscription, condition: TransitCondition): boolean {
  const originIndex = condition.stopIDs.indexOf(subscription.originStopID);
  const destinationIndex = condition.stopIDs.indexOf(subscription.destinationStopID);
  return subscription.status === "active"
    && subscription.agencyID === condition.agencyID
    && subscription.routeID === condition.routeID
    && subscription.directionID === condition.directionID
    && subscription.serviceWeekdays.includes(condition.serviceWeekday)
    && condition.scheduledMinutes >= subscription.windowStartMinutes
    && condition.scheduledMinutes <= subscription.windowEndMinutes
    && subscription.alertKinds.includes(condition.kind)
    && (condition.kind !== "delay" || condition.delayMinutes >= subscription.minimumDelayMinutes)
    && (condition.stopIDs.length === 0 || (originIndex >= 0 && destinationIndex > originIndex));
}
