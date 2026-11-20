import { z } from "zod";
import {
  IVehicleAttribute,
  TSpecs,
} from "../module/vehicleType/vehicleType.interface";

/*
 * Builds a runtime Zod schema from a vehicle type's attribute schema.
 * - unknown keys are rejected (strict)
 * - values are coerced from form strings ("150" → 150, "true" → true)
 * - empty values ("", null, []) count as "not provided"
 * - partial: true → required attributes may be missing (model default specs)
 *
 * Reused by listings (Phase 1 · Part 3) for Listing.specs.
 */

const isEmptyValue = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const withUnit = (value: number, unit?: string) =>
  unit ? `${value} ${unit}` : String(value);

const buildFieldSchema = (attribute: IVehicleAttribute): z.ZodType => {
  const { label } = attribute;

  switch (attribute.type) {
    case "NUMBER":
      return z
        .preprocess(
          (value) =>
            typeof value === "string" ? Number(value.trim()) : value,
          z.number({ message: `${label} must be a number` }),
        )
        .superRefine((value, ctx) => {
          if (!Number.isFinite(value)) {
            ctx.addIssue({ code: "custom", message: `${label} must be a number` });
            return;
          }

          if (attribute.min !== undefined && value < attribute.min) {
            ctx.addIssue({
              code: "custom",
              message: `${label} must be at least ${withUnit(attribute.min, attribute.unit)}`,
            });
          }

          if (attribute.max !== undefined && value > attribute.max) {
            ctx.addIssue({
              code: "custom",
              message: `${label} must be at most ${withUnit(attribute.max, attribute.unit)}`,
            });
          }
        });

    case "BOOLEAN":
      return z.preprocess(
        (value) => (value === "true" ? true : value === "false" ? false : value),
        z.boolean({ message: `${label} must be yes or no` }),
      );

    case "SELECT": {
      const allowed = (attribute.options ?? []).map((option) => option.value);

      return z
        .string({ message: `${label} must be one of the options` })
        .refine((value) => allowed.includes(value), {
          message: `${label} has an invalid option`,
        });
    }

    case "MULTI_SELECT": {
      const allowed = (attribute.options ?? []).map((option) => option.value);

      return z
        .array(z.string(), { message: `${label} must be a list of options` })
        .refine((values) => values.every((value) => allowed.includes(value)), {
          message: `${label} has an invalid option`,
        })
        .transform((values) => Array.from(new Set(values)));
    }

    default:
      return z
        .string({ message: `${label} must be text` })
        .trim()
        .max(200, `${label} must be at most 200 characters`);
  }
};

export const buildDynamicSpecSchema = (
  attributes: IVehicleAttribute[],
  options: { partial?: boolean } = {},
) => {
  const shape: Record<string, z.ZodType> = {};

  for (const attribute of attributes) {
    shape[attribute.key] = z.preprocess(
      (value) => (isEmptyValue(value) ? undefined : value),
      buildFieldSchema(attribute).optional(),
    );
  }

  const requiredAttributes = options.partial
    ? []
    : attributes.filter((attribute) => attribute.required);

  return z
    .strictObject(shape, {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `Unknown spec field(s): ${issue.keys.join(", ")}`
          : undefined,
    })
    .superRefine((specs, ctx) => {
      for (const attribute of requiredAttributes) {
        if ((specs as Record<string, unknown>)[attribute.key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [attribute.key],
            message: `${attribute.label} is required`,
          });
        }
      }
    })
    .transform(
      (specs) =>
        // drop empty optional values so stored JSON stays clean
        Object.fromEntries(
          Object.entries(specs).filter(([, value]) => value !== undefined),
        ) as TSpecs,
    );
};

/*
 * Validates specs and returns clean values, or one readable error message.
 */
export const validateSpecs = (
  attributes: IVehicleAttribute[],
  specs: unknown,
  options: { partial?: boolean } = {},
): { success: true; data: TSpecs } | { success: false; message: string } => {
  const result = buildDynamicSpecSchema(attributes, options).safeParse(
    specs ?? {},
  );

  if (!result.success) {
    return {
      success: false,
      message: result.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  return { success: true, data: result.data };
};
