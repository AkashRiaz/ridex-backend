import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { AuditAction, Role } from "../../../generated/prisma/enums";
import { ReviewWhereInput } from "../../../generated/prisma/models";
import { appEvents } from "../../events/appEvents";
import { isUuid } from "../../helper/isUuid";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createAuditLog } from "../../utils/auditLogger";
import { IRequestMeta } from "../auth/auth.interface";
import {
  ICreateReviewPayload,
  IReplyToReviewPayload,
  IReviewVisibilityPayload,
  IUpdateReviewPayload,
} from "./review.interface";
import {
  REVIEW_EDIT_WINDOW_DAYS,
  canReview,
  isWithinEditWindow,
  recalculateSellerRating,
} from "./review.utils";

const reviewInclude = {
  reviewer: { select: { id: true, name: true, imageUrl: true } },
  seller: { select: { id: true, name: true, imageUrl: true } },
  listing: { select: { id: true, title: true, slug: true } },
} satisfies Prisma.ReviewInclude;

const findReviewOrThrow = async (id: string) => {
  const review = await prisma.review.findUnique({ where: { id } });

  if (!review) {
    throw new AppError(httpStatus.NOT_FOUND, "Review not found");
  }

  return review;
};

const loadReviewer = (userId: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, emailVerified: true, phoneVerified: true },
  });

// ============================================
// Create & eligibility
// ============================================

const getReviewEligibility = async (requestUser: RequestUser, listingId: string) => {
  if (!isUuid(listingId)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid listing ID");
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, sellerId: true, status: true, isDeleted: true },
  });

  if (!listing) {
    throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
  }

  const [eligibility, existing] = await Promise.all([
    canReview(await loadReviewer(requestUser.userId), listing),
    prisma.review.findUnique({
      where: { reviewerId_listingId: { reviewerId: requestUser.userId, listingId } },
      include: reviewInclude,
    }),
  ]);

  return { ...eligibility, existingReview: existing };
};

const createReview = async (requestUser: RequestUser, payload: ICreateReviewPayload) => {
  const listing = await prisma.listing.findUnique({
    where: { id: payload.listingId },
    select: { id: true, sellerId: true, status: true, isDeleted: true },
  });

  if (!listing) {
    throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
  }

  const eligibility = await canReview(await loadReviewer(requestUser.userId), listing);

  if (!eligibility.allowed) {
    throw new AppError(
      eligibility.code === "ALREADY_REVIEWED" ? httpStatus.CONFLICT : httpStatus.FORBIDDEN,
      eligibility.reason,
    );
  }

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        reviewerId: requestUser.userId,
        sellerId: listing.sellerId,
        listingId: listing.id,
        rating: payload.rating,
        comment: payload.comment ?? "",
      },
      include: reviewInclude,
    });

    await recalculateSellerRating(tx, listing.sellerId);

    return created;
  });

  appEvents.emit("review.created", {
    reviewId: review.id,
    sellerId: review.sellerId,
    reviewerId: review.reviewerId,
    rating: review.rating,
  });

  return review;
};

// ============================================
// Reads
// ============================================

/*
 * Public list for a seller (or a listing). Includes a rating summary.
 */
const getReviews = async (query: IQuery) => {
  const sellerId = typeof query.seller === "string" && isUuid(query.seller) ? query.seller : undefined;
  const listingId = typeof query.listing === "string" && isUuid(query.listing) ? query.listing : undefined;

  if (!sellerId && !listingId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Filter by seller or listing");
  }

  const { page, limit, skip } = queryBuilder.buildPagination(query, 10);

  const andConditions: ReviewWhereInput[] = [{ isHidden: false }];

  if (sellerId) andConditions.push({ sellerId });
  if (listingId) andConditions.push({ listingId });

  const rating = Number(query.rating);
  const ratingFilter = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? { rating } : {};

  const orderBy: Prisma.ReviewOrderByWithRelationInput =
    query.sortBy === "rating"
      ? { rating: query.sortOrder === "asc" ? "asc" : "desc" }
      : { createdAt: "desc" };

  const [reviews, total, distribution] = await Promise.all([
    prisma.review.findMany({
      where: { AND: [...andConditions, ratingFilter] },
      orderBy,
      take: limit,
      skip,
      include: reviewInclude,
    }),
    prisma.review.count({ where: { AND: [...andConditions, ratingFilter] } }),
    prisma.review.groupBy({
      by: ["rating"],
      where: { AND: andConditions },
      _count: { _all: true },
    }),
  ]);

  const counts = Object.fromEntries([1, 2, 3, 4, 5].map((star) => [star, 0])) as Record<number, number>;
  for (const row of distribution) counts[row.rating] = row._count._all;
  const totalCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const average =
    totalCount === 0
      ? 0
      : Object.entries(counts).reduce((sum, [star, count]) => sum + Number(star) * count, 0) / totalCount;

  return {
    data: reviews,
    meta: {
      ...queryBuilder.buildMeta(page, limit, total),
      summary: {
        average: Math.round(average * 10) / 10,
        count: totalCount,
        distribution: counts,
      },
    },
  };
};

const getGivenReviews = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 10);

  const where = { reviewerId: userId };

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip, include: reviewInclude }),
    prisma.review.count({ where }),
  ]);

  return {
    data: reviews.map((review) => ({
      ...review,
      canEdit: isWithinEditWindow(review.createdAt),
    })),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

// sellers also see hidden reviews (flagged) so moderation is transparent
const getReceivedReviews = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 10);

  const where: ReviewWhereInput = {
    sellerId: userId,
    ...(query.replied === "false" && { sellerReply: null }),
  };

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip, include: reviewInclude }),
    prisma.review.count({ where }),
  ]);

  return {
    data: reviews,
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

// ============================================
// Changes
// ============================================

const updateReview = async (requestUser: RequestUser, id: string, payload: IUpdateReviewPayload) => {
  const review = await findReviewOrThrow(id);

  if (review.reviewerId !== requestUser.userId) {
    throw new AppError(httpStatus.FORBIDDEN, "You can only edit your own reviews");
  }

  if (!isWithinEditWindow(review.createdAt)) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      `Reviews can only be edited within ${REVIEW_EDIT_WINDOW_DAYS} days`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.review.update({
      where: { id },
      data: {
        ...(payload.rating !== undefined && { rating: payload.rating }),
        ...(payload.comment !== undefined && { comment: payload.comment }),
      },
      include: reviewInclude,
    });

    await recalculateSellerRating(tx, review.sellerId);

    return updated;
  });
};

const deleteReview = async (requestUser: RequestUser, id: string, meta: IRequestMeta) => {
  const review = await findReviewOrThrow(id);

  const isAdmin = requestUser.role === Role.ADMIN || requestUser.role === Role.SUPER_ADMIN;

  if (review.reviewerId !== requestUser.userId && !isAdmin) {
    throw new AppError(httpStatus.FORBIDDEN, "You can only delete your own reviews");
  }

  await prisma.$transaction(async (tx) => {
    await tx.review.delete({ where: { id } });
    await recalculateSellerRating(tx, review.sellerId);

    if (review.reviewerId !== requestUser.userId) {
      await createAuditLog(
        { userId: requestUser.userId, action: AuditAction.DELETE, entity: "Review", entityId: id, ...meta },
        tx,
      );
    }
  });
};

const replyToReview = async (requestUser: RequestUser, id: string, payload: IReplyToReviewPayload) => {
  const review = await findReviewOrThrow(id);

  if (review.sellerId !== requestUser.userId) {
    throw new AppError(httpStatus.FORBIDDEN, "Only the reviewed seller can reply");
  }

  if (review.sellerReply) {
    throw new AppError(httpStatus.CONFLICT, "You have already replied to this review");
  }

  return prisma.review.update({
    where: { id },
    data: { sellerReply: payload.reply, sellerRepliedAt: new Date() },
    include: reviewInclude,
  });
};

/*
 * Moderation: hide / unhide (also used by the report module).
 */
const setReviewVisibility = async (
  staff: RequestUser,
  id: string,
  payload: IReviewVisibilityPayload,
  meta: IRequestMeta,
  tx?: Prisma.TransactionClient,
) => {
  const run = async (db: Prisma.TransactionClient) => {
    const review = await db.review.findUnique({ where: { id } });

    if (!review) {
      throw new AppError(httpStatus.NOT_FOUND, "Review not found");
    }

    const updated = await db.review.update({
      where: { id },
      data: {
        isHidden: payload.isHidden,
        hiddenReason: payload.isHidden ? (payload.reason ?? null) : null,
      },
      include: reviewInclude,
    });

    await recalculateSellerRating(db, review.sellerId);

    await createAuditLog(
      {
        userId: staff.userId,
        action: AuditAction.UPDATE,
        entity: "Review",
        entityId: id,
        oldData: { isHidden: review.isHidden },
        newData: { isHidden: payload.isHidden, reason: payload.reason ?? null },
        ...meta,
      },
      db,
    );

    return updated;
  };

  return tx ? run(tx) : prisma.$transaction(run);
};

export const ReviewService = {
  getReviewEligibility,
  createReview,
  getReviews,
  getGivenReviews,
  getReceivedReviews,
  updateReview,
  deleteReview,
  replyToReview,
  setReviewVisibility,
};
