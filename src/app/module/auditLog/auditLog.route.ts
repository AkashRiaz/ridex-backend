import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AuditLogController } from "./auditLog.controller";

const router = Router();

const AUDIT_ROLES = [Role.SUPER_ADMIN, Role.ADMIN];

router.get("/", auth(...AUDIT_ROLES), AuditLogController.getAllAuditLogs);

router.get(
  "/entities",
  auth(...AUDIT_ROLES),
  AuditLogController.getAuditLogEntities,
);

router.get("/:id", auth(...AUDIT_ROLES), AuditLogController.getAuditLogById);

export const AuditLogRoutes = router;
