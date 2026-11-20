import { IQuery } from "../interfaces";

/*
 * Small helpers that produce exactly the hand-written list pattern
 * from the reference project (see CONVENTIONS.md §A5).
 * Services still assemble their own `andConditions` and call
 * prisma.x.findMany / prisma.x.count themselves.
 */

export type TMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const buildPagination = (query: IQuery, defaultLimit = DEFAULT_LIMIT) => {
  const parsedLimit = query.limit ? parseInt(query.limit, 10) : defaultLimit;
  const parsedPage = query.page ? parseInt(query.page, 10) : 1;

  const limit = Math.min(
    Math.max(Number.isNaN(parsedLimit) ? defaultLimit : parsedLimit, 1),
    MAX_LIMIT,
  );
  const page = Math.max(Number.isNaN(parsedPage) ? 1 : parsedPage, 1);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const buildSort = (
  query: IQuery,
  allowedSortFields: string[],
  defaultSortBy = "createdAt",
) => {
  const sortBy = allowedSortFields.includes(query.sortBy || "")
    ? (query.sortBy as string)
    : defaultSortBy;

  const sortOrder: "asc" | "desc" = query.sortOrder === "asc" ? "asc" : "desc";

  return { [sortBy]: sortOrder };
};

/*
 * buildSearch(query.searchTerm, ["title", "description"])
 * → { OR: [{ title: { contains, mode: "insensitive" } }, ...] }
 * Nested paths are supported with dots: "brand.name".
 */
const buildSearch = (searchTerm: string | undefined, fields: string[]) => {
  if (!searchTerm?.trim()) return null;

  const term = searchTerm.trim();

  return {
    OR: fields.map((field) =>
      field
        .split(".")
        .reverse()
        .reduce<Record<string, unknown>>(
          (acc, key) => ({ [key]: acc }),
          { contains: term, mode: "insensitive" },
        ),
    ),
  };
};

/*
 * Pick only the selected scalar fields: ?fields=title,price
 */
const buildSelect = (query: IQuery, allowedFields: string[]) => {
  if (!query.fields) return undefined;

  const selected = String(query.fields)
    .split(",")
    .map((field) => field.trim())
    .filter((field) => allowedFields.includes(field));

  if (!selected.length) return undefined;

  return Object.fromEntries(
    ["id", ...selected].map((field) => [field, true as const]),
  );
};

const buildMeta = (page: number, limit: number, total: number): TMeta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

export const queryBuilder = {
  buildPagination,
  buildSort,
  buildSearch,
  buildSelect,
  buildMeta,
};
