import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { getRequestMeta } from "../auth/auth.utils";
import { VerificationService } from "./verification.service";

const getMyVerification = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await VerificationService.getMyVerification(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Verification status retrieved successfully",
    data: result,
  });
});

const submitVerification = catchAsync(async (req: Request, res: Response) => {
  const files =
    (req.files as { documents?: Express.Multer.File[] } | undefined)
      ?.documents ?? [];

  const result = await VerificationService.submitVerification(
    req.user as RequestUser,
    req.body,
    files,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message:
      "Documents submitted. We usually review them within 2 working days.",
    data: result,
  });
});

const getVerificationRequests = catchAsync(
  async (req: Request, res: Response) => {
    const result = await VerificationService.getVerificationRequests(req.query);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Verification requests retrieved successfully",
      data: result.data,
      meta: result.meta,
    });
  },
);

const getVerificationRequestById = catchAsync(
  async (req: Request, res: Response) => {
    const result = await VerificationService.getVerificationRequestById(
      req.params.id as string,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Verification request retrieved successfully",
      data: result,
    });
  },
);

const reviewVerificationRequest = catchAsync(
  async (req: Request, res: Response) => {
    const result = await VerificationService.reviewVerificationRequest(
      req.user as RequestUser,
      req.params.id as string,
      req.body,
      getRequestMeta(req),
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message:
        result.status === "APPROVED"
          ? "Verification approved"
          : "Verification rejected",
      data: result,
    });
  },
);

export const VerificationController = {
  getMyVerification,
  submitVerification,
  getVerificationRequests,
  getVerificationRequestById,
  reviewVerificationRequest,
};
