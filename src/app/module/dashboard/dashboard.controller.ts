import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { DashboardService } from "./dashboard.service";

const getAdminOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getAdminOverview(
    req.user as RequestUser,
    req.query.range,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Admin dashboard overview retrieved successfully",
    data: result,
  });
});

const getModeratorOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getModeratorOverview(
    req.user as RequestUser,
    req.query.range,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Moderator dashboard overview retrieved successfully",
    data: result,
  });
});

const getSellerOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getSellerOverview(
    req.user as RequestUser,
    req.query.range,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Seller dashboard overview retrieved successfully",
    data: result,
  });
});

const getBuyerOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getBuyerOverview(
    req.user as RequestUser,
    req.query.range,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Buyer dashboard overview retrieved successfully",
    data: result,
  });
});

const getQueueCounts = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getQueueCounts(req.user as RequestUser);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Queue counts retrieved successfully",
    data: result,
  });
});

export const DashboardController = {
  getAdminOverview,
  getModeratorOverview,
  getSellerOverview,
  getBuyerOverview,
  getQueueCounts,
};
