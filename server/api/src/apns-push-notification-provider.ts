import { connect } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import type { PushNotification, PushNotificationProvider } from "./push-notification-provider.js";
import { configuredSecret, type SecretFileReader } from "./runtime-configuration.js";

interface APNSConfiguration {
  keyID: string;
  teamID: string;
  bundleID: string;
  privateKey: string;
  production: boolean;
}

export class APNSPushNotificationProvider implements PushNotificationProvider {
  private authorizationToken?: { value: string; expiresAt: number };

  constructor(private readonly configuration: APNSConfiguration) {}

  static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    readSecretFile?: SecretFileReader,
  ): APNSPushNotificationProvider | null {
    const keyID = configuredSecret("APNS_KEY_ID", environment, readSecretFile);
    const teamID = environment.APNS_TEAM_ID;
    const bundleID = environment.APNS_BUNDLE_ID;
    const privateKeyValue = configuredSecret("APNS_PRIVATE_KEY", environment, readSecretFile);
    const privateKey = privateKeyValue ? normalizeAPNSPrivateKey(privateKeyValue) : undefined;
    if (!keyID || !teamID || !bundleID || !privateKey) return null;
    return new APNSPushNotificationProvider({
      keyID,
      teamID,
      bundleID,
      privateKey,
      production: environment.APNS_ENV === "production",
    });
  }

  async send(tokens: string[], notification: PushNotification): Promise<void> {
    if (tokens.length === 0) return;
    const authorization = await this.authorization();
    const origin = this.configuration.production
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
    const client = connect(origin);
    client.on("error", () => {});
    try {
      await Promise.all(tokens.map((token) => this.sendOne(client, token, authorization, notification)));
    } finally {
      client.close();
    }
  }

  private async authorization(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.authorizationToken && this.authorizationToken.expiresAt > now) {
      return this.authorizationToken.value;
    }
    const key = await importPKCS8(this.configuration.privateKey, "ES256");
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.configuration.keyID })
      .setIssuer(this.configuration.teamID)
      .setIssuedAt(now)
      .sign(key);
    this.authorizationToken = { value, expiresAt: now + 50 * 60 };
    return value;
  }

  private async sendOne(
    client: ReturnType<typeof connect>,
    token: string,
    authorization: string,
    notification: PushNotification,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${authorization}`,
        "apns-topic": this.configuration.bundleID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        ...(notification.collapseID ? { "apns-collapse-id": notification.collapseID } : {}),
        "content-type": "application/json",
      });
      let status = 0;
      request.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
      request.on("data", () => {});
      request.on("error", reject);
      request.on("end", () => status >= 200 && status < 300
        ? resolve()
        : reject(new Error(`APNs returned ${status}`)));
      request.end(JSON.stringify({
        aps: {
          alert: { title: notification.title, body: notification.body },
          sound: "default",
        },
        ...notification.data,
      }));
    });
  }
}

export function normalizeAPNSPrivateKey(value: string): string {
  const expanded = value.replaceAll("\\n", "\n").trim();
  const keyLabel = "PRIVATE KEY";
  const beginMarker = `-----BEGIN ${keyLabel}-----`;
  const endMarker = `-----END ${keyLabel}-----`;
  if (!expanded.startsWith(beginMarker) || !expanded.endsWith(endMarker)) return expanded;
  const body = expanded
    .slice(beginMarker.length, -endMarker.length)
    .replaceAll(/\s/g, "");
  if (!body) return expanded;
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `${beginMarker}\n${wrapped}\n${endMarker}\n`;
}
