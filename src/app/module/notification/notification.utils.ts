import crypto from "node:crypto";
import { JwtPayload, SignOptions } from "jsonwebtoken";
import {
  NotificationCategory,
  NotificationType,
} from "../../../generated/prisma/enums";
import { config } from "../../config";
import { jwtUtils } from "../../utils/jwt";
import {
  TNotificationChannel,
  IResolvedPreference,
} from "./notification.interface";

// ============================================
// Categories
// ============================================

type TCategoryDefault = {
  inApp: boolean;
  email: boolean;
  // locked channels are always on and cannot be changed
  lockedInApp: boolean;
  lockedEmail: boolean;
};

export const CATEGORY_DEFAULTS: Record<NotificationCategory, TCategoryDefault> =
  {
    // in-app for messages is the chat badge itself; only the email digest is optional
    MESSAGES: {
      inApp: true,
      email: true,
      lockedInApp: true,
      lockedEmail: false,
    },
    LISTINGS: {
      inApp: true,
      email: true,
      lockedInApp: false,
      lockedEmail: false,
    },
    // wishlist price drops and saved-search alerts
    PRICE_ALERTS: {
      inApp: true,
      email: true,
      lockedInApp: false,
      lockedEmail: false,
    },
    REVIEWS: {
      inApp: true,
      email: true,
      lockedInApp: false,
      lockedEmail: false,
    },
    // verification decisions and report outcomes
    ACCOUNT: { inApp: true, email: true, lockedInApp: true, lockedEmail: true },
    // offers received, countered, accepted, declined, expired
    OFFERS: {
      inApp: true,
      email: true,
      lockedInApp: false,
      lockedEmail: false,
    },
    // bookings, confirmations, cancellations and reminders
    TEST_RIDES: {
      inApp: true,
      email: true,
      lockedInApp: false,
      lockedEmail: false,
    },
  };

export const NOTIFICATION_CATEGORIES = Object.keys(
  CATEGORY_DEFAULTS,
) as NotificationCategory[];

export const TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  UNREAD_MESSAGES: NotificationCategory.MESSAGES,
  LISTING_APPROVED: NotificationCategory.LISTINGS,
  LISTING_REJECTED: NotificationCategory.LISTINGS,
  LISTING_EXPIRED: NotificationCategory.LISTINGS,
  WISHLIST_PRICE_DROP: NotificationCategory.PRICE_ALERTS,
  WISHLIST_SOLD: NotificationCategory.PRICE_ALERTS,
  REVIEW_RECEIVED: NotificationCategory.REVIEWS,
  REVIEW_REPLY: NotificationCategory.REVIEWS,
  REPORT_RESOLVED: NotificationCategory.ACCOUNT,
  VERIFICATION_APPROVED: NotificationCategory.ACCOUNT,
  VERIFICATION_REJECTED: NotificationCategory.ACCOUNT,
  OFFER_RECEIVED: NotificationCategory.OFFERS,
  OFFER_COUNTERED: NotificationCategory.OFFERS,
  OFFER_ACCEPTED: NotificationCategory.OFFERS,
  OFFER_DECLINED: NotificationCategory.OFFERS,
  OFFER_WITHDRAWN: NotificationCategory.OFFERS,
  OFFER_EXPIRED: NotificationCategory.OFFERS,
  OFFER_CANCELLED: NotificationCategory.OFFERS,
  OFFER_OTHER_ACCEPTED: NotificationCategory.OFFERS,
  TEST_RIDE_REQUESTED: NotificationCategory.TEST_RIDES,
  TEST_RIDE_CONFIRMED: NotificationCategory.TEST_RIDES,
  TEST_RIDE_DECLINED: NotificationCategory.TEST_RIDES,
  TEST_RIDE_CANCELLED: NotificationCategory.TEST_RIDES,
  TEST_RIDE_EXPIRED: NotificationCategory.TEST_RIDES,
  TEST_RIDE_REMINDER: NotificationCategory.TEST_RIDES,
  SAVED_SEARCH_MATCH: NotificationCategory.PRICE_ALERTS,
  SAVED_SEARCH_PRICE_DROP: NotificationCategory.PRICE_ALERTS,
  SYSTEM: NotificationCategory.ACCOUNT,
};

// ============================================
// Preferences (pure, unit-tested)
// ============================================

type TPreferenceRow = {
  category: NotificationCategory;
  inApp: boolean;
  email: boolean;
};

/*
 * Stored rows over defaults; locked channels always win.
 */
export const resolvePreferences = (
  rows: TPreferenceRow[],
): IResolvedPreference[] =>
  NOTIFICATION_CATEGORIES.map((category) => {
    const defaults = CATEGORY_DEFAULTS[category];
    const row = rows.find((preference) => preference.category === category);

    return {
      category,
      inApp: defaults.lockedInApp ? true : (row?.inApp ?? defaults.inApp),
      email: defaults.lockedEmail ? true : (row?.email ?? defaults.email),
      lockedInApp: defaults.lockedInApp,
      lockedEmail: defaults.lockedEmail,
    };
  });

export const isChannelEnabled = (
  rows: TPreferenceRow[],
  category: NotificationCategory,
  channel: TNotificationChannel,
) => {
  const preference = resolvePreferences(rows).find(
    (resolved) => resolved.category === category,
  );

  return Boolean(preference?.[channel]);
};

/*
 * Rejects an attempt to switch off a locked channel instead of silently ignoring it.
 */
export const findLockedChange = (
  changes: {
    category: NotificationCategory;
    inApp?: boolean;
    email?: boolean;
  }[],
) =>
  changes.find(({ category, inApp, email }) => {
    const defaults = CATEGORY_DEFAULTS[category];

    return (
      (defaults.lockedInApp && inApp === false) ||
      (defaults.lockedEmail && email === false)
    );
  }) ?? null;

// ============================================
// Unsubscribe links
// ============================================

const UNSUBSCRIBE_TOKEN_TYPE = "unsubscribe";

// a sub-key of the socket secret, so the two token kinds can never be swapped
const unsubscribeSecret = () =>
  crypto
    .createHmac("sha256", config.jwt_socket_secret)
    .update("email-unsubscribe")
    .digest("hex");

export const createUnsubscribeToken = (
  userId: string,
  category: NotificationCategory,
) =>
  jwtUtils.createToken(
    { userId, category, typ: UNSUBSCRIBE_TOKEN_TYPE },
    unsubscribeSecret(),
    "180d" as SignOptions,
  );

export const verifyUnsubscribeToken = (token: string) => {
  const verified = jwtUtils.verifyToken(token, unsubscribeSecret());

  if (!verified.success) return null;

  const payload = verified.data as JwtPayload;

  if (
    payload.typ !== UNSUBSCRIBE_TOKEN_TYPE ||
    typeof payload.userId !== "string" ||
    !NOTIFICATION_CATEGORIES.includes(payload.category)
  ) {
    return null;
  }

  return {
    userId: payload.userId,
    category: payload.category as NotificationCategory,
  };
};

export const buildUnsubscribeUrl = (
  userId: string,
  category: NotificationCategory,
) =>
  CATEGORY_DEFAULTS[category].lockedEmail
    ? null
    : `${config.frontend_url}/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(userId, category))}`;

// absolute link for emails; in-app links stay relative
export const toAbsoluteLink = (link?: string | null) =>
  link
    ? link.startsWith("http")
      ? link
      : `${config.frontend_url}${link}`
    : config.frontend_url;

// ============================================
// Unread message digest (pure, unit-tested)
// ============================================

export type TDigestSkipReason =
  | "NO_UNREAD"
  | "ONLINE"
  | "NO_EMAIL"
  | "EMAIL_OFF"
  | "COOLDOWN"
  | "INACTIVE";

/*
 * The delayed job re-checks everything when it runs.
 * Returns null when the digest should be sent.
 */
export const getDigestSkipReason = (input: {
  unreadCount: number;
  isOnline: boolean;
  isActive: boolean;
  hasVerifiedEmail: boolean;
  emailEnabled: boolean;
  onCooldown: boolean;
}): TDigestSkipReason | null => {
  if (!input.isActive) return "INACTIVE";
  if (input.unreadCount === 0) return "NO_UNREAD";
  if (input.isOnline) return "ONLINE";
  if (!input.hasVerifiedEmail) return "NO_EMAIL";
  if (!input.emailEnabled) return "EMAIL_OFF";
  if (input.onCooldown) return "COOLDOWN";
  return null;
};

// at most one digest per conversation per hour
export const DIGEST_COOLDOWN_SECONDS = 60 * 60;
