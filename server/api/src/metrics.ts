import { Counter, Histogram, Registry } from "@prometheus-io/client";

export type CacheResult = "hit" | "miss" | "error";
export type ProviderResult = "success" | "failure";

export interface Telemetry {
  observeCache(cache: string, result: CacheResult): void;
  observeProvider(provider: string, result: ProviderResult, durationSeconds: number): void;
}

export class NoopTelemetry implements Telemetry {
  observeCache(): void {}
  observeProvider(): void {}
}

export class RallyrooMetrics implements Telemetry {
  private readonly registry = new Registry();
  private readonly requests = new Counter({
    name: "rallyroo_http_requests_total",
    help: "Rallyroo HTTP requests",
    labelNames: ["method", "route", "status"],
    registers: [this.registry],
  });
  private readonly requestDuration = new Histogram({
    name: "rallyroo_http_request_duration_seconds",
    help: "Rallyroo HTTP request duration",
    labelNames: ["method", "route"],
    registers: [this.registry],
  });
  private readonly cacheOperations = new Counter({
    name: "rallyroo_cache_operations_total",
    help: "Rallyroo cache operations",
    labelNames: ["cache", "result"],
    registers: [this.registry],
  });
  private readonly notificationDeliveryDuration = new Histogram({
    name: "rallyroo_notification_delivery_duration_seconds",
    help: "Notification delivery attempts by bounded category and outcome",
    labelNames: ["category", "outcome"],
    registers: [this.registry],
  });
  private readonly providerDuration = new Histogram({
    name: "rallyroo_provider_request_duration_seconds",
    help: "External provider request duration",
    labelNames: ["provider", "result"],
    registers: [this.registry],
  });

  observeRequest(method: string, route: string, status: number, durationSeconds: number): void {
    this.requests.inc({ method, route, status: String(status) });
    this.requestDuration.observe({ method, route }, durationSeconds);
  }

  observeCache(cache: string, result: CacheResult): void {
    this.cacheOperations.inc({ cache, result });
  }

  observeNotificationDelivery(
    category: string, outcome: "delivered" | "no_recipient" | "failure", durationSeconds: number,
  ): void {
    this.notificationDeliveryDuration.observe({ category, outcome }, durationSeconds);
  }

  observeProvider(provider: string, result: ProviderResult, durationSeconds: number): void {
    this.providerDuration.observe({ provider, result }, durationSeconds);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
