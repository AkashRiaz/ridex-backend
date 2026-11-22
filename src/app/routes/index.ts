import { Router } from "express";
import { AuditLogRoutes } from "../module/auditLog/auditLog.route";
import { AuthRoutes } from "../module/auth/auth.route";
import { BrandRoutes } from "../module/brand/brand.route";
import { ChatRoutes } from "../module/chat/chat.route";
import { CompareRoutes } from "../module/compare/compare.route";
import { DashboardRoutes } from "../module/dashboard/dashboard.route";
import { ListingRoutes } from "../module/listing/listing.route";
import { NotificationRoutes } from "../module/notification/notification.route";
import { OfferRoutes } from "../module/offer/offer.route";
import { PriceInsightRoutes } from "../module/priceInsight/priceInsight.route";
import { QuickReplyRoutes } from "../module/quickReply/quickReply.route";
import { RecentlyViewedRoutes } from "../module/recentlyViewed/recentlyViewed.route";
import { ReportRoutes } from "../module/report/report.route";
import { ReviewRoutes } from "../module/review/review.route";
import { SavedSearchRoutes } from "../module/savedSearch/savedSearch.route";
import { TestRideRoutes } from "../module/testRide/testRide.route";
import { SearchRoutes } from "../module/search/search.route";
import { UserRoutes } from "../module/user/user.route";
import { UserBlockRoutes } from "../module/userBlock/userBlock.route";
import { VehicleModelRoutes } from "../module/vehicleModel/vehicleModel.route";
import { VehicleTypeRoutes } from "../module/vehicleType/vehicleType.route";
import { VerificationRoutes } from "../module/verification/verification.route";
import { WishlistRoutes } from "../module/wishlist/wishlist.route";

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
  { path: "/listings", route: ListingRoutes },
  { path: "/search", route: SearchRoutes },
  { path: "/wishlist", route: WishlistRoutes },
  { path: "/recently-viewed", route: RecentlyViewedRoutes },
  { path: "/reviews", route: ReviewRoutes },
  { path: "/reports", route: ReportRoutes },
  { path: "/verifications", route: VerificationRoutes },
  { path: "/conversations", route: ChatRoutes },
  { path: "/quick-replies", route: QuickReplyRoutes },
  { path: "/blocks", route: UserBlockRoutes },
  { path: "/notifications", route: NotificationRoutes },
  { path: "/dashboard", route: DashboardRoutes },
  { path: "/audit-logs", route: AuditLogRoutes },
  { path: "/offers", route: OfferRoutes },
  { path: "/test-rides", route: TestRideRoutes },
  { path: "/price-insights", route: PriceInsightRoutes },
  { path: "/compare", route: CompareRoutes },
  { path: "/saved-searches", route: SavedSearchRoutes },
];

moduleRoutes.forEach((moduleRoute) => {
  router.use(moduleRoute.path, moduleRoute.route);
});

export const AppRoutes = router;
