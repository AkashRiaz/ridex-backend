import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { AuditLogWhereInput } from "../../../generated/prisma/models";
import { isUuid } from "../../helper/isUuid";
import { queryBuilder } from "../../helper/queryBuilder";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { IAuditLogQuery } from "./auditLog.interface";
import {
  canViewAuditLog,
  getAuditLogVisibilityFilter,
  isAuditAction,
  parseAuditDateRange,
  redactSensitiveData,
} from "./auditLog.utils";

const auditLogInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      imageUrl: true,
    },
  },
} satisfies Prisma.AuditLogInclude;

type TAuditLogWithUser = Prisma.AuditLogGetPayload<{
  include: typeof auditLogInclude;
}>;

const formatAuditLog = (log: TAuditLogWithUser) => ({
  ...log,
  oldData: redactSensitiveData(log.oldData),
  newData: redactSensitiveData(log.newData),
});

/*
 * Shared by the audit log page and the admin dashboard's recent activity.
 */
const getAllAuditLogs = async (query: IAuditLogQuery, viewer: RequestUser) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);
  const orderBy = queryBuilder.buildSort(query, ["createdAt"]);

  const andConditions: AuditLogWhereInput[] = [];

  const visibility = getAuditLogVisibilityFilter(viewer.role);
  if (visibility) andConditions.push(visibility);

  const search = queryBuilder.buildSearch(query.searchTerm, [
    "entity",
    "entityId",
    "user.name",
    "user.email",
    "ipAddress",
  ]);
  if (search) andConditions.push(search as AuditLogWhereInput);

  if (query.action) {
    if (!isAuditAction(query.action)) {
      throw new AppError(httpStatus.BAD_REQUEST, "Unknown audit action");
    }
    andConditions.push({ action: query.action });
  }

  if (query.entity) andConditions.push({ entity: query.entity });

  if (query.entityId) andConditions.push({ entityId: query.entityId });

  if (query.userId) {
    if (!isUuid(query.userId)) {
      throw new AppError(httpStatus.BAD_REQUEST, "userId must be a valid id");
    }
    andConditions.push({ userId: query.userId });
  }

  const createdAt = parseAuditDateRange(query.from, query.to);
  if (createdAt.gte || createdAt.lt) andConditions.push({ createdAt });

  const where: AuditLogWhereInput = { AND: andConditions };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      take: limit,
      skip,
      orderBy,
      include: auditLogInclude,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    data: logs.map(formatAuditLog),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getAuditLogById = async (id: string, viewer: RequestUser) => {
  if (!isUuid(id)) {
    throw new AppError(httpStatus.NOT_FOUND, "Audit log entry not found");
  }

  const log = await prisma.auditLog.findUnique({
    where: { id },
    include: auditLogInclude,
  });

  // hidden entries look exactly like missing ones
  if (!log || !canViewAuditLog(viewer.role, log.user?.role)) {
    throw new AppError(httpStatus.NOT_FOUND, "Audit log entry not found");
  }

  return formatAuditLog(log);
};

/*
 * Entity names present in the log, for the filter dropdown.
 */
const getAuditLogEntities = async (viewer: RequestUser) => {
  const visibility = getAuditLogVisibilityFilter(viewer.role);

  const groups = await prisma.auditLog.groupBy({
    by: ["entity"],
    where: visibility ?? {},
    _count: { _all: true },
    orderBy: { entity: "asc" },
  });

  return groups.map((group) => ({
    entity: group.entity,
    count: group._count._all,
  }));
};

export const AuditLogService = {
  getAllAuditLogs,
  getAuditLogById,
  getAuditLogEntities,
};
