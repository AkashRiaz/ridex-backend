import { Server } from "http";
import app from "./app";
import { config } from "./app/config";
import { isSmtpConfigured, transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";
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
        console.warn("SMTP verification failed. Emails will not be sent.", error);
      }
    } else {
      console.warn("SMTP is not configured. Emails will not be sent.");
    }

    // seeding

    await seedSuperAdmin();
    console.log("Super Admin seeding completed successfully.");

    server = app.listen(PORT, () => {
      console.log(`${config.app_name} server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting the server:", error);
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  console.log(`${signal} received. Shutting down gracefully...`);

  server?.close();
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
