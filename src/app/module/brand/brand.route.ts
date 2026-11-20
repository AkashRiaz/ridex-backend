import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { BrandController } from "./brand.controller";
import { CreateBrandZodSchema, UpdateBrandZodSchema } from "./brand.validation";

const router = Router();

router.post(
  "/",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  upload.fields([{ name: "logo", maxCount: 1 }]),
  validateRequest(CreateBrandZodSchema),
  BrandController.createBrand,
);

router.get("/", BrandController.getAllBrands);

router.get("/:idOrSlug", BrandController.getBrandByIdOrSlug);

router.patch(
  "/:id",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  upload.fields([{ name: "logo", maxCount: 1 }]),
  validateRequest(UpdateBrandZodSchema),
  BrandController.updateBrand,
);

router.delete(
  "/:id",
  auth(Role.SUPER_ADMIN, Role.ADMIN),
  BrandController.deleteBrand,
);

export const BrandRoutes = router;
