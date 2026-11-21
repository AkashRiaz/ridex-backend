import { Request, Response } from "express";
import httpStatus from "http-status";
import { getAuditActor } from "../../utils/auditLogger";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { VehicleModelService } from "./vehicleModel.service";

const getImageFile = (req: Request) => {
  const files = req.files as { image?: Express.Multer.File[] } | undefined;

  return files?.image?.[0] ?? null;
};

const createVehicleModel = catchAsync(async (req: Request, res: Response) => {
  const result = await VehicleModelService.createVehicleModel(
    req.body,
    getImageFile(req),
    getAuditActor(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Vehicle model created successfully",
    data: result,
  });
});

const getAllVehicleModels = catchAsync(async (req: Request, res: Response) => {
  const result = await VehicleModelService.getAllVehicleModels(req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Vehicle models retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getVehicleModelByIdOrSlug = catchAsync(
  async (req: Request, res: Response) => {
    const { idOrSlug } = req.params;

    const result = await VehicleModelService.getVehicleModelByIdOrSlug(
      idOrSlug as string,
      typeof req.query.brand === "string" ? req.query.brand : undefined,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Vehicle model retrieved successfully",
      data: result,
    });
  },
);

const updateVehicleModel = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await VehicleModelService.updateVehicleModel(
    id as string,
    req.body,
    getImageFile(req),
    getAuditActor(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Vehicle model updated successfully",
    data: result,
  });
});

const deleteVehicleModel = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await VehicleModelService.deleteVehicleModel(id as string, getAuditActor(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Vehicle model deleted successfully",
    data: result,
  });
});

export const VehicleModelController = {
  createVehicleModel,
  getAllVehicleModels,
  getVehicleModelByIdOrSlug,
  updateVehicleModel,
  deleteVehicleModel,
};
