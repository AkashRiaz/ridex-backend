import { Router } from "express";
import { optionalAuth } from "../../middleware/optionalAuth";
import { PriceInsightController } from "./priceInsight.controller";

const router = Router();

// public for live/sold listings; owners and staff also see their unpublished ones
router.get(
  "/listings/:idOrSlug",
  optionalAuth(),
  PriceInsightController.getListingPriceInsight,
);

export const PriceInsightRoutes = router;
