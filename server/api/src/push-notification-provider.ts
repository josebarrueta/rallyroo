export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
  collapseID?: string;
  /** Absolute unread inbox count, never an increment. */
  badge?: number;
}

export const notificationBadgeCap = 99;

export function boundedNotificationBadge(count: number): number {
  return Number.isFinite(count) ? Math.min(notificationBadgeCap, Math.max(0, Math.trunc(count))) : 0;
}

export interface PushNotificationProvider {
  send(tokens: string[], notification: PushNotification): Promise<void>;
}

export class NoopPushNotificationProvider implements PushNotificationProvider {
  async send(): Promise<void> {}
}
