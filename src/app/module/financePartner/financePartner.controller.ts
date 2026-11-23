import { Request, Response } from "express";
import httpStatus from "http-status";
import { getAuditActor } from "../../utils/auditLogger";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { FinancePartnerService } from "./financePartner.service";

const getLogoFile = (req: Request) => {
  const files = req.files as { logo?: Express.Multer.File[] } | undefined;

  return files?.logo?.[0] ?? null;
};

const getActiveFinancePartners = catchAsync(
  async (_req: Request, res: Response) => {
    const result = await FinancePartnerService.getActiveFinancePartners();

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Finance partners retrieved successfully",
      data: result,
    });
  },
);

const createFinancePartner = catchAsync(async (req: Request, res: Response) => {
  const result = await FinancePartnerService.createFinancePartner(
    req.body,
    getLogoFile(req),
    getAuditActor(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Finance partner created successfully",
    data: result,
  });
});

const getAllFinancePartners = catchAsync(
  async (req: Request, res: Response) => {
    const result = await FinancePartnerService.getAllFinancePartners(req.query);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Finance partners retrieved successfully",
      data: result.data,
      meta: result.meta,
    });
  },
);

const getFinancePartnerById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const result = await FinancePartnerService.getFinancePartnerById(
      id as string,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Finance partner retrieved successfully",
      data: result,
    });
  },
);

const updateFinancePartner = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await FinancePartnerService.updateFinancePartner(
    id as string,
    req.body,
    getLogoFile(req),
    getAuditActor(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Finance partner updated successfully",
    data: result,
  });
});

const deleteFinancePartner = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await FinancePartnerService.deleteFinancePartner(
    id as string,
    getAuditActor(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Finance partner deleted successfully",
    data: result,
  });
});

export const FinancePartnerController = {
  getActiveFinancePartners,
  createFinancePartner,
  getAllFinancePartners,
  getFinancePartnerById,
  updateFinancePartner,
  deleteFinancePartner,
};
