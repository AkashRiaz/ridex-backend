import { describe, expect, it } from "vitest";
import { ISavedSearchLookups } from "../src/app/module/savedSearch/savedSearch.interface";
import {
  buildSavedSearchName,
  buildSearchUrl,
  canonicalizeSearchQuery,
  collectLookupKeys,
  describeSearchQuery,
  hashSearchQuery,
  parseStoredQuery,
} from "../src/app/module/savedSearch/savedSearch.utils";
import {
  CreateSavedSearchZodSchema,
  UpdateSavedSearchZodSchema,
} from "../src/app/module/savedSearch/savedSearch.validation";

const lookups: ISavedSearchLookups = {
  vehicleTypes: new Map([
    [
      "bike",
      {
        name: "Bike",
        attributes: [
          {
            key: "engineCapacity",
            label: "Engine capacity",
            type: "NUMBER",
            unit: "cc",
          },
          {
            key: "abs",
            label: "ABS",
            type: "SELECT",
            options: [
              { value: "dual-channel", label: "Dual-channel" },
              { value: "single-channel", label: "Single-channel" },
            ],
          },
          { key: "hasWarranty", label: "Warranty", type: "BOOLEAN" },
        ],
      },
    ],
  ]),
  brands: new Map([
    ["yamaha", "Yamaha"],
    ["honda", "Honda"],
  ]),
  models: new Map([["r15-v4", "R15 V4"]]),
};

describe("canonicalizeSearchQuery", () => {
  it("drops paging, sorting, layout, unknown and empty params", () => {
    expect(
      canonicalizeSearchQuery({
        brand: "yamaha",
        page: "2",
        limit: "24",
        sortBy: "price_asc",
        view: "list",
        utm_source: "fb",
        district: "  ",
        minPrice: "",
      }),
    ).toEqual({ brand: "yamaha" });
  });

  it("sorts keys and list values so order never matters", () => {
    const a = canonicalizeSearchQuery({
      maxPrice: "300000",
      brand: "yamaha, honda,yamaha",
      condition: "USED,NEW",
    });
    const b = canonicalizeSearchQuery({
      condition: "NEW,USED",
      brand: "honda,yamaha",
      maxPrice: " 300000 ",
    });

    expect(a).toEqual(b);
    expect(Object.keys(a)).toEqual(["brand", "condition", "maxPrice"]);
    expect(a.brand).toBe("honda,yamaha");
    expect(hashSearchQuery(a)).toBe(hashSearchQuery(b));
  });

  it("normalises spec option lists but keeps spec ranges", () => {
    expect(
      canonicalizeSearchQuery({
        "spec.abs": "single-channel,dual-channel",
        "spec.engineCapacity.min": "150",
      }),
    ).toEqual({
      "spec.abs": "dual-channel,single-channel",
      "spec.engineCapacity.min": "150",
    });
  });

  it("lowercases the search term and rounds near-me coordinates", () => {
    expect(
      canonicalizeSearchQuery({
        searchTerm: "  Yamaha   R15 ",
        lat: "23.810331",
        lng: "90.412521",
        radius: "10",
      }),
    ).toEqual({
      lat: "23.810",
      lng: "90.413",
      radius: "10",
      searchTerm: "yamaha r15",
    });
  });

  it("takes the first value of repeated params", () => {
    expect(canonicalizeSearchQuery({ district: ["Dhaka", "Gazipur"] })).toEqual(
      {
        district: "Dhaka",
      },
    );
  });
});

describe("hashSearchQuery", () => {
  it("differs for different searches", () => {
    expect(hashSearchQuery({ brand: "yamaha" })).not.toBe(
      hashSearchQuery({ brand: "honda" }),
    );
  });
});

describe("describeSearchQuery", () => {
  it("builds readable chips in a fixed order", () => {
    const chips = describeSearchQuery(
      canonicalizeSearchQuery({
        vehicleType: "bike",
        brand: "yamaha,honda",
        model: "r15-v4",
        minPrice: "100000",
        maxPrice: "300000",
        minYear: "2020",
        maxMileage: "20000",
        condition: "USED,RECONDITIONED",
        negotiable: "true",
        district: "Dhaka",
        "spec.engineCapacity.min": "150",
        "spec.engineCapacity.max": "200",
        "spec.abs": "dual-channel",
        "spec.hasWarranty": "true",
        searchTerm: "abs",
      }),
      lookups,
    );

    expect(chips.map((chip) => chip.label)).toEqual([
      "“abs”",
      "Honda, Yamaha",
      "R15 V4",
      expect.stringMatching(/^BDT .+–BDT .+$/),
      "2020 or newer",
      "Up to 20,000 km",
      "Reconditioned, Used",
      "Negotiable",
      "Dhaka",
      "ABS: Dual-channel",
      "Engine capacity: 150–200 cc",
      "Warranty: Yes",
    ]);
  });

  it("describes one-sided ranges and near-me", () => {
    const labels = describeSearchQuery(
      { maxPrice: "300000", maxYear: "2022", lat: "23.8", lng: "90.4" },
      lookups,
    ).map((chip) => chip.label);

    expect(labels[0]).toMatch(/^Under BDT /);
    expect(labels).toContain("2022 or older");
    expect(labels).toContain("Within 25 km");
  });

  it("names the vehicle type only without a brand or model", () => {
    expect(
      describeSearchQuery({ vehicleType: "bike", district: "Dhaka" }, lookups),
    ).toEqual([
      { key: "vehicleType", label: "Bike" },
      { key: "location", label: "Dhaka" },
    ]);
  });

  it("shows unknown slugs as they are", () => {
    expect(describeSearchQuery({ brand: "ghost" }, lookups)).toEqual([
      { key: "brand", label: "ghost" },
    ]);
  });
});

describe("buildSavedSearchName", () => {
  it("joins the first three chips", () => {
    expect(
      buildSavedSearchName([
        { key: "brand", label: "Yamaha" },
        { key: "price", label: "Under BDT 5,00,000" },
        { key: "location", label: "Dhaka" },
        { key: "condition", label: "Used" },
      ]),
    ).toBe("Yamaha · Under BDT 5,00,000 · Dhaka");
  });

  it("falls back and truncates", () => {
    expect(buildSavedSearchName([])).toBe("My search");

    const long = buildSavedSearchName([
      { key: "searchTerm", label: "x".repeat(200) },
    ]);
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("buildSearchUrl / collectLookupKeys / parseStoredQuery", () => {
  it("links to newest results", () => {
    expect(buildSearchUrl({ brand: "honda,yamaha" })).toBe(
      "/listings?brand=honda%2Cyamaha&sortBy=newest",
    );
  });

  it("collects every slug once", () => {
    expect(
      collectLookupKeys([
        { brand: "honda,yamaha", vehicleType: "bike" },
        { brand: "yamaha", model: "r15-v4" },
      ]),
    ).toEqual({
      vehicleTypes: ["bike"],
      brands: ["honda", "yamaha"],
      models: ["r15-v4"],
    });
  });

  it("keeps only string values from stored JSON", () => {
    expect(parseStoredQuery({ brand: "honda", bad: 1 })).toEqual({
      brand: "honda",
    });
    expect(parseStoredQuery(null)).toEqual({});
    expect(parseStoredQuery(["x"])).toEqual({});
  });
});

describe("validation", () => {
  it("accepts a search with optional settings", () => {
    expect(
      CreateSavedSearchZodSchema.safeParse({
        query: { brand: "yamaha", maxPrice: 300000 },
        alertFrequency: "DAILY",
      }).success,
    ).toBe(true);
  });

  it("rejects bad settings", () => {
    expect(
      CreateSavedSearchZodSchema.safeParse({
        query: { brand: "yamaha" },
        alertFrequency: "HOURLY",
      }).success,
    ).toBe(false);
    expect(
      CreateSavedSearchZodSchema.safeParse({ query: "brand=yamaha" }).success,
    ).toBe(false);
    expect(
      CreateSavedSearchZodSchema.safeParse({ query: {}, name: "   " }).success,
    ).toBe(false);
  });

  it("needs at least one field to update", () => {
    expect(UpdateSavedSearchZodSchema.safeParse({}).success).toBe(false);
    expect(
      UpdateSavedSearchZodSchema.safeParse({ notifyPriceDrops: false }).success,
    ).toBe(true);
  });
});
