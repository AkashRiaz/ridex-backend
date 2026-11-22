import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { SavedSearchController } from "./savedSearch.controller";
import { SAVED_SEARCH_ROLES } from "./savedSearch.utils";
import {
  CreateSavedSearchZodSchema,
  UpdateSavedSearchZodSchema,
} from "./savedSearch.validation";

const router = Router();

router.post(
  "/",
  auth(...SAVED_SEARCH_ROLES),
  validateRequest(CreateSavedSearchZodSchema),
  SavedSearchController.createSavedSearch,
);

router.get(
  "/",
  auth(...SAVED_SEARCH_ROLES),
  SavedSearchController.getMySavedSearches,
);

// query = the search page's params (validated in the service)
router.get(
  "/lookup",
  auth(...SAVED_SEARCH_ROLES),
  SavedSearchController.lookupSavedSearch,
);

router.get(
  "/:id",
  auth(...SAVED_SEARCH_ROLES),
  SavedSearchController.getSavedSearchById,
);

router.patch(
  "/:id",
  auth(...SAVED_SEARCH_ROLES),
  validateRequest(UpdateSavedSearchZodSchema),
  SavedSearchController.updateSavedSearch,
);

router.patch(
  "/:id/seen",
  auth(...SAVED_SEARCH_ROLES),
  SavedSearchController.markSavedSearchSeen,
);

router.delete(
  "/:id",
  auth(...SAVED_SEARCH_ROLES),
  SavedSearchController.deleteSavedSearch,
);

export const SavedSearchRoutes = router;
