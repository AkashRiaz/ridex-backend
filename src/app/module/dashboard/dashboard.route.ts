import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { DashboardController } from "./dashboard.controller";

const router = Router();

const STAFF_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.MODERATOR];

/*
 * Every overview accepts ?range=7d|30d|90d (default 30d).
 */

router.get(
  "/admin/overview",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  DashboardController.getAdminOverview,
);

router.get(
  "/moderator/overview",
  auth(...STAFF_ROLES),
  DashboardController.getModeratorOverview,
);

router.get(
  "/seller/overview",
  auth(Role.SELLER, Role.DEALER),
  DashboardController.getSellerOverview,
);

router.get(
  "/buyer/overview",
  auth(Role.BUYER, Role.DEALER_STAFF, Role.INSPECTOR),
  DashboardController.getBuyerOverview,
);

router.get(
  "/staff/queue-counts",
  auth(...STAFF_ROLES),
  DashboardController.getQueueCounts,
);

export const DashboardRoutes = router;
