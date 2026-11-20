import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { VehicleTypeController } from "./vehicleType.controller";
import {
  CreateVehicleTypeZodSchema,
  UpdateVehicleTypeAttributesZodSchema,
  UpdateVehicleTypeZodSchema,
} from "./vehicleType.validation";

const router = Router();

router.post(
  "/",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  upload.fields([{ name: "image", maxCount: 1 }]),
  validateRequest(CreateVehicleTypeZodSchema),
  VehicleTypeController.createVehicleType,
);

router.get("/", VehicleTypeController.getAllVehicleTypes);

router.get("/:idOrSlug", VehicleTypeController.getVehicleTypeByIdOrSlug);

router.patch(
  "/:id",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  upload.fields([{ name: "image", maxCount: 1 }]),
  validateRequest(UpdateVehicleTypeZodSchema),
  VehicleTypeController.updateVehicleType,
);

router.put(
  "/:id/attributes",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  validateRequest(UpdateVehicleTypeAttributesZodSchema),
  VehicleTypeController.updateVehicleTypeAttributes,
);

router.delete(
  "/:id",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  VehicleTypeController.deleteVehicleType,
);

export const VehicleTypeRoutes = router;
