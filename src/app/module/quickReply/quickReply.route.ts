import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { QuickReplyController } from "./quickReply.controller";
import {
  CreateQuickReplyZodSchema,
  UpdateQuickReplyZodSchema,
} from "./quickReply.validation";

const router = Router();

router.post(
  "/",
  auth(),
  validateRequest(CreateQuickReplyZodSchema),
  QuickReplyController.createQuickReply,
);

router.get("/", auth(), QuickReplyController.getQuickReplies);

router.patch(
  "/:id",
  auth(),
  validateRequest(UpdateQuickReplyZodSchema),
  QuickReplyController.updateQuickReply,
);

router.delete("/:id", auth(), QuickReplyController.deleteQuickReply);

export const QuickReplyRoutes = router;
