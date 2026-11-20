import { prisma } from "../../lib/prisma";
import { RECENTLY_VIEWED_LIMIT } from "./recentlyViewed.interface";

/*
 * Called by the listing detail endpoint for signed-in visitors.
 * Keeps only the newest RECENTLY_VIEWED_LIMIT entries per user.
 * Lives in utils (Prisma only) so listing.service can import it without a cycle.
 */
export const recordRecentlyViewed = async (userId: string, listingId: string) => {
  await prisma.recentlyViewed.upsert({
    where: { userId_listingId: { userId, listingId } },
    create: { userId, listingId },
    update: { viewedAt: new Date() },
  });

  const overflow = await prisma.recentlyViewed.findMany({
    where: { userId },
    orderBy: { viewedAt: "desc" },
    skip: RECENTLY_VIEWED_LIMIT,
    select: { id: true },
  });

  if (overflow.length > 0) {
    await prisma.recentlyViewed.deleteMany({
      where: { id: { in: overflow.map((item) => item.id) } },
    });
  }
};
