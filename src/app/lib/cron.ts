import cron from "node-cron";
import { config } from "../config";
import { ListingService } from "../module/listing/listing.service";
import { NotificationService } from "../module/notification/notification.service";
import { VerificationService } from "../module/verification/verification.service";
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

/*
 * Daily at 02:00: approved listings past expiresAt become EXPIRED.
 */
export const expireListings = async () => {
  cron.schedule("0 2 * * *", async () => {
    try {
      const count = await ListingService.expireListings();

      if (count > 0) {
        console.log(`Expired ${count} listing(s).`);
      }
    } catch (error) {
      console.error("Error expiring listings:", error);
    }
  });
};

/*
 * Daily at 03:00: delete verification document files 30 days after a decision.
 */
export const purgeVerificationDocuments = async () => {
  cron.schedule("0 3 * * *", async () => {
    try {
      const count = await VerificationService.purgeReviewedDocuments();

      if (count > 0) {
        console.log(`Purged documents of ${count} verification request(s).`);
      }
    } catch (error) {
      console.error("Error purging verification documents:", error);
    }
  });
};

/*
 * Daily at 04:00: delete read notifications older than NOTIFICATION_RETENTION_DAYS.
 */
export const deleteOldNotifications = async () => {
  cron.schedule("0 4 * * *", async () => {
    try {
      const count = await NotificationService.deleteOldNotifications();

      if (count > 0) {
        console.log(`Deleted ${count} old notification(s).`);
      }
    } catch (error) {
      console.error("Error deleting old notifications:", error);
    }
  });
};
