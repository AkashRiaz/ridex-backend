import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import multer from "multer";
import { config } from "../config";
import { Prisma } from "../../generated/prisma/client";
import { AppError } from "../utils/AppError";

export const globalErrorHandler = async (
  // biome-ignore lint/suspicious/noExplicitAny: anything can be thrown
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const isDevelopment = config.node_env === "development";

  if (isDevelopment) {
    console.log("Error from Global Error Handler", err);
  }

  let statusCode: number = httpStatus.INTERNAL_SERVER_ERROR;
  let errorMessage = err?.message || "Internal Server Error";
  const errorName = err?.name || "Internal Server Error";

  if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = httpStatus.BAD_REQUEST;
    errorMessage = "You have provided incorrect field type or missing fields";
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      statusCode = httpStatus.CONFLICT;
      errorMessage = "Duplicate Key Error";
    } else if (err.code === "P2003") {
      statusCode = httpStatus.BAD_REQUEST;
      errorMessage = "Foreign key constraint failed";
    } else if (err.code === "P2025") {
      statusCode = httpStatus.NOT_FOUND;
      errorMessage =
        "An operation failed because it depends on one or more records that were required but not found.";
    }
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    if (err.errorCode === "P1000") {
      statusCode = httpStatus.UNAUTHORIZED;
      errorMessage =
        "Authentication failed against database server. Please Check Your Credentials";
    } else if (err.errorCode === "P1001") {
      statusCode = httpStatus.BAD_REQUEST;
      errorMessage = "Can't reach database server";
    }
  } else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    statusCode = httpStatus.INTERNAL_SERVER_ERROR;
    errorMessage = "Error occurred during query execution";
  } else if (err instanceof multer.MulterError) {
    statusCode = httpStatus.BAD_REQUEST;
    errorMessage =
      err.code === "LIMIT_FILE_SIZE"
        ? `File too large. Maximum size is ${config.max_upload_size_mb}MB`
        : err.message;
  } else if (err instanceof SyntaxError && "body" in err) {
    statusCode = httpStatus.BAD_REQUEST;
    errorMessage = "Malformed JSON in request body";
  } else if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorMessage = err.message;
  } else if (err instanceof Error) {
    errorMessage = err.message;
  }

  res.status(statusCode).json({
    success: false,
    statusCode: statusCode || httpStatus.INTERNAL_SERVER_ERROR,
    name: isDevelopment
      ? errorName
      : statusCode >= 500
        ? "Internal Server Error"
        : "Request Error",

    message:
      !isDevelopment && statusCode >= 500
        ? "Something went wrong. Please try again later."
        : errorMessage,
    error: isDevelopment ? err : undefined,
    stack: isDevelopment ? err?.stack : undefined,
  });
};
