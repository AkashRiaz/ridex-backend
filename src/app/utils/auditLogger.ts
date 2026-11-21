import { Request } from "express";
import { Prisma } from "../../generated/prisma/client";
import { AuditAction } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";

type TAuditLogPayload = {
  userId?: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  oldData?: Prisma.InputJsonValue;
  newData?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/*
 * Pass `tx` to write the log inside an existing transaction.
 * Audit logging must never break the main operation.
 */
export const createAuditLog = async (
  payload: TAuditLogPayload,
  tx?: Prisma.TransactionClient,
) => {
  try {
    await (tx ?? prisma).auditLog.create({
      data: {
        userId: payload.userId ?? null,
        action: payload.action,
        entity: payload.entity,
        entityId: payload.entityId ?? null,
        oldData: payload.oldData,
        newData: payload.newData,
        ipAddress: payload.ipAddress ?? null,
        userAgent: payload.userAgent ?? null,
      },
    });
  } catch (error) {
    if (tx) throw error;
    console.error("Failed to write audit log:", error);
  }
};

// ============================================
// Helpers for services that log their own changes
// ============================================

export type TAuditActor = {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/*
 * Who did it, from the request (controllers pass this to services).
 */
export const getAuditActor = (req: Request): TAuditActor => ({
  userId: req.user?.userId as string,
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

const toJsonValue = (value: unknown): Prisma.InputJsonValue | null =>
  value === undefined ? null : JSON.parse(JSON.stringify(value));

/*
 * Keeps only the keys whose value changed, so the log shows a small diff:
 * buildAuditDiff({ name: "A", isActive: true }, { name: "B", isActive: true })
 * → { oldData: { name: "A" }, newData: { name: "B" } }
 */
export const buildAuditDiff = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[] = Object.keys(after),
) => {
  const oldData: Record<string, Prisma.InputJsonValue | null> = {};
  const newData: Record<string, Prisma.InputJsonValue | null> = {};

  for (const key of keys) {
    if (after[key] === undefined) continue;

    const previous = toJsonValue(before[key]);
    const next = toJsonValue(after[key]);

    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      oldData[key] = previous;
      newData[key] = next;
    }
  }

  return { oldData, newData, changed: Object.keys(newData).length > 0 };
};
