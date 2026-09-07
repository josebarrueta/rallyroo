export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
  collapseID?: string;
}

export interface PushNotificationProvider {
  send(tokens: string[], notification: PushNotification): Promise<void>;
}

export class NoopPushNotificationProvider implements PushNotificationProvider {
  async send(): Promise<void> {}
}
