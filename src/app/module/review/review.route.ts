import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ReviewController } from "./review.controller";
import {
  CreateReviewZodSchema,
  ReplyToReviewZodSchema,
  ReviewVisibilityZodSchema,
  UpdateReviewZodSchema,
} from "./review.validation";

const router = Router();

router.post("/", auth(), validateRequest(CreateReviewZodSchema), ReviewController.createReview);

router.get("/", ReviewController.getReviews);

router.get("/given", auth(), ReviewController.getGivenReviews);

router.get("/received", auth(), ReviewController.getReceivedReviews);

router.get("/eligibility/:listingId", auth(), ReviewController.getReviewEligibility);

router.patch("/:id", auth(), validateRequest(UpdateReviewZodSchema), ReviewController.updateReview);

router.delete("/:id", auth(), ReviewController.deleteReview);

router.post("/:id/reply", auth(), validateRequest(ReplyToReviewZodSchema), ReviewController.replyToReview);

router.patch(
  "/:id/visibility",
  auth(Role.MODERATOR, Role.ADMIN, Role.SUPER_ADMIN),
  validateRequest(ReviewVisibilityZodSchema),
  ReviewController.setReviewVisibility,
);

export const ReviewRoutes = router;
