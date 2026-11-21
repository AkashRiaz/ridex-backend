import httpStatus from "http-status";
import {
  ReportStatus,
  ReportTargetType,
  Role,
} from "../../../generated/prisma/enums";
import { AppError } from "../../utils/AppError";
import { TReportAction } from "./report.interface";

export const ACTIVE_REPORT_STATUSES: ReportStatus[] = [
  ReportStatus.OPEN,
  ReportStatus.IN_REVIEW,
];

export const REPORTS_PER_HOUR = 10;

type TReportTargetColumns = {
  listingId?: string | null;
  reportedUserId?: string | null;
  reviewId?: string | null;
  messageId?: string | null;
};

/*
 * targetType + targetId → the typed foreign-key column that stores it.
 */
export const targetColumns = (
  targetType: ReportTargetType,
  targetId: string,
): TReportTargetColumns => {
  switch (targetType) {
    case ReportTargetType.LISTING:
      return { listingId: targetId };
    case ReportTargetType.USER:
      return { reportedUserId: targetId };
    case ReportTargetType.REVIEW:
      return { reviewId: targetId };
    default:
      return { messageId: targetId };
  }
};

export const targetIdOf = (report: TReportTargetColumns) =>
  report.listingId ??
  report.reportedUserId ??
  report.reviewId ??
  report.messageId ??
  "";

export const targetKey = (
  report: TReportTargetColumns & { targetType: ReportTargetType },
) => `${report.targetType}:${targetIdOf(report)}`;

/*
 * Which resolve action fits which target, and who may take it.
 */
const ACTION_TARGETS: Record<
  Exclude<TReportAction, "NONE">,
  ReportTargetType[]
> = {
  TAKE_DOWN_LISTING: [ReportTargetType.LISTING],
  // blocks the reported user, the seller of the reported listing, or the sender of the message
  BLOCK_USER: [
    ReportTargetType.USER,
    ReportTargetType.LISTING,
    ReportTargetType.MESSAGE,
  ],
  HIDE_REVIEW: [ReportTargetType.REVIEW],
};

export const assertActionAllowed = (
  action: TReportAction,
  targetType: ReportTargetType,
  actorRole: Role,
) => {
  if (action === "NONE") return;

  if (!ACTION_TARGETS[action].includes(targetType)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${action.replaceAll("_", " ").toLowerCase()} does not apply to a ${targetType.toLowerCase()} report`,
    );
  }

  if (
    action === "BLOCK_USER" &&
    actorRole !== Role.ADMIN &&
    actorRole !== Role.SUPER_ADMIN
  ) {
    throw new AppError(httpStatus.FORBIDDEN, "Only admins can block users");
  }
};

/*
 * Queue order: most-reported targets first, then oldest first.
 */
export const sortByPriority = <T extends { key: string; createdAt: Date }>(
  reports: T[],
  openCountByKey: Map<string, number>,
) =>
  reports
    .slice()
    .sort(
      (first, second) =>
        (openCountByKey.get(second.key) ?? 0) -
          (openCountByKey.get(first.key) ?? 0) ||
        first.createdAt.getTime() - second.createdAt.getTime(),
    );

// messages shown before the reported one, so staff see the context
export const MESSAGE_CONTEXT_SIZE = 5;
