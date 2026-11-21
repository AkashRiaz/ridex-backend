import { Role } from "../../generated/prisma/enums";

/*
 * Frontend dashboard prefix per role, for links in notifications and emails.
 * Keep in sync with ridex-frontend/lib/dashboardPath.ts.
 */
export const ROLE_DASHBOARD_PATH: Record<Role, string> = {
  SUPER_ADMIN: "/super-admin-dashboard",
  ADMIN: "/admin-dashboard",
  MODERATOR: "/moderator-dashboard",
  DEALER: "/dealer-dashboard",
  DEALER_STAFF: "/dealer-staff-dashboard",
  SELLER: "/seller-dashboard",
  INSPECTOR: "/inspector-dashboard",
  BUYER: "/buyer-dashboard",
};

export const dashboardLink = (role: Role, path = "") =>
  `${ROLE_DASHBOARD_PATH[role]}${path}`;
