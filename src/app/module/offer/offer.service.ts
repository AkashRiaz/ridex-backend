import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { MessageType, OfferStatus } from "../../../generated/prisma/enums";
import { OfferWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { appEvents } from "../../events/appEvents";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, enqueueJob } from "../../lib/queue";
import { emitToUser } from "../../lib/socket";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { consumeRateLimit } from "../../utils/redisRateLimit";
import { ChatService, offerCardSelect } from "../chat/chat.service";
import {
  ICounterOfferPayload,
  ICreateOfferPayload,
  IDeclineOfferPayload,
  IOfferExpireJob,
  IOfferRef,
} from "./offer.interface";
import {
  OFFER_LOCK_NAMESPACE,
  OFFER_RATE_LIMIT_PER_HOUR,
  OFFER_SWEEP_BATCH_LIMIT,
  TOfferAction,
  evaluateCounterAmount,
  evaluateMakeOffer,
  evaluateOfferAction,
  offerExpireJobId,
  offerExpiryDate,
  offerNoticeText,
  offerPreview,
  offerRateKey,
  offerRecipientId,
  offerSideOf,
} from "./offer.utils";

// ============================================
// Shapes
// ============================================

const offerInclude = {
  listing: {
    select: {
      id: true,
      title: true,
      slug: true,
      price: true,
      status: true,
      isNegotiable: true,
      isDeleted: true,
      images: { where: { isCover: true }, take: 1, select: { url: true } },
    },
  },
  buyer: { select: { id: true, name: true, imageUrl: true } },
  seller: { select: { id: true, name: true, imageUrl: true } },
} satisfies Prisma.OfferInclude;

type TOfferRow = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

const OFFER_ACTIONS: TOfferAction[] = [
  "counter",
  "accept",
  "decline",
  "withdraw",
];

/*
 * The offer as one participant sees it, with the actions they may take now.
 */
const toOffer = (offer: TOfferRow, userId: string) => ({
  id: offer.id,
  listingId: offer.listingId,
  conversationId: offer.conversationId,
  buyerId: offer.buyerId,
  sellerId: offer.sellerId,
  proposedById: offer.proposedById,
  amount: Number(offer.amount),
  message: offer.message,
  status: offer.status,
  parentOfferId: offer.parentOfferId,
  round: offer.round,
  expiresAt: offer.expiresAt,
  respondedAt: offer.respondedAt,
  declineReason: offer.declineReason,
  createdAt: offer.createdAt,
  updatedAt: offer.updatedAt,
  side: offerSideOf(offer, userId),
  isMine: offer.proposedById === userId,
  allowedActions: OFFER_ACTIONS.filter(
    (action) =>
      evaluateOfferAction({
        action,
        userId,
        offer,
        listing: offer.listing,
      }).allowed,
  ),
  listing: {
    id: offer.listing.id,
    title: offer.listing.title,
    slug: offer.listing.slug,
    price: Number(offer.listing.price),
    status: offer.listing.status,
    isDeleted: offer.listing.isDeleted,
    coverImage: offer.listing.images[0]?.url ?? null,
  },
  buyer: offer.buyer,
  seller: offer.seller,
});

const toOfferRef = (offer: TOfferRow): IOfferRef => ({
  offerId: offer.id,
  conversationId: offer.conversationId,
  listingId: offer.listingId,
  listingTitle: offer.listing.title,
  buyerId: offer.buyerId,
  sellerId: offer.sellerId,
  proposedById: offer.proposedById,
  amount: Number(offer.amount),
  status: offer.status,
  round: offer.round,
});

// ============================================
// Helpers
// ============================================

const RULE_STATUS: Record<string, number> = {
  LISTING_NOT_FOUND: httpStatus.NOT_FOUND,
  NOT_FOUND: httpStatus.NOT_FOUND,
  OWN_LISTING: httpStatus.BAD_REQUEST,
  NOT_NEGOTIABLE: httpStatus.BAD_REQUEST,
  AMOUNT_TOO_LOW: httpStatus.BAD_REQUEST,
  AMOUNT_TOO_HIGH: httpStatus.BAD_REQUEST,
  AMOUNT_OUT_OF_RANGE: httpStatus.BAD_REQUEST,
  NOT_ALLOWED: httpStatus.FORBIDDEN,
};

const throwRule = (result: { code: string; reason: string }): never => {
  throw new AppError(
    RULE_STATUS[result.code] ?? httpStatus.CONFLICT,
    result.reason,
  );
};

/*
 * Serializes every offer change inside one conversation
 * (make, counter, accept, decline, withdraw, expire).
 */
const lockConversation = (
  tx: Prisma.TransactionClient,
  conversationId: string,
) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(${OFFER_LOCK_NAMESPACE}::int, hashtext(${conversationId}::text))`;

const findOfferForUser = async (
  userId: string,
  id: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) => {
  const offer = await db.offer.findUnique({
    where: { id },
    include: offerInclude,
  });

  // same 404 for "missing" and "not yours"
  if (!offer || !offerSideOf(offer, userId)) {
    throw new AppError(httpStatus.NOT_FOUND, "Offer not found");
  }

  return offer;
};

/*
 * Moves one PENDING offer to its next status. Returns null when another
 * request changed it first (the caller answers 409).
 */
const closeOffer = async (
  tx: Prisma.TransactionClient,
  id: string,
  data: Prisma.OfferUpdateManyMutationInput,
  extraWhere: OfferWhereInput = {},
) => {
  const { count } = await tx.offer.updateMany({
    where: { id, status: OfferStatus.PENDING, ...extraWhere },
    data: { ...data, respondedAt: new Date() },
  });

  return count === 1
    ? tx.offer.findUniqueOrThrow({ where: { id }, include: offerInclude })
    : null;
};

const assertRate = async (userId: string) => {
  const allowed = await consumeRateLimit(
    offerRateKey(userId),
    OFFER_RATE_LIMIT_PER_HOUR,
    60 * 60,
  );

  if (!allowed) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "You have made too many offers. Please try again in an hour.",
    );
  }
};

// ============================================
// Side effects (AFTER commit)
// ============================================

const emitOfferUpdate = async (offerIds: string[]) => {
  const offers = await prisma.offer.findMany({
    where: { id: { in: offerIds } },
    select: {
      ...offerCardSelect,
      conversationId: true,
      buyerId: true,
      sellerId: true,
    },
  });

  for (const offer of offers) {
    const payload = {
      conversationId: offer.conversationId,
      offer: {
        id: offer.id,
        amount: Number(offer.amount),
        status: offer.status,
        proposedById: offer.proposedById,
        round: offer.round,
        parentOfferId: offer.parentOfferId,
        expiresAt: offer.expiresAt,
        respondedAt: offer.respondedAt,
      },
    };

    emitToUser(offer.buyerId, "offer:updated", payload);
    emitToUser(offer.sellerId, "offer:updated", payload);
  }
};

const scheduleExpiry = (offer: { id: string; expiresAt: Date }) =>
  enqueueJob<IOfferExpireJob>(
    QUEUE_NAMES.scheduled,
    "offer-expire",
    { offerId: offer.id },
    {
      ...DEFAULT_JOB_OPTIONS,
      jobId: offerExpireJobId(offer.id),
      delay: Math.max(offer.expiresAt.getTime() - Date.now(), 0),
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );

// the new card in chat, its expiry job and the live update
const announceNewOffer = async (offer: TOfferRow, changedIds: string[]) => {
  await ChatService.postCardMessage({
    type: MessageType.OFFER,
    conversationId: offer.conversationId,
    senderId: offer.proposedById,
    offerId: offer.id,
    body: offer.message,
    preview: offerPreview(Number(offer.amount)),
  });
  await scheduleExpiry(offer);
  await emitOfferUpdate(changedIds);
};

// ============================================
// Make & counter
// ============================================

const makeOffer = async (
  requestUser: RequestUser,
  payload: ICreateOfferPayload,
) => {
  const listing = await prisma.listing.findUnique({
    where: { id: payload.listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      isDeleted: true,
      isNegotiable: true,
      price: true,
    },
  });

  const listingState = listing
    ? { ...listing, price: Number(listing.price) }
    : null;

  // listing and amount checks first, so a bad offer never opens an empty thread
  const precheck = evaluateMakeOffer({
    userId: requestUser.userId,
    listing: listingState,
    amount: payload.amount,
    minPercent: config.offer_min_percent,
    hasOpenOffer: false,
    hasAcceptedOffer: false,
  });

  if (!precheck.allowed) throwRule(precheck);

  await assertRate(requestUser.userId);

  const { conversation } = await ChatService.findOrCreateConversation(
    requestUser,
    payload.listingId,
  );

  const offer = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, conversation.id);

    // one query: a transaction client must not run statements in parallel
    const blocking = await tx.offer.findMany({
      where: {
        conversationId: conversation.id,
        status: { in: [OfferStatus.PENDING, OfferStatus.ACCEPTED] },
      },
      select: { status: true },
    });

    const rule = evaluateMakeOffer({
      userId: requestUser.userId,
      listing: listingState,
      amount: payload.amount,
      minPercent: config.offer_min_percent,
      hasOpenOffer: blocking.some(
        (offer) => offer.status === OfferStatus.PENDING,
      ),
      hasAcceptedOffer: blocking.some(
        (offer) => offer.status === OfferStatus.ACCEPTED,
      ),
    });

    if (!rule.allowed) throwRule(rule);

    return tx.offer.create({
      data: {
        listingId: conversation.listingId,
        conversationId: conversation.id,
        buyerId: conversation.buyerId,
        sellerId: conversation.sellerId,
        proposedById: requestUser.userId,
        amount: payload.amount,
        message: payload.message ?? "",
        expiresAt: offerExpiryDate(config.offer_expiry_hours),
      },
      include: offerInclude,
    });
  });

  // Side effects AFTER commit
  await announceNewOffer(offer, [offer.id]);
  appEvents.emit("offer.created", toOfferRef(offer));

  return toOffer(offer, requestUser.userId);
};

const counterOffer = async (
  requestUser: RequestUser,
  id: string,
  payload: ICounterOfferPayload,
) => {
  const current = await findOfferForUser(requestUser.userId, id);

  await ChatService.assertCanReplyInConversation(
    requestUser.userId,
    current.conversationId,
  );

  const { countered, created } = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, current.conversationId);

    const offer = await findOfferForUser(requestUser.userId, id, tx);

    const rule = evaluateOfferAction({
      action: "counter",
      userId: requestUser.userId,
      offer,
      listing: offer.listing,
    });

    if (!rule.allowed) throwRule(rule);

    // offers alternate, so the parent is the counterer's own last proposal
    const previousOwn = offer.parentOfferId
      ? await tx.offer.findUnique({
          where: { id: offer.parentOfferId },
          select: { amount: true, proposedById: true },
        })
      : null;

    const amountRule = evaluateCounterAmount({
      counterSide: offerSideOf(offer, requestUser.userId) as "buyer" | "seller",
      amount: payload.amount,
      counteredAmount: Number(offer.amount),
      previousOwnAmount:
        previousOwn && previousOwn.proposedById === requestUser.userId
          ? Number(previousOwn.amount)
          : null,
      listingPrice: Number(offer.listing.price),
      minPercent: config.offer_min_percent,
      nextRound: offer.round + 1,
      maxRounds: config.offer_max_rounds,
    });

    if (!amountRule.allowed) throwRule(amountRule);

    const closed = await closeOffer(tx, offer.id, {
      status: OfferStatus.COUNTERED,
    });

    if (!closed) {
      throw new AppError(httpStatus.CONFLICT, "This offer was just updated");
    }

    const next = await tx.offer.create({
      data: {
        listingId: offer.listingId,
        conversationId: offer.conversationId,
        buyerId: offer.buyerId,
        sellerId: offer.sellerId,
        proposedById: requestUser.userId,
        amount: payload.amount,
        message: payload.message ?? "",
        parentOfferId: offer.id,
        round: offer.round + 1,
        expiresAt: offerExpiryDate(config.offer_expiry_hours),
      },
      include: offerInclude,
    });

    return { countered: closed, created: next };
  });

  // Side effects AFTER commit
  await announceNewOffer(created, [countered.id, created.id]);
  appEvents.emit("offer.countered", {
    ...toOfferRef(created),
    counteredOfferId: countered.id,
  });

  return toOffer(created, requestUser.userId);
};

// ============================================
// Accept, decline, withdraw
// ============================================

const respondToOffer = async (
  requestUser: RequestUser,
  id: string,
  action: "accept" | "decline" | "withdraw",
  reason?: string,
) => {
  const current = await findOfferForUser(requestUser.userId, id);

  if (action === "accept") {
    await ChatService.assertCanReplyInConversation(
      requestUser.userId,
      current.conversationId,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await lockConversation(tx, current.conversationId);

    const offer = await findOfferForUser(requestUser.userId, id, tx);

    const rule = evaluateOfferAction({
      action,
      userId: requestUser.userId,
      offer,
      listing: offer.listing,
    });

    if (!rule.allowed) throwRule(rule);

    const closed = await closeOffer(
      tx,
      offer.id,
      action === "accept"
        ? { status: OfferStatus.ACCEPTED }
        : action === "decline"
          ? { status: OfferStatus.DECLINED, declineReason: reason || null }
          : { status: OfferStatus.WITHDRAWN },
      // accept and decline are only valid before expiry (checked again under the lock)
      action === "withdraw" ? {} : { expiresAt: { gt: new Date() } },
    );

    if (!closed) {
      throw new AppError(httpStatus.CONFLICT, "This offer was just updated");
    }

    return closed;
  });

  // Side effects AFTER commit
  const amount = Number(updated.amount);

  await ChatService.postCardNotice({
    conversationId: updated.conversationId,
    offerId: updated.id,
    body:
      action === "accept"
        ? offerNoticeText("accepted", amount)
        : action === "decline"
          ? offerNoticeText("declined", amount, updated.declineReason)
          : offerNoticeText("withdrawn", amount),
    // the other participant should notice it
    unreadForUserId:
      action === "withdraw" ? offerRecipientId(updated) : updated.proposedById,
  });
  await emitOfferUpdate([updated.id]);

  const ref = toOfferRef(updated);

  if (action === "accept") appEvents.emit("offer.accepted", ref);
  if (action === "decline")
    appEvents.emit("offer.declined", {
      ...ref,
      reason: updated.declineReason,
    });
  if (action === "withdraw") appEvents.emit("offer.withdrawn", ref);

  return toOffer(updated, requestUser.userId);
};

const acceptOffer = (requestUser: RequestUser, id: string) =>
  respondToOffer(requestUser, id, "accept");

const declineOffer = (
  requestUser: RequestUser,
  id: string,
  payload: IDeclineOfferPayload,
) => respondToOffer(requestUser, id, "decline", payload.reason);

const withdrawOffer = (requestUser: RequestUser, id: string) =>
  respondToOffer(requestUser, id, "withdraw");

// ============================================
// Reads
// ============================================

const getMyOffers = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query);
  const orderBy = queryBuilder.buildSort(query, [
    "createdAt",
    "amount",
    "expiresAt",
  ]);

  const andConditions: OfferWhereInput[] = [
    query.as === "buyer"
      ? { buyerId: userId }
      : query.as === "seller"
        ? { sellerId: userId }
        : { OR: [{ buyerId: userId }, { sellerId: userId }] },
  ];

  if (query.status) {
    andConditions.push({ status: query.status });
  } else {
    // a countered offer lives on in its counter: show the latest of each chain
    andConditions.push({ status: { not: OfferStatus.COUNTERED } });
  }

  if (query.listingId) andConditions.push({ listingId: query.listingId });

  if (query.conversationId) {
    andConditions.push({ conversationId: query.conversationId });
  }

  const search = queryBuilder.buildSearch(query.searchTerm, [
    "listing.title",
    "buyer.name",
    "seller.name",
  ]);

  if (search) andConditions.push(search as OfferWhereInput);

  const where: OfferWhereInput = { AND: andConditions };

  const [offers, total] = await Promise.all([
    prisma.offer.findMany({
      where,
      orderBy,
      take: limit,
      skip,
      include: offerInclude,
    }),
    prisma.offer.count({ where }),
  ]);

  return {
    data: offers.map((offer) => toOffer(offer, userId)),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

/*
 * One offer plus every offer in the same conversation (oldest first),
 * so the whole negotiation can be shown.
 */
const getOfferById = async (userId: string, id: string) => {
  const offer = await findOfferForUser(userId, id);

  const history = await prisma.offer.findMany({
    where: { conversationId: offer.conversationId },
    orderBy: { createdAt: "asc" },
    include: offerInclude,
  });

  return {
    ...toOffer(offer, userId),
    history: history.map((item) => toOffer(item, userId)),
  };
};

// ============================================
// Expiry & cancellation (jobs, cron, events)
// ============================================

/*
 * Called by the "offer-expire" job and the hourly sweep. Safe to run twice:
 * only a PENDING offer past expiresAt changes.
 */
const expireOffer = async (offerId: string) => {
  const expired = await prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({
      where: { id: offerId },
      select: { conversationId: true },
    });

    if (!offer) return null;

    await lockConversation(tx, offer.conversationId);

    return closeOffer(
      tx,
      offerId,
      { status: OfferStatus.EXPIRED },
      { expiresAt: { lte: new Date() } },
    );
  });

  if (!expired) return false;

  await ChatService.postCardNotice({
    conversationId: expired.conversationId,
    offerId: expired.id,
    body: offerNoticeText("expired", Number(expired.amount)),
    unreadForUserId: expired.proposedById,
  });
  await emitOfferUpdate([expired.id]);
  appEvents.emit("offer.expired", toOfferRef(expired));

  return true;
};

// safety net for jobs Redis may have lost
const expireDueOffers = async () => {
  const due = await prisma.offer.findMany({
    where: { status: OfferStatus.PENDING, expiresAt: { lte: new Date() } },
    orderBy: { expiresAt: "asc" },
    take: OFFER_SWEEP_BATCH_LIMIT,
    select: { id: true },
  });

  let count = 0;

  for (const { id } of due) {
    if (await expireOffer(id)) count += 1;
  }

  return count;
};

/*
 * The listing was sold, expired, rejected or removed: every open offer
 * on it closes. Returns how many were cancelled.
 */
const cancelOpenOffersForListing = async (
  listingId: string,
  reason: string,
) => {
  const open = await prisma.offer.findMany({
    where: { listingId, status: OfferStatus.PENDING },
    select: { id: true },
  });

  let count = 0;

  for (const { id } of open) {
    const cancelled = await prisma.$transaction((tx) =>
      closeOffer(tx, id, { status: OfferStatus.CANCELLED }),
    );

    if (!cancelled) continue;

    count += 1;

    await ChatService.postCardNotice({
      conversationId: cancelled.conversationId,
      offerId: cancelled.id,
      body: offerNoticeText("cancelled", Number(cancelled.amount), reason),
      unreadForUserId: null,
    });
    await emitOfferUpdate([cancelled.id]);
    appEvents.emit("offer.cancelled", { ...toOfferRef(cancelled), reason });
  }

  return count;
};

/*
 * Buyers with an open offer on the listing in OTHER conversations,
 * told after the seller accepted someone else's offer.
 */
const getOtherOpenOfferBuyerIds = async (
  listingId: string,
  conversationId: string,
) => {
  const offers = await prisma.offer.findMany({
    where: {
      listingId,
      status: OfferStatus.PENDING,
      conversationId: { not: conversationId },
    },
    distinct: ["buyerId"],
    select: { buyerId: true },
  });

  return offers.map((offer) => offer.buyerId);
};

export const OfferService = {
  makeOffer,
  counterOffer,
  acceptOffer,
  declineOffer,
  withdrawOffer,
  getMyOffers,
  getOfferById,
  expireOffer,
  expireDueOffers,
  cancelOpenOffersForListing,
  getOtherOpenOfferBuyerIds,
};
