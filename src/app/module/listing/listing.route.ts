import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { config } from "../../config";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { optionalAuth } from "../../middleware/optionalAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ListingController } from "./listing.controller";
import {
  CreateListingDraftZodSchema,
  ReorderListingImagesZodSchema,
  UpdateListingStatusZodSchema,
  UpdateListingZodSchema,
} from "./listing.validation";

const router = Router();

const SELLER_ROLES = [Role.SELLER, Role.DEALER];
const STAFF_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.MODERATOR];

router.post(
  "/",
  auth(...SELLER_ROLES),
  validateRequest(CreateListingDraftZodSchema),
  ListingController.createListingDraft,
);

router.get(
  "/my-listings",
  auth(...SELLER_ROLES),
  ListingController.getMyListings,
);

router.get(
  "/manage",
  auth(...STAFF_ROLES),
  ListingController.getManagedListings,
);

router.get(
  "/:idOrSlug",
  optionalAuth(),
  ListingController.getListingByIdOrSlug,
);

router.get("/:idOrSlug/similar", ListingController.getSimilarListings);

router.patch(
  "/:id",
  auth(...SELLER_ROLES),
  validateRequest(UpdateListingZodSchema),
  ListingController.updateListing,
);

router.post(
  "/:id/images",
  auth(...SELLER_ROLES),
  upload.fields([{ name: "images", maxCount: config.max_listing_images }]),
  ListingController.addListingImages,
);

router.patch(
  "/:id/images",
  auth(...SELLER_ROLES),
  validateRequest(ReorderListingImagesZodSchema),
  ListingController.reorderListingImages,
);

router.delete(
  "/:id/images/:imageId",
  auth(...SELLER_ROLES),
  ListingController.deleteListingImage,
);

router.post(
  "/:id/submit",
  auth(...SELLER_ROLES),
  ListingController.submitListing,
);

router.patch(
  "/:id/status",
  auth(...STAFF_ROLES),
  validateRequest(UpdateListingStatusZodSchema),
  ListingController.updateListingStatus,
);

router.post(
  "/:id/mark-sold",
  auth(...SELLER_ROLES),
  ListingController.markListingSold,
);

router.post(
  "/:id/renew",
  auth(...SELLER_ROLES),
  ListingController.renewListing,
);

router.delete(
  "/:id",
  auth(...SELLER_ROLES, Role.ADMIN, Role.SUPER_ADMIN),
  ListingController.deleteListing,
);

export const ListingRoutes = router;
