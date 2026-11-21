import httpStatus from "http-status";
import { AuditAction, Role } from "../../../generated/prisma/enums";
import { AuditLogWhereInput } from "../../../generated/prisma/models";
import { AppError } from "../../utils/AppError";
import { localMidnightToUtc } from "../dashboard/dashboard.utils";

/*
 * Keys whose values never leave the server, at any depth.
 * Matches passwordHash, tokenHash, accessToken, otp, clientSecret, ...
 */
export const SENSITIVE_KEY_PATTERN = /(password|secret|token|otp)/i;

export const REDACTED_VALUE = "[redacted]";

export const redactSensitiveData = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitiveData);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? REDACTED_VALUE
          : redactSensitiveData(nested),
      ]),
    );
  }

  return value;
};

/*
 * Super admins see everything. Admins don't see what super admins did
 * (same rule as user management: only a SUPER_ADMIN manages ADMINs).
 * Entries without a user (system jobs, deleted accounts) stay visible.
 */
export const getAuditLogVisibilityFilter = (
  viewerRole: Role,
): AuditLogWhereInput | null =>
  viewerRole === Role.SUPER_ADMIN
    ? null
    : {
        OR: [
          { userId: null },
          { user: { is: { role: { not: Role.SUPER_ADMIN } } } },
        ],
      };

export const canViewAuditLog = (
  viewerRole: Role,
  actorRole: Role | null | undefined,
) => viewerRole === Role.SUPER_ADMIN || actorRole !== Role.SUPER_ADMIN;

export const isAuditAction = (value: unknown): value is AuditAction =>
  typeof value === "string" &&
  Object.values(AuditAction).includes(value as AuditAction);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/*
 * ?from=2026-11-01&to=2026-11-21 → local-day bounds in UTC.
 * `to` is inclusive, so it becomes midnight of the next day (exclusive).
 */
export const parseAuditDateRange = (from?: unknown, to?: unknown) => {
  const parse = (value: unknown, label: string) => {
    if (value === undefined || value === "") return undefined;

    if (
      typeof value !== "string" ||
      !DATE_KEY_PATTERN.test(value) ||
      Number.isNaN(Date.parse(value))
    ) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `${label} must be a date like 2026-11-21`,
      );
    }

    return value;
  };

  const fromKey = parse(from, "from");
  const toKey = parse(to, "to");

  if (fromKey && toKey && fromKey > toKey) {
    throw new AppError(httpStatus.BAD_REQUEST, "from must be on or before to");
  }

  const nextDay = (dateKey: string) => {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  };

  return {
    gte: fromKey ? localMidnightToUtc(fromKey) : undefined,
    lt: toKey ? localMidnightToUtc(nextDay(toKey)) : undefined,
  };
};
