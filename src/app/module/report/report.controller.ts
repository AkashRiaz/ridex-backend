import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { getRequestMeta } from "../auth/auth.utils";
import { ReportService } from "./report.service";

const createReport = catchAsync(async (req: Request, res: Response) => {
  const result = await ReportService.createReport(req.user as RequestUser, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Thanks for letting us know. Our team will review it.",
    data: result,
  });
});

const getMyReports = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ReportService.getMyReports(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Your reports retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getReports = catchAsync(async (req: Request, res: Response) => {
  const result = await ReportService.getReports(req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Reports retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getReportById = catchAsync(async (req: Request, res: Response) => {
  const result = await ReportService.getReportById(req.params.id as string);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Report retrieved successfully",
    data: result,
  });
});

const updateReport = catchAsync(async (req: Request, res: Response) => {
  const result = await ReportService.updateReport(
    req.user as RequestUser,
    req.params.id as string,
    req.body,
    getRequestMeta(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message:
      result.status === "RESOLVED"
        ? "Report resolved"
        : result.status === "DISMISSED"
          ? "Report dismissed"
          : "Report marked as in review",
    data: result,
  });
});

export const ReportController = {
  createReport,
  getMyReports,
  getReports,
  getReportById,
  updateReport,
};
