import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { TestRideController } from "./testRide.controller";
import { AVAILABILITY_ROLES, TEST_RIDE_ROLES } from "./testRide.utils";
import {
  CancelTestRideZodSchema,
  ConfirmTestRideZodSchema,
  CreateBlockedDateZodSchema,
  CreateTestRideZodSchema,
  DeclineTestRideZodSchema,
  ReplaceAvailabilityZodSchema,
} from "./testRide.validation";

const router = Router();

router.post(
  "/",
  auth(...TEST_RIDE_ROLES),
  validateRequest(CreateTestRideZodSchema),
  TestRideController.createTestRide,
);

router.get("/", auth(...TEST_RIDE_ROLES), TestRideController.getMyTestRides);

// ============================================
// Static paths (before /:id)
// ============================================

// public: free slots of a listing
router.get("/slots", TestRideController.getAvailableSlots);

router.get(
  "/availability/me",
  auth(...AVAILABILITY_ROLES),
  TestRideController.getMyAvailability,
);

router.put(
  "/availability/me",
  auth(...AVAILABILITY_ROLES),
  validateRequest(ReplaceAvailabilityZodSchema),
  TestRideController.replaceMyAvailability,
);

router.post(
  "/blocked-dates",
  auth(...AVAILABILITY_ROLES),
  validateRequest(CreateBlockedDateZodSchema),
  TestRideController.addBlockedDate,
);

router.delete(
  "/blocked-dates/:id",
  auth(...AVAILABILITY_ROLES),
  TestRideController.deleteBlockedDate,
);

// ============================================
// One booking
// ============================================

router.get(
  "/:id",
  auth(...TEST_RIDE_ROLES),
  TestRideController.getTestRideById,
);

router.patch(
  "/:id/confirm",
  auth(...TEST_RIDE_ROLES),
  validateRequest(ConfirmTestRideZodSchema),
  TestRideController.confirmTestRide,
);

router.patch(
  "/:id/decline",
  auth(...TEST_RIDE_ROLES),
  validateRequest(DeclineTestRideZodSchema),
  TestRideController.declineTestRide,
);

router.patch(
  "/:id/cancel",
  auth(...TEST_RIDE_ROLES),
  validateRequest(CancelTestRideZodSchema),
  TestRideController.cancelTestRide,
);

router.patch(
  "/:id/complete",
  auth(...TEST_RIDE_ROLES),
  TestRideController.completeTestRide,
);

router.patch(
  "/:id/no-show",
  auth(...TEST_RIDE_ROLES),
  TestRideController.markTestRideNoShow,
);

export const TestRideRoutes = router;
