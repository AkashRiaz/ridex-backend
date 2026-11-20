import { Request, Response } from "express";
import httpStatus from "http-status";
import { isUuid } from "../../helper/isUuid";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { RecentlyViewedService } from "./recentlyViewed.service";

const getMyRecentlyViewed = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await RecentlyViewedService.getMyRecentlyViewed(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Recently viewed listings retrieved successfully",
    data: result,
  });
});

const removeRecentlyViewed = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;
  const listingId = req.params.listingId as string;

  if (!isUuid(listingId)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid listing ID");
  }

  await RecentlyViewedService.removeRecentlyViewed(userId, listingId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Removed from recently viewed",
    data: null,
  });
});

const clearRecentlyViewed = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await RecentlyViewedService.clearRecentlyViewed(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Recently viewed cleared",
    data: result,
  });
});

export const RecentlyViewedController = {
  getMyRecentlyViewed,
  removeRecentlyViewed,
  clearRecentlyViewed,
};
