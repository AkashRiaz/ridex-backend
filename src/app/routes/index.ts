import { Router } from "express";

const router = Router();

type TModuleRoute = {
  path: string;
  route: Router;
};

/*
 * Register every module router here:
 * { path: "/listings", route: ListingRoutes },
 * Mounted under /api/v1 in app.ts.
 */
const moduleRoutes: TModuleRoute[] = [];

moduleRoutes.forEach((moduleRoute) => {
  router.use(moduleRoute.path, moduleRoute.route);
});

export const AppRoutes = router;
