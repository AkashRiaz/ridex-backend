import { describe, expect, it } from "vitest";
import {
  buildCompareHighlights,
  buildCompareSpecRows,
  orderByRequestedIds,
} from "../src/app/module/compare/compare.utils";
import { CompareListingsQueryZodSchema } from "../src/app/module/compare/compare.validation";
import { IVehicleAttribute } from "../src/app/module/vehicleType/vehicleType.interface";

const ID_A = "6f1c1f5e-7d3a-4c1b-9a51-0a1b2c3d4e5f";
const ID_B = "7a2d2e6f-8e4b-4d2c-8b62-1b2c3d4e5f60";
const ID_C = "8b3e3f70-9f5c-4e3d-9c73-2c3d4e5f6071";
const ID_D = "9c4f4081-a06d-4f4e-ad84-3d4e5f607182";
const ID_E = "ad505192-b17e-4a5f-be95-4e5f60718293";

describe("CompareListingsQueryZodSchema", () => {
  it("splits, trims and de-duplicates ids", () => {
    const result = CompareListingsQueryZodSchema.parse({
      ids: ` ${ID_A}, ${ID_B},${ID_A},`,
    });

    expect(result.ids).toEqual([ID_A, ID_B]);
  });

  it("allows up to 4 listings", () => {
    expect(
      CompareListingsQueryZodSchema.safeParse({
        ids: [ID_A, ID_B, ID_C, ID_D].join(","),
      }).success,
    ).toBe(true);

    expect(
      CompareListingsQueryZodSchema.safeParse({
        ids: [ID_A, ID_B, ID_C, ID_D, ID_E].join(","),
      }).success,
    ).toBe(false);
  });

  it("rejects missing and invalid ids", () => {
    expect(CompareListingsQueryZodSchema.safeParse({}).success).toBe(false);
    expect(CompareListingsQueryZodSchema.safeParse({ ids: "," }).success).toBe(
      false,
    );
    expect(
      CompareListingsQueryZodSchema.safeParse({ ids: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("orderByRequestedIds", () => {
  it("keeps the requested order and reports missing ids", () => {
    const result = orderByRequestedIds(
      ["b", "x", "a"],
      [{ id: "a" }, { id: "b" }],
    );

    expect(result.ordered.map((row) => row.id)).toEqual(["b", "a"]);
    expect(result.missingIds).toEqual(["x"]);
  });
});

describe("buildCompareHighlights", () => {
  const listing = (
    id: string,
    price: number,
    year: number,
    mileage: number,
    diffPercent: number | null,
  ) => ({
    id,
    price,
    year,
    mileage,
    priceInsight: {
      rating:
        diffPercent === null
          ? ("INSUFFICIENT_DATA" as const)
          : ("FAIR" as const),
      diffPercent,
    },
  });

  it("marks the best value of each fixed row", () => {
    const highlights = buildCompareHighlights([
      listing("a", 400000, 2022, 9000, 4),
      listing("b", 350000, 2021, 15000, -12),
      listing("c", 420000, 2023, 3000, null),
    ]);

    expect(highlights).toEqual({
      lowestPrice: ["b"],
      lowestMileage: ["c"],
      newestYear: ["c"],
      bestDeal: ["b"],
    });
  });

  it("shares ties and skips rows where everyone is equal", () => {
    const highlights = buildCompareHighlights([
      listing("a", 300000, 2022, 5000, null),
      listing("b", 300000, 2022, 8000, null),
      listing("c", 350000, 2022, 5000, null),
    ]);

    expect(highlights.lowestPrice).toEqual(["a", "b"]);
    expect(highlights.lowestMileage).toEqual(["a", "c"]);
    expect(highlights.newestYear).toEqual([]);
    expect(highlights.bestDeal).toEqual([]);
  });

  it("highlights nothing for a single listing", () => {
    expect(
      buildCompareHighlights([listing("a", 1, 2022, 1, 1)]).lowestPrice,
    ).toEqual([]);
  });
});

describe("buildCompareSpecRows", () => {
  const attributes: IVehicleAttribute[] = [
    {
      key: "abs",
      label: "ABS",
      type: "SELECT",
      options: [
        { value: "single-channel", label: "Single-channel" },
        { value: "dual-channel", label: "Dual-channel" },
      ],
      required: false,
      filterable: true,
      showInCard: false,
      group: "Safety",
      sortOrder: 2,
    },
    {
      key: "engineCapacity",
      label: "Engine",
      type: "NUMBER",
      unit: "cc",
      required: true,
      filterable: true,
      showInCard: true,
      group: "Engine",
      sortOrder: 1,
    },
    {
      key: "unused",
      label: "Unused",
      type: "TEXT",
      required: false,
      filterable: false,
      showInCard: false,
      group: "Other",
      sortOrder: 3,
    },
  ];

  it("formats values per column in schema order and flags differences", () => {
    const rows = buildCompareSpecRows(attributes, [
      { engineCapacity: 155, abs: "dual-channel" },
      { engineCapacity: 155 },
    ]);

    expect(rows).toEqual([
      {
        key: "engineCapacity",
        label: "Engine",
        group: "Engine",
        type: "NUMBER",
        unit: "cc",
        values: ["155 cc", "155 cc"],
        isDifferent: false,
      },
      {
        key: "abs",
        label: "ABS",
        group: "Safety",
        type: "SELECT",
        unit: null,
        values: ["Dual-channel", null],
        isDifferent: true,
      },
    ]);
  });
});
