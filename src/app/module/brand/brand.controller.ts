import { Request, Response } from "express";
import httpStatus from "http-status";
import { getAuditActor } from "../../utils/auditLogger";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { BrandService } from "./brand.service";

const getLogoFile = (req: Request) => {
  const files = req.files as { logo?: Express.Multer.File[] } | undefined;

  return files?.logo?.[0] ?? null;
};

const createBrand = catchAsync(async (req: Request, res: Response) => {
  const result = await BrandService.createBrand(req.body, getLogoFile(req), getAuditActor(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Brand created successfully",
    data: result,
  });
});

const getAllBrands = catchAsync(async (req: Request, res: Response) => {
  const result = await BrandService.getAllBrands(req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Brands retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getBrandByIdOrSlug = catchAsync(async (req: Request, res: Response) => {
  const { idOrSlug } = req.params;

  const result = await BrandService.getBrandByIdOrSlug(idOrSlug as string);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Brand retrieved successfully",
    data: result,
  });
});

const updateBrand = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await BrandService.updateBrand(
    id as string,
    req.body,
    getLogoFile(req),
    getAuditActor(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Brand updated successfully",
    data: result,
  });
});

const deleteBrand = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await BrandService.deleteBrand(id as string, getAuditActor(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Brand deleted successfully",
    data: result,
  });
});

export const BrandController = {
  createBrand,
  getAllBrands,
  getBrandByIdOrSlug,
  updateBrand,
  deleteBrand,
};
