import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { ListingStatus } from "../../../generated/prisma/enums";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { listingCardInclude, toListingCard } from "../listing/listing.service";
import { IWishlistToggleResult } from "./wishlist.interface";

const MAX_IDS = 500;

const addToWishlist = async (userId: string, listingId: string): Promise<IWishlistToggleResult> => {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, isDeleted: false },
    select: { id: true, status: true, sellerId: true },
  });

  if (!listing) {
    throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
  }

  if (listing.status !== ListingStatus.APPROVED) {
    throw new AppError(httpStatus.CONFLICT, "Only live listings can be saved");
  }

  if (listing.sellerId === userId) {
    throw new AppError(httpStatus.BAD_REQUEST, "You cannot save your own listing");
  }

  try {
    await prisma.wishlistItem.create({ data: { userId, listingId } });
  } catch (error) {
    // already saved — saving twice is not an error
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }
  }

  return { listingId, saved: true };
};

const removeFromWishlist = async (
  userId: string,
  listingId: string,
): Promise<IWishlistToggleResult> => {
  await prisma.wishlistItem.deleteMany({ where: { userId, listingId } });

  return { listingId, saved: false };
};

/*
 * Saved listings stay in the list after they are sold/expired/removed,
 * flagged as unavailable so the user understands why.
 */
const getMyWishlist = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 12);

  const where = { userId };

  const [items, total] = await Promise.all([
    prisma.wishlistItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      include: { listing: { include: listingCardInclude } },
    }),
    prisma.wishlistItem.count({ where }),
  ]);

  return {
    data: items.map((item) => ({
      ...toListingCard(item.listing),
      savedAt: item.createdAt,
      isAvailable: item.listing.status === ListingStatus.APPROVED && !item.listing.isDeleted,
    })),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getMyWishlistIds = async (userId: string) => {
  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: MAX_IDS,
    select: { listingId: true },
  });

  return items.map((item) => item.listingId);
};

export const WishlistService = {
  addToWishlist,
  removeFromWishlist,
  getMyWishlist,
  getMyWishlistIds,
};
