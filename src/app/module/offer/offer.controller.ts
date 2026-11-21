import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { OfferService } from "./offer.service";
import { OfferParamZodSchema, OfferQueryZodSchema } from "./offer.validation";

const parseOfferId = (req: Request) => {
  const result = OfferParamZodSchema.safeParse(req.params);

  if (!result.success) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid offer ID");
  }

  return result.data.id;
};

const makeOffer = catchAsync(async (req: Request, res: Response) => {
  const result = await OfferService.makeOffer(
    req.user as RequestUser,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Offer sent",
    data: result,
  });
});

const getMyOffers = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const filters = OfferQueryZodSchema.safeParse(req.query);

  if (!filters.success) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      filters.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  const result = await OfferService.getMyOffers(userId, {
    ...req.query,
    ...filters.data,
  });

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Offers retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getOfferById = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await OfferService.getOfferById(userId, parseOfferId(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Offer retrieved successfully",
    data: result,
  });
});

const counterOffer = catchAsync(async (req: Request, res: Response) => {
  const result = await OfferService.counterOffer(
    req.user as RequestUser,
    parseOfferId(req),
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Counter offer sent",
    data: result,
  });
});

const acceptOffer = catchAsync(async (req: Request, res: Response) => {
  const result = await OfferService.acceptOffer(
    req.user as RequestUser,
    parseOfferId(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Offer accepted",
    data: result,
  });
});

const declineOffer = catchAsync(async (req: Request, res: Response) => {
  const result = await OfferService.declineOffer(
    req.user as RequestUser,
    parseOfferId(req),
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Offer declined",
    data: result,
  });
});

const withdrawOffer = catchAsync(async (req: Request, res: Response) => {
  const result = await OfferService.withdrawOffer(
    req.user as RequestUser,
    parseOfferId(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Offer withdrawn",
    data: result,
  });
});

export const OfferController = {
  makeOffer,
  getMyOffers,
  getOfferById,
  counterOffer,
  acceptOffer,
  declineOffer,
  withdrawOffer,
};
