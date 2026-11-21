import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { NotificationCategory, NotificationType, ReportTargetType, Role } from "../src/generated/prisma/enums";
import { MESSAGE_CONTEXT_SIZE, assertActionAllowed, targetColumns } from "../src/app/module/report/report.utils";
import {
  CATEGORY_DEFAULTS,
  TYPE_CATEGORY,
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  findLockedChange,
  getDigestSkipReason,
  isChannelEnabled,
  resolvePreferences,
  verifyUnsubscribeToken,
} from "../src/app/module/notification/notification.utils";
import { UpdatePreferencesZodSchema } from "../src/app/module/notification/notification.validation";

// ============================================
// Preferences
// ============================================

describe("notification preferences", () => {
  it("uses defaults when nothing is stored", () => {
    const resolved = resolvePreferences([]);

    expect(resolved).toHaveLength(Object.keys(CATEGORY_DEFAULTS).length);
    expect(resolved.every((preference) => preference.inApp && preference.email)).toBe(true);
  });

  it("applies stored rows", () => {
    const rows = [{ category: NotificationCategory.PRICE_ALERTS, inApp: false, email: false }];

    expect(isChannelEnabled(rows, NotificationCategory.PRICE_ALERTS, "inApp")).toBe(false);
    expect(isChannelEnabled(rows, NotificationCategory.PRICE_ALERTS, "email")).toBe(false);
    expect(isChannelEnabled(rows, NotificationCategory.LISTINGS, "email")).toBe(true);
  });

  it("keeps locked channels on even if a row says otherwise", () => {
    const rows = [
      { category: NotificationCategory.ACCOUNT, inApp: false, email: false },
      { category: NotificationCategory.MESSAGES, inApp: false, email: false },
    ];

    expect(isChannelEnabled(rows, NotificationCategory.ACCOUNT, "inApp")).toBe(true);
    expect(isChannelEnabled(rows, NotificationCategory.ACCOUNT, "email")).toBe(true);
    // the chat badge is always on; the message email digest can be turned off
    expect(isChannelEnabled(rows, NotificationCategory.MESSAGES, "inApp")).toBe(true);
    expect(isChannelEnabled(rows, NotificationCategory.MESSAGES, "email")).toBe(false);
  });

  it("reports an attempt to switch off a locked channel", () => {
    expect(findLockedChange([{ category: NotificationCategory.ACCOUNT, email: false }])).not.toBeNull();
    expect(findLockedChange([{ category: NotificationCategory.MESSAGES, inApp: false }])).not.toBeNull();
    expect(findLockedChange([{ category: NotificationCategory.MESSAGES, email: false }])).toBeNull();
    expect(findLockedChange([{ category: NotificationCategory.ACCOUNT, email: true }])).toBeNull();
  });

  it("maps every notification type to a category", () => {
    for (const type of Object.values(NotificationType)) {
      expect(Object.values(NotificationCategory)).toContain(TYPE_CATEGORY[type]);
    }
    expect(TYPE_CATEGORY.VERIFICATION_REJECTED).toBe(NotificationCategory.ACCOUNT);
    expect(TYPE_CATEGORY.WISHLIST_PRICE_DROP).toBe(NotificationCategory.PRICE_ALERTS);
  });

  it("validates preference updates", () => {
    expect(
      UpdatePreferencesZodSchema.safeParse({ preferences: [{ category: "LISTINGS", email: false }] }).success,
    ).toBe(true);
    expect(UpdatePreferencesZodSchema.safeParse({ preferences: [{ category: "LISTINGS" }] }).success).toBe(false);
    expect(UpdatePreferencesZodSchema.safeParse({ preferences: [{ category: "SPAM", email: true }] }).success).toBe(
      false,
    );
    expect(UpdatePreferencesZodSchema.safeParse({ preferences: [] }).success).toBe(false);
  });
});

// ============================================
// Unsubscribe links
// ============================================

describe("unsubscribe links", () => {
  it("round-trips a token", () => {
    const token = createUnsubscribeToken("user-1", NotificationCategory.REVIEWS);

    expect(verifyUnsubscribeToken(token)).toEqual({ userId: "user-1", category: NotificationCategory.REVIEWS });
  });

  it("rejects tampered tokens and other token kinds", () => {
    const token = createUnsubscribeToken("user-1", NotificationCategory.REVIEWS);
    const socketToken = jwt.sign(
      { userId: "user-1", category: "REVIEWS", typ: "unsubscribe" },
      process.env.JWT_SOCKET_SECRET as string,
    );

    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
    // signed with the socket secret itself, not the derived unsubscribe key
    expect(verifyUnsubscribeToken(socketToken)).toBeNull();
  });

  it("has no unsubscribe link for locked emails", () => {
    expect(buildUnsubscribeUrl("user-1", NotificationCategory.ACCOUNT)).toBeNull();
    expect(buildUnsubscribeUrl("user-1", NotificationCategory.MESSAGES)).toContain("/unsubscribe?token=");
  });
});

// ============================================
// Unread message digest
// ============================================

describe("unread message digest", () => {
  const ready = {
    unreadCount: 2,
    isOnline: false,
    isActive: true,
    hasVerifiedEmail: true,
    emailEnabled: true,
    onCooldown: false,
  };

  it("sends when still unread and the user is offline", () => {
    expect(getDigestSkipReason(ready)).toBeNull();
  });

  it.each([
    ["the thread was read", { unreadCount: 0 }, "NO_UNREAD"],
    ["the user is online", { isOnline: true }, "ONLINE"],
    ["the account is inactive", { isActive: false }, "INACTIVE"],
    ["there is no verified email", { hasVerifiedEmail: false }, "NO_EMAIL"],
    ["message emails are off", { emailEnabled: false }, "EMAIL_OFF"],
    ["a digest was sent within the hour", { onCooldown: true }, "COOLDOWN"],
  ])("skips when %s", (_label, override, reason) => {
    expect(getDigestSkipReason({ ...ready, ...override })).toBe(reason);
  });
});

// ============================================
// Message reports
// ============================================

describe("message reports", () => {
  it("stores message reports in the message column", () => {
    expect(targetColumns(ReportTargetType.MESSAGE, "m1")).toEqual({ messageId: "m1" });
  });

  it("lets admins block the sender of a reported message", () => {
    expect(() => assertActionAllowed("BLOCK_USER", ReportTargetType.MESSAGE, Role.ADMIN)).not.toThrow();
    expect(() => assertActionAllowed("BLOCK_USER", ReportTargetType.MESSAGE, Role.MODERATOR)).toThrow();
    expect(() => assertActionAllowed("TAKE_DOWN_LISTING", ReportTargetType.MESSAGE, Role.ADMIN)).toThrow();
  });

  it("shows staff a small context window", () => {
    expect(MESSAGE_CONTEXT_SIZE).toBeGreaterThan(0);
    expect(MESSAGE_CONTEXT_SIZE).toBeLessThanOrEqual(10);
  });
});
