import { describe, expect, it } from "vitest";
import { generateSlug, generateUniqueSlug } from "../src/app/helper/generateSlug";
import { isUuid } from "../src/app/helper/isUuid";

describe("generateSlug", () => {
  it.each([
    ["Royal Enfield", "royal-enfield"],
    ["  R15 V4  ", "r15-v4"],
    ["Gixxer SF FI ABS", "gixxer-sf-fi-abs"],
    ["Café Racer", "cafe-racer"],
    ["Parts & Accessories", "parts-and-accessories"],
    ["X-Blade!!", "x-blade"],
    ["***", "item"],
  ])("%s → %s", (input, expected) => {
    expect(generateSlug(input)).toBe(expected);
  });

  it("adds a numeric suffix until the slug is free", async () => {
    const taken = new Set(["honda", "honda-2"]);

    await expect(
      generateUniqueSlug("Honda", async (slug) => taken.has(slug)),
    ).resolves.toBe("honda-3");
  });
});

describe("isUuid", () => {
  it("tells ids and slugs apart", () => {
    expect(isUuid("3f2c1a8e-9b4d-4c6e-8a1f-2b3c4d5e6f70")).toBe(true);
    expect(isUuid("royal-enfield")).toBe(false);
  });
});
