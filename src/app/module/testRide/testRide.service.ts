import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
  ListingStatus,
  MessageType,
  TestRideStatus,
} from "../../../generated/prisma/enums";
import { TestRideWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { appEvents } from "../../events/appEvents";
import { queryBuilder } from "../../helper/queryBuilder";
import {
  localMidnightToUtc,
  shiftDateKey,
  toLocalDateKey,
} from "../../helper/timeZone";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, enqueueJob } from "../../lib/queue";
import { emitToUser } from "../../lib/socket";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { consumeRateLimit } from "../../utils/redisRateLimit";
import { ChatService, testRideCardSelect } from "../chat/chat.service";
import {
  ICancelTestRidePayload,
  IConfirmTestRidePayload,
  ICreateBlockedDatePayload,
  ICreateTestRidePayload,
  IDeclineTestRidePayload,
  IReplaceAvailabilityPayload,
  ISlotsQuery,
  ITestRideExpireJob,
  ITestRideRef,
  ITestRideReminderJob,
} from "./testRide.interface";
import {
  ACTIVE_TEST_RIDE_STATUSES,
  MAX_BLOCKED_DATE_DAYS_AHEAD,
  SLOT_MINUTE_OPTIONS,
  TEST_RIDE_LOCK_NAMESPACE,
  TEST_RIDE_RATE_LIMIT_PER_HOUR,
  TEST_RIDE_REMINDERS,
  TEST_RIDE_SWEEP_BATCH_LIMIT,
  TReminderKind,
  TTestRideAction,
  actionFromStatuses,
  bookingWindow,
  evaluateBooking,
  evaluateTestRideAction,
  generateSlots,
  rulesForListing,
  testRideExpireJobId,
  testRideNoticeText,
  testRidePreview,
  testRideRateKey,
  testRideReminderJobId,
} from "./testRide.utils";

// ============================================
// Shapes
// ============================================

const testRideInclude = {
  listing: {
    select: {
      id: true,
      title: true,
      slug: true,
      price: true,
      status: true,
      isDeleted: true,
      district: true,
      area: true,
      images: { where: { isCover: true }, take: 1, select: { url: true } },
    },
  },
  buyer: { select: { id: true, name: true, imageUrl: true } },
  seller: { select: { id: true, name: true, imageUrl: true } },
} satisfies Prisma.TestRideInclude;

type TTestRideRow = Prisma.TestRideGetPayload<{
  include: typeof testRideInclude;
}>;

const TEST_RIDE_ACTIONS: TTestRideAction[] = [
  "confirm",
  "decline",
  "cancel",
  "complete",
  "noShow",
];

const toTestRide = (ride: TTestRideRow, userId: string) => ({
  id: ride.id,
  listingId: ride.listingId,
  conversationId: ride.conversationId,
  buyerId: ride.buyerId,
  sellerId: ride.sellerId,
  startsAt: ride.startsAt,
  endsAt: ride.endsAt,
  status: ride.status,
  buyerNote: ride.buyerNote,
  sellerNote: ride.sellerNote,
  declineReason: ride.declineReason,
  cancelReason: ride.cancelReason,
  cancelledById: ride.cancelledById,
  confirmedAt: ride.confirmedAt,
  cancelledAt: ride.cancelledAt,
  closedAt: ride.closedAt,
  createdAt: ride.createdAt,
  updatedAt: ride.updatedAt,
  side: ride.buyerId === userId ? "buyer" : "seller",
  allowedActions: TEST_RIDE_ACTIONS.filter(
    (action) => evaluateTestRideAction({ action, userId, ride }).allowed,
  ),
  listing: {
    id: ride.listing.id,
    title: ride.listing.title,
    slug: ride.listing.slug,
    price: Number(ride.listing.price),
    status: ride.listing.status,
    isDeleted: ride.listing.isDeleted,
    district: ride.listing.district,
    area: ride.listing.area,
    coverImage: ride.listing.images[0]?.url ?? null,
  },
  buyer: ride.buyer,
  seller: ride.seller,
});

const toTestRideRef = (ride: TTestRideRow): ITestRideRef => ({
  testRideId: ride.id,
  conversationId: ride.conversationId,
  listingId: ride.listingId,
  listingTitle: ride.listing.title,
  buyerId: ride.buyerId,
  sellerId: ride.sellerId,
  startsAt: ride.startsAt,
});

// "YYYY-MM-DD" ↔ @db.Date (stored as UTC midnight of that calendar day)
const dateKeyToDbDate = (dateKey: string) =>
  new Date(`${dateKey}T00:00:00.000Z`);

const dbDateToKey = (date: Date) => date.toISOString().slice(0, 10);

// ============================================
// Helpers
// ============================================

const RULE_STATUS: Record<string, number> = {
  LISTING_NOT_FOUND: httpStatus.NOT_FOUND,
  NOT_FOUND: httpStatus.NOT_FOUND,
  OWN_LISTING: httpStatus.BAD_REQUEST,
  NOT_ALLOWED: httpStatus.FORBIDDEN,
};

const throwRule = (result: { code: string; reason: string }): never => {
  throw new AppError(
    RULE_STATUS[result.code] ?? httpStatus.CONFLICT,
    result.reason,
  );
};

/*
 * Serializes bookings and status changes per seller, so two buyers can
 * never take the last place in the same slot.
 */
const lockSeller = (tx: Prisma.TransactionClient, sellerId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(${TEST_RIDE_LOCK_NAMESPACE}::int, hashtext(${sellerId}::text))`;

const findTestRideForUser = async (
  userId: string,
  id: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) => {
  const ride = await db.testRide.findUnique({
    where: { id },
    include: testRideInclude,
  });

  // same 404 for "missing" and "not yours"
  if (!ride || (ride.buyerId !== userId && ride.sellerId !== userId)) {
    throw new AppError(httpStatus.NOT_FOUND, "Test ride not found");
  }

  return ride;
};

/*
 * Inputs for generateSlots for one seller + listing and a local date range:
 * the listing's rules, the seller's blocked dates and every booking of the
 * seller that holds a place (capacity is per seller, across listings).
 */
const loadSlotInputs = async (
  db: Prisma.TransactionClient | typeof prisma,
  sellerId: string,
  listingId: string,
  fromKey: string,
  toKey: string,
) => {
  const rangeStart = localMidnightToUtc(fromKey);
  const rangeEnd = localMidnightToUtc(shiftDateKey(toKey, 1));

  // sequential: a transaction client must not run statements in parallel
  const rules = await db.testRideAvailability.findMany({
    where: { sellerId },
  });
  const blocked = await db.testRideBlockedDate.findMany({
    where: {
      sellerId,
      date: { gte: dateKeyToDbDate(fromKey), lte: dateKeyToDbDate(toKey) },
    },
    select: { date: true },
  });
  const bookings = await db.testRide.findMany({
    where: {
      sellerId,
      status: { in: ACTIVE_TEST_RIDE_STATUSES },
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
    },
    select: { startsAt: true, endsAt: true },
  });

  return {
    rules: rulesForListing(rules, listingId),
    blockedDateKeys: new Set(blocked.map((row) => dbDateToKey(row.date))),
    bookings,
  };
};

const assertRate = async (userId: string) => {
  const allowed = await consumeRateLimit(
    testRideRateKey(userId),
    TEST_RIDE_RATE_LIMIT_PER_HOUR,
    60 * 60,
  );

  if (!allowed) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "You have requested too many test rides. Please try again in an hour.",
    );
  }
};

// ============================================
// Side effects (AFTER commit)
// ============================================

const emitTestRideUpdate = async (ids: string[]) => {
  const rides = await prisma.testRide.findMany({
    where: { id: { in: ids } },
    select: {
      ...testRideCardSelect,
      conversationId: true,
      buyerId: true,
      sellerId: true,
    },
  });

  for (const ride of rides) {
    const { buyerId, sellerId, conversationId, ...card } = ride;
    const payload = { conversationId, testRide: card };

    emitToUser(buyerId, "testRide:updated", payload);
    emitToUser(sellerId, "testRide:updated", payload);
  }
};

// an unconfirmed request expires at its start time
const scheduleExpiry = (ride: { id: string; startsAt: Date }) =>
  enqueueJob<ITestRideExpireJob>(
    QUEUE_NAMES.scheduled,
    "test-ride-expire",
    { testRideId: ride.id },
    {
      ...DEFAULT_JOB_OPTIONS,
      jobId: testRideExpireJobId(ride.id),
      delay: Math.max(ride.startsAt.getTime() - Date.now(), 0),
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );

// 24h and 2h before a confirmed ride; reminders already in the past are skipped
const scheduleReminders = async (ride: { id: string; startsAt: Date }) => {
  for (const reminder of TEST_RIDE_REMINDERS) {
    const delay =
      ride.startsAt.getTime() -
      reminder.hoursBefore * 60 * 60 * 1000 -
      Date.now();

    if (delay <= 0) continue;

    await enqueueJob<ITestRideReminderJob>(
      QUEUE_NAMES.scheduled,
      "test-ride-reminder",
      { testRideId: ride.id, kind: reminder.kind },
      {
        ...DEFAULT_JOB_OPTIONS,
        jobId: testRideReminderJobId(ride.id, reminder.kind),
        delay,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
};

// ============================================
// Availability (sellers)
// ============================================

const getMyAvailability = async (userId: string) => {
  const todayKey = toLocalDateKey(new Date());

  const [rules, blockedDates] = await Promise.all([
    prisma.testRideAvailability.findMany({
      where: { sellerId: userId },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      include: { listing: { select: { id: true, title: true, slug: true } } },
    }),
    prisma.testRideBlockedDate.findMany({
      where: { sellerId: userId, date: { gte: dateKeyToDbDate(todayKey) } },
      orderBy: { date: "asc" },
    }),
  ]);

  return {
    timezone: config.timezone,
    slotMinuteOptions: SLOT_MINUTE_OPTIONS,
    bookingDays: config.test_ride_booking_days,
    minLeadHours: config.test_ride_min_lead_hours,
    rules: rules.map((rule) => ({
      id: rule.id,
      listingId: rule.listingId,
      listing: rule.listing,
      dayOfWeek: rule.dayOfWeek,
      startTime: rule.startTime,
      endTime: rule.endTime,
      slotMinutes: rule.slotMinutes,
      capacity: rule.capacity,
    })),
    blockedDates: blockedDates.map((row) => ({
      id: row.id,
      date: dbDateToKey(row.date),
      reason: row.reason,
    })),
  };
};

/*
 * Replaces all weekly rules at once (the editor saves the whole week).
 * Existing bookings are kept; only new bookings see the new hours.
 */
const replaceMyAvailability = async (
  userId: string,
  payload: IReplaceAvailabilityPayload,
) => {
  const listingIds = [
    ...new Set(
      payload.rules
        .map((rule) => rule.listingId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (listingIds.length) {
    const owned = await prisma.listing.count({
      where: { id: { in: listingIds }, sellerId: userId, isDeleted: false },
    });

    if (owned !== listingIds.length) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "A time range points to a listing that is not yours",
      );
    }
  }

  await prisma.$transaction([
    prisma.testRideAvailability.deleteMany({ where: { sellerId: userId } }),
    prisma.testRideAvailability.createMany({
      data: payload.rules.map((rule) => ({
        sellerId: userId,
        listingId: rule.listingId ?? null,
        dayOfWeek: rule.dayOfWeek,
        startTime: rule.startTime,
        endTime: rule.endTime,
        slotMinutes: rule.slotMinutes,
        capacity: rule.capacity,
      })),
    }),
  ]);

  return getMyAvailability(userId);
};

/*
 * Blocking a day does not cancel bookings already on it; the response
 * says how many there are so the seller can handle them.
 */
const addBlockedDate = async (
  userId: string,
  payload: ICreateBlockedDatePayload,
) => {
  const todayKey = toLocalDateKey(new Date());

  if (payload.date < todayKey) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pick today or a later date");
  }

  if (payload.date > shiftDateKey(todayKey, MAX_BLOCKED_DATE_DAYS_AHEAD)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You can block dates up to a year ahead",
    );
  }

  let blocked: { id: string; date: Date; reason: string | null };

  try {
    blocked = await prisma.testRideBlockedDate.create({
      data: {
        sellerId: userId,
        date: dateKeyToDbDate(payload.date),
        reason: payload.reason || null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(httpStatus.CONFLICT, "This date is already blocked");
    }
    throw error;
  }

  const affectedBookings = await prisma.testRide.count({
    where: {
      sellerId: userId,
      status: { in: ACTIVE_TEST_RIDE_STATUSES },
      startsAt: {
        gte: localMidnightToUtc(payload.date),
        lt: localMidnightToUtc(shiftDateKey(payload.date, 1)),
      },
    },
  });

  return {
    id: blocked.id,
    date: dbDateToKey(blocked.date),
    reason: blocked.reason,
    affectedBookings,
  };
};

const deleteBlockedDate = async (userId: string, id: string) => {
  const { count } = await prisma.testRideBlockedDate.deleteMany({
    where: { id, sellerId: userId },
  });

  if (!count) {
    throw new AppError(httpStatus.NOT_FOUND, "Blocked date not found");
  }
};

// ============================================
// Slots (public)
// ============================================

const getAvailableSlots = async (query: ISlotsQuery) => {
  const listing = await prisma.listing.findUnique({
    where: { id: query.listingId },
    select: { id: true, sellerId: true, status: true, isDeleted: true },
  });

  if (!listing || listing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
  }

  const now = new Date();
  const window = bookingWindow({
    now,
    bookingDays: config.test_ride_booking_days,
    timeZone: config.timezone,
    fromKey: query.from,
    toKey: query.to,
  });

  const base = {
    listingId: listing.id,
    timezone: config.timezone,
    from: window.fromKey,
    to: window.toKey,
  };

  if (
    listing.status !== ListingStatus.APPROVED ||
    window.fromKey > window.toKey
  ) {
    return { ...base, hasAvailability: false, days: [] };
  }

  const inputs = await loadSlotInputs(
    prisma,
    listing.sellerId,
    listing.id,
    window.fromKey,
    window.toKey,
  );

  const days = generateSlots({
    ...inputs,
    now,
    fromKey: window.fromKey,
    toKey: window.toKey,
    minLeadHours: config.test_ride_min_lead_hours,
    timeZone: config.timezone,
  });

  return {
    ...base,
    hasAvailability: inputs.rules.length > 0,
    days: days.map((day) => ({
      ...day,
      // capacity is internal; buyers only see whether a slot is free
      slots: day.slots.map(({ startsAt, endsAt, time }) => ({
        startsAt,
        endsAt,
        time,
      })),
    })),
  };
};

// ============================================
// Booking
// ============================================

const createTestRide = async (
  requestUser: RequestUser,
  payload: ICreateTestRidePayload,
) => {
  const listing = await prisma.listing.findUnique({
    where: { id: payload.listingId },
    select: { id: true, sellerId: true, status: true, isDeleted: true },
  });

  const precheck = evaluateBooking({
    userId: requestUser.userId,
    listing,
    hasActiveBooking: false,
  });

  if (!precheck.allowed) throwRule(precheck);

  await assertRate(requestUser.userId);

  const { conversation } = await ChatService.findOrCreateConversation(
    requestUser,
    payload.listingId,
  );

  const sellerId = conversation.sellerId;

  const ride = await prisma.$transaction(async (tx) => {
    await lockSeller(tx, sellerId);

    const now = new Date();

    const active = await tx.testRide.findFirst({
      where: {
        listingId: conversation.listingId,
        buyerId: requestUser.userId,
        status: { in: ACTIVE_TEST_RIDE_STATUSES },
        startsAt: { gt: now },
      },
      select: { id: true },
    });

    const rule = evaluateBooking({
      userId: requestUser.userId,
      listing,
      hasActiveBooking: Boolean(active),
    });

    if (!rule.allowed) throwRule(rule);

    // the requested start must still be a free slot (re-checked under the lock)
    const dayKey = toLocalDateKey(payload.startsAt);
    const window = bookingWindow({
      now,
      bookingDays: config.test_ride_booking_days,
      timeZone: config.timezone,
      fromKey: dayKey,
      toKey: dayKey,
    });

    const inputs =
      window.fromKey <= window.toKey
        ? await loadSlotInputs(
            tx,
            sellerId,
            conversation.listingId,
            window.fromKey,
            window.toKey,
          )
        : null;

    const slot = inputs
      ? generateSlots({
          ...inputs,
          now,
          fromKey: window.fromKey,
          toKey: window.toKey,
          minLeadHours: config.test_ride_min_lead_hours,
          timeZone: config.timezone,
        })
          .flatMap((day) => day.slots)
          .find(
            (candidate) =>
              candidate.startsAt.getTime() === payload.startsAt.getTime(),
          )
      : undefined;

    if (!slot) {
      throw new AppError(
        httpStatus.CONFLICT,
        "This time slot is no longer available. Please pick another one.",
      );
    }

    return tx.testRide.create({
      data: {
        listingId: conversation.listingId,
        conversationId: conversation.id,
        buyerId: requestUser.userId,
        sellerId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        buyerNote: payload.note ?? "",
      },
      include: testRideInclude,
    });
  });

  // Side effects AFTER commit
  await ChatService.postCardMessage({
    type: MessageType.TEST_RIDE,
    conversationId: ride.conversationId,
    senderId: ride.buyerId,
    testRideId: ride.id,
    body: ride.buyerNote,
    preview: testRidePreview(ride.startsAt),
  });
  await scheduleExpiry(ride);
  await emitTestRideUpdate([ride.id]);
  appEvents.emit("testRide.requested", toTestRideRef(ride));

  return toTestRide(ride, requestUser.userId);
};

// ============================================
// Status changes
// ============================================

type TChangeInput =
  | { action: "confirm"; payload: IConfirmTestRidePayload }
  | { action: "decline"; payload: IDeclineTestRidePayload }
  | { action: "cancel"; payload: ICancelTestRidePayload }
  | { action: "complete" }
  | { action: "noShow" };

const changeData = (
  input: TChangeInput,
  userId: string,
): Prisma.TestRideUpdateManyMutationInput => {
  const now = new Date();

  switch (input.action) {
    case "confirm":
      return {
        status: TestRideStatus.CONFIRMED,
        confirmedAt: now,
        sellerNote: input.payload.note ?? "",
      };
    case "decline":
      return {
        status: TestRideStatus.DECLINED,
        declineReason: input.payload.reason,
        closedAt: now,
      };
    case "cancel":
      return {
        status: TestRideStatus.CANCELLED,
        cancelReason: input.payload.reason,
        cancelledById: userId,
        cancelledAt: now,
      };
    case "complete":
      return { status: TestRideStatus.COMPLETED, closedAt: now };
    case "noShow":
      return { status: TestRideStatus.NO_SHOW, closedAt: now };
  }
};

const changeTestRide = async (
  requestUser: RequestUser,
  id: string,
  input: TChangeInput,
) => {
  const current = await findTestRideForUser(requestUser.userId, id);

  if (input.action === "confirm") {
    await ChatService.assertCanReplyInConversation(
      requestUser.userId,
      current.conversationId,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await lockSeller(tx, current.sellerId);

    const ride = await findTestRideForUser(requestUser.userId, id, tx);

    const rule = evaluateTestRideAction({
      action: input.action,
      userId: requestUser.userId,
      ride,
    });

    if (!rule.allowed) throwRule(rule);

    const { count } = await tx.testRide.updateMany({
      where: { id, status: { in: actionFromStatuses(input.action) } },
      data: changeData(input, requestUser.userId),
    });

    if (!count) {
      throw new AppError(
        httpStatus.CONFLICT,
        "This test ride was just updated",
      );
    }

    return tx.testRide.findUniqueOrThrow({
      where: { id },
      include: testRideInclude,
    });
  });

  // Side effects AFTER commit
  const otherId =
    requestUser.userId === updated.buyerId ? updated.sellerId : updated.buyerId;

  const noticeExtra =
    input.action === "confirm"
      ? updated.sellerNote
      : input.action === "decline"
        ? updated.declineReason
        : input.action === "cancel"
          ? updated.cancelReason
          : null;

  await ChatService.postCardNotice({
    conversationId: updated.conversationId,
    testRideId: updated.id,
    body: testRideNoticeText(
      input.action === "confirm"
        ? "confirmed"
        : input.action === "decline"
          ? "declined"
          : input.action === "cancel"
            ? "cancelled"
            : input.action === "complete"
              ? "completed"
              : "noShow",
      updated.startsAt,
      noticeExtra,
    ),
    // outcomes after the ride are a record, not something to react to
    unreadForUserId:
      input.action === "complete" || input.action === "noShow" ? null : otherId,
  });
  await emitTestRideUpdate([updated.id]);

  const ref = toTestRideRef(updated);

  if (input.action === "confirm") {
    await scheduleReminders(updated);
    appEvents.emit("testRide.confirmed", { ...ref, note: updated.sellerNote });
  }
  if (input.action === "decline") {
    appEvents.emit("testRide.declined", {
      ...ref,
      reason: updated.declineReason ?? "",
    });
  }
  if (input.action === "cancel") {
    appEvents.emit("testRide.cancelled", {
      ...ref,
      cancelledById: requestUser.userId,
      reason: updated.cancelReason ?? "",
    });
  }
  if (input.action === "complete") appEvents.emit("testRide.completed", ref);
  if (input.action === "noShow") appEvents.emit("testRide.noShow", ref);

  return toTestRide(updated, requestUser.userId);
};

const confirmTestRide = (
  requestUser: RequestUser,
  id: string,
  payload: IConfirmTestRidePayload,
) => changeTestRide(requestUser, id, { action: "confirm", payload });

const declineTestRide = (
  requestUser: RequestUser,
  id: string,
  payload: IDeclineTestRidePayload,
) => changeTestRide(requestUser, id, { action: "decline", payload });

const cancelTestRide = (
  requestUser: RequestUser,
  id: string,
  payload: ICancelTestRidePayload,
) => changeTestRide(requestUser, id, { action: "cancel", payload });

const completeTestRide = (requestUser: RequestUser, id: string) =>
  changeTestRide(requestUser, id, { action: "complete" });

const markTestRideNoShow = (requestUser: RequestUser, id: string) =>
  changeTestRide(requestUser, id, { action: "noShow" });

// ============================================
// Reads
// ============================================

const getMyTestRides = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query);
  const now = new Date();
  const upcoming = query.upcoming === "true";
  const past = query.upcoming === "false";

  const andConditions: TestRideWhereInput[] = [
    query.as === "buyer"
      ? { buyerId: userId }
      : query.as === "seller"
        ? { sellerId: userId }
        : { OR: [{ buyerId: userId }, { sellerId: userId }] },
  ];

  if (query.status) andConditions.push({ status: query.status });

  if (upcoming) {
    andConditions.push({
      status: { in: ACTIVE_TEST_RIDE_STATUSES },
      endsAt: { gt: now },
    });
  }

  if (past) {
    andConditions.push({
      OR: [
        { endsAt: { lte: now } },
        { status: { notIn: ACTIVE_TEST_RIDE_STATUSES } },
      ],
    });
  }

  if (query.listingId) andConditions.push({ listingId: query.listingId });

  const search = queryBuilder.buildSearch(query.searchTerm, [
    "listing.title",
    "buyer.name",
    "seller.name",
  ]);

  if (search) andConditions.push(search as TestRideWhereInput);

  const where: TestRideWhereInput = { AND: andConditions };

  // upcoming: soonest first; everything else: newest first
  const orderBy = queryBuilder.buildSort(
    { ...query, sortOrder: query.sortOrder ?? (upcoming ? "asc" : "desc") },
    ["startsAt", "createdAt"],
    "startsAt",
  );

  const [rides, total] = await Promise.all([
    prisma.testRide.findMany({
      where,
      orderBy,
      take: limit,
      skip,
      include: testRideInclude,
    }),
    prisma.testRide.count({ where }),
  ]);

  return {
    data: rides.map((ride) => toTestRide(ride, userId)),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getTestRideById = async (userId: string, id: string) =>
  toTestRide(await findTestRideForUser(userId, id), userId);

// ============================================
// Jobs, cron and listing events
// ============================================

/*
 * "test-ride-expire" job and the hourly sweep: a request still REQUESTED
 * at its start time expires. Safe to run twice.
 */
const expireTestRide = async (id: string) => {
  const { count } = await prisma.testRide.updateMany({
    where: {
      id,
      status: TestRideStatus.REQUESTED,
      startsAt: { lte: new Date() },
    },
    data: { status: TestRideStatus.EXPIRED, closedAt: new Date() },
  });

  if (!count) return false;

  const ride = await prisma.testRide.findUniqueOrThrow({
    where: { id },
    include: testRideInclude,
  });

  await ChatService.postCardNotice({
    conversationId: ride.conversationId,
    testRideId: ride.id,
    body: testRideNoticeText("expired", ride.startsAt),
    unreadForUserId: ride.buyerId,
  });
  await emitTestRideUpdate([ride.id]);
  appEvents.emit("testRide.expired", toTestRideRef(ride));

  return true;
};

const expireDueTestRides = async () => {
  const due = await prisma.testRide.findMany({
    where: { status: TestRideStatus.REQUESTED, startsAt: { lte: new Date() } },
    orderBy: { startsAt: "asc" },
    take: TEST_RIDE_SWEEP_BATCH_LIMIT,
    select: { id: true },
  });

  let count = 0;

  for (const { id } of due) {
    if (await expireTestRide(id)) count += 1;
  }

  return count;
};

/*
 * "test-ride-reminder" job: only a ride that is still CONFIRMED and has not
 * started gets a reminder.
 */
const sendTestRideReminder = async (id: string, kind: TReminderKind) => {
  const ride = await prisma.testRide.findUnique({
    where: { id },
    include: testRideInclude,
  });

  if (
    !ride ||
    ride.status !== TestRideStatus.CONFIRMED ||
    ride.startsAt.getTime() <= Date.now()
  ) {
    return false;
  }

  appEvents.emit("testRide.reminder", { ...toTestRideRef(ride), kind });

  return true;
};

/*
 * The listing was sold, expired, rejected or removed: upcoming requested
 * and confirmed rides are cancelled by the system.
 */
const cancelActiveTestRidesForListing = async (
  listingId: string,
  reason: string,
) => {
  const active = await prisma.testRide.findMany({
    where: {
      listingId,
      status: { in: ACTIVE_TEST_RIDE_STATUSES },
      startsAt: { gt: new Date() },
    },
    select: { id: true },
  });

  let count = 0;

  for (const { id } of active) {
    const { count: changed } = await prisma.testRide.updateMany({
      where: { id, status: { in: ACTIVE_TEST_RIDE_STATUSES } },
      data: {
        status: TestRideStatus.CANCELLED,
        cancelReason: reason,
        cancelledById: null,
        cancelledAt: new Date(),
      },
    });

    if (!changed) continue;

    count += 1;

    const ride = await prisma.testRide.findUniqueOrThrow({
      where: { id },
      include: testRideInclude,
    });

    await ChatService.postCardNotice({
      conversationId: ride.conversationId,
      testRideId: ride.id,
      body: testRideNoticeText("cancelled", ride.startsAt, reason),
      unreadForUserId: null,
    });
    await emitTestRideUpdate([ride.id]);
    appEvents.emit("testRide.cancelled", {
      ...toTestRideRef(ride),
      cancelledById: null,
      reason,
    });
  }

  return count;
};

export const TestRideService = {
  getMyAvailability,
  replaceMyAvailability,
  addBlockedDate,
  deleteBlockedDate,
  getAvailableSlots,
  createTestRide,
  confirmTestRide,
  declineTestRide,
  cancelTestRide,
  completeTestRide,
  markTestRideNoShow,
  getMyTestRides,
  getTestRideById,
  expireTestRide,
  expireDueTestRides,
  sendTestRideReminder,
  cancelActiveTestRidesForListing,
};
