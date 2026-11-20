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
