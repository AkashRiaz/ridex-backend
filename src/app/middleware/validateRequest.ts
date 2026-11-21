import z from "zod";
import httpStatus from "http-status";
import { catchAsync } from "../utils/catchAsync";
import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError";

export const validateRequest = (zodSchema: z.ZodType) => {
  return catchAsync(
    async (req: Request, _res: Response, next: NextFunction) => {
      /*
       * multipart/form-data: the JSON payload is sent in the "data" field
       * next to the files (upload.fields(...) must run before this).
       */
      let payload: unknown = req.body ?? {};

      if (typeof req.body?.data === "string") {
        try {
          payload = JSON.parse(req.body.data);
        } catch {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            "The data field must be valid JSON",
          );
        }
      }

      const result = zodSchema.safeParse(payload);

      if (!result.success) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          result.error.issues.map((issue) => issue.message).join(", "),
        );
      }

      req.body = result.data;

      next();
    },
  );
};
