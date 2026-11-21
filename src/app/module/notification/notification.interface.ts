import { NotificationCategory, NotificationType, Role } from "../../../generated/prisma/enums";

export type TNotificationChannel = "inApp" | "email";

export interface IResolvedPreference {
  category: NotificationCategory;
  inApp: boolean;
  email: boolean;
  lockedInApp: boolean;
  lockedEmail: boolean;
}

export interface IUpdatePreferencesPayload {
  preferences: {
    category: NotificationCategory;
    inApp?: boolean;
    email?: boolean;
  }[];
}

export interface IUnsubscribePayload {
  token: string;
}

/*
 * What a handler asks to deliver. `link` may depend on the recipient's
 * role (dashboard paths differ per role).
 */
export interface INotifyPayload {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | ((role: Role) => string);
  data?: Record<string, unknown>;
  // email call-to-action label; defaults to "Open"
  ctaLabel?: string;
}

// BullMQ job payloads (notification-email queue)
export interface INotificationEmailJob {
  userId: string;
  category: NotificationCategory;
  subject: string;
  title: string;
  body: string;
  link: string | null;
  ctaLabel: string;
}

export interface IUnreadMessagesEmailJob {
  conversationId: string;
  userId: string;
}
