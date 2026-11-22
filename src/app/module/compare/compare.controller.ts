import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { CompareService } from "./compare.service";

const compareListings = catchAsync(async (req: Request, res: Response) => {
  const result = await CompareService.compareListings(
    req.query as Record<string, unknown>,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Listings compared successfully",
    data: result,
  });
});

export const CompareController = {
  compareListings,
};
