import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
  ListingStatus,
  SavedSearchAlertFrequency,
  SavedSearchMatchKind,
  UserStatus,
} from "../../../generated/prisma/enums";
import { config } from "../../config";
import { appEvents } from "../../events/appEvents";
import { isUuid } from "../../helper/isUuid";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { QUEUE_NAMES, enqueueJob } from "../../lib/queue";
import { redisClient } from "../../lib/redis";
import { AppError } from "../../utils/AppError";
import { listingCardInclude, toListingCard } from "../listing/listing.service";
import {
  listingMatchesFilters,
  resolveSearchFilters,
} from "../search/search.service";
import { IResolvedSearchFilters } from "../search/search.interface";
import { parseAttributes } from "../vehicleType/vehicleType.utils";
import {
  ICreateSavedSearchPayload,
  ISavedSearchLookups,
  ISavedSearchMatchJob,
  IUpdateSavedSearchPayload,
  TSavedSearchQuery,
} from "./savedSearch.interface";
import {
  buildSavedSearchName,
  buildSearchUrl,
  canonicalizeSearchQuery,
  collectLookupKeys,
  describeSearchQuery,
  hashSearchQuery,
  parseStoredQuery,
} from "./savedSearch.utils";

const DAY_SECONDS = 24 * 60 * 60;

// candidates are loaded and checked in batches of this size
const MATCH_BATCH_SIZE = 200;
const MATCH_CONCURRENCY = 10;

// matches shown on a saved search's page
const RECENT_MATCHES_LIMIT = 20;

type TSavedSearchRow = Prisma.SavedSearchGetPayload<object>;

// ============================================
// Shapes
// ============================================

const loadLookups = async (
  queries: TSavedSearchQuery[],
): Promise<ISavedSearchLookups> => {
  const keys = collectLookupKeys(queries);
  const bySlugOrId = (values: string[]) => ({
    OR: [{ slug: { in: values } }, { id: { in: values.filter(isUuid) } }],
  });

  const [vehicleTypes, brands, models] = await Promise.all([
    keys.vehicleTypes.length
      ? prisma.vehicleType.findMany({
          where: bySlugOrId(keys.vehicleTypes),
          select: { id: true, slug: true, name: true, attributes: true },
        })
      : [],
    keys.brands.length
      ? prisma.brand.findMany({
          where: bySlugOrId(keys.brands),
          select: { id: true, slug: true, name: true },
        })
      : [],
    keys.models.length
      ? prisma.vehicleModel.findMany({
          where: bySlugOrId(keys.models),
          select: { id: true, slug: true, name: true },
        })
      : [],
  ]);

  const typeEntries = vehicleTypes.flatMap((type) => {
    const value = {
      name: type.name,
      attributes: parseAttributes(type.attributes),
    };
    return [
      [type.slug, value],
      [type.id, value],
    ] as const;
  });

  return {
    vehicleTypes: new Map(typeEntries),
    brands: new Map(
      brands.flatMap((brand) => [
        [brand.slug, brand.name],
        [brand.id, brand.name],
      ]),
    ),
    models: new Map(
      models.flatMap((model) => [
        [model.slug, model.name],
        [model.id, model.name],
      ]),
    ),
  };
};

const toSavedSearch = (
  row: TSavedSearchRow,
  lookups: ISavedSearchLookups,
  counts?: { newMatches: number; totalMatches: number },
) => {
  const query = parseStoredQuery(row.query);

  return {
    id: row.id,
    name: row.name,
    query,
    summary: describeSearchQuery(query, lookups),
    searchUrl: buildSearchUrl(query),
    alertFrequency: row.alertFrequency,
    notifyPriceDrops: row.notifyPriceDrops,
    lastViewedAt: row.lastViewedAt,
    lastAlertedAt: row.lastAlertedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    newMatchesCount: counts?.newMatches ?? 0,
    totalMatchesCount: counts?.totalMatches ?? 0,
  };
};

/*
 * New (since last visit) and total matches per saved search,
 * counting only listings that are still live.
 */
const getMatchCounts = async (savedSearchIds: string[]) => {
  if (savedSearchIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    { savedSearchId: string; newMatches: number; totalMatches: number }[]
  >`
    SELECT
      m."savedSearchId",
      COUNT(*) FILTER (WHERE m."matchedAt" > s."lastViewedAt")::int AS "newMatches",
      COUNT(*)::int AS "totalMatches"
    FROM "saved_search_matches" m
    JOIN "saved_searches" s ON s."id" = m."savedSearchId"
    JOIN "listings" l ON l."id" = m."listingId"
    WHERE m."savedSearchId" = ANY(${savedSearchIds})
      AND l."status" = 'APPROVED'::"ListingStatus"
      AND l."isDeleted" = false
    GROUP BY m."savedSearchId"
  `;

  return new Map(
    rows.map((row) => [
      row.savedSearchId,
      { newMatches: row.newMatches, totalMatches: row.totalMatches },
    ]),
  );
};

const findOwnSavedSearchOrThrow = async (userId: string, id: string) => {
  const savedSearch = isUuid(id)
    ? await prisma.savedSearch.findFirst({ where: { id, userId } })
    : null;

  if (!savedSearch) {
    throw new AppError(httpStatus.NOT_FOUND, "Saved search not found");
  }

  return savedSearch;
};

/*
 * Canonical query + validation with the search page's own rules.
 */
const prepareQuery = async (raw: Record<string, unknown>) => {
  const query = canonicalizeSearchQuery(raw);

  if (Object.keys(query).length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Add at least one filter before saving a search",
    );
  }

  // throws 400 for invalid values (same messages as the search page)
  const { filters } = await resolveSearchFilters(query);

  if (!filters) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Some filters in this search no longer exist. Refresh the search and try again.",
    );
  }

  return { query, filters, queryHash: hashSearchQuery(query) };
};

// ============================================
// CRUD (owner)
// ============================================

const createSavedSearch = async (
  userId: string,
  payload: ICreateSavedSearchPayload,
) => {
  const { query, filters, queryHash } = await prepareQuery(payload.query);

  const [count, existing] = await Promise.all([
    prisma.savedSearch.count({ where: { userId } }),
    prisma.savedSearch.findUnique({
      where: { userId_queryHash: { userId, queryHash } },
      select: { id: true },
    }),
  ]);

  if (existing) {
    throw new AppError(httpStatus.CONFLICT, "You already saved this search");
  }

  if (count >= config.saved_search_max_per_user) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `You can keep up to ${config.saved_search_max_per_user} saved searches. Delete one to save a new search.`,
    );
  }

  const lookups = await loadLookups([query]);

  try {
    const created = await prisma.savedSearch.create({
      data: {
        userId,
        name:
          payload.name?.trim() ||
          buildSavedSearchName(describeSearchQuery(query, lookups)),
        query,
        queryHash,
        vehicleTypeId: filters.vehicleTypeId ?? null,
        alertFrequency:
          payload.alertFrequency ?? SavedSearchAlertFrequency.INSTANT,
        notifyPriceDrops: payload.notifyPriceDrops ?? true,
      },
    });

    return toSavedSearch(created, lookups);
  } catch (error) {
    // a parallel save of the same search
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(httpStatus.CONFLICT, "You already saved this search");
    }

    throw error;
  }
};

const getMySavedSearches = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const andConditions: Prisma.SavedSearchWhereInput[] = [{ userId }];

  if (query.searchTerm?.trim()) {
    andConditions.push({
      name: { contains: query.searchTerm.trim(), mode: "insensitive" },
    });
  }

  const where = { AND: andConditions };

  const [rows, total] = await Promise.all([
    prisma.savedSearch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    }),
    prisma.savedSearch.count({ where }),
  ]);

  const [lookups, counts] = await Promise.all([
    loadLookups(rows.map((row) => parseStoredQuery(row.query))),
    getMatchCounts(rows.map((row) => row.id)),
  ]);

  return {
    data: rows.map((row) => toSavedSearch(row, lookups, counts.get(row.id))),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

/*
 * GET /saved-searches/lookup?<search params> — is this exact search saved?
 */
const lookupSavedSearch = async (
  userId: string,
  rawQuery: Record<string, unknown>,
) => {
  const query = canonicalizeSearchQuery(rawQuery);

  if (Object.keys(query).length === 0) return { savedSearch: null };

  const savedSearch = await prisma.savedSearch.findUnique({
    where: {
      userId_queryHash: { userId, queryHash: hashSearchQuery(query) },
    },
    select: {
      id: true,
      name: true,
      alertFrequency: true,
      notifyPriceDrops: true,
    },
  });

  return { savedSearch };
};

const getSavedSearchById = async (userId: string, id: string) => {
  const savedSearch = await findOwnSavedSearchOrThrow(userId, id);

  const [lookups, counts, matches] = await Promise.all([
    loadLookups([parseStoredQuery(savedSearch.query)]),
    getMatchCounts([savedSearch.id]),
    prisma.savedSearchMatch.findMany({
      where: { savedSearchId: savedSearch.id, listing: { isDeleted: false } },
      orderBy: { matchedAt: "desc" },
      take: RECENT_MATCHES_LIMIT,
      include: { listing: { include: listingCardInclude } },
    }),
  ]);

  return {
    ...toSavedSearch(savedSearch, lookups, counts.get(savedSearch.id)),
    matches: matches.map((match) => ({
      id: match.id,
      kind: match.kind,
      oldPrice: match.oldPrice === null ? null : Number(match.oldPrice),
      newPrice: match.newPrice === null ? null : Number(match.newPrice),
      matchedAt: match.matchedAt,
      isNew: match.matchedAt > savedSearch.lastViewedAt,
      listing: toListingCard(match.listing),
    })),
  };
};

const updateSavedSearch = async (
  userId: string,
  id: string,
  payload: IUpdateSavedSearchPayload,
) => {
  await findOwnSavedSearchOrThrow(userId, id);

  const updated = await prisma.savedSearch.update({
    where: { id },
    data: {
      ...(payload.name !== undefined && { name: payload.name.trim() }),
      ...(payload.alertFrequency !== undefined && {
        alertFrequency: payload.alertFrequency,
      }),
      ...(payload.notifyPriceDrops !== undefined && {
        notifyPriceDrops: payload.notifyPriceDrops,
      }),
    },
  });

  const [lookups, counts] = await Promise.all([
    loadLookups([parseStoredQuery(updated.query)]),
    getMatchCounts([updated.id]),
  ]);

  return toSavedSearch(updated, lookups, counts.get(updated.id));
};

// clears the "new" badge
const markSavedSearchSeen = async (userId: string, id: string) => {
  await findOwnSavedSearchOrThrow(userId, id);

  const updated = await prisma.savedSearch.update({
    where: { id },
    data: { lastViewedAt: new Date() },
    select: { id: true, lastViewedAt: true },
  });

  return updated;
};

const deleteSavedSearch = async (userId: string, id: string) => {
  await findOwnSavedSearchOrThrow(userId, id);

  await prisma.savedSearch.delete({ where: { id } });

  return null;
};

// ============================================
// Alerts
// ============================================

/*
 * Called from the listing event handlers; matching runs in the worker.
 * While a job waits, the same event for the same listing + price is a no-op
 * (BullMQ ids cannot contain ":"). Finished jobs drop their id, so a later
 * re-approval after an edit is matched again; the unique match row still
 * prevents a second NEW_LISTING alert.
 */
const enqueueListingMatch = (job: ISavedSearchMatchJob) =>
  enqueueJob<ISavedSearchMatchJob>(
    QUEUE_NAMES.savedSearch,
    "match-listing",
    job,
    {
      jobId: `match-${job.listingId}-${job.kind}-${job.newPrice ?? "new"}`,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

/*
 * At most SAVED_SEARCH_INSTANT_MAX_PER_DAY instant alerts per saved search
 * per 24h. If Redis is down the match waits for the digest instead.
 */
const takeInstantSlot = async (savedSearchId: string) => {
  try {
    const key = `saved-search-instant:${savedSearchId}`;
    const used = await redisClient.incr(key);

    if (used === 1) await redisClient.expire(key, DAY_SECONDS);

    return used <= config.saved_search_instant_max_per_day;
  } catch (error) {
    console.error("Saved search instant counter failed:", error);
    return false;
  }
};

const runInChunks = async <T>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<void>,
) => {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(worker));
  }
};

/*
 * "match-listing" job: finds every saved search the listing now matches.
 *
 * Candidates: alerts on, same (or no) vehicle type, active owner who is not
 * the seller and has no block with the seller. Price drops also skip owners
 * who wishlisted the listing (they already get WISHLIST_PRICE_DROP) and
 * searches with price-drop alerts off.
 * Each candidate runs the exact search SQL restricted to this listing.
 */
const matchListing = async (job: ISavedSearchMatchJob) => {
  const listing = await prisma.listing.findFirst({
    where: {
      id: job.listingId,
      isDeleted: false,
      status: ListingStatus.APPROVED,
    },
    select: {
      id: true,
      title: true,
      slug: true,
      price: true,
      sellerId: true,
      vehicleTypeId: true,
    },
  });

  if (!listing) return 0;

  const isPriceDrop = job.kind === SavedSearchMatchKind.PRICE_DROP;

  const [blocks, wishlisters] = await Promise.all([
    prisma.userBlock.findMany({
      where: {
        OR: [{ blockerId: listing.sellerId }, { blockedId: listing.sellerId }],
      },
      select: { blockerId: true, blockedId: true },
    }),
    isPriceDrop
      ? prisma.wishlistItem.findMany({
          where: { listingId: listing.id },
          select: { userId: true },
        })
      : [],
  ]);

  const excludedUserIds = Array.from(
    new Set([
      listing.sellerId,
      ...blocks.map((block) =>
        block.blockerId === listing.sellerId
          ? block.blockedId
          : block.blockerId,
      ),
      ...wishlisters.map((item) => item.userId),
    ]),
  );

  const where: Prisma.SavedSearchWhereInput = {
    alertFrequency: { not: SavedSearchAlertFrequency.OFF },
    OR: [{ vehicleTypeId: null }, { vehicleTypeId: listing.vehicleTypeId }],
    userId: { notIn: excludedUserIds },
    user: { status: UserStatus.ACTIVE, isDeleted: false },
    ...(isPriceDrop && { notifyPriceDrops: true }),
  };

  const price = Number(listing.price);
  let matched = 0;
  let cursor: string | undefined;

  while (true) {
    const candidates = await prisma.savedSearch.findMany({
      where,
      orderBy: { id: "asc" },
      take: MATCH_BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });

    if (candidates.length === 0) break;

    cursor = candidates[candidates.length - 1].id;

    await runInChunks(candidates, MATCH_CONCURRENCY, async (savedSearch) => {
      let filters: IResolvedSearchFilters | null;

      try {
        ({ filters } = await resolveSearchFilters(
          parseStoredQuery(savedSearch.query),
        ));
      } catch {
        // the vehicle type schema changed and the saved filters are no longer valid
        return;
      }

      if (!filters || !(await listingMatchesFilters(filters, listing.id))) {
        return;
      }

      const isNewMatch = await recordMatch(savedSearch.id, job);

      if (!isNewMatch) return;

      matched += 1;

      if (
        savedSearch.alertFrequency === SavedSearchAlertFrequency.INSTANT &&
        (await takeInstantSlot(savedSearch.id))
      ) {
        const now = new Date();

        await prisma.$transaction([
          prisma.savedSearchMatch.update({
            where: {
              savedSearchId_listingId_kind: {
                savedSearchId: savedSearch.id,
                listingId: listing.id,
                kind: job.kind,
              },
            },
            data: { notifiedAt: now },
          }),
          prisma.savedSearch.update({
            where: { id: savedSearch.id },
            data: { lastAlertedAt: now },
          }),
        ]);

        appEvents.emit("savedSearch.matched", {
          savedSearchId: savedSearch.id,
          userId: savedSearch.userId,
          savedSearchName: savedSearch.name,
          kind: job.kind,
          listingId: listing.id,
          listingTitle: listing.title,
          listingSlug: listing.slug,
          price,
          oldPrice: job.oldPrice ?? null,
        });
      }
    });

    if (candidates.length < MATCH_BATCH_SIZE) break;
  }

  return matched;
};

/*
 * NEW_LISTING is recorded once (a re-approved listing never alerts twice).
 * PRICE_DROP is upserted: every further drop alerts again.
 * Returns false when nothing new should be announced.
 */
const recordMatch = async (
  savedSearchId: string,
  job: ISavedSearchMatchJob,
) => {
  const key = {
    savedSearchId_listingId_kind: {
      savedSearchId,
      listingId: job.listingId,
      kind: job.kind,
    },
  };

  if (job.kind === SavedSearchMatchKind.NEW_LISTING) {
    try {
      await prisma.savedSearchMatch.create({
        data: { savedSearchId, listingId: job.listingId, kind: job.kind },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return false;
      }
      throw error;
    }
  }

  const existing = await prisma.savedSearchMatch.findUnique({
    where: key,
    select: { newPrice: true },
  });

  // the same drop processed twice (job retry)
  if (
    existing &&
    existing.newPrice !== null &&
    Number(existing.newPrice) === job.newPrice
  ) {
    return false;
  }

  await prisma.savedSearchMatch.upsert({
    where: key,
    create: {
      savedSearchId,
      listingId: job.listingId,
      kind: job.kind,
      oldPrice: job.oldPrice ?? null,
      newPrice: job.newPrice ?? null,
    },
    update: {
      oldPrice: job.oldPrice ?? null,
      newPrice: job.newPrice ?? null,
      matchedAt: new Date(),
      notifiedAt: null,
    },
  });

  return true;
};

/*
 * Daily cron: one digest per saved search with matches that were not
 * announced yet (DAILY searches, plus INSTANT overflow). Listings that are
 * no longer live are marked as handled without being announced.
 */
const sendDailyDigests = async () => {
  const pending = await prisma.savedSearchMatch.findMany({
    where: {
      notifiedAt: null,
      savedSearch: {
        alertFrequency: { not: SavedSearchAlertFrequency.OFF },
        user: { status: UserStatus.ACTIVE, isDeleted: false },
      },
    },
    orderBy: { matchedAt: "desc" },
    select: {
      id: true,
      kind: true,
      savedSearchId: true,
      savedSearch: { select: { userId: true, name: true } },
      listing: { select: { title: true, status: true, isDeleted: true } },
    },
  });

  if (pending.length === 0) return 0;

  const groups = new Map<string, typeof pending>();

  for (const match of pending) {
    const group = groups.get(match.savedSearchId) ?? [];
    group.push(match);
    groups.set(match.savedSearchId, group);
  }

  const now = new Date();
  const announcedSearchIds: string[] = [];

  for (const [savedSearchId, matches] of groups) {
    const live = matches.filter(
      (match) =>
        match.listing.status === ListingStatus.APPROVED &&
        !match.listing.isDeleted,
    );

    if (live.length === 0) continue;

    announcedSearchIds.push(savedSearchId);

    appEvents.emit("savedSearch.digest", {
      savedSearchId,
      userId: live[0].savedSearch.userId,
      savedSearchName: live[0].savedSearch.name,
      newListings: live.filter(
        (match) => match.kind === SavedSearchMatchKind.NEW_LISTING,
      ).length,
      priceDrops: live.filter(
        (match) => match.kind === SavedSearchMatchKind.PRICE_DROP,
      ).length,
      sampleTitles: Array.from(
        new Set(live.map((match) => match.listing.title)),
      ).slice(0, 3),
    });
  }

  await prisma.$transaction([
    prisma.savedSearchMatch.updateMany({
      where: { id: { in: pending.map((match) => match.id) } },
      data: { notifiedAt: now },
    }),
    prisma.savedSearch.updateMany({
      where: { id: { in: announcedSearchIds } },
      data: { lastAlertedAt: now },
    }),
  ]);

  return announcedSearchIds.length;
};

export const SavedSearchService = {
  createSavedSearch,
  getMySavedSearches,
  lookupSavedSearch,
  getSavedSearchById,
  updateSavedSearch,
  markSavedSearchSeen,
  deleteSavedSearch,
  enqueueListingMatch,
  matchListing,
  sendDailyDigests,
};
