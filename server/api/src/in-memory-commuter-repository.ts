import type {
  CommuterInstallation,
  CommuterRepository,
  CommuteAlertIntent,
  CommuteSubscription,
} from "./commuter-module.js";

export class InMemoryCommuterRepository implements CommuterRepository {
  private readonly installations = new Map<string, CommuterInstallation>();
  private readonly subscriptions = new Map<string, CommuteSubscription>();
  private readonly alertKeys = new Set<string>();

  async installation(familyID: string): Promise<CommuterInstallation | null> {
    return this.installations.get(familyID) ?? null;
  }

  async saveInstallationIfAbsent(
    installation: CommuterInstallation,
  ): Promise<CommuterInstallation> {
    const existing = this.installations.get(installation.familyID);
    if (existing) return existing;
    this.installations.set(installation.familyID, installation);
    return installation;
  }

  async setInstallationStatus(
    familyID: string,
    status: CommuterInstallation["status"],
  ): Promise<CommuterInstallation | null> {
    const installation = this.installations.get(familyID);
    if (!installation) return null;
    const updated = { ...installation, status };
    this.installations.set(familyID, updated);
    return updated;
  }

  async removeInstallationAndState(familyID: string): Promise<void> {
    this.installations.delete(familyID);
    for (const [id, subscription] of this.subscriptions) {
      if (subscription.familyID === familyID) this.subscriptions.delete(id);
    }
    for (const key of this.alertKeys) {
      if (key.startsWith(`${familyID}:`)) this.alertKeys.delete(key);
    }
  }

  async subscriptionsForFamily(familyID: string): Promise<CommuteSubscription[]> {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.familyID === familyID);
  }

  async saveSubscription(subscription: CommuteSubscription): Promise<void> {
    this.subscriptions.set(subscription.id, subscription);
  }

  async saveSubscriptionIfCapacity(
    subscription: CommuteSubscription,
    maximum: number,
  ): Promise<boolean> {
    const count = [...this.subscriptions.values()]
      .filter((item) => item.familyID === subscription.familyID).length;
    if (count >= maximum) return false;
    this.subscriptions.set(subscription.id, subscription);
    return true;
  }

  async subscription(
    familyID: string,
    subscriptionID: string,
  ): Promise<CommuteSubscription | null> {
    const subscription = this.subscriptions.get(subscriptionID);
    return subscription?.familyID === familyID ? subscription : null;
  }

  async removeSubscription(familyID: string, subscriptionID: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionID);
    if (subscription?.familyID === familyID) this.subscriptions.delete(subscriptionID);
  }

  async activeSubscriptionsForAgency(agencyID: "CT"): Promise<CommuteSubscription[]> {
    return [...this.subscriptions.values()].filter((subscription) => (
      subscription.agencyID === agencyID
      && subscription.status === "active"
      && this.installations.get(subscription.familyID)?.status === "enabled"
    ));
  }

  async saveAlertsIfAbsent(alerts: CommuteAlertIntent[]): Promise<CommuteAlertIntent[]> {
    const claimed: CommuteAlertIntent[] = [];
    for (const alert of alerts) {
      const key = `${alert.familyID}:${alert.subscriptionID}:${alert.conditionID}:${alert.kind}`;
      if (this.alertKeys.has(key)) continue;
      this.alertKeys.add(key);
      claimed.push(alert);
    }
    return claimed;
  }
}
