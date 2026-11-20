import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./app/config";
import { notFound } from "./app/middleware/notFound";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { globalRateLimiter } from "./app/middleware/rateLimiter";
import { AppRoutes } from "./app/routes";
import { AppError } from "./app/utils/AppError";
import httpStatus from "http-status";

const app: Application = express();

app.set("trust proxy", 1);

app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no Origin header) and whitelisted origins
      if (!origin || config.cors_origins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(
        new AppError(
          httpStatus.FORBIDDEN,
          `Origin ${origin} is not allowed by CORS`,
        ),
      );
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Health check successful",
  });
});

app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: `Welcome to the ${config.app_name} API`,
  });
});

app.use("/api/v1", globalRateLimiter, AppRoutes);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
