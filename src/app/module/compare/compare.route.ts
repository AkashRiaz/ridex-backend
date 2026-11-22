import { Router } from "express";
import { CompareController } from "./compare.controller";

const router = Router();

// query params are validated in the service (validateRequest only covers bodies)
router.get("/", CompareController.compareListings);

export const CompareRoutes = router;
