import { Prisma } from "../../../generated/prisma/client";
import {
  AuditAction,
  ListingStatus,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  Role,
  UserStatus,
  VerificationStatus,
  VerificationType,
} from "../../../generated/prisma/enums";
import { config } from "../../config";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { RequestUser } from "../../middleware/checkAuth";
import { AuditLogService } from "../auditLog/auditLog.service";
import {
  IDailyCountRow,
  IDashboardRange,
  IQueueCounts,
} from "./dashboard.interface";
import {
  dashboardCacheKey,
  fillDailySeries,
  parseDashboardRange,
  percentChange,
  toCountMap,
  toPercent,
} from "./dashboard.utils";

const DAY_MS = 24 * 60 * 60 * 1000;

const ACTIVE_REPORT_STATUSES: ReportStatus[] = [
  ReportStatus.OPEN,
  ReportStatus.IN_REVIEW,
];

const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

// ============================================
// Shared building blocks
// ============================================

/*
 * Cached overviews: read-through Redis cache that never breaks the request.
 */
const withCache = async <T>(
  key: string,
  compute: () => Promise<T>,
): Promise<T> => {
  const ttl = config.dashboard_cache_seconds;

  if (ttl > 0) {
    try {
      const cached = await redisClient.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch (error) {
      console.error("Dashboard cache read failed:", error);
    }
  }

  const result = await compute();

  if (ttl > 0) {
    try {
      await redisClient.set(key, JSON.stringify(result), {
        expiration: { type: "EX", value: ttl },
      });
    } catch (error) {
      console.error("Dashboard cache write failed:", error);
    }
  }

  return result;
};

/*
 * Date param for raw SQL. Prisma DateTime columns are `timestamp` holding UTC,
 * so the bound instant is converted to a UTC timestamp before comparing.
 */
const utcTimestamp = (date: Date) =>
  Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

const localDay = (column: Prisma.Sql) =>
  Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${config.timezone}, 'YYYY-MM-DD')`;

/*
 * Rows per local day for one table/column, from the start of the range.
 * `table`, `column` and `join` are fixed identifiers from this file, never user input;
 * values go through bound parameters in `where`.
 */
const dailyCounts = (
  range: IDashboardRange,
  source: {
    table: string;
    column: string;
    join?: Prisma.Sql;
    where?: Prisma.Sql;
  },
) => {
  const column = Prisma.raw(`t."${source.column}"`);

  return prisma.$queryRaw<IDailyCountRow[]>`
    SELECT ${localDay(column)} AS day, COUNT(*)::int AS count
    FROM ${Prisma.raw(source.table)} t
    ${source.join ?? Prisma.empty}
    WHERE ${column} >= ${utcTimestamp(range.from)}
    ${source.where ?? Prisma.empty}
    GROUP BY 1
  `;
};

const previousPeriod = (range: IDashboardRange) => ({
  gte: new Date(range.from.getTime() - range.days * DAY_MS),
  lt: range.from,
});

const inRange = (range: IDashboardRange) => ({ gte: range.from });

const rangeInfo = (range: IDashboardRange) => ({
  key: range.key,
  days: range.days,
  from: range.fromKey,
  to: range.toKey,
});

const groupRows = <T extends Record<string, unknown>>(
  rows: (T & { _count: { _all: number } })[],
  key: keyof T,
) =>
  rows.map((row) => ({
    key: row[key] as string | null,
    count: row._count._all,
  }));

const coverImageSelect = {
  where: { isCover: true },
  take: 1,
  select: { url: true },
} satisfies Prisma.Listing$imagesArgs;

const toListingSummary = <
  T extends { price: Prisma.Decimal; images: { url: string }[] },
>(
  listing: T,
) => {
  const { images, ...rest } = listing;

  return {
    ...rest,
    price: Number(listing.price),
    coverImage: images[0]?.url ?? null,
  };
};

/*
 * Average hours from submit to approval, for listings approved in the range.
 */
const getAverageReviewHours = async (range: IDashboardRange) => {
  const [row] = await prisma.$queryRaw<{ hours: number | null }[]>`
    SELECT (AVG(EXTRACT(EPOCH FROM ("approvedAt" - "submittedAt"))) / 3600)::float AS hours
    FROM listings
    WHERE "approvedAt" >= ${utcTimestamp(range.from)}
      AND "submittedAt" IS NOT NULL
      AND "approvedAt" >= "submittedAt"
  `;

  return row?.hours === null || row?.hours === undefined
    ? null
    : Math.round(row.hours * 10) / 10;
};

const getQueueCountsFor = async (role: Role): Promise<IQueueCounts> => {
  const canReviewVerifications = ADMIN_ROLES.includes(role);

  const [listings, reports, verifications] = await Promise.all([
    prisma.listing.count({
      where: { status: ListingStatus.PENDING, isDeleted: false },
    }),
    prisma.report.count({ where: { status: { in: ACTIVE_REPORT_STATUSES } } }),
    canReviewVerifications
      ? prisma.verificationRequest.count({
          where: { status: VerificationStatus.PENDING },
        })
      : Promise.resolve(null),
  ]);

  return { listings, reports, verifications };
};

// ============================================
// Admin / super admin
// ============================================

const getAdminOverview = async (viewer: RequestUser, rangeValue: unknown) => {
  const range = parseDashboardRange(rangeValue);

  // recent activity depends on the viewer's role (admins don't see super admin actions)
  return withCache(
    dashboardCacheKey("admin", viewer.role, range.key),
    async () => {
      const previous = previousPeriod(range);
      const notDeletedUser = { isDeleted: false };
      const liveListing = { isDeleted: false };

      const [
        usersByRole,
        usersByStatus,
        newUsers,
        previousNewUsers,
        listingsByStatus,
        submittedListings,
        previousSubmittedListings,
        openReports,
        reportsInRange,
        previousReports,
        reportsByReason,
        pendingVerifications,
        conversationsTotal,
        conversationsInRange,
        previousConversations,
        messagesInRange,
        topBrandGroups,
        divisionGroups,
        averageReviewHours,
        queues,
      ] = await Promise.all([
        prisma.user.groupBy({
          by: ["role"],
          where: notDeletedUser,
          _count: { _all: true },
        }),
        prisma.user.groupBy({
          by: ["status"],
          where: notDeletedUser,
          _count: { _all: true },
        }),
        prisma.user.count({
          where: { ...notDeletedUser, createdAt: inRange(range) },
        }),
        prisma.user.count({
          where: { ...notDeletedUser, createdAt: previous },
        }),
        prisma.listing.groupBy({
          by: ["status"],
          where: liveListing,
          _count: { _all: true },
        }),
        prisma.listing.count({
          where: { ...liveListing, submittedAt: inRange(range) },
        }),
        prisma.listing.count({
          where: { ...liveListing, submittedAt: previous },
        }),
        prisma.report.count({
          where: { status: { in: ACTIVE_REPORT_STATUSES } },
        }),
        prisma.report.count({ where: { createdAt: inRange(range) } }),
        prisma.report.count({ where: { createdAt: previous } }),
        prisma.report.groupBy({
          by: ["reason"],
          where: { createdAt: inRange(range) },
          _count: { _all: true },
        }),
        prisma.verificationRequest.groupBy({
          by: ["type"],
          where: { status: VerificationStatus.PENDING },
          _count: { _all: true },
        }),
        prisma.conversation.count(),
        prisma.conversation.count({ where: { createdAt: inRange(range) } }),
        prisma.conversation.count({ where: { createdAt: previous } }),
        prisma.message.count({
          where: { createdAt: inRange(range), senderId: { not: null } },
        }),
        prisma.listing.groupBy({
          by: ["brandId"],
          where: { ...liveListing, status: ListingStatus.APPROVED },
          _count: { _all: true },
          orderBy: { _count: { brandId: "desc" } },
          take: 6,
        }),
        prisma.listing.groupBy({
          by: ["division"],
          where: {
            ...liveListing,
            status: ListingStatus.APPROVED,
            division: { not: "" },
          },
          _count: { _all: true },
          orderBy: { _count: { division: "desc" } },
          take: 8,
        }),
        getAverageReviewHours(range),
        getQueueCountsFor(viewer.role),
      ]);

      const [
        usersSeries,
        submittedSeries,
        approvedSeries,
        reportsSeries,
        conversationsSeries,
      ] = await Promise.all([
        dailyCounts(range, {
          table: "users",
          column: "createdAt",
          where: Prisma.sql`AND t."isDeleted" = false`,
        }),
        dailyCounts(range, {
          table: "listings",
          column: "submittedAt",
          where: Prisma.sql`AND t."isDeleted" = false`,
        }),
        dailyCounts(range, {
          table: "listings",
          column: "approvedAt",
          where: Prisma.sql`AND t."isDeleted" = false`,
        }),
        dailyCounts(range, { table: "reports", column: "createdAt" }),
        dailyCounts(range, { table: "conversations", column: "createdAt" }),
      ]);

      const brands = await prisma.brand.findMany({
        where: { id: { in: topBrandGroups.map((group) => group.brandId) } },
        select: { id: true, name: true },
      });
      const brandName = new Map(brands.map((brand) => [brand.id, brand.name]));

      const userRoleCounts = toCountMap(
        Object.values(Role),
        groupRows(usersByRole, "role"),
      );
      const userStatusCounts = toCountMap(
        Object.values(UserStatus),
        groupRows(usersByStatus, "status"),
      );
      const listingStatusCounts = toCountMap(
        Object.values(ListingStatus),
        groupRows(listingsByStatus, "status"),
      );
      const verificationCounts = toCountMap(
        Object.values(VerificationType),
        groupRows(pendingVerifications, "type"),
      );

      const recentActivity = await AuditLogService.getAllAuditLogs(
        { limit: "8" },
        viewer,
      );

      const totalUsers = Object.values(userRoleCounts).reduce(
        (sum, count) => sum + count,
        0,
      );
      const staffRoles: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.MODERATOR];

      return {
        range: rangeInfo(range),
        generatedAt: new Date().toISOString(),
        users: {
          total: totalUsers,
          staff: staffRoles.reduce(
            (sum, role) => sum + userRoleCounts[role],
            0,
          ),
          newInRange: newUsers,
          change: percentChange(newUsers, previousNewUsers),
          byRole: userRoleCounts,
          byStatus: userStatusCounts,
        },
        listings: {
          total: Object.values(listingStatusCounts).reduce(
            (sum, count) => sum + count,
            0,
          ),
          live: listingStatusCounts.APPROVED,
          submittedInRange: submittedListings,
          change: percentChange(submittedListings, previousSubmittedListings),
          byStatus: listingStatusCounts,
          averageReviewHours,
        },
        reports: {
          open: openReports,
          inRange: reportsInRange,
          change: percentChange(reportsInRange, previousReports),
          byReason: toCountMap(
            Object.values(ReportReason),
            groupRows(reportsByReason, "reason"),
          ),
        },
        verifications: {
          pending: verificationCounts.ID + verificationCounts.DEALER,
          byType: verificationCounts,
        },
        chats: {
          conversations: conversationsTotal,
          newInRange: conversationsInRange,
          change: percentChange(conversationsInRange, previousConversations),
          messagesInRange,
        },
        queues,
        series: fillDailySeries(range, {
          users: usersSeries,
          submitted: submittedSeries,
          approved: approvedSeries,
          reports: reportsSeries,
          conversations: conversationsSeries,
        }),
        topBrands: topBrandGroups.map((group) => ({
          id: group.brandId,
          label: brandName.get(group.brandId) ?? "Unknown",
          count: group._count._all,
        })),
        listingsByDivision: divisionGroups.map((group) => ({
          label: group.division,
          count: group._count._all,
        })),
        recentActivity: recentActivity.data,
      };
    },
  );
};

// ============================================
// Moderator (admins can open it too)
// ============================================

const getModeratorOverview = async (
  viewer: RequestUser,
  rangeValue: unknown,
) => {
  const range = parseDashboardRange(rangeValue);

  return withCache(
    dashboardCacheKey("moderator", viewer.userId, range.key),
    async () => {
      const canReviewVerifications = ADMIN_ROLES.includes(viewer.role);

      const [
        queues,
        myListingDecisions,
        myClosedReports,
        openReportsByReason,
        openReportsByTarget,
        oldestListings,
        oldestReports,
        oldestVerifications,
        averageReviewHours,
      ] = await Promise.all([
        getQueueCountsFor(viewer.role),
        prisma.auditLog.groupBy({
          by: ["action"],
          where: {
            userId: viewer.userId,
            entity: "Listing",
            action: { in: [AuditAction.APPROVE, AuditAction.REJECT] },
            createdAt: inRange(range),
          },
          _count: { _all: true },
        }),
        prisma.report.groupBy({
          by: ["status"],
          where: { resolvedById: viewer.userId, resolvedAt: inRange(range) },
          _count: { _all: true },
        }),
        prisma.report.groupBy({
          by: ["reason"],
          where: { status: { in: ACTIVE_REPORT_STATUSES } },
          _count: { _all: true },
        }),
        prisma.report.groupBy({
          by: ["targetType"],
          where: { status: { in: ACTIVE_REPORT_STATUSES } },
          _count: { _all: true },
        }),
        prisma.listing.findMany({
          where: { status: ListingStatus.PENDING, isDeleted: false },
          orderBy: { submittedAt: "asc" },
          take: 5,
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            submittedAt: true,
            seller: { select: { id: true, name: true } },
            images: coverImageSelect,
          },
        }),
        prisma.report.findMany({
          where: { status: { in: ACTIVE_REPORT_STATUSES } },
          orderBy: { createdAt: "asc" },
          take: 5,
          select: {
            id: true,
            targetType: true,
            reason: true,
            status: true,
            createdAt: true,
          },
        }),
        canReviewVerifications
          ? prisma.verificationRequest.findMany({
              where: { status: VerificationStatus.PENDING },
              orderBy: { createdAt: "asc" },
              take: 5,
              select: {
                id: true,
                type: true,
                createdAt: true,
                user: { select: { id: true, name: true } },
              },
            })
          : Promise.resolve(null),
        getAverageReviewHours(range),
      ]);

      const decisionWhere = (action: AuditAction) =>
        Prisma.sql`AND t."userId" = ${viewer.userId} AND t."entity" = 'Listing' AND t."action" = ${action}::"AuditAction"`;

      const [approvedSeries, rejectedSeries, reportsSeries] = await Promise.all(
        [
          dailyCounts(range, {
            table: "audit_logs",
            column: "createdAt",
            where: decisionWhere(AuditAction.APPROVE),
          }),
          dailyCounts(range, {
            table: "audit_logs",
            column: "createdAt",
            where: decisionWhere(AuditAction.REJECT),
          }),
          dailyCounts(range, {
            table: "reports",
            column: "resolvedAt",
            where: Prisma.sql`AND t."resolvedById" = ${viewer.userId}`,
          }),
        ],
      );

      const decisions = toCountMap(
        [AuditAction.APPROVE, AuditAction.REJECT] as const,
        groupRows(myListingDecisions, "action"),
      );
      const closedReports = toCountMap(
        [ReportStatus.RESOLVED, ReportStatus.DISMISSED] as const,
        groupRows(myClosedReports, "status"),
      );
      const totalDecisions = decisions.APPROVE + decisions.REJECT;

      return {
        range: rangeInfo(range),
        generatedAt: new Date().toISOString(),
        queues,
        mine: {
          approved: decisions.APPROVE,
          rejected: decisions.REJECT,
          approvalRate: toPercent(decisions.APPROVE, totalDecisions),
          reportsResolved: closedReports.RESOLVED,
          reportsDismissed: closedReports.DISMISSED,
        },
        averageReviewHours,
        openReportsByReason: toCountMap(
          Object.values(ReportReason),
          groupRows(openReportsByReason, "reason"),
        ),
        openReportsByTarget: toCountMap(
          Object.values(ReportTargetType),
          groupRows(openReportsByTarget, "targetType"),
        ),
        series: fillDailySeries(range, {
          approved: approvedSeries,
          rejected: rejectedSeries,
          reports: reportsSeries,
        }),
        oldest: {
          listings: oldestListings.map(toListingSummary),
          reports: oldestReports,
          verifications: oldestVerifications,
        },
      };
    },
  );
};

// ============================================
// Seller / dealer
// ============================================

const getLatestVerifications = async (userId: string) => {
  const requests = await prisma.verificationRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      type: true,
      status: true,
      rejectionReason: true,
      createdAt: true,
    },
  });

  const latest = (type: VerificationType) =>
    requests.find((request) => request.type === type) ?? null;

  return {
    ID: latest(VerificationType.ID),
    DEALER: latest(VerificationType.DEALER),
  };
};

const getSellerOverview = async (viewer: RequestUser, rangeValue: unknown) => {
  const range = parseDashboardRange(rangeValue);
  const previous = previousPeriod(range);
  const userId = viewer.userId;
  const myListings = { sellerId: userId, isDeleted: false };
  const now = new Date();

  const [
    listingsByStatus,
    viewsAggregate,
    savesTotal,
    savesInRange,
    previousSaves,
    chatsTotal,
    chatsInRange,
    previousChats,
    unreadAggregate,
    soldInRange,
    listingsWithChats,
    soldWithChats,
    profile,
    verifications,
    topListings,
    expiringSoon,
    recentReviews,
  ] = await Promise.all([
    prisma.listing.groupBy({
      by: ["status"],
      where: myListings,
      _count: { _all: true },
    }),
    prisma.listing.aggregate({ where: myListings, _sum: { viewsCount: true } }),
    prisma.wishlistItem.count({ where: { listing: myListings } }),
    prisma.wishlistItem.count({
      where: { listing: myListings, createdAt: inRange(range) },
    }),
    prisma.wishlistItem.count({
      where: { listing: myListings, createdAt: previous },
    }),
    prisma.conversation.count({ where: { sellerId: userId } }),
    prisma.conversation.count({
      where: { sellerId: userId, createdAt: inRange(range) },
    }),
    prisma.conversation.count({
      where: { sellerId: userId, createdAt: previous },
    }),
    prisma.conversation.aggregate({
      where: { sellerId: userId },
      _sum: { sellerUnreadCount: true },
    }),
    prisma.listing.count({ where: { ...myListings, soldAt: inRange(range) } }),
    prisma.listing.count({
      where: { ...myListings, conversations: { some: {} } },
    }),
    prisma.listing.count({
      where: {
        ...myListings,
        status: ListingStatus.SOLD,
        conversations: { some: {} },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        ratingAverage: true,
        ratingCount: true,
        phoneVerified: true,
        emailVerified: true,
        idVerifiedAt: true,
        dealerVerifiedAt: true,
        status: true,
      },
    }),
    getLatestVerifications(userId),
    prisma.listing.findMany({
      where: {
        ...myListings,
        status: { in: [ListingStatus.APPROVED, ListingStatus.SOLD] },
      },
      orderBy: [{ viewsCount: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        price: true,
        viewsCount: true,
        images: coverImageSelect,
        _count: { select: { wishlistItems: true, conversations: true } },
      },
    }),
    prisma.listing.findMany({
      where: {
        ...myListings,
        status: ListingStatus.APPROVED,
        expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) },
      },
      orderBy: { expiresAt: "asc" },
      take: 5,
      select: {
        id: true,
        title: true,
        slug: true,
        price: true,
        expiresAt: true,
        images: coverImageSelect,
      },
    }),
    prisma.review.findMany({
      where: { sellerId: userId, isHidden: false },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        sellerReply: true,
        reviewer: { select: { id: true, name: true, imageUrl: true } },
        listing: { select: { id: true, title: true, slug: true } },
      },
    }),
  ]);

  const [chatsSeries, savesSeries, soldSeries] = await Promise.all([
    dailyCounts(range, {
      table: "conversations",
      column: "createdAt",
      where: Prisma.sql`AND t."sellerId" = ${userId}`,
    }),
    dailyCounts(range, {
      table: "wishlist_items",
      column: "createdAt",
      join: Prisma.sql`JOIN listings l ON l.id = t."listingId"`,
      where: Prisma.sql`AND l."sellerId" = ${userId} AND l."isDeleted" = false`,
    }),
    dailyCounts(range, {
      table: "listings",
      column: "soldAt",
      where: Prisma.sql`AND t."sellerId" = ${userId} AND t."isDeleted" = false`,
    }),
  ]);

  const statusCounts = toCountMap(
    Object.values(ListingStatus),
    groupRows(listingsByStatus, "status"),
  );

  return {
    range: rangeInfo(range),
    generatedAt: new Date().toISOString(),
    listings: {
      total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
      live: statusCounts.APPROVED,
      byStatus: statusCounts,
      soldInRange,
    },
    engagement: {
      views: viewsAggregate._sum.viewsCount ?? 0,
      saves: savesTotal,
      savesInRange,
      savesChange: percentChange(savesInRange, previousSaves),
      chats: chatsTotal,
      chatsInRange,
      chatsChange: percentChange(chatsInRange, previousChats),
      unreadMessages: unreadAggregate._sum.sellerUnreadCount ?? 0,
    },
    conversion: {
      listingsWithChats,
      soldWithChats,
      // share of listings that got a chat and then sold
      rate: toPercent(soldWithChats, listingsWithChats),
    },
    trust: {
      ratingAverage: profile?.ratingAverage ?? 0,
      ratingCount: profile?.ratingCount ?? 0,
      phoneVerified: profile?.phoneVerified ?? false,
      emailVerified: profile?.emailVerified ?? false,
      idVerified: Boolean(profile?.idVerifiedAt),
      dealerVerified: Boolean(profile?.dealerVerifiedAt),
      accountStatus: profile?.status ?? null,
      verifications,
    },
    series: fillDailySeries(range, {
      chats: chatsSeries,
      saves: savesSeries,
      sold: soldSeries,
    }),
    topListings: topListings.map((listing) => {
      const { _count, ...rest } = toListingSummary(listing);
      return {
        ...rest,
        saves: _count.wishlistItems,
        chats: _count.conversations,
      };
    }),
    expiringSoon: expiringSoon.map(toListingSummary),
    recentReviews,
  };
};

// ============================================
// Buyer (also dealer staff and inspector until their modules arrive)
// ============================================

const getBuyerOverview = async (viewer: RequestUser, rangeValue: unknown) => {
  const range = parseDashboardRange(rangeValue);
  const userId = viewer.userId;
  const liveListing = { status: ListingStatus.APPROVED, isDeleted: false };

  const [
    savedTotal,
    savedUnavailable,
    recentlyViewedTotal,
    activeChats,
    unreadAggregate,
    reportsByStatus,
    reviewsGiven,
    profile,
    verifications,
    recentSaved,
    savedByBrand,
  ] = await Promise.all([
    prisma.wishlistItem.count({ where: { userId } }),
    prisma.wishlistItem.count({
      where: { userId, listing: { NOT: liveListing } },
    }),
    prisma.recentlyViewed.count({ where: { userId } }),
    prisma.conversation.count({
      where: { buyerId: userId, buyerArchivedAt: null },
    }),
    prisma.conversation.aggregate({
      where: { buyerId: userId },
      _sum: { buyerUnreadCount: true },
    }),
    prisma.report.groupBy({
      by: ["status"],
      where: { reporterId: userId },
      _count: { _all: true },
    }),
    prisma.review.count({ where: { reviewerId: userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { phoneVerified: true, emailVerified: true, idVerifiedAt: true },
    }),
    getLatestVerifications(userId),
    prisma.wishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: {
        createdAt: true,
        listing: {
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            status: true,
            isDeleted: true,
            images: coverImageSelect,
          },
        },
      },
    }),
    prisma.$queryRaw<{ label: string; count: number }[]>`
      SELECT b.name AS label, COUNT(*)::int AS count
      FROM wishlist_items w
      JOIN listings l ON l.id = w."listingId"
      JOIN brands b ON b.id = l."brandId"
      WHERE w."userId" = ${userId}
      GROUP BY b.name
      ORDER BY count DESC, b.name ASC
      LIMIT 6
    `,
  ]);

  const [savesSeries, viewedSeries, messagesSeries] = await Promise.all([
    dailyCounts(range, {
      table: "wishlist_items",
      column: "createdAt",
      where: Prisma.sql`AND t."userId" = ${userId}`,
    }),
    dailyCounts(range, {
      table: "recently_viewed",
      column: "viewedAt",
      where: Prisma.sql`AND t."userId" = ${userId}`,
    }),
    dailyCounts(range, {
      table: "messages",
      column: "createdAt",
      where: Prisma.sql`AND t."senderId" = ${userId}`,
    }),
  ]);

  const reportCounts = toCountMap(
    Object.values(ReportStatus),
    groupRows(reportsByStatus, "status"),
  );

  return {
    range: rangeInfo(range),
    generatedAt: new Date().toISOString(),
    saved: {
      total: savedTotal,
      unavailable: savedUnavailable,
      available: savedTotal - savedUnavailable,
    },
    recentlyViewed: recentlyViewedTotal,
    chats: {
      active: activeChats,
      unreadMessages: unreadAggregate._sum.buyerUnreadCount ?? 0,
    },
    reports: {
      total: Object.values(reportCounts).reduce((sum, count) => sum + count, 0),
      open: reportCounts.OPEN + reportCounts.IN_REVIEW,
      byStatus: reportCounts,
    },
    reviewsGiven,
    trust: {
      phoneVerified: profile?.phoneVerified ?? false,
      emailVerified: profile?.emailVerified ?? false,
      idVerified: Boolean(profile?.idVerifiedAt),
      verifications,
    },
    series: fillDailySeries(range, {
      saves: savesSeries,
      viewed: viewedSeries,
      messages: messagesSeries,
    }),
    recentSaved: recentSaved.map((item) => ({
      savedAt: item.createdAt,
      ...toListingSummary(item.listing),
      isAvailable:
        item.listing.status === ListingStatus.APPROVED &&
        !item.listing.isDeleted,
    })),
    savedByBrand,
  };
};

// ============================================
// Sidebar badges
// ============================================

const getQueueCounts = (viewer: RequestUser) => getQueueCountsFor(viewer.role);

export const DashboardService = {
  getAdminOverview,
  getModeratorOverview,
  getSellerOverview,
  getBuyerOverview,
  getQueueCounts,
};
