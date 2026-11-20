import cron from "node-cron";
import { config } from "../config";
import { prisma } from "./prisma";

/*
 * Self-registered accounts that never verified their email or phone
 * are removed after UNVERIFIED_USER_TTL_HOURS. Admin-created and
 * Google accounts are never touched.
 */
export const deleteUnverifiedUsers = async () => {
  cron.schedule("0 * * * *", async () => {
    try {
      const cutoff = new Date(
        Date.now() - config.unverified_user_ttl_hours * 60 * 60 * 1000,
      );

      const deletedUsers = await prisma.user.deleteMany({
        where: {
          emailVerified: false,
          phoneVerified: false,
          googleId: null,
          createdById: null,
          createdAt: {
            lt: cutoff,
          },
        },
      });

      if (deletedUsers.count > 0) {
        console.log(`Deleted ${deletedUsers.count} unverified users.`);
      }
    } catch (error) {
      console.error("Error deleting unverified users:", error);
    }
  });
};
