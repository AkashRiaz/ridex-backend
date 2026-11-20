import { Router } from "express";
import { SearchController } from "./search.controller";

const router = Router();

// query params are validated in the service (validateRequest only covers bodies)
router.get("/listings", SearchController.searchListings);

router.get("/filters", SearchController.getSearchFilters);

export const SearchRoutes = router;
