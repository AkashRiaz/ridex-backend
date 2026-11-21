import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { authRateLimiter } from "../../middleware/rateLimiter";
import { validateRequest } from "../../middleware/validateRequest";
import { NotificationController } from "./notification.controller";
import {
  UnsubscribeZodSchema,
  UpdatePreferencesZodSchema,
} from "./notification.validation";

const router = Router();

// public: one-click link from email footers (POST, so mail scanners cannot trigger it)
router.post(
  "/unsubscribe",
  authRateLimiter,
  validateRequest(UnsubscribeZodSchema),
  NotificationController.unsubscribe,
);

router.get("/", auth(), NotificationController.getMyNotifications);

router.get("/unread-count", auth(), NotificationController.getUnreadCount);

router.get("/preferences", auth(), NotificationController.getMyPreferences);

router.put(
  "/preferences",
  auth(),
  validateRequest(UpdatePreferencesZodSchema),
  NotificationController.updateMyPreferences,
);

router.patch("/read-all", auth(), NotificationController.markAllAsRead);

router.patch("/:id/read", auth(), NotificationController.markAsRead);

router.delete("/:id", auth(), NotificationController.deleteNotification);

export const NotificationRoutes = router;
