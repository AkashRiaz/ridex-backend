import crypto from "node:crypto";
import { Role } from "../../../generated/prisma/enums";
import { formatPrice } from "../../helper/formatPrice";
import {
  ISavedSearchChip,
  ISavedSearchLookups,
  TSavedSearchQuery,
} from "./savedSearch.interface";

// the roles with a "Saved Searches" dashboard page (same as the chat roles)
export const SAVED_SEARCH_ROLES: Role[] = [
  Role.BUYER,
  Role.SELLER,
  Role.DEALER,
  Role.DEALER_STAFF,
  Role.INSPECTOR,
];

export const SAVED_SEARCH_NAME_MAX = 80;

// search params a saved search keeps (paging and sorting are not part of a search)
export const SAVED_SEARCH_QUERY_KEYS = [
  "searchTerm",
  "vehicleType",
  "brand",
  "model",
  "minPrice",
  "maxPrice",
  "minYear",
  "maxYear",
  "maxMileage",
  "condition",
  "negotiable",
  "division",
  "district",
  "lat",
  "lng",
  "radius",
] as const;

const LIST_KEYS = ["brand", "model", "condition"];

const isSpecKey = (key: string) => key.startsWith("spec.");

// spec.<key>.min / spec.<key>.max are numbers, other spec params are option lists
const isSpecRangeKey = (key: string) => /^spec\.[^.]+\.(min|max)$/.test(key);

const normalizeList = (value: string) =>
  Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
    .sort()
    .join(",");

/*
 * One stable form per search, so "brand=yamaha,honda&maxPrice=300000" and
 * "maxPrice=300000&brand=honda,yamaha" are the same saved search.
 * Unknown keys and empty values are dropped; lists are de-duplicated and sorted;
 * "near me" coordinates are rounded to ~100 m.
 */
export const canonicalizeSearchQuery = (
  raw: Record<string, unknown>,
): TSavedSearchQuery => {
  const entries: [string, string][] = [];

  for (const [key, rawValue] of Object.entries(raw)) {
    const allowed =
      (SAVED_SEARCH_QUERY_KEYS as readonly string[]).includes(key) ||
      isSpecKey(key);

    if (!allowed) continue;

    const first = Array.isArray(rawValue) ? rawValue[0] : rawValue;

    if (first === undefined || first === null) continue;

    let value = String(first).trim();

    if (value === "") continue;

    if (key === "searchTerm") {
      // search is case-insensitive
      value = value.toLowerCase().replace(/\s+/g, " ");
    } else if (key === "lat" || key === "lng") {
      const number = Number(value);
      value = Number.isFinite(number) ? number.toFixed(3) : value;
    } else if (
      LIST_KEYS.includes(key) ||
      (isSpecKey(key) && !isSpecRangeKey(key))
    ) {
      value = normalizeList(value);
    }

    if (value !== "") entries.push([key, value]);
  }

  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
};

export const hashSearchQuery = (query: TSavedSearchQuery) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(Object.entries(query)))
    .digest("hex");

// ============================================
// Readable summary
// ============================================

const CONDITION_LABEL: Record<string, string> = {
  NEW: "New",
  USED: "Used",
  RECONDITIONED: "Reconditioned",
};

const names = (value: string, lookup: Map<string, string>) =>
  value
    .split(",")
    .map((item) => lookup.get(item) ?? item)
    .join(", ");

const range = (
  min: string | undefined,
  max: string | undefined,
  format: (value: string) => string,
  words: { from: string; upTo: string },
) => {
  if (min && max) return `${format(min)}–${format(max)}`;
  if (min) return `${words.from} ${format(min)}`;
  if (max) return `${words.upTo} ${format(max)}`;
  return null;
};

/*
 * Filter chips in a fixed, readable order. Unknown slugs are shown as-is.
 */
export const describeSearchQuery = (
  query: TSavedSearchQuery,
  lookups: ISavedSearchLookups,
): ISavedSearchChip[] => {
  const chips: ISavedSearchChip[] = [];
  const push = (key: string, label: string | null) => {
    if (label) chips.push({ key, label });
  };

  const vehicleType = query.vehicleType
    ? lookups.vehicleTypes.get(query.vehicleType)
    : undefined;

  if (query.searchTerm) push("searchTerm", `“${query.searchTerm}”`);
  if (query.brand) push("brand", names(query.brand, lookups.brands));
  if (query.model) push("model", names(query.model, lookups.models));
  // the type adds nothing once a brand or model is chosen
  if (query.vehicleType && !query.brand && !query.model) {
    push("vehicleType", vehicleType?.name ?? query.vehicleType);
  }

  push(
    "price",
    range(query.minPrice, query.maxPrice, (value) => formatPrice(value), {
      from: "From",
      upTo: "Under",
    }),
  );

  push(
    "year",
    query.minYear && !query.maxYear
      ? `${query.minYear} or newer`
      : query.maxYear && !query.minYear
        ? `${query.maxYear} or older`
        : range(query.minYear, query.maxYear, (value) => value, {
            from: "",
            upTo: "",
          }),
  );

  if (query.maxMileage) {
    push(
      "maxMileage",
      `Up to ${Number(query.maxMileage).toLocaleString("en-US")} km`,
    );
  }

  if (query.condition) {
    push(
      "condition",
      query.condition
        .split(",")
        .map((item) => CONDITION_LABEL[item] ?? item)
        .join(", "),
    );
  }

  if (query.negotiable) {
    push(
      "negotiable",
      query.negotiable === "true" ? "Negotiable" : "Fixed price",
    );
  }

  push("location", query.district ?? query.division ?? null);

  if (query.lat && query.lng) {
    push("near", `Within ${query.radius ?? 25} km`);
  }

  // spec filters: ranges are combined into one chip per attribute
  const specKeys = Array.from(
    new Set(
      Object.keys(query)
        .filter(isSpecKey)
        .map((key) => key.split(".")[1]),
    ),
  );

  for (const specKey of specKeys) {
    const attribute = vehicleType?.attributes.find(
      (item) => item.key === specKey,
    );
    const label = attribute?.label ?? specKey;
    const unit = attribute?.unit ? ` ${attribute.unit}` : "";
    const min = query[`spec.${specKey}.min`];
    const max = query[`spec.${specKey}.max`];

    if (min || max) {
      push(
        `spec.${specKey}`,
        `${label}: ${range(min, max, (value) => value, { from: "from", upTo: "up to" })}${unit}`,
      );
      continue;
    }

    const value = query[`spec.${specKey}`];

    if (!value) continue;

    if (attribute?.type === "BOOLEAN") {
      push(`spec.${specKey}`, `${label}: ${value === "true" ? "Yes" : "No"}`);
      continue;
    }

    const optionLabel = (optionValue: string) =>
      attribute?.options?.find((option) => option.value === optionValue)
        ?.label ?? optionValue;

    push(
      `spec.${specKey}`,
      `${label}: ${value.split(",").map(optionLabel).join(", ")}`,
    );
  }

  return chips;
};

/*
 * Default name from the first three chips: "Yamaha · Under BDT 5,00,000 · Dhaka".
 */
export const buildSavedSearchName = (chips: ISavedSearchChip[]) => {
  const name = chips
    .slice(0, 3)
    .map((chip) => chip.label)
    .join(" · ");

  if (!name) return "My search";

  return name.length > SAVED_SEARCH_NAME_MAX
    ? `${name.slice(0, SAVED_SEARCH_NAME_MAX - 1).trimEnd()}…`
    : name;
};

// frontend results page for a saved search (newest first)
export const buildSearchUrl = (query: TSavedSearchQuery) =>
  `/listings?${new URLSearchParams({ ...query, sortBy: "newest" }).toString()}`;

// every slug or id the lookups need, collected across many saved queries
export const collectLookupKeys = (queries: TSavedSearchQuery[]) => {
  const split = (value?: string) => (value ? value.split(",") : []);

  return {
    vehicleTypes: Array.from(
      new Set(queries.flatMap((query) => split(query.vehicleType))),
    ),
    brands: Array.from(new Set(queries.flatMap((query) => split(query.brand)))),
    models: Array.from(new Set(queries.flatMap((query) => split(query.model)))),
  };
};

/*
 * The stored JSON is always an object of strings (written by this module),
 * but guard against hand-edited rows.
 */
export const parseStoredQuery = (value: unknown): TSavedSearchQuery =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
