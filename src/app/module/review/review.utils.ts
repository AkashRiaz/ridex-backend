import { Prisma } from "../../../generated/prisma/client";
import { ListingStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { TReviewEligibility } from "./review.interface";

export const REVIEW_EDIT_WINDOW_DAYS = 30;

export const REVIEWABLE_STATUSES: ListingStatus[] = [ListingStatus.APPROVED, ListingStatus.SOLD];

type TReviewer = { id: string; emailVerified: boolean; phoneVerified: boolean };
type TReviewListing = { id: string; sellerId: string; status: ListingStatus; isDeleted: boolean };

/*
 * Pure part of the eligibility check (unit-tested).
 * `hasInteraction` and `alreadyReviewed` come from the database.
 */
export const evaluateReviewEligibility = (input: {
  reviewer: TReviewer;
  listing: TReviewListing;
  hasInteraction: boolean;
  alreadyReviewed: boolean;
}): TReviewEligibility => {
  const { reviewer, listing } = input;

  if (listing.sellerId === reviewer.id) {
    return { allowed: false, code: "OWN_LISTING", reason: "You cannot review your own listing" };
  }

  if (listing.isDeleted || !REVIEWABLE_STATUSES.includes(listing.status)) {
    return { allowed: false, code: "LISTING_UNAVAILABLE", reason: "This listing cannot be reviewed" };
  }

  if (!reviewer.emailVerified && !reviewer.phoneVerified) {
    return {
      allowed: false,
      code: "UNVERIFIED",
      reason: "Verify your email or phone before writing reviews",
    };
  }

  if (input.alreadyReviewed) {
    return {
      allowed: false,
      code: "ALREADY_REVIEWED",
      reason: "You have already reviewed this listing. You can edit your review instead.",
    };
  }

  if (!input.hasInteraction) {
    return {
      allowed: false,
      code: "NO_INTERACTION",
      reason: "You can review a seller after you have viewed or saved their listing",
    };
  }

  return { allowed: true };
};

/*
 * "Interaction" with the seller about this listing.
 * Until chat exists: the reviewer viewed or saved the listing.
 * Chat (Phase 1 · Part 5) replaces this with "has a conversation about this listing".
 */
export const hasReviewInteraction = async (reviewerId: string, listingId: string) => {
  const [viewed, saved] = await Promise.all([
    prisma.recentlyViewed.findUnique({
      where: { userId_listingId: { userId: reviewerId, listingId } },
      select: { id: true },
    }),
    prisma.wishlistItem.findUnique({
      where: { userId_listingId: { userId: reviewerId, listingId } },
      select: { id: true },
    }),
  ]);

  return Boolean(viewed || saved);
};

export const canReview = async (reviewer: TReviewer, listing: TReviewListing) => {
  const [hasInteraction, existing] = await Promise.all([
    hasReviewInteraction(reviewer.id, listing.id),
    prisma.review.findUnique({
      where: { reviewerId_listingId: { reviewerId: reviewer.id, listingId: listing.id } },
      select: { id: true },
    }),
  ]);

  return evaluateReviewEligibility({
    reviewer,
    listing,
    hasInteraction,
    alreadyReviewed: Boolean(existing),
  });
};

/*
 * Keeps User.ratingAverage / ratingCount in sync. Hidden reviews do not count.
 * Always call inside the same transaction as the review change.
 */
export const recalculateSellerRating = async (tx: Prisma.TransactionClient, sellerId: string) => {
  const aggregate = await tx.review.aggregate({
    where: { sellerId, isHidden: false },
    _avg: { rating: true },
    _count: { _all: true },
  });

  await tx.user.update({
    where: { id: sellerId },
    data: {
      ratingAverage: aggregate._avg.rating ?? 0,
      ratingCount: aggregate._count._all,
    },
  });
};

export const isWithinEditWindow = (createdAt: Date, now = new Date()) =>
  now.getTime() - createdAt.getTime() <= REVIEW_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
