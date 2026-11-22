import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { PriceInsightService } from "./priceInsight.service";

const getListingPriceInsight = catchAsync(
  async (req: Request, res: Response) => {
    const result = await PriceInsightService.getListingPriceInsight(
      req.params.idOrSlug as string,
      req.user,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Price insight retrieved successfully",
      data: result,
    });
  },
);

export const PriceInsightController = {
  getListingPriceInsight,
};
