import crypto from "node:crypto";
import httpStatus from "http-status";
import { ListingStatus, Role } from "../../../generated/prisma/enums";
import { validateSpecs } from "../../helper/buildDynamicSpecSchema";
import { generateSlug } from "../../helper/generateSlug";
import { isValidLocation } from "../../helper/bdLocations";
import { AppError } from "../../utils/AppError";
import {
  IVehicleAttribute,
  TSpecs,
} from "../vehicleType/vehicleType.interface";
import { IUpdateListingPayload } from "./listing.interface";
import { LISTING_LIMITS } from "./listing.validation";

// ============================================
// Status flow
// ============================================

/*
 * DRAFT → PENDING → APPROVED → SOLD
 *            ↓  ↑        ↓ ↘ (cron) EXPIRED → APPROVED (renew)
 *         REJECTED ←─────┘ (moderator take-down)
 */
const ALLOWED_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  DRAFT: [ListingStatus.PENDING],
  PENDING: [ListingStatus.APPROVED, ListingStatus.REJECTED],
  APPROVED: [
    ListingStatus.SOLD,
    ListingStatus.EXPIRED,
    ListingStatus.PENDING,
    ListingStatus.REJECTED,
  ],
  REJECTED: [ListingStatus.PENDING],
  SOLD: [],
  EXPIRED: [ListingStatus.APPROVED],
};

export const canTransition = (from: ListingStatus, to: ListingStatus) =>
  ALLOWED_TRANSITIONS[from].includes(to);

export const assertTransition = (from: ListingStatus, to: ListingStatus) => {
  if (!canTransition(from, to)) {
    throw new AppError(
      httpStatus.CONFLICT,
      `A ${from.toLowerCase()} listing cannot become ${to.toLowerCase()}`,
    );
  }
};

export const EDITABLE_STATUSES: ListingStatus[] = [
  ListingStatus.DRAFT,
  ListingStatus.PENDING,
  ListingStatus.APPROVED,
  ListingStatus.REJECTED,
  ListingStatus.EXPIRED,
];

// public visitors only see these
export const PUBLIC_STATUSES: ListingStatus[] = [
  ListingStatus.APPROVED,
  ListingStatus.SOLD,
];

// ============================================
// Edit rules for approved listings
// ============================================

/*
 * Changing any of these on an APPROVED listing sends it back to PENDING.
 * Price, negotiable, description, video and color stay live.
 */
export const MAJOR_EDIT_FIELDS: (keyof IUpdateListingPayload)[] = [
  "vehicleTypeId",
  "brandId",
  "vehicleModelId",
  "year",
  "title",
  "mileage",
  "condition",
  "specs",
  "division",
  "district",
  "area",
  "latitude",
  "longitude",
];

const isSameValue = (current: unknown, next: unknown) =>
  JSON.stringify(current ?? null) === JSON.stringify(next ?? null);

export const isMajorEdit = (
  current: Record<string, unknown>,
  payload: IUpdateListingPayload,
) =>
  MAJOR_EDIT_FIELDS.some(
    (field) =>
      payload[field] !== undefined &&
      !isSameValue(current[field], payload[field]),
  );

// ============================================
// Ownership & staff
// ============================================

export const STAFF_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.MODERATOR,
];

export const isStaff = (role?: Role | null) =>
  Boolean(role && STAFF_ROLES.includes(role));

export const assertListingOwner = (
  listing: { sellerId: string },
  userId: string,
) => {
  if (listing.sellerId !== userId) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You can only manage your own listings",
    );
  }
};

// ============================================
// Slug & search text
// ============================================

export const generateListingSlug = (
  parts: (string | number | null | undefined)[],
) => {
  const base = generateSlug(parts.filter(Boolean).join(" ")).slice(0, 70);
  const suffix = crypto.randomBytes(3).toString("hex").slice(0, 4);

  return `${base}-${suffix}`;
};

export const formatSpecValue = (
  attribute: IVehicleAttribute,
  value: unknown,
): string | null => {
  if (value === undefined || value === null || value === "") return null;

  const optionLabel = (optionValue: string) =>
    attribute.options?.find((option) => option.value === optionValue)?.label ??
    optionValue;

  switch (attribute.type) {
    case "NUMBER":
      return attribute.unit ? `${value} ${attribute.unit}` : String(value);
    case "BOOLEAN":
      return value === true ? "Yes" : "No";
    case "SELECT":
      return optionLabel(String(value));
    case "MULTI_SELECT":
      return Array.isArray(value) && value.length > 0
        ? value.map((item) => optionLabel(String(item))).join(", ")
        : null;
    default:
      return String(value);
  }
};

/*
 * Everything a buyer might type: brand, model, title, year, location,
 * vehicle type and human-readable spec values ("Dual-channel", "Sports").
 */
export const buildSearchText = (input: {
  title: string;
  year: number;
  brandName: string;
  modelName?: string | null;
  vehicleTypeName: string;
  division: string;
  district: string;
  area?: string | null;
  color?: string | null;
  attributes: IVehicleAttribute[];
  specs: TSpecs;
}) => {
  const specText = input.attributes
    .filter(
      (attribute) =>
        attribute.type === "SELECT" || attribute.type === "MULTI_SELECT",
    )
    .map((attribute) => formatSpecValue(attribute, input.specs[attribute.key]))
    .filter(Boolean);

  return [
    input.brandName,
    input.modelName,
    input.title,
    input.year,
    input.vehicleTypeName,
    input.color,
    input.area,
    input.district,
    input.division,
    ...specText,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
};

export const getCardSpecs = (attributes: IVehicleAttribute[], specs: TSpecs) =>
  attributes
    .filter((attribute) => attribute.showInCard)
    .map((attribute) => ({
      key: attribute.key,
      label: attribute.label,
      value: formatSpecValue(attribute, specs[attribute.key]),
    }))
    .filter(
      (spec): spec is { key: string; label: string; value: string } =>
        spec.value !== null,
    );

// ============================================
// Submit checklist
// ============================================

type TSubmitCandidate = {
  title: string;
  price: unknown;
  year: number;
  mileage: number;
  division: string;
  district: string;
  specs: unknown;
};

/*
 * Every problem that blocks DRAFT/REJECTED → PENDING, as readable messages.
 */
export const getSubmitProblems = (
  listing: TSubmitCandidate,
  imageCount: number,
  attributes: IVehicleAttribute[],
) => {
  const problems: string[] = [];

  const title = listing.title.trim();

  if (title.length < LISTING_LIMITS.titleMin) {
    problems.push(
      `Title must be at least ${LISTING_LIMITS.titleMin} characters`,
    );
  }

  if (Number(listing.price) < LISTING_LIMITS.priceMin) {
    problems.push("Set a price");
  }

  if (!isValidLocation(listing.division, listing.district)) {
    problems.push("Choose a division and district");
  }

  if (imageCount < 1) {
    problems.push("Add at least one photo");
  }

  const specs = validateSpecs(attributes, listing.specs);

  if (!specs.success) {
    problems.push(specs.message);
  }

  return problems;
};

// ============================================
// Serialization (Decimal → number)
// ============================================

export const toNumber = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);
