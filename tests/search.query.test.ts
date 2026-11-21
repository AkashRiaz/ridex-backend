import { describe, expect, it } from "vitest";
import {
  BD_DIVISIONS,
  isInsideBangladesh,
} from "../src/app/helper/bdLocations";
import {
  buildSearchSql,
  buildTsQuery,
  parseSpecFilters,
} from "../src/app/module/search/search.utils";
import { SearchListingsQueryZodSchema } from "../src/app/module/search/search.validation";
import { VehicleAttributesZodSchema } from "../src/app/module/vehicleType/vehicleType.validation";
import { BIKE_ATTRIBUTES } from "../src/app/utils/seedData/bikeCatalog";

const attributes = VehicleAttributesZodSchema.parse(BIKE_ATTRIBUTES);

describe("buildTsQuery", () => {
  it("prefix-matches every word", () => {
    expect(buildTsQuery("Yamaha  R15 v4")).toBe("yamaha:* & r15:* & v4:*");
  });

  it("strips tsquery syntax and SQL", () => {
    expect(buildTsQuery("x') OR 1=1; DROP TABLE listings;--")).toBe(
      "x:* & or:* & 1:* & 1:* & drop:* & table:* & listings:*",
    );
    expect(buildTsQuery("!!! & | :*")).toBeNull();
    expect(buildTsQuery(undefined)).toBeNull();
  });

  it("keeps Bangla words", () => {
    expect(buildTsQuery("ইয়ামাহা বাইক")).toBe("ইয়ামাহা:* & বাইক:*");
  });
});

describe("parseSpecFilters", () => {
  it("parses ranges, choices, multi-choices", () => {
    const filters = parseSpecFilters(
      {
        "spec.engineCapacity.min": "150",
        "spec.engineCapacity.max": "170",
        "spec.abs": "dual-channel,single-channel",
        "spec.features": "bluetooth",
        searchTerm: "ignored",
      },
      attributes,
    );

    expect(filters).toEqual([
      { kind: "anyOf", key: "abs", values: ["dual-channel", "single-channel"] },
      { kind: "allOf", key: "features", values: ["bluetooth"] },
      { kind: "range", key: "engineCapacity", min: 150, max: 170 },
    ]);
  });

  it("ignores empty values", () => {
    expect(parseSpecFilters({ "spec.abs": "" }, attributes)).toEqual([]);
  });

  it.each([
    [{ "spec.abs": "none" }, null, /Choose a vehicle type/],
    [{ "spec.topSpeed.min": "100" }, attributes, /not a filterable spec/],
    [{ "spec.madeUp": "1" }, attributes, /not a filterable spec/],
    [
      { "spec.engineCapacity": "150" },
      attributes,
      /\.min or spec\.engineCapacity\.max/,
    ],
    [{ "spec.engineCapacity.min": "fast" }, attributes, /must be a number/],
    [{ "spec.abs": "triple" }, attributes, /not a valid ABS option/],
    [{ "spec.abs.min": "1" }, attributes, /Unknown filter/],
  ])("rejects %o", (query, attrs, message) => {
    expect(() => parseSpecFilters(query, attrs)).toThrow(message);
  });
});

describe("buildSearchSql", () => {
  const base = {
    specFilters: [],
    sortBy: "newest" as const,
    limit: 24,
    skip: 0,
  };

  it("always limits to approved, non-deleted listings", () => {
    const sql = buildSearchSql(base);

    expect(sql.sql).toContain(`l."status" = 'APPROVED'`);
    expect(sql.sql).toContain(`l."isDeleted" = false`);
  });

  it("passes every user value as a bound parameter", () => {
    const sql = buildSearchSql({
      ...base,
      searchTerm: "r15'; DROP TABLE x",
      minPrice: 100000,
      district: "Dhaka'--",
      specFilters: [{ kind: "anyOf", key: "abs", values: ["dual-channel"] }],
    });

    expect(sql.sql).not.toContain("DROP");
    expect(sql.sql).not.toContain("Dhaka");
    expect(sql.values).toContain("Dhaka'--");
    expect(sql.values).toContain(100000);
    expect(sql.values).toContain(JSON.stringify({ abs: "dual-channel" }));
  });

  it("uses relevance only with a search term and nearest only with a location", () => {
    expect(buildSearchSql({ ...base, sortBy: "relevance" }).sql).toContain(
      `l."approvedAt" DESC`,
    );
    expect(
      buildSearchSql({ ...base, searchTerm: "r15", sortBy: "relevance" }).sql,
    ).toContain("rank DESC");
    expect(buildSearchSql({ ...base, sortBy: "nearest" }).sql).not.toContain(
      "distance ASC",
    );
    expect(
      buildSearchSql({
        ...base,
        sortBy: "nearest",
        near: { lat: 23.8, lng: 90.4, radiusKm: 10 },
      }).sql,
    ).toContain("distance ASC");
  });

  it("adds a bounding box before the exact radius", () => {
    const sql = buildSearchSql({
      ...base,
      near: { lat: 23.8, lng: 90.4, radiusKm: 10 },
    });

    expect(sql.sql).toContain(`l."latitude" BETWEEN`);
    expect(sql.sql).toContain("ASIN(SQRT(");
  });
});

describe("SearchListingsQueryZodSchema", () => {
  it("coerces and splits lists", () => {
    const parsed = SearchListingsQueryZodSchema.parse({
      brand: "yamaha, honda",
      minPrice: "1000",
      condition: "NEW,USED",
    });

    expect(parsed).toMatchObject({
      brand: ["yamaha", "honda"],
      minPrice: 1000,
      condition: ["NEW", "USED"],
    });
  });

  it.each([
    [{ lat: "23.8" }, /sent together/],
    [{ minPrice: "5", maxPrice: "1" }, /Min price/],
    [{ condition: "BROKEN" }, /Condition must be/],
    [{ limit: "500" }, /at most 48/],
    [{ sortBy: "cheapest" }, /Invalid sort/],
  ])("rejects %o", (query, message) => {
    const result = SearchListingsQueryZodSchema.safeParse(query);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.map((issue) => issue.message).join(" "),
      ).toMatch(message);
    }
  });
});

describe("bdLocations", () => {
  it("has 8 divisions and 64 unique districts inside Bangladesh", () => {
    const districts = BD_DIVISIONS.flatMap((division) => division.districts);

    expect(BD_DIVISIONS).toHaveLength(8);
    expect(districts).toHaveLength(64);
    expect(new Set(districts.map((district) => district.name)).size).toBe(64);
    expect(
      districts.every((district) =>
        isInsideBangladesh(district.lat, district.lng),
      ),
    ).toBe(true);
  });
});
