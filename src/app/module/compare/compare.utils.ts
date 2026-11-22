import { formatSpecValue } from "../listing/listing.utils";
import {
  IVehicleAttribute,
  TSpecs,
} from "../vehicleType/vehicleType.interface";
import {
  ICompareCandidate,
  ICompareHighlights,
  ICompareSpecRow,
} from "./compare.interface";

export const MAX_COMPARE_LISTINGS = 4;

/*
 * Ids of every candidate holding the best value (ties share the highlight).
 */
const bestBy = (
  candidates: ICompareCandidate[],
  value: (candidate: ICompareCandidate) => number | null,
  direction: "min" | "max",
) => {
  const scored = candidates
    .map((candidate) => ({ id: candidate.id, value: value(candidate) }))
    .filter((item): item is { id: string; value: number } =>
      Number.isFinite(item.value),
    );

  // a highlight needs something to beat
  if (scored.length < 2) return [];

  const best =
    direction === "min"
      ? Math.min(...scored.map((item) => item.value))
      : Math.max(...scored.map((item) => item.value));

  // nothing stands out when everyone is equal
  if (scored.every((item) => item.value === best)) return [];

  return scored.filter((item) => item.value === best).map((item) => item.id);
};

export const buildCompareHighlights = (
  candidates: ICompareCandidate[],
): ICompareHighlights => ({
  lowestPrice: bestBy(candidates, (item) => item.price, "min"),
  lowestMileage: bestBy(candidates, (item) => item.mileage, "min"),
  newestYear: bestBy(candidates, (item) => item.year, "max"),
  bestDeal: bestBy(
    candidates,
    (item) =>
      item.priceInsight && item.priceInsight.rating !== "INSUFFICIENT_DATA"
        ? item.priceInsight.diffPercent
        : null,
    "min",
  ),
});

/*
 * One row per attribute of the vehicle type, in schema order.
 * Attributes no listing has a value for are left out.
 */
export const buildCompareSpecRows = (
  attributes: IVehicleAttribute[],
  specsByColumn: TSpecs[],
): ICompareSpecRow[] =>
  [...attributes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((attribute) => {
      const values = specsByColumn.map((specs) =>
        formatSpecValue(attribute, specs[attribute.key]),
      );

      return {
        key: attribute.key,
        label: attribute.label,
        group: attribute.group,
        type: attribute.type,
        unit: attribute.unit ?? null,
        values,
        isDifferent: new Set(values).size > 1,
      };
    })
    .filter((row) => row.values.some((value) => value !== null));

/*
 * Keeps the order the ids were requested in; unknown ids are reported back.
 */
export const orderByRequestedIds = <T extends { id: string }>(
  ids: string[],
  rows: T[],
) => {
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    ordered: ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    }),
    missingIds: ids.filter((id) => !byId.has(id)),
  };
};
