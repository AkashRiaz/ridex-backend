import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { WishlistService } from "./wishlist.service";
import { WishlistListingParamZodSchema } from "./wishlist.validation";

const parseListingId = (req: Request) => {
  const result = WishlistListingParamZodSchema.safeParse(req.params);

  if (!result.success) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid listing ID");
  }

  return result.data.listingId;
};

const addToWishlist = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await WishlistService.addToWishlist(
    userId,
    parseListingId(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Saved to your wishlist",
    data: result,
  });
});

const removeFromWishlist = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await WishlistService.removeFromWishlist(
    userId,
    parseListingId(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Removed from your wishlist",
    data: result,
  });
});

const getMyWishlist = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await WishlistService.getMyWishlist(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Wishlist retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getMyWishlistIds = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await WishlistService.getMyWishlistIds(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Wishlist ids retrieved successfully",
    data: result,
  });
});

export const WishlistController = {
  addToWishlist,
  removeFromWishlist,
  getMyWishlist,
  getMyWishlistIds,
};
