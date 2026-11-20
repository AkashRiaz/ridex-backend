import { describe, expect, it } from "vitest";
import { validateSpecs } from "../src/app/helper/buildDynamicSpecSchema";
import { IVehicleAttribute } from "../src/app/module/vehicleType/vehicleType.interface";
import { findSpecConflicts } from "../src/app/module/vehicleType/vehicleType.utils";
import { VehicleAttributesZodSchema } from "../src/app/module/vehicleType/vehicleType.validation";
import { BIKE_ATTRIBUTES, BIKE_BRANDS } from "../src/app/utils/seedData/bikeCatalog";

const base = {
  required: false,
  filterable: false,
  showInCard: false,
  group: "General",
  sortOrder: 0,
};

const attributes: IVehicleAttribute[] = [
  { ...base, key: "engineCapacity", label: "Engine capacity", type: "NUMBER", unit: "cc", min: 50, max: 2500, required: true },
  {
    ...base,
    key: "abs",
    label: "ABS",
    type: "SELECT",
    options: [
      { value: "none", label: "None" },
      { value: "dual-channel", label: "Dual" },
    ],
  },
  {
    ...base,
    key: "features",
    label: "Features",
    type: "MULTI_SELECT",
    options: [
      { value: "usb", label: "USB" },
      { value: "led", label: "LED" },
    ],
  },
  { ...base, key: "hasWarranty", label: "Warranty", type: "BOOLEAN" },
  { ...base, key: "color", label: "Colour", type: "TEXT" },
];

describe("validateSpecs", () => {
  it("accepts valid specs and coerces form strings", () => {
    const result = validateSpecs(attributes, {
      engineCapacity: "155",
      abs: "dual-channel",
      features: ["usb", "usb", "led"],
      hasWarranty: "true",
      color: "  Racing blue ",
    });

    expect(result).toEqual({
      success: true,
      data: {
        engineCapacity: 155,
        abs: "dual-channel",
        features: ["usb", "led"],
        hasWarranty: true,
        color: "Racing blue",
      },
    });
  });

  it("requires required attributes unless partial", () => {
    const strict = validateSpecs(attributes, { abs: "none" });
    expect(strict.success).toBe(false);
    if (!strict.success) expect(strict.message).toContain("Engine capacity is required");

    expect(validateSpecs(attributes, { abs: "none" }, { partial: true }).success).toBe(true);
  });

  it("treats empty values as not provided and drops them", () => {
    const result = validateSpecs(
      attributes,
      { engineCapacity: 110, abs: "", features: [], color: "" },
    );

    expect(result).toEqual({ success: true, data: { engineCapacity: 110 } });
  });

  it("rejects unknown keys", () => {
    const result = validateSpecs(attributes, { engineCapacity: 150, turbo: true });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toContain("turbo");
  });

  it("enforces number range with unit in the message", () => {
    const result = validateSpecs(attributes, { engineCapacity: 10 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toContain("at least 50 cc");
  });

  it("rejects options that are not in the schema", () => {
    expect(validateSpecs(attributes, { engineCapacity: 150, abs: "triple" }).success).toBe(false);
    expect(validateSpecs(attributes, { engineCapacity: 150, features: ["jetpack"] }).success).toBe(false);
  });

  it("rejects non-numeric numbers", () => {
    expect(validateSpecs(attributes, { engineCapacity: "fast" }).success).toBe(false);
  });
});

describe("findSpecConflicts", () => {
  const models = [
    { id: "m1", name: "R15", defaultSpecs: { engineCapacity: 155, abs: "dual-channel" } },
    { id: "m2", name: "Splendor", defaultSpecs: { engineCapacity: 97 } },
  ];

  it("is empty when the new schema still fits every model", () => {
    const relabelled = attributes.map((attribute) => ({ ...attribute, label: `${attribute.label}!` }));
    expect(findSpecConflicts(relabelled, models)).toEqual([]);
  });

  it("allows removing an attribute nobody uses", () => {
    expect(findSpecConflicts(attributes.filter((attribute) => attribute.key !== "color"), models)).toEqual([]);
  });

  it("flags removing an attribute that a model uses", () => {
    const conflicts = findSpecConflicts(
      attributes.filter((attribute) => attribute.key !== "abs"),
      models,
    );

    expect(conflicts.map((conflict) => conflict.name)).toEqual(["R15"]);
  });

  it("flags removing an option that a model uses", () => {
    const withoutDual = attributes.map((attribute) =>
      attribute.key === "abs"
        ? { ...attribute, options: [{ value: "none", label: "None" }] }
        : attribute,
    );

    expect(findSpecConflicts(withoutDual, models)).toHaveLength(1);
  });

  it("flags a tighter range or a type change", () => {
    const tighter = attributes.map((attribute) =>
      attribute.key === "engineCapacity" ? { ...attribute, min: 100 } : attribute,
    );
    expect(findSpecConflicts(tighter, models).map((conflict) => conflict.name)).toEqual(["Splendor"]);

    const retyped = attributes.map((attribute) =>
      attribute.key === "engineCapacity" ? { ...attribute, type: "BOOLEAN" as const } : attribute,
    );
    expect(findSpecConflicts(retyped, models)).toHaveLength(2);
  });
});

describe("VehicleAttributesZodSchema", () => {
  const attribute = { key: "engineCapacity", label: "Engine", type: "NUMBER" };

  it("rejects duplicate keys", () => {
    expect(VehicleAttributesZodSchema.safeParse([attribute, attribute]).success).toBe(false);
  });

  it("requires options for SELECT and rejects duplicate option values", () => {
    expect(
      VehicleAttributesZodSchema.safeParse([{ key: "abs", label: "ABS", type: "SELECT" }]).success,
    ).toBe(false);

    expect(
      VehicleAttributesZodSchema.safeParse([
        {
          key: "abs",
          label: "ABS",
          type: "SELECT",
          options: [
            { value: "none", label: "A" },
            { value: "none", label: "B" },
          ],
        },
      ]).success,
    ).toBe(false);
  });

  it("rejects non camelCase keys and min > max", () => {
    expect(
      VehicleAttributesZodSchema.safeParse([{ ...attribute, key: "Engine Capacity" }]).success,
    ).toBe(false);
    expect(
      VehicleAttributesZodSchema.safeParse([{ ...attribute, min: 10, max: 5 }]).success,
    ).toBe(false);
  });

  it("strips properties that do not fit the type and sorts by sortOrder", () => {
    const parsed = VehicleAttributesZodSchema.parse([
      { key: "bText", label: "B text", type: "TEXT", unit: "cc", min: 1, filterable: true, sortOrder: 2 },
      { key: "aNumber", label: "A", type: "NUMBER", options: [{ value: "x", label: "X" }], sortOrder: 1 },
    ]);

    expect(parsed.map((item) => item.key)).toEqual(["aNumber", "bText"]);
    expect(parsed[1]).toMatchObject({ unit: undefined, min: undefined, filterable: false });
    expect(parsed[0].options).toBeUndefined();
    expect(parsed[0]).toMatchObject({ required: false, group: "General" });
  });
});

describe("seed catalog", () => {
  it("bike attribute schema is valid", () => {
    expect(VehicleAttributesZodSchema.safeParse(BIKE_ATTRIBUTES).success).toBe(true);
  });

  it("every seeded model has valid full specs", () => {
    const bikeAttributes = VehicleAttributesZodSchema.parse(BIKE_ATTRIBUTES);

    for (const brand of BIKE_BRANDS) {
      for (const model of brand.models) {
        const result = validateSpecs(bikeAttributes, model.specs);
        expect(result.success, `${brand.name} ${model.name}: ${!result.success && result.message}`).toBe(true);
      }
    }
  });
});
