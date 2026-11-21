import { Router } from "express";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ChatController } from "./chat.controller";
import { CHAT_ROLES, MAX_CHAT_IMAGES } from "./chat.utils";
import {
  ArchiveConversationZodSchema,
  SendImagesZodSchema,
  SendMessageZodSchema,
  StartConversationZodSchema,
} from "./chat.validation";

const router = Router();

router.post(
  "/",
  auth(...CHAT_ROLES),
  validateRequest(StartConversationZodSchema),
  ChatController.startConversation,
);

router.get("/", auth(...CHAT_ROLES), ChatController.getMyConversations);

router.get("/unread-count", auth(...CHAT_ROLES), ChatController.getUnreadCount);

router.get("/:id", auth(...CHAT_ROLES), ChatController.getConversationById);

router.get("/:id/messages", auth(...CHAT_ROLES), ChatController.getMessages);

router.post(
  "/:id/messages",
  auth(...CHAT_ROLES),
  validateRequest(SendMessageZodSchema),
  ChatController.sendMessage,
);

router.post(
  "/:id/images",
  auth(...CHAT_ROLES),
  upload.fields([{ name: "images", maxCount: MAX_CHAT_IMAGES }]),
  validateRequest(SendImagesZodSchema),
  ChatController.sendImages,
);

router.patch("/:id/read", auth(...CHAT_ROLES), ChatController.markAsRead);

router.patch(
  "/:id/archive",
  auth(...CHAT_ROLES),
  validateRequest(ArchiveConversationZodSchema),
  ChatController.setArchived,
);

export const ChatRoutes = router;
