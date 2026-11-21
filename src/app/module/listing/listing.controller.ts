import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { getRequestMeta } from "../auth/auth.utils";
import { ListingService } from "./listing.service";

const createListingDraft = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.createListingDraft(
    req.user as RequestUser,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Draft listing created",
    data: result,
  });
});

const updateListing = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.updateListing(
    req.user as RequestUser,
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: result.sentBackToReview
      ? "Listing updated and sent for review again"
      : "Listing updated successfully",
    data: result,
  });
});

const addListingImages = catchAsync(async (req: Request, res: Response) => {
  const files =
    (req.files as { images?: Express.Multer.File[] } | undefined)?.images ?? [];

  const result = await ListingService.addListingImages(
    req.user as RequestUser,
    req.params.id as string,
    files,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: result.sentBackToReview
      ? "Photos added. The listing will be reviewed again."
      : "Photos added successfully",
    data: result,
  });
});

const reorderListingImages = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.reorderListingImages(
    req.user as RequestUser,
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Photo order saved",
    data: result,
  });
});

const deleteListingImage = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.deleteListingImage(
    req.user as RequestUser,
    req.params.id as string,
    req.params.imageId as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Photo removed",
    data: result,
  });
});

const submitListing = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.submitListing(
    req.user as RequestUser,
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Listing submitted for review",
    data: result,
  });
});

const updateListingStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.updateListingStatus(
    req.user as RequestUser,
    req.params.id as string,
    req.body,
    getRequestMeta(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message:
      result.status === "APPROVED" ? "Listing approved" : "Listing rejected",
    data: result,
  });
});

const markListingSold = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.markListingSold(
    req.user as RequestUser,
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Listing marked as sold",
    data: result,
  });
});

const renewListing = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.renewListing(
    req.user as RequestUser,
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Listing renewed",
    data: result,
  });
});

const deleteListing = catchAsync(async (req: Request, res: Response) => {
  await ListingService.deleteListing(
    req.user as RequestUser,
    req.params.id as string,
    getRequestMeta(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Listing deleted",
    data: null,
  });
});

const getMyListings = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ListingService.getMyListings(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Your listings retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getManagedListings = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.getManagedListings(req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Listings retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getListingByIdOrSlug = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.getListingByIdOrSlug(
    req.params.idOrSlug as string,
    req.user,
    getRequestMeta(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Listing retrieved successfully",
    data: result,
  });
});

const getSimilarListings = catchAsync(async (req: Request, res: Response) => {
  const result = await ListingService.getSimilarListings(
    req.params.idOrSlug as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Similar listings retrieved successfully",
    data: result,
  });
});

export const ListingController = {
  createListingDraft,
  updateListing,
  addListingImages,
  reorderListingImages,
  deleteListingImage,
  submitListing,
  updateListingStatus,
  markListingSold,
  renewListing,
  deleteListing,
  getMyListings,
  getManagedListings,
  getListingByIdOrSlug,
  getSimilarListings,
};
