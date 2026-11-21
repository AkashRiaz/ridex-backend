import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AuditLogService } from "./auditLog.service";

const getAllAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const result = await AuditLogService.getAllAuditLogs(
    req.query,
    req.user as RequestUser,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Audit logs retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getAuditLogEntities = catchAsync(async (req: Request, res: Response) => {
  const result = await AuditLogService.getAuditLogEntities(
    req.user as RequestUser,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Audit log entities retrieved successfully",
    data: result,
  });
});

const getAuditLogById = catchAsync(async (req: Request, res: Response) => {
  const result = await AuditLogService.getAuditLogById(
    req.params.id as string,
    req.user as RequestUser,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Audit log entry retrieved successfully",
    data: result,
  });
});

export const AuditLogController = {
  getAllAuditLogs,
  getAuditLogEntities,
  getAuditLogById,
};
