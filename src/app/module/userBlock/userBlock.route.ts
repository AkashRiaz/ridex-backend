import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { UserBlockController } from "./userBlock.controller";

const router = Router();

router.get("/", auth(), UserBlockController.getMyBlockedUsers);

router.post("/:userId", auth(), UserBlockController.blockUser);

router.delete("/:userId", auth(), UserBlockController.unblockUser);

export const UserBlockRoutes = router;
