import { z } from "zod";
import { ATTRIBUTE_TYPES } from "./vehicleType.interface";

const OPTION_TYPES = ["SELECT", "MULTI_SELECT"];

const AttributeOptionZodSchema = z.object({
  value: z
    .string({ message: "Option value is required" })
    .trim()
    .min(1, "Option value is required")
    .max(60, "Option value must be at most 60 characters")
    .regex(
      /^[a-z0-9][a-z0-9_-]*$/,
      "Option value must use lowercase letters, numbers, - or _",
    ),
  label: z
    .string({ message: "Option label is required" })
    .trim()
    .min(1, "Option label is required")
    .max(60, "Option label must be at most 60 characters"),
});

export const VehicleAttributeZodSchema = z
  .object({
    key: z
      .string({ message: "Attribute key is required" })
      .trim()
      .regex(
        /^[a-z][a-zA-Z0-9]{1,39}$/,
        "Attribute key must be camelCase (letters and numbers, starting with a lowercase letter)",
      ),
    label: z
      .string({ message: "Attribute label is required" })
      .trim()
      .min(1, "Attribute label is required")
      .max(60, "Attribute label must be at most 60 characters"),
    type: z.enum(ATTRIBUTE_TYPES, { message: "Invalid attribute type" }),
    unit: z
      .string()
      .trim()
      .max(20, "Unit must be at most 20 characters")
      .optional(),
    options: z
      .array(AttributeOptionZodSchema)
      .max(50, "At most 50 options")
      .optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive("Step must be positive").optional(),
    required: z.boolean().default(false),
    filterable: z.boolean().default(false),
    showInCard: z.boolean().default(false),
    group: z
      .string()
      .trim()
      .max(40, "Group must be at most 40 characters")
      .default("General")
      .transform((value) => value || "General"),
    sortOrder: z.number().int().default(0),
    placeholder: z.string().trim().max(80).optional(),
    helpText: z.string().trim().max(200).optional(),
  })
  .superRefine((attribute, ctx) => {
    const isOptionType = OPTION_TYPES.includes(attribute.type);

    if (isOptionType) {
      const options = attribute.options ?? [];

      if (options.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: `"${attribute.label}" needs at least one option`,
        });
      }

      const values = options.map((option) => option.value);
      const duplicate = values.find(
        (value, index) => values.indexOf(value) !== index,
      );

      if (duplicate) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: `"${attribute.label}" has a duplicate option "${duplicate}"`,
        });
      }
    }

    if (
      attribute.type === "NUMBER" &&
      attribute.min !== undefined &&
      attribute.max !== undefined &&
      attribute.min > attribute.max
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["min"],
        message: `"${attribute.label}" min must be less than or equal to max`,
      });
    }
  })
  .transform((attribute) => {
    const isOptionType = OPTION_TYPES.includes(attribute.type);
    const isNumber = attribute.type === "NUMBER";

    // keep only the properties that make sense for the type
    return {
      ...attribute,
      options: isOptionType ? attribute.options : undefined,
      unit: isNumber ? attribute.unit || undefined : undefined,
      min: isNumber ? attribute.min : undefined,
      max: isNumber ? attribute.max : undefined,
      step: isNumber ? attribute.step : undefined,
      // MULTI_SELECT / TEXT / BOOLEAN have no range filter UI
      filterable: attribute.type === "TEXT" ? false : attribute.filterable,
    };
  });

export const VehicleAttributesZodSchema = z
  .array(VehicleAttributeZodSchema)
  .max(60, "A vehicle type can have at most 60 attributes")
  .superRefine((attributes, ctx) => {
    const keys = attributes.map((attribute) => attribute.key);
    const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);

    if (duplicate) {
      ctx.addIssue({
        code: "custom",
        message: `Attribute key "${duplicate}" is used more than once`,
      });
    }
  })
  .transform((attributes) =>
    [...attributes].sort((first, second) => first.sortOrder - second.sortOrder),
  );

const SlugZodSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase words separated by -",
  )
  .max(80, "Slug must be at most 80 characters");

export const CreateVehicleTypeZodSchema = z.object({
  name: z
    .string({ message: "Name is required" })
    .trim()
    .min(2, "Name must be at least 2 characters long")
    .max(40, "Name must be at most 40 characters long"),
  slug: SlugZodSchema.optional(),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(40).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  attributes: VehicleAttributesZodSchema.default([]),
});

export const UpdateVehicleTypeZodSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters long")
    .max(40, "Name must be at most 40 characters long")
    .optional(),
  slug: SlugZodSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const UpdateVehicleTypeAttributesZodSchema = z.object({
  attributes: VehicleAttributesZodSchema,
});
