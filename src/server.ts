import { Server, createServer } from "node:http";
import app from "./app";
import { config } from "./app/config";
import { registerEventHandlers } from "./app/events/registerEventHandlers";
import { startNotificationEmailWorker } from "./app/jobs/notificationEmail.job";
import { startScheduledWorker } from "./app/jobs/scheduled.job";
import {
  deleteOldNotifications,
  deleteUnverifiedUsers,
  expireListings,
  expireOffers,
  purgeVerificationDocuments,
} from "./app/lib/cron";
import { isSmtpConfigured, transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { closeQueues } from "./app/lib/queue";
import { redisClient } from "./app/lib/redis";
import { closeSocket, initSocket } from "./app/lib/socket";
import { registerChatSocketHandlers } from "./app/module/chat/chat.socket";
import { seedSuperAdmin } from "./app/utils/seed";

const PORT = config.port;

let server: Server;

const main = async () => {
  try {
    await prisma.$connect();
    // The pg adapter connects lazily; run a real query so bad credentials fail fast
    await prisma.$queryRaw`SELECT 1`;
    console.log("Connected to the database successfully.");

    await redisClient.connect();
    console.log("Connected to Redis successfully.");

    if (isSmtpConfigured) {
      try {
        await transporter.verify();
        console.log("SMTP transporter is ready to send emails.");
      } catch (error) {
        console.warn(
          "SMTP verification failed. Emails will not be sent.",
          error,
        );
      }
    } else {
      console.warn("SMTP is not configured. Emails will not be sent.");
    }

    // seeding

    await seedSuperAdmin();
    console.log("Super Admin seeding completed successfully.");

    await deleteUnverifiedUsers();
    await expireListings();
    await purgeVerificationDocuments();
    await deleteOldNotifications();
    await expireOffers();

    registerEventHandlers();

    startNotificationEmailWorker();
    console.log("Notification email worker started.");

    startScheduledWorker();
    console.log("Scheduled jobs worker started.");

    server = createServer(app);
    initSocket(server, [registerChatSocketHandlers]);

    server.listen(PORT, () => {
      console.log(
        `${config.app_name} server (HTTP + Socket.io) is running on port ${PORT}`,
      );
    });
  } catch (error) {
    console.error("Error starting the server:", error);
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  console.log(`${signal} received. Shutting down gracefully...`);

  await closeSocket().catch(() => null);
  server?.close();
  await closeQueues().catch(() => null);
  await prisma.$disconnect().catch(() => null);
  if (redisClient.isOpen) {
    await redisClient.quit().catch(() => null);
  }

  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error);
});

main();
