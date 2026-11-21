import { Request, Response } from "express";
import httpStatus from "http-status";
import z from "zod";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { TestRideService } from "./testRide.service";
import {
  BlockedDateParamZodSchema,
  SlotsQueryZodSchema,
  TestRideParamZodSchema,
  TestRideQueryZodSchema,
} from "./testRide.validation";

const parseOrThrow = <T extends z.ZodType>(schema: T, value: unknown) => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      result.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  return result.data as z.infer<T>;
};

const parseTestRideId = (req: Request) =>
  parseOrThrow(TestRideParamZodSchema, req.params).id;

// ============================================
// Availability
// ============================================

const getMyAvailability = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await TestRideService.getMyAvailability(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Availability retrieved successfully",
    data: result,
  });
});

const replaceMyAvailability = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = req.user as RequestUser;

    const result = await TestRideService.replaceMyAvailability(
      userId,
      req.body,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Availability updated successfully",
      data: result,
    });
  },
);

const addBlockedDate = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await TestRideService.addBlockedDate(userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: result.affectedBookings
      ? `Date blocked. ${result.affectedBookings} booking(s) on this day are still active.`
      : "Date blocked",
    data: result,
  });
});

const deleteBlockedDate = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  await TestRideService.deleteBlockedDate(
    userId,
    parseOrThrow(BlockedDateParamZodSchema, req.params).id,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Blocked date removed",
    data: null,
  });
});

const getAvailableSlots = catchAsync(async (req: Request, res: Response) => {
  const result = await TestRideService.getAvailableSlots(
    parseOrThrow(SlotsQueryZodSchema, req.query),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Available slots retrieved successfully",
    data: result,
  });
});

// ============================================
// Bookings
// ============================================

const createTestRide = catchAsync(async (req: Request, res: Response) => {
  const result = await TestRideService.createTestRide(
    req.user as RequestUser,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Test ride requested",
    data: result,
  });
});

const getMyTestRides = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const filters = parseOrThrow(TestRideQueryZodSchema, req.query);

  const result = await TestRideService.getMyTestRides(userId, {
    ...req.query,
    ...filters,
  });

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Test rides retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getTestRideById = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await TestRideService.getTestRideById(
    userId,
    parseTestRideId(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Test ride retrieved successfully",
    data: result,
  });
});

const confirmTestRide = catchAsync(async (req: Request, res: Response) => {
  const result = await TestRideService.confirmTestRide(
    req.user as RequestUser,
    parseTestRideId(req),
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Test ride confirmed",
    data: result,
  });
});

const declineTestRide = catchAsync(async (req: Request, res: Response) => {
  const result = await TestRideService.declineTestRide(
    req.user as RequestUser,
    parseTestRideId(req),
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Test ride declined",
    data: result,
  });
});

const cancelTestRide = catchAsync(async (req: Request, res: Response) => {
  const result = await TestRideService.cancelTestRide(
    req.user as RequestUser,
    parseTestRideId(req),
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Test ride cancelled",
    data: result,
  });
});

const completeTestRide = catchAsync(async (req: Request, res: Response) => {
  const result = await TestRideService.completeTestRide(
    req.user as RequestUser,
    parseTestRideId(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Test ride marked as completed",
    data: result,
  });
});

const markTestRideNoShow = catchAsync(async (req: Request, res: Response) => {
  const result = await TestRideService.markTestRideNoShow(
    req.user as RequestUser,
    parseTestRideId(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Test ride marked as a no-show",
    data: result,
  });
});

export const TestRideController = {
  getMyAvailability,
  replaceMyAvailability,
  addBlockedDate,
  deleteBlockedDate,
  getAvailableSlots,
  createTestRide,
  getMyTestRides,
  getTestRideById,
  confirmTestRide,
  declineTestRide,
  cancelTestRide,
  completeTestRide,
  markTestRideNoShow,
};
