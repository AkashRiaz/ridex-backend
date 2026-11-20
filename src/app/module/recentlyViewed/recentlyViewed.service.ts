import { ListingStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { listingCardInclude, toListingCard } from "../listing/listing.service";
import { IRecentlyViewedQuery, RECENTLY_VIEWED_LIMIT } from "./recentlyViewed.interface";
import { recordRecentlyViewed } from "./recentlyViewed.utils";

const getMyRecentlyViewed = async (userId: string, query: IRecentlyViewedQuery) => {
  const limit = Math.min(Math.max(Number(query.limit) || RECENTLY_VIEWED_LIMIT, 1), RECENTLY_VIEWED_LIMIT);

  const items = await prisma.recentlyViewed.findMany({
    where: {
      userId,
      // removed listings disappear; sold ones stay (flagged by status)
      listing: { isDeleted: false, status: { in: [ListingStatus.APPROVED, ListingStatus.SOLD] } },
    },
    orderBy: { viewedAt: "desc" },
    take: limit,
    include: { listing: { include: listingCardInclude } },
  });

  return items.map((item) => ({
    ...toListingCard(item.listing),
    viewedAt: item.viewedAt,
  }));
};

const removeRecentlyViewed = async (userId: string, listingId: string) => {
  await prisma.recentlyViewed.deleteMany({ where: { userId, listingId } });
};

const clearRecentlyViewed = async (userId: string) => {
  const result = await prisma.recentlyViewed.deleteMany({ where: { userId } });

  return { removed: result.count };
};

export const RecentlyViewedService = {
  recordView: recordRecentlyViewed,
  getMyRecentlyViewed,
  removeRecentlyViewed,
  clearRecentlyViewed,
};
