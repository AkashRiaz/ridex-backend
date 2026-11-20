import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { VehicleTypeService } from "./vehicleType.service";

const getImageFile = (req: Request) => {
  const files = req.files as { image?: Express.Multer.File[] } | undefined;

  return files?.image?.[0] ?? null;
};

const createVehicleType = catchAsync(async (req: Request, res: Response) => {
  const result = await VehicleTypeService.createVehicleType(
    req.body,
    getImageFile(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Vehicle type created successfully",
    data: result,
  });
});

const getAllVehicleTypes = catchAsync(async (req: Request, res: Response) => {
  const result = await VehicleTypeService.getAllVehicleTypes(req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Vehicle types retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getVehicleTypeByIdOrSlug = catchAsync(
  async (req: Request, res: Response) => {
    const { idOrSlug } = req.params;

    const result = await VehicleTypeService.getVehicleTypeByIdOrSlug(
      idOrSlug as string,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Vehicle type retrieved successfully",
      data: result,
    });
  },
);

const updateVehicleType = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await VehicleTypeService.updateVehicleType(
    id as string,
    req.body,
    getImageFile(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Vehicle type updated successfully",
    data: result,
  });
});

const updateVehicleTypeAttributes = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const result = await VehicleTypeService.updateVehicleTypeAttributes(
      id as string,
      req.body,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Vehicle type attributes updated successfully",
      data: result,
    });
  },
);

const deleteVehicleType = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await VehicleTypeService.deleteVehicleType(id as string);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Vehicle type deleted successfully",
    data: result,
  });
});

export const VehicleTypeController = {
  createVehicleType,
  getAllVehicleTypes,
  getVehicleTypeByIdOrSlug,
  updateVehicleType,
  updateVehicleTypeAttributes,
  deleteVehicleType,
};
