import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  APNSPushNotificationProvider,
  apnsPayload,
  normalizeAPNSPrivateKey,
} from "../src/apns-push-notification-provider.js";

describe("APNSPushNotificationProvider", () => {
  it("emits the exact APNs JSON with an absolute badge, including zero", () => {
    expect(JSON.parse(JSON.stringify(apnsPayload({
      title: "Hello", body: "World", data: { notificationID: "42" }, badge: 3,
    })))).toEqual({
      notificationID: "42",
      aps: { alert: { title: "Hello", body: "World" }, sound: "default", badge: 3 },
    });
    expect(apnsPayload({ title: "T", body: "B", badge: 0 }).aps.badge).toBe(0);
    expect(apnsPayload({ title: "T", body: "B" }).aps).not.toHaveProperty("badge");
  });

  it.each([[-1, 0], [1000, 99], [3.9, 3], [NaN, 0], [Infinity, 0]])(
    "bounds badge %s to %s", (badge, expected) => {
      expect(apnsPayload({ title: "T", body: "B", badge }).aps.badge).toBe(expected);
    },
  );

  it("does not allow custom data to replace aps", () => {
    expect(apnsPayload({ title: "T", body: "B", data: { aps: "invalid" }, badge: 5 })).toEqual({
      aps: { alert: { title: "T", body: "B" }, sound: "default", badge: 5 },
    });
  });

  it("normalizes a one-line PKCS#8 key copied through a concealed field", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const oneLine = pem.replaceAll("\n", " ");

    expect(() => createPrivateKey(normalizeAPNSPrivateKey(oneLine))).not.toThrow();
  });

  it("loads rotating APNs credentials from mounted files", () => {
    const reads: string[] = [];
    const provider = APNSPushNotificationProvider.fromEnvironment({
      APNS_KEY_ID_FILE: "/run/secrets/apns/key-id",
      APNS_PRIVATE_KEY_FILE: "/run/secrets/apns/private-key",
      APNS_TEAM_ID: "TEAM123",
      APNS_BUNDLE_ID: "dev.rallyroo.app",
      APNS_ENV: "production",
    }, (path) => {
      reads.push(path);
      return path.endsWith("key-id") ? "KEY123" : "private-key";
    });

    expect(provider).not.toBeNull();
    expect(reads).toEqual([
      "/run/secrets/apns/key-id",
      "/run/secrets/apns/private-key",
    ]);
  });
});
