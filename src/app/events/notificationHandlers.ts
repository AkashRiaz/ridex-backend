import { NotificationType } from "../../generated/prisma/enums";
import { dashboardLink } from "../helper/dashboardPath";
import { formatPrice } from "../helper/formatPrice";
import { prisma } from "../lib/prisma";
import { ChatService } from "../module/chat/chat.service";
import { NotificationService } from "../module/notification/notification.service";
import { appEvents, safeHandler } from "./appEvents";

/*
 * Domain events → notifications (in-app + email by preference).
 * Every handler runs after commit and is wrapped in safeHandler.
 */

// users who saved a listing (never the seller)
const getWishlisterIds = async (listingId: string, sellerId: string) => {
  const items = await prisma.wishlistItem.findMany({
    where: { listingId, userId: { not: sellerId } },
    select: { userId: true },
  });

  return items.map((item) => item.userId);
};

const listingLink = (slug: string) => `/listings/${slug}`;

export const registerNotificationHandlers = () => {
  // ============================================
  // Listings → seller
  // ============================================

  appEvents.on(
    "listing.approved",
    safeHandler("notify:listing.approved", async (event) => {
      await NotificationService.notify(event.sellerId, {
        type: NotificationType.LISTING_APPROVED,
        title: "Your listing is live",
        body: `"${event.title}" is now visible to buyers.`,
        link: listingLink(event.slug),
        data: { listingId: event.listingId },
        ctaLabel: "View listing",
      });
    }),
  );

  appEvents.on(
    "listing.rejected",
    safeHandler("notify:listing.rejected", async (event) => {
      await NotificationService.notify(event.sellerId, {
        type: NotificationType.LISTING_REJECTED,
        title: "Your listing needs changes",
        body: `"${event.title}" was not approved. Reason: ${event.reason}`,
        link: (role) =>
          dashboardLink(role, `/my-listings/${event.listingId}/edit`),
        data: { listingId: event.listingId },
        ctaLabel: "Edit listing",
      });
    }),
  );

  appEvents.on(
    "listing.expired",
    safeHandler("notify:listing.expired", async (event) => {
      await NotificationService.notify(event.sellerId, {
        type: NotificationType.LISTING_EXPIRED,
        title: "Your listing has expired",
        body: `"${event.title}" is no longer shown to buyers. Renew it to put it back online.`,
        link: (role) => dashboardLink(role, "/my-listings?status=EXPIRED"),
        data: { listingId: event.listingId },
        ctaLabel: "Renew listing",
      });
    }),
  );

  // ============================================
  // Listings → users who saved them
  // ============================================

  appEvents.on(
    "listing.priceDropped",
    safeHandler("notify:listing.priceDropped", async (event) => {
      const userIds = await getWishlisterIds(event.listingId, event.sellerId);

      await NotificationService.notifyUsers(userIds, {
        type: NotificationType.WISHLIST_PRICE_DROP,
        title: "Price drop on a saved listing",
        body: `"${event.title}" is now ${formatPrice(event.newPrice)} (was ${formatPrice(event.oldPrice)}).`,
        link: listingLink(event.slug),
        data: {
          listingId: event.listingId,
          oldPrice: event.oldPrice,
          newPrice: event.newPrice,
        },
        ctaLabel: "View listing",
      });
    }),
  );

  appEvents.on(
    "listing.sold",
    safeHandler("notify:listing.sold", async (event) => {
      const userIds = await getWishlisterIds(event.listingId, event.sellerId);

      await NotificationService.notifyUsers(userIds, {
        type: NotificationType.WISHLIST_SOLD,
        title: "A saved listing was sold",
        body: `"${event.title}" has been marked as sold.`,
        link: "/listings",
        data: { listingId: event.listingId },
        ctaLabel: "Browse similar listings",
      });
    }),
  );

  appEvents.on(
    "listing.sold",
    safeHandler("chat:listing.sold", async (event) => {
      await ChatService.postListingSystemMessage(
        event.listingId,
        "The seller marked this listing as sold.",
      );
    }),
  );

  // ============================================
  // Reviews
  // ============================================

  appEvents.on(
    "review.created",
    safeHandler("notify:review.created", async (event) => {
      await NotificationService.notify(event.sellerId, {
        type: NotificationType.REVIEW_RECEIVED,
        title: `You received a ${event.rating}-star review`,
        body: "Thank the buyer or reply publicly from your reviews page.",
        link: (role) => dashboardLink(role, "/reviews"),
        data: { reviewId: event.reviewId, rating: event.rating },
        ctaLabel: "See review",
      });
    }),
  );

  appEvents.on(
    "review.replied",
    safeHandler("notify:review.replied", async (event) => {
      await NotificationService.notify(event.reviewerId, {
        type: NotificationType.REVIEW_REPLY,
        title: "The seller replied to your review",
        link: `/sellers/${event.sellerId}`,
        data: { reviewId: event.reviewId },
        ctaLabel: "Read reply",
      });
    }),
  );

  // ============================================
  // Account: reports and verification
  // ============================================

  appEvents.on(
    "report.resolved",
    safeHandler("notify:report.resolved", async (event) => {
      await NotificationService.notify(event.reporterId, {
        type: NotificationType.REPORT_RESOLVED,
        title: "We reviewed your report",
        body:
          event.status === "RESOLVED"
            ? "Thank you. Our team reviewed it and took action."
            : "Thank you. Our team reviewed it and found no rule was broken.",
        link: (role) => dashboardLink(role, "/my-reports"),
        data: { reportId: event.reportId, status: event.status },
        ctaLabel: "View my reports",
      });
    }),
  );

  appEvents.on(
    "verification.approved",
    safeHandler("notify:verification.approved", async (event) => {
      await NotificationService.notify(event.userId, {
        type: NotificationType.VERIFICATION_APPROVED,
        title:
          event.type === "DEALER"
            ? "Your dealership is verified"
            : "Your identity is verified",
        body: "Your verified badge now shows on your listings and profile.",
        link: (role) => dashboardLink(role, "/verification"),
        data: { requestId: event.requestId, type: event.type },
        ctaLabel: "View badges",
      });
    }),
  );

  appEvents.on(
    "verification.rejected",
    safeHandler("notify:verification.rejected", async (event) => {
      await NotificationService.notify(event.userId, {
        type: NotificationType.VERIFICATION_REJECTED,
        title: "Your verification was not approved",
        body: `Reason: ${event.reason}. You can submit new documents.`,
        link: (role) => dashboardLink(role, "/verification"),
        data: { requestId: event.requestId, type: event.type },
        ctaLabel: "Try again",
      });
    }),
  );

  // ============================================
  // Chat → delayed unread digest
  // ============================================

  appEvents.on(
    "message.created",
    safeHandler("notify:message.created", async (event) => {
      await NotificationService.scheduleUnreadMessagesEmail(
        event.conversationId,
        event.recipientId,
      );
    }),
  );
};
