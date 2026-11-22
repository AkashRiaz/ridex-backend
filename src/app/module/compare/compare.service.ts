import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { listingCardInclude, toListingCard } from "../listing/listing.service";
import { PUBLIC_STATUSES } from "../listing/listing.utils";
import { getPriceInsightForRow } from "../priceInsight/priceInsight.service";
import { parseAttributes } from "../vehicleType/vehicleType.utils";
import { TSpecs } from "../vehicleType/vehicleType.interface";
import {
  buildCompareHighlights,
  buildCompareSpecRows,
  orderByRequestedIds,
} from "./compare.utils";
import { CompareListingsQueryZodSchema } from "./compare.validation";

/*
 * GET /compare?ids=a,b,c,d
 * Live and sold listings only. Ids that are gone (deleted, expired, hidden)
 * come back in `missingIds` instead of failing, because the compare list
 * lives in the browser and goes stale.
 */
const compareListings = async (rawQuery: Record<string, unknown>) => {
  const parsed = CompareListingsQueryZodSchema.safeParse(rawQuery);

  if (!parsed.success) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      parsed.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  const { ids } = parsed.data;

  const rows = await prisma.listing.findMany({
    where: {
      id: { in: ids },
      isDeleted: false,
      status: { in: PUBLIC_STATUSES },
    },
    include: listingCardInclude,
  });

  const { ordered, missingIds } = orderByRequestedIds(ids, rows);

  const vehicleTypeIds = new Set(ordered.map((row) => row.vehicleTypeId));

  if (vehicleTypeIds.size > 1) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You can only compare listings of the same vehicle type",
    );
  }

  const insights = await Promise.all(
    ordered.map((row) => getPriceInsightForRow(row)),
  );

  const listings = ordered.map((row, index) => ({
    ...toListingCard(row),
    description: row.description,
    color: row.color,
    priceInsight: insights[index],
  }));

  const vehicleType = ordered[0]?.vehicleType ?? null;

  return {
    vehicleType: vehicleType
      ? { id: vehicleType.id, name: vehicleType.name, slug: vehicleType.slug }
      : null,
    listings,
    specRows: vehicleType
      ? buildCompareSpecRows(
          parseAttributes(vehicleType.attributes),
          ordered.map((row) => row.specs as TSpecs),
        )
      : [],
    highlights: buildCompareHighlights(listings),
    missingIds,
  };
};

export const CompareService = {
  compareListings,
};
