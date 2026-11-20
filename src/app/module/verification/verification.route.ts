import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { VerificationController } from "./verification.controller";
import {
  ReviewVerificationZodSchema,
  SubmitVerificationZodSchema,
} from "./verification.validation";

const router = Router();

// ID documents are visible to admins only (not moderators)
const REVIEWER_ROLES = [Role.ADMIN, Role.SUPER_ADMIN];

router.get("/me", auth(), VerificationController.getMyVerification);

router.post(
  "/",
  auth(),
  upload.fields([{ name: "documents", maxCount: 8 }]),
  validateRequest(SubmitVerificationZodSchema),
  VerificationController.submitVerification,
);

router.get("/", auth(...REVIEWER_ROLES), VerificationController.getVerificationRequests);

router.get("/:id", auth(...REVIEWER_ROLES), VerificationController.getVerificationRequestById);

router.patch(
  "/:id",
  auth(...REVIEWER_ROLES),
  validateRequest(ReviewVerificationZodSchema),
  VerificationController.reviewVerificationRequest,
);

export const VerificationRoutes = router;
