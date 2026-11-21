import { Router } from "express";
import { SearchController } from "./search.controller";

const router = Router();

// query params are validated in the service (validateRequest only covers bodies)
router.get("/listings", SearchController.searchListings);

router.get("/filters", SearchController.getSearchFilters);

// featured listings, brands, categories and site numbers for the homepage
router.get("/home", SearchController.getHomeData);

export const SearchRoutes = router;
