import { describe, expect, it } from "vitest";
import { ListingStatus } from "../src/generated/prisma/enums";
import {
  assertListingOwner,
  buildSearchText,
  canTransition,
  generateListingSlug,
  getCardSpecs,
  getSubmitProblems,
  isMajorEdit,
} from "../src/app/module/listing/listing.utils";
import { BIKE_ATTRIBUTES } from "../src/app/utils/seedData/bikeCatalog";
import { VehicleAttributesZodSchema } from "../src/app/module/vehicleType/vehicleType.validation";

const attributes = VehicleAttributesZodSchema.parse(BIKE_ATTRIBUTES);

describe("listing status flow", () => {
  const { DRAFT, PENDING, APPROVED, REJECTED, SOLD, EXPIRED } = ListingStatus;

  it.each([
    [DRAFT, PENDING],
    [PENDING, APPROVED],
    [PENDING, REJECTED],
    [REJECTED, PENDING],
    [APPROVED, SOLD],
    [APPROVED, EXPIRED],
    [APPROVED, PENDING],
    [APPROVED, REJECTED],
    [EXPIRED, APPROVED],
  ])("%s → %s is allowed", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [DRAFT, APPROVED],
    [DRAFT, SOLD],
    [PENDING, SOLD],
    [REJECTED, APPROVED],
    [SOLD, APPROVED],
    [SOLD, PENDING],
    [EXPIRED, SOLD],
  ])("%s → %s is blocked", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("isMajorEdit (approved listings)", () => {
  const current = {
    title: "Yamaha R15 V4 2023",
    price: 495000,
    mileage: 8200,
    specs: { engineCapacity: 155 },
    district: "Dhaka",
    latitude: 23.8,
  };

  it("price / description / video / color edits stay live", () => {
    expect(isMajorEdit(current, { price: 450000 })).toBe(false);
    expect(
      isMajorEdit(current, {
        description: "New tyres",
        videoUrl: null,
        color: "Red",
      }),
    ).toBe(false);
  });

  it("sending the same values is not an edit", () => {
    expect(
      isMajorEdit(current, {
        title: "Yamaha R15 V4 2023",
        specs: { engineCapacity: 155 },
      }),
    ).toBe(false);
  });

  it("title, mileage, specs and location changes need review", () => {
    expect(
      isMajorEdit(current, { title: "Yamaha R15 V4 2023 — like new" }),
    ).toBe(true);
    expect(isMajorEdit(current, { mileage: 100 })).toBe(true);
    expect(isMajorEdit(current, { specs: { engineCapacity: 150 } })).toBe(true);
    expect(isMajorEdit(current, { district: "Gazipur" })).toBe(true);
  });
});

describe("ownership", () => {
  it("only the seller can manage a listing (403)", () => {
    expect(() => assertListingOwner({ sellerId: "a" }, "a")).not.toThrow();

    try {
      assertListingOwner({ sellerId: "a" }, "b");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(403);
    }
  });
});

describe("submit checklist", () => {
  const ready = {
    title: "Yamaha R15 V4 2023",
    price: 495000,
    year: 2023,
    mileage: 8200,
    division: "Dhaka",
    district: "Dhaka",
    specs: { engineCapacity: 155, bikeCategory: "sports" },
  };

  it("passes a complete listing", () => {
    expect(getSubmitProblems(ready, 3, attributes)).toEqual([]);
  });

  it("lists every missing piece", () => {
    const problems = getSubmitProblems(
      { ...ready, title: "R15", price: 0, district: "Atlantis", specs: {} },
      0,
      attributes,
    );

    expect(problems.join(" | ")).toMatch(/Title must be at least 10/);
    expect(problems.join(" | ")).toMatch(/Set a price/);
    expect(problems.join(" | ")).toMatch(/division and district/);
    expect(problems.join(" | ")).toMatch(/at least one photo/);
    expect(problems.join(" | ")).toMatch(/Engine capacity is required/);
  });
});

describe("slug, search text and card specs", () => {
  it("slug is readable and unique-ish", () => {
    const first = generateListingSlug(["Yamaha", "R15 V4", 2023]);
    const second = generateListingSlug(["Yamaha", "R15 V4", 2023]);

    expect(first).toMatch(/^yamaha-r15-v4-2023-[a-f0-9]{4}$/);
    expect(first).not.toBe(second);
  });

  it("search text includes brand, model, location and option labels", () => {
    const text = buildSearchText({
      title: "Yamaha R15 V4 2023",
      year: 2023,
      brandName: "Yamaha",
      modelName: "R15 V4",
      vehicleTypeName: "Bike",
      division: "Dhaka",
      district: "Dhaka",
      area: "Mirpur",
      attributes,
      specs: {
        abs: "dual-channel",
        bikeCategory: "sports",
        features: ["bluetooth"],
      },
    });

    expect(text).toContain("Mirpur");
    expect(text).toContain("Dual-channel");
    expect(text).toContain("Sports");
    expect(text).toContain("Bluetooth connectivity");
  });

  it("card specs are the show-in-card attributes, formatted", () => {
    expect(
      getCardSpecs(attributes, {
        engineCapacity: 155,
        bikeCategory: "sports",
        fuelEconomy: 45,
        abs: "dual-channel",
      }),
    ).toEqual([
      { key: "engineCapacity", label: "Engine capacity", value: "155 cc" },
      { key: "bikeCategory", label: "Category", value: "Sports" },
      { key: "fuelEconomy", label: "Fuel economy", value: "45 km/l" },
    ]);
  });
});
