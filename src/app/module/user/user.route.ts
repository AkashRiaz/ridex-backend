import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { UserController } from "./user.controller";
import {
  CreateUserZodSchema,
  DeleteMyAccountZodSchema,
  UpdateMyProfileZodSchema,
  UpdateUserRoleZodSchema,
  UpdateUserStatusZodSchema,
} from "./user.validation";

const router = Router();

router.post(
  "/",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  validateRequest(CreateUserZodSchema),
  UserController.createUser,
);

router.get(
  "/",
  auth(Role.SUPER_ADMIN, Role.ADMIN, Role.MODERATOR),
  UserController.getAllUsers,
);

router.get("/me", auth(), UserController.getMyProfile);

router.patch(
  "/me",
  auth(),
  upload.fields([
    {
      name: "avatar",
      maxCount: 1,
    },
  ]),
  validateRequest(UpdateMyProfileZodSchema),
  UserController.updateMyProfile,
);

router.delete(
  "/me",
  auth(),
  validateRequest(DeleteMyAccountZodSchema),
  UserController.deleteMyAccount,
);

router.post("/me/become-seller", auth(Role.BUYER), UserController.becomeSeller);

router.get("/:id/public", UserController.getPublicProfile);

router.get(
  "/:id",
  auth(Role.SUPER_ADMIN, Role.ADMIN, Role.MODERATOR),
  UserController.getUserById,
);

router.patch(
  "/:id/status",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  validateRequest(UpdateUserStatusZodSchema),
  UserController.updateUserStatus,
);

router.patch(
  "/:id/role",
  auth(Role.SUPER_ADMIN),
  validateRequest(UpdateUserRoleZodSchema),
  UserController.updateUserRole,
);

router.patch(
  "/:id/restore",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  UserController.restoreUser,
);

router.delete(
  "/:id",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  UserController.deleteUser,
);

export const UserRoutes = router;
