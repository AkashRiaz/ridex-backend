import { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route";
import { BrandRoutes } from "../module/brand/brand.route";
import { UserRoutes } from "../module/user/user.route";
import { VehicleModelRoutes } from "../module/vehicleModel/vehicleModel.route";
import { VehicleTypeRoutes } from "../module/vehicleType/vehicleType.route";

const router = Router();

type TModuleRoute = {
  path: string;
  route: Router;
};

/*
 * Register every module router here.
 * Mounted under /api/v1 in app.ts.
 */
const moduleRoutes: TModuleRoute[] = [
  { path: "/auth", route: AuthRoutes },
  { path: "/users", route: UserRoutes },
  { path: "/vehicle-types", route: VehicleTypeRoutes },
  { path: "/brands", route: BrandRoutes },
  { path: "/vehicle-models", route: VehicleModelRoutes },
];

moduleRoutes.forEach((moduleRoute) => {
  router.use(moduleRoute.path, moduleRoute.route);
});

export const AppRoutes = router;
