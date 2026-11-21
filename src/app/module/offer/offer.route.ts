import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OfferController } from "./offer.controller";
import { OFFER_ROLES } from "./offer.utils";
import {
  CounterOfferZodSchema,
  CreateOfferZodSchema,
  DeclineOfferZodSchema,
} from "./offer.validation";

const router = Router();

router.post(
  "/",
  auth(...OFFER_ROLES),
  validateRequest(CreateOfferZodSchema),
  OfferController.makeOffer,
);

router.get("/", auth(...OFFER_ROLES), OfferController.getMyOffers);

router.get("/:id", auth(...OFFER_ROLES), OfferController.getOfferById);

router.post(
  "/:id/counter",
  auth(...OFFER_ROLES),
  validateRequest(CounterOfferZodSchema),
  OfferController.counterOffer,
);

router.patch("/:id/accept", auth(...OFFER_ROLES), OfferController.acceptOffer);

router.patch(
  "/:id/decline",
  auth(...OFFER_ROLES),
  validateRequest(DeclineOfferZodSchema),
  OfferController.declineOffer,
);

router.patch(
  "/:id/withdraw",
  auth(...OFFER_ROLES),
  OfferController.withdrawOffer,
);

export const OfferRoutes = router;
