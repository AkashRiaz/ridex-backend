import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
  AuditAction,
  ListingStatus,
  ReportStatus,
  ReportTargetType,
  UserStatus,
} from "../../../generated/prisma/enums";
import { ReportWhereInput } from "../../../generated/prisma/models";
import { appEvents } from "../../events/appEvents";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createAuditLog } from "../../utils/auditLogger";
import { IRequestMeta } from "../auth/auth.interface";
import { ListingService } from "../listing/listing.service";
import { ReviewService } from "../review/review.service";
import { UserService } from "../user/user.service";
import { ICreateReportPayload, IUpdateReportPayload } from "./report.interface";
import {
  ACTIVE_REPORT_STATUSES,
  MESSAGE_CONTEXT_SIZE,
  REPORTS_PER_HOUR,
  assertActionAllowed,
  sortByPriority,
  targetColumns,
  targetIdOf,
  targetKey,
} from "./report.utils";

const reportInclude = {
  reporter: { select: { id: true, name: true, email: true } },
  listing: {
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      isDeleted: true,
      sellerId: true,
      seller: { select: { id: true, name: true, status: true } },
      images: { where: { isCover: true }, take: 1, select: { url: true } },
    },
  },
  reportedUser: {
    select: { id: true, name: true, email: true, role: true, status: true, isDeleted: true, createdAt: true },
  },
  review: {
    select: {
      id: true,
      rating: true,
      comment: true,
      isHidden: true,
      reviewer: { select: { id: true, name: true } },
      seller: { select: { id: true, name: true } },
    },
  },
  message: {
    select: {
      id: true,
      type: true,
      body: true,
      imageUrl: true,
      createdAt: true,
      conversationId: true,
      sender: { select: { id: true, name: true, email: true, role: true, status: true, isDeleted: true } },
    },
  },
} satisfies Prisma.ReportInclude;

const PRIORITY_SCAN_LIMIT = 1000;

// ============================================
// Create
// ============================================

/*
 * Confirms the target exists and the reporter is not reporting themselves.
 */
const assertReportableTarget = async (reporterId: string, payload: ICreateReportPayload) => {
  switch (payload.targetType) {
    case ReportTargetType.LISTING: {
      const listing = await prisma.listing.findFirst({
        where: { id: payload.targetId, isDeleted: false },
        select: { sellerId: true },
      });

      if (!listing) throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
      if (listing.sellerId === reporterId) {
        throw new AppError(httpStatus.BAD_REQUEST, "You cannot report your own listing");
      }
      return;
    }

    case ReportTargetType.USER: {
      if (payload.targetId === reporterId) {
        throw new AppError(httpStatus.BAD_REQUEST, "You cannot report yourself");
      }

      const user = await prisma.user.findFirst({
        where: { id: payload.targetId, isDeleted: false },
        select: { id: true },
      });

      if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
      return;
    }

    case ReportTargetType.REVIEW: {
      const review = await prisma.review.findUnique({
        where: { id: payload.targetId },
        select: { reviewerId: true },
      });

      if (!review) throw new AppError(httpStatus.NOT_FOUND, "Review not found");
      if (review.reviewerId === reporterId) {
        throw new AppError(httpStatus.BAD_REQUEST, "You cannot report your own review");
      }
      return;
    }

    default: {
      // only a participant can report a message, and never their own
      const message = await prisma.message.findUnique({
        where: { id: payload.targetId },
        select: {
          senderId: true,
          conversation: { select: { buyerId: true, sellerId: true } },
        },
      });

      const isParticipant =
        message?.conversation.buyerId === reporterId || message?.conversation.sellerId === reporterId;

      if (!message || !isParticipant) throw new AppError(httpStatus.NOT_FOUND, "Message not found");
      if (!message.senderId) {
        throw new AppError(httpStatus.BAD_REQUEST, "System messages cannot be reported");
      }
      if (message.senderId === reporterId) {
        throw new AppError(httpStatus.BAD_REQUEST, "You cannot report your own message");
      }
      return;
    }
  }
};

const enforceRateLimit = async (userId: string) => {
  const key = `report-rate:${userId}`;

  try {
    const count = await redisClient.incr(key);

    if (count === 1) await redisClient.expire(key, 60 * 60);

    if (count > REPORTS_PER_HOUR) {
      throw new AppError(
        httpStatus.TOO_MANY_REQUESTS,
        "You have sent too many reports. Please try again in an hour.",
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Redis trouble must not block safety reports
    console.error("Report rate limit check failed:", error);
  }
};

const createReport = async (requestUser: RequestUser, payload: ICreateReportPayload) => {
  await assertReportableTarget(requestUser.userId, payload);

  const columns = targetColumns(payload.targetType, payload.targetId);

  const duplicate = await prisma.report.findFirst({
    where: {
      reporterId: requestUser.userId,
      targetType: payload.targetType,
      status: { in: ACTIVE_REPORT_STATUSES },
      ...columns,
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new AppError(httpStatus.CONFLICT, "You have already reported this. Our team is reviewing it.");
  }

  await enforceRateLimit(requestUser.userId);

  const report = await prisma.report.create({
    data: {
      reporterId: requestUser.userId,
      targetType: payload.targetType,
      reason: payload.reason,
      details: payload.details || null,
      ...columns,
    },
  });

  appEvents.emit("report.created", {
    reportId: report.id,
    targetType: report.targetType,
    targetId: payload.targetId,
    reporterId: report.reporterId,
  });

  return report;
};

// ============================================
// Reads
// ============================================

const getMyReports = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 10);

  const where = { reporterId: userId };

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: {
        id: true,
        targetType: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        listing: { select: { id: true, title: true, slug: true } },
        reportedUser: { select: { id: true, name: true } },
        review: { select: { id: true, rating: true } },
        message: { select: { id: true, body: true, type: true } },
      },
    }),
    prisma.report.count({ where }),
  ]);

  return { data: reports, meta: queryBuilder.buildMeta(page, limit, total) };
};

/*
 * Open-report count per target (for priority and "N reports" badges).
 */
const countOpenReportsByTarget = async () => {
  const groups = await prisma.report.groupBy({
    by: ["targetType", "listingId", "reportedUserId", "reviewId", "messageId"],
    where: { status: { in: ACTIVE_REPORT_STATUSES } },
    _count: { _all: true },
  });

  return new Map(groups.map((group) => [targetKey(group), group._count._all]));
};

const getReports = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const andConditions: ReportWhereInput[] = [];

  // default queue = open + in review
  if (query.status && Object.values(ReportStatus).includes(query.status)) {
    andConditions.push({ status: query.status });
  } else if (query.status !== "ALL") {
    andConditions.push({ status: { in: ACTIVE_REPORT_STATUSES } });
  }

  if (query.targetType && Object.values(ReportTargetType).includes(query.targetType)) {
    andConditions.push({ targetType: query.targetType });
  }

  if (query.reason) andConditions.push({ reason: query.reason });

  const where = { AND: andConditions };
  const openCountByKey = await countOpenReportsByTarget();

  let pageIds: string[];
  let total: number;

  if (query.sortBy === "newest") {
    const [rows, count] = await Promise.all([
      prisma.report.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip, select: { id: true } }),
      prisma.report.count({ where }),
    ]);
    pageIds = rows.map((row) => row.id);
    total = count;
  } else {
    // priority: most-reported targets first (sorted in memory, bounded scan)
    const rows = await prisma.report.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: PRIORITY_SCAN_LIMIT,
      select: {
        id: true,
        createdAt: true,
        targetType: true,
        listingId: true,
        reportedUserId: true,
        reviewId: true,
        messageId: true,
      },
    });

    const sorted = sortByPriority(
      rows.map((row) => ({ ...row, key: targetKey(row) })),
      openCountByKey,
    );

    pageIds = sorted.slice(skip, skip + limit).map((row) => row.id);
    total = rows.length;
  }

  const reports = await prisma.report.findMany({
    where: { id: { in: pageIds } },
    include: reportInclude,
  });

  const byId = new Map(reports.map((report) => [report.id, report]));

  return {
    data: pageIds
      .map((id) => byId.get(id))
      .filter((report) => report !== undefined)
      .map((report) => ({
        ...report,
        targetId: targetIdOf(report),
        openReportsOnTarget: openCountByKey.get(targetKey(report)) ?? 0,
      })),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getReportById = async (id: string) => {
  const report = await prisma.report.findUnique({ where: { id }, include: reportInclude });

  if (!report) {
    throw new AppError(httpStatus.NOT_FOUND, "Report not found");
  }

  const otherReports = await prisma.report.findMany({
    where: {
      id: { not: id },
      targetType: report.targetType,
      ...targetColumns(report.targetType, targetIdOf(report)),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      reason: true,
      details: true,
      status: true,
      createdAt: true,
      reporter: { select: { id: true, name: true } },
    },
  });

  /*
   * Message reports: the reported message plus the few before it.
   * This is the only way staff can read a conversation.
   */
  const messageContext = report.message
    ? (
        await prisma.message.findMany({
          where: {
            conversationId: report.message.conversationId,
            createdAt: { lte: report.message.createdAt },
          },
          orderBy: { createdAt: "desc" },
          take: MESSAGE_CONTEXT_SIZE + 1,
          select: {
            id: true,
            type: true,
            body: true,
            imageUrl: true,
            createdAt: true,
            sender: { select: { id: true, name: true } },
          },
        })
      ).reverse()
    : [];

  return { ...report, targetId: targetIdOf(report), otherReports, messageContext };
};

// ============================================
// Resolve
// ============================================

/*
 * Applies the chosen action through the owning module, then closes this
 * report (and, when resolved, every other open report on the same target).
 */
const updateReport = async (
  staff: RequestUser,
  id: string,
  payload: IUpdateReportPayload,
  meta: IRequestMeta,
) => {
  const report = await prisma.report.findUnique({ where: { id }, include: reportInclude });

  if (!report) {
    throw new AppError(httpStatus.NOT_FOUND, "Report not found");
  }

  if (!ACTIVE_REPORT_STATUSES.includes(report.status)) {
    throw new AppError(httpStatus.CONFLICT, "This report has already been closed");
  }

  const action = payload.action ?? "NONE";
  const note = payload.resolutionNote ?? "";

  assertActionAllowed(action, report.targetType, staff.role);

  if (payload.status === ReportStatus.RESOLVED && action !== "NONE") {
    if (action === "TAKE_DOWN_LISTING" && report.listing) {
      const isLive =
        report.listing.status === ListingStatus.APPROVED || report.listing.status === ListingStatus.PENDING;

      if (isLive) {
        await ListingService.updateListingStatus(
          staff,
          report.listing.id,
          { status: "REJECTED", reason: note },
          meta,
        );
      }
    }

    if (action === "BLOCK_USER") {
      const userId = report.reportedUser?.id ?? report.listing?.sellerId ?? report.message?.sender?.id;
      const status =
        report.reportedUser?.status ?? report.listing?.seller.status ?? report.message?.sender?.status;

      if (userId && status !== UserStatus.BLOCKED) {
        await UserService.updateUserStatus(staff, userId, { status: "BLOCKED", reason: note }, meta);
      }
    }

    if (action === "HIDE_REVIEW" && report.review && !report.review.isHidden) {
      await ReviewService.setReviewVisibility(staff, report.review.id, { isHidden: true, reason: note }, meta);
    }
  }

  const resolution = {
    status: payload.status,
    resolutionNote: note || null,
    ...(payload.status !== ReportStatus.IN_REVIEW && {
      actionTaken: action === "NONE" ? null : action,
      resolvedById: staff.userId,
      resolvedAt: new Date(),
    }),
  };

  // every reporter whose report this decision closes hears back
  const closedReports =
    payload.status === ReportStatus.RESOLVED
      ? await prisma.report.findMany({
          where: {
            targetType: report.targetType,
            status: { in: ACTIVE_REPORT_STATUSES },
            ...targetColumns(report.targetType, targetIdOf(report)),
          },
          select: { id: true, reporterId: true },
        })
      : payload.status === ReportStatus.DISMISSED
        ? [{ id: report.id, reporterId: report.reporterId }]
        : [];

  await prisma.$transaction(async (tx) => {
    await tx.report.update({ where: { id }, data: resolution });

    await createAuditLog(
      {
        userId: staff.userId,
        action: AuditAction.UPDATE,
        entity: "Report",
        entityId: id,
        oldData: { status: report.status },
        newData: {
          status: payload.status,
          targetType: report.targetType,
          actionTaken: action === "NONE" ? null : action,
          resolutionNote: note || null,
          closedReports: closedReports.length,
        },
        ...meta,
      },
      tx,
    );

    // one decision closes every open report about the same target
    if (payload.status === ReportStatus.RESOLVED) {
      await tx.report.updateMany({
        where: {
          id: { not: id },
          targetType: report.targetType,
          status: { in: ACTIVE_REPORT_STATUSES },
          ...targetColumns(report.targetType, targetIdOf(report)),
        },
        data: resolution,
      });
    }
  });

  // Side effects AFTER commit
  if (payload.status === ReportStatus.RESOLVED || payload.status === ReportStatus.DISMISSED) {
    const closedStatus = payload.status;

    for (const closed of closedReports) {
      appEvents.emit("report.resolved", {
        reportId: closed.id,
        reporterId: closed.reporterId,
        targetType: report.targetType,
        status: closedStatus,
        actionTaken: action === "NONE" ? null : action,
      });
    }
  }

  return getReportById(id);
};

export const ReportService = {
  createReport,
  getMyReports,
  getReports,
  getReportById,
  updateReport,
};
