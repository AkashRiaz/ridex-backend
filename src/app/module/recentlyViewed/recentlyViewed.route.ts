import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { RecentlyViewedController } from "./recentlyViewed.controller";

const router = Router();

router.get("/", auth(), RecentlyViewedController.getMyRecentlyViewed);

router.delete("/", auth(), RecentlyViewedController.clearRecentlyViewed);

router.delete("/:listingId", auth(), RecentlyViewedController.removeRecentlyViewed);

export const RecentlyViewedRoutes = router;
