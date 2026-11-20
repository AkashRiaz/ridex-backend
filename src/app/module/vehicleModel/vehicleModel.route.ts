import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { VehicleModelController } from "./vehicleModel.controller";
import {
  CreateVehicleModelZodSchema,
  UpdateVehicleModelZodSchema,
} from "./vehicleModel.validation";

const router = Router();

router.post(
  "/",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  upload.fields([{ name: "image", maxCount: 1 }]),
  validateRequest(CreateVehicleModelZodSchema),
  VehicleModelController.createVehicleModel,
);

router.get("/", VehicleModelController.getAllVehicleModels);

router.get("/:idOrSlug", VehicleModelController.getVehicleModelByIdOrSlug);

router.patch(
  "/:id",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  upload.fields([{ name: "image", maxCount: 1 }]),
  validateRequest(UpdateVehicleModelZodSchema),
  VehicleModelController.updateVehicleModel,
);

router.delete(
  "/:id",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  VehicleModelController.deleteVehicleModel,
);

export const VehicleModelRoutes = router;
