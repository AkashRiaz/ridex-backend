import { NotificationType, Role } from "../../generated/prisma/enums";
import { config } from "../config";
import { dashboardLink } from "../helper/dashboardPath";
import { formatPrice } from "../helper/formatPrice";
import { prisma } from "../lib/prisma";
import { ChatService } from "../module/chat/chat.service";
import { NotificationService } from "../module/notification/notification.service";
import { ILoanLeadRef } from "../module/loanLead/loanLead.interface";
import { IOfferRef } from "../module/offer/offer.interface";
import { OfferService } from "../module/offer/offer.service";
import { offerRecipientId } from "../module/offer/offer.utils";
import { ITestRideRef } from "../module/testRide/testRide.interface";
import { formatLocalDateTime } from "../helper/timeZone";
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

  // ============================================
  // Offers → the participant who has to react
  // ============================================

  appEvents.on(
    "offer.created",
    safeHandler("notify:offer.created", async (event) => {
      await NotificationService.notify(event.sellerId, {
        type: NotificationType.OFFER_RECEIVED,
        title: `New offer: ${formatPrice(event.amount)}`,
        body: `A buyer made an offer on "${event.listingTitle}". It expires in ${config.offer_expiry_hours} hours.`,
        link: (role) => chatLink(role, event.conversationId),
        data: offerData(event),
        ctaLabel: "Review offer",
      });
    }),
  );

  appEvents.on(
    "offer.countered",
    safeHandler("notify:offer.countered", async (event) => {
      await NotificationService.notify(offerRecipientId(event), {
        type: NotificationType.OFFER_COUNTERED,
        title: `Counter offer: ${formatPrice(event.amount)}`,
        body: `You received a counter offer on "${event.listingTitle}".`,
        link: (role) => chatLink(role, event.conversationId),
        data: offerData(event),
        ctaLabel: "Review offer",
      });
    }),
  );

  appEvents.on(
    "offer.accepted",
    safeHandler("notify:offer.accepted", async (event) => {
      await NotificationService.notify(event.proposedById, {
        type: NotificationType.OFFER_ACCEPTED,
        title: "Your offer was accepted",
        body: `${formatPrice(event.amount)} for "${event.listingTitle}" was accepted. Arrange the handover in chat.`,
        link: (role) => chatLink(role, event.conversationId),
        data: offerData(event),
        ctaLabel: "Open chat",
      });

      // other buyers keep their open offers, but should know (amount stays private)
      const otherBuyerIds = await OfferService.getOtherOpenOfferBuyerIds(
        event.listingId,
        event.conversationId,
      );

      await NotificationService.notifyUsers(otherBuyerIds, {
        type: NotificationType.OFFER_OTHER_ACCEPTED,
        title: "The seller accepted another offer",
        body: `Your offer on "${event.listingTitle}" is still open, but the bike may be sold soon.`,
        link: (role) => dashboardLink(role, "/offers"),
        data: { listingId: event.listingId },
        ctaLabel: "View my offers",
      });
    }),
  );

  appEvents.on(
    "offer.declined",
    safeHandler("notify:offer.declined", async (event) => {
      await NotificationService.notify(event.proposedById, {
        type: NotificationType.OFFER_DECLINED,
        title: "Your offer was declined",
        body: event.reason
          ? `${formatPrice(event.amount)} for "${event.listingTitle}" was declined: ${event.reason}`
          : `${formatPrice(event.amount)} for "${event.listingTitle}" was declined.`,
        link: (role) => chatLink(role, event.conversationId),
        data: offerData(event),
        ctaLabel: "Open chat",
      });
    }),
  );

  appEvents.on(
    "offer.withdrawn",
    safeHandler("notify:offer.withdrawn", async (event) => {
      await NotificationService.notify(offerRecipientId(event), {
        type: NotificationType.OFFER_WITHDRAWN,
        title: "An offer was withdrawn",
        body: `The ${formatPrice(event.amount)} offer on "${event.listingTitle}" was withdrawn.`,
        link: (role) => chatLink(role, event.conversationId),
        data: offerData(event),
        ctaLabel: "Open chat",
      });
    }),
  );

  appEvents.on(
    "offer.expired",
    safeHandler("notify:offer.expired", async (event) => {
      await NotificationService.notify(event.proposedById, {
        type: NotificationType.OFFER_EXPIRED,
        title: "Your offer expired",
        body: `${formatPrice(event.amount)} for "${event.listingTitle}" got no reply in time. You can make a new offer.`,
        link: (role) => chatLink(role, event.conversationId),
        data: offerData(event),
        ctaLabel: "Open chat",
      });
    }),
  );

  appEvents.on(
    "offer.cancelled",
    safeHandler("notify:offer.cancelled", async (event) => {
      await NotificationService.notify(event.buyerId, {
        type: NotificationType.OFFER_CANCELLED,
        title: "Your offer was closed",
        body: `Your offer on "${event.listingTitle}" was closed because ${event.reason}.`,
        link: (role) => dashboardLink(role, "/offers"),
        data: offerData(event),
        ctaLabel: "View my offers",
      });
    }),
  );

  // ============================================
  // Test rides
  // ============================================

  appEvents.on(
    "testRide.requested",
    safeHandler("notify:testRide.requested", async (event) => {
      await NotificationService.notify(event.sellerId, {
        type: NotificationType.TEST_RIDE_REQUESTED,
        title: "New test ride request",
        body: `A buyer wants to test ride "${event.listingTitle}" on ${formatLocalDateTime(event.startsAt)}. Confirm it before then.`,
        link: (role) => dashboardLink(role, "/test-rides"),
        data: testRideData(event),
        ctaLabel: "Review request",
      });
    }),
  );

  appEvents.on(
    "testRide.confirmed",
    safeHandler("notify:testRide.confirmed", async (event) => {
      await NotificationService.notify(event.buyerId, {
        type: NotificationType.TEST_RIDE_CONFIRMED,
        title: "Your test ride is confirmed",
        body: event.note
          ? `"${event.listingTitle}" on ${formatLocalDateTime(event.startsAt)}. Seller's note: ${event.note}`
          : `"${event.listingTitle}" on ${formatLocalDateTime(event.startsAt)}.`,
        link: (role) => chatLink(role, event.conversationId),
        data: testRideData(event),
        ctaLabel: "Open chat",
      });
    }),
  );

  appEvents.on(
    "testRide.declined",
    safeHandler("notify:testRide.declined", async (event) => {
      await NotificationService.notify(event.buyerId, {
        type: NotificationType.TEST_RIDE_DECLINED,
        title: "Your test ride request was declined",
        body: `"${event.listingTitle}" on ${formatLocalDateTime(event.startsAt)}: ${event.reason}`,
        link: (role) => chatLink(role, event.conversationId),
        data: testRideData(event),
        ctaLabel: "Pick another time",
      });
    }),
  );

  appEvents.on(
    "testRide.cancelled",
    safeHandler("notify:testRide.cancelled", async (event) => {
      // the system cancels for the seller (listing closed): tell the buyer
      const recipientId =
        event.cancelledById === event.buyerId ? event.sellerId : event.buyerId;

      await NotificationService.notify(recipientId, {
        type: NotificationType.TEST_RIDE_CANCELLED,
        title: "A test ride was cancelled",
        body: `"${event.listingTitle}" on ${formatLocalDateTime(event.startsAt)}: ${event.reason}`,
        link: (role) => dashboardLink(role, "/test-rides"),
        data: testRideData(event),
        ctaLabel: "View test rides",
      });
    }),
  );

  appEvents.on(
    "testRide.expired",
    safeHandler("notify:testRide.expired", async (event) => {
      await NotificationService.notify(event.buyerId, {
        type: NotificationType.TEST_RIDE_EXPIRED,
        title: "Your test ride request was not confirmed",
        body: `The seller did not confirm "${event.listingTitle}" for ${formatLocalDateTime(event.startsAt)} in time. You can book another slot.`,
        link: (role) => chatLink(role, event.conversationId),
        data: testRideData(event),
        ctaLabel: "Pick another time",
      });
    }),
  );

  appEvents.on(
    "testRide.reminder",
    safeHandler("notify:testRide.reminder", async (event) => {
      const when = event.kind === "24h" ? "tomorrow" : "in 2 hours";

      await NotificationService.notifyUsers([event.buyerId, event.sellerId], {
        type: NotificationType.TEST_RIDE_REMINDER,
        title: `Test ride ${when}`,
        body: `"${event.listingTitle}" on ${formatLocalDateTime(event.startsAt)}.`,
        link: (role) => chatLink(role, event.conversationId),
        data: { ...testRideData(event), kind: event.kind },
        ctaLabel: "Open chat",
      });
    }),
  );

  // ============================================
  // Saved searches
  // ============================================

  appEvents.on(
    "savedSearch.matched",
    safeHandler("notify:savedSearch.matched", async (event) => {
      const isPriceDrop = event.kind === "PRICE_DROP";

      await NotificationService.notify(event.userId, {
        type: isPriceDrop
          ? NotificationType.SAVED_SEARCH_PRICE_DROP
          : NotificationType.SAVED_SEARCH_MATCH,
        title: isPriceDrop
          ? `Price drop in “${event.savedSearchName}”`
          : `New match for “${event.savedSearchName}”`,
        body:
          isPriceDrop && event.oldPrice !== null
            ? `"${event.listingTitle}" is now ${formatPrice(event.price)} (was ${formatPrice(event.oldPrice)}).`
            : `"${event.listingTitle}" · ${formatPrice(event.price)}`,
        link: listingLink(event.listingSlug),
        data: {
          savedSearchId: event.savedSearchId,
          listingId: event.listingId,
          kind: event.kind,
        },
        ctaLabel: "View listing",
      });
    }),
  );

  appEvents.on(
    "savedSearch.digest",
    safeHandler("notify:savedSearch.digest", async (event) => {
      const parts = [
        event.newListings > 0 &&
          `${event.newListings} new listing${event.newListings === 1 ? "" : "s"}`,
        event.priceDrops > 0 &&
          `${event.priceDrops} price drop${event.priceDrops === 1 ? "" : "s"}`,
      ].filter(Boolean);

      await NotificationService.notify(event.userId, {
        type: NotificationType.SAVED_SEARCH_MATCH,
        title: `${parts.join(" and ")} in “${event.savedSearchName}”`,
        body: `Including ${event.sampleTitles.map((title) => `"${title}"`).join(", ")}.`,
        link: (role) => savedSearchLink(role, event.savedSearchId),
        data: {
          savedSearchId: event.savedSearchId,
          newListings: event.newListings,
          priceDrops: event.priceDrops,
        },
        ctaLabel: "See matches",
      });
    }),
  );

  // ============================================
  // Financing requests (loan leads)
  // ============================================

  appEvents.on(
    "loanLead.submitted",
    safeHandler("notify:loanLead.submitted", async (event) => {
      await NotificationService.notifyUsers(await getLoanLeadAdminIds(), {
        type: NotificationType.LOAN_LEAD_SUBMITTED,
        title: `New financing request ${event.reference}`,
        body: `${event.fullName} wants ${formatPrice(event.loanAmount)} for "${event.listingTitle}".`,
        link: (role) => adminLoanLeadLink(role, event.loanLeadId),
        data: loanLeadData(event),
        ctaLabel: "Review request",
      });
    }),
  );

  appEvents.on(
    "loanLead.withdrawn",
    safeHandler("notify:loanLead.withdrawn", async (event) => {
      await NotificationService.notifyUsers(await getLoanLeadAdminIds(), {
        type: NotificationType.LOAN_LEAD_SUBMITTED,
        title: `Financing request ${event.reference} was withdrawn`,
        body: event.partnerName
          ? `The buyer withdrew it after it was sent to ${event.partnerName}. Let the partner know.`
          : `The buyer withdrew their request for "${event.listingTitle}".`,
        link: (role) => adminLoanLeadLink(role, event.loanLeadId),
        data: loanLeadData(event),
        ctaLabel: "View request",
      });
    }),
  );

  appEvents.on(
    "loanLead.sentToPartner",
    safeHandler("notify:loanLead.sentToPartner", async (event) => {
      await NotificationService.notify(event.buyerId, {
        type: NotificationType.LOAN_LEAD_UPDATED,
        title: `Your financing request was sent to ${event.partnerName}`,
        body: `${event.partnerName} will contact you about "${event.listingTitle}". Reference: ${event.reference}.`,
        link: (role) => buyerLoanLeadLink(role, event.loanLeadId),
        data: loanLeadData(event),
        ctaLabel: "View request",
      });
    }),
  );

  appEvents.on(
    "loanLead.statusChanged",
    safeHandler("notify:loanLead.statusChanged", async (event) => {
      const partner = event.partnerName ?? "The finance partner";
      const copy: Partial<Record<string, { title: string; body: string }>> = {
        CONTACTED: {
          title: `${partner} is reviewing your financing request`,
          body: `Your request for "${event.listingTitle}" is being processed.`,
        },
        APPROVED: {
          title: "Your financing request was approved",
          body: `${partner} approved your loan for "${event.listingTitle}". They will guide you through the next steps.`,
        },
        DISBURSED: {
          title: "Your loan has been disbursed",
          body: `The loan for "${event.listingTitle}" was paid out. Enjoy the ride!`,
        },
        REJECTED: {
          title: "Your financing request was not approved",
          body:
            event.closeReason ?? `${partner} could not approve this request.`,
        },
        CLOSED: {
          title: "Your financing request was closed",
          body:
            event.closeReason ??
            `Your request for "${event.listingTitle}" was closed.`,
        },
      };

      const message = copy[event.status];
      if (!message) return;

      await NotificationService.notify(event.buyerId, {
        type: NotificationType.LOAN_LEAD_UPDATED,
        title: message.title,
        body: message.body,
        link: (role) => buyerLoanLeadLink(role, event.loanLeadId),
        data: loanLeadData(event),
        ctaLabel: "View request",
      });
    }),
  );
};

// admins who manage loan leads (never moderators: leads hold income data)
const getLoanLeadAdminIds = async () => {
  const admins = await prisma.user.findMany({
    where: { role: { in: [Role.SUPER_ADMIN, Role.ADMIN] }, isDeleted: false },
    select: { id: true },
  });

  return admins.map((admin) => admin.id);
};

const adminLoanLeadLink = (role: Role, loanLeadId: string) =>
  dashboardLink(role, `/loan-leads/${loanLeadId}`);

const buyerLoanLeadLink = (role: Role, loanLeadId: string) =>
  dashboardLink(role, `/financing-requests/${loanLeadId}`);

const loanLeadData = (event: ILoanLeadRef) => ({
  loanLeadId: event.loanLeadId,
  listingId: event.listingId,
  status: event.status,
});

const savedSearchLink = (role: Role, savedSearchId: string) =>
  dashboardLink(role, `/saved-searches/${savedSearchId}`);

const testRideData = (event: ITestRideRef) => ({
  testRideId: event.testRideId,
  listingId: event.listingId,
  conversationId: event.conversationId,
  startsAt: event.startsAt.toISOString(),
});

// the chat thread, where offer and test-ride cards live
const chatLink = (role: Role, conversationId: string) =>
  dashboardLink(role, `/messages/${conversationId}`);

const offerData = (event: IOfferRef) => ({
  offerId: event.offerId,
  listingId: event.listingId,
  conversationId: event.conversationId,
  amount: event.amount,
});
