import { Request, Response } from "express";
import httpStatus from "http-status";
import { IQuery } from "../../interfaces";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { SavedSearchService } from "./savedSearch.service";

const createSavedSearch = catchAsync(async (req: Request, res: Response) => {
  const result = await SavedSearchService.createSavedSearch(
    (req.user as RequestUser).userId,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Search saved. We'll let you know about new matches.",
    data: result,
  });
});

const getMySavedSearches = catchAsync(async (req: Request, res: Response) => {
  const result = await SavedSearchService.getMySavedSearches(
    (req.user as RequestUser).userId,
    req.query as IQuery,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Saved searches retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const lookupSavedSearch = catchAsync(async (req: Request, res: Response) => {
  const result = await SavedSearchService.lookupSavedSearch(
    (req.user as RequestUser).userId,
    req.query as Record<string, unknown>,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: result.savedSearch
      ? "This search is saved"
      : "This search is not saved",
    data: result,
  });
});

const getSavedSearchById = catchAsync(async (req: Request, res: Response) => {
  const result = await SavedSearchService.getSavedSearchById(
    (req.user as RequestUser).userId,
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Saved search retrieved successfully",
    data: result,
  });
});

const updateSavedSearch = catchAsync(async (req: Request, res: Response) => {
  const result = await SavedSearchService.updateSavedSearch(
    (req.user as RequestUser).userId,
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Saved search updated",
    data: result,
  });
});

const markSavedSearchSeen = catchAsync(async (req: Request, res: Response) => {
  const result = await SavedSearchService.markSavedSearchSeen(
    (req.user as RequestUser).userId,
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Saved search marked as seen",
    data: result,
  });
});

const deleteSavedSearch = catchAsync(async (req: Request, res: Response) => {
  const result = await SavedSearchService.deleteSavedSearch(
    (req.user as RequestUser).userId,
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Saved search deleted",
    data: result,
  });
});

export const SavedSearchController = {
  createSavedSearch,
  getMySavedSearches,
  lookupSavedSearch,
  getSavedSearchById,
  updateSavedSearch,
  markSavedSearchSeen,
  deleteSavedSearch,
};
