import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { SearchService } from "./search.service";

const searchListings = catchAsync(async (req: Request, res: Response) => {
  const result = await SearchService.searchListings(
    req.query as Record<string, unknown>,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Listings retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getSearchFilters = catchAsync(async (req: Request, res: Response) => {
  const result = await SearchService.getSearchFilters(
    req.query as Record<string, unknown>,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Search filters retrieved successfully",
    data: result,
  });
});

const getHomeData = catchAsync(async (_req: Request, res: Response) => {
  const result = await SearchService.getHomeData();

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Homepage data retrieved successfully",
    data: result,
  });
});

export const SearchController = {
  searchListings,
  getSearchFilters,
  getHomeData,
};
