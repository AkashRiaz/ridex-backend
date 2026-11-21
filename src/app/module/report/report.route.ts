import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ReportController } from "./report.controller";
import {
  CreateReportZodSchema,
  UpdateReportZodSchema,
} from "./report.validation";

const router = Router();

const STAFF_ROLES = [Role.MODERATOR, Role.ADMIN, Role.SUPER_ADMIN];

router.post(
  "/",
  auth(),
  validateRequest(CreateReportZodSchema),
  ReportController.createReport,
);

router.get("/my", auth(), ReportController.getMyReports);

router.get("/", auth(...STAFF_ROLES), ReportController.getReports);

router.get("/:id", auth(...STAFF_ROLES), ReportController.getReportById);

router.patch(
  "/:id",
  auth(...STAFF_ROLES),
  validateRequest(UpdateReportZodSchema),
  ReportController.updateReport,
);

export const ReportRoutes = router;
