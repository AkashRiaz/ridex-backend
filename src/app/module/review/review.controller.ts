import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { getRequestMeta } from "../auth/auth.utils";
import { ReviewService } from "./review.service";

const getReviewEligibility = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.getReviewEligibility(
    req.user as RequestUser,
    req.params.listingId as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: result.allowed ? "You can review this seller" : result.reason,
    data: result,
  });
});

const createReview = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.createReview(req.user as RequestUser, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Thanks! Your review has been posted",
    data: result,
  });
});

const getReviews = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.getReviews(req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Reviews retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getGivenReviews = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ReviewService.getGivenReviews(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Your reviews retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getReceivedReviews = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ReviewService.getReceivedReviews(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Received reviews retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const updateReview = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.updateReview(
    req.user as RequestUser,
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Review updated",
    data: result,
  });
});

const deleteReview = catchAsync(async (req: Request, res: Response) => {
  await ReviewService.deleteReview(req.user as RequestUser, req.params.id as string, getRequestMeta(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Review deleted",
    data: null,
  });
});

const replyToReview = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.replyToReview(
    req.user as RequestUser,
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Reply posted",
    data: result,
  });
});

const setReviewVisibility = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.setReviewVisibility(
    req.user as RequestUser,
    req.params.id as string,
    req.body,
    getRequestMeta(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: result.isHidden ? "Review hidden" : "Review visible again",
    data: result,
  });
});

export const ReviewController = {
  getReviewEligibility,
  createReview,
  getReviews,
  getGivenReviews,
  getReceivedReviews,
  updateReview,
  deleteReview,
  replyToReview,
  setReviewVisibility,
};
