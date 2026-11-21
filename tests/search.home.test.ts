import { describe, expect, it } from "vitest";
import { IFeaturedCandidate } from "../src/app/module/search/search.interface";
import {
  FEATURED_LIMIT,
  rankFeaturedListings,
  scoreFeaturedListing,
  toCategoryCounts,
} from "../src/app/module/search/search.utils";

const NOW = new Date("2026-11-21T12:00:00.000Z");

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const candidate = (
  overrides: Partial<IFeaturedCandidate> = {},
): IFeaturedCandidate => ({
  id: "a",
  views: 0,
  saves: 0,
  chats: 0,
  verifiedSeller: false,
  hasPhoto: false,
  publishedAt: daysAgo(30),
  ...overrides,
});

describe("scoreFeaturedListing", () => {
  it("is 0 for an old listing with no activity", () => {
    expect(scoreFeaturedListing(candidate(), NOW)).toBe(0);
  });

  it("weights saves ×3, chats ×2 and views ÷ 50", () => {
    expect(
      scoreFeaturedListing(candidate({ saves: 2, chats: 3, views: 100 }), NOW),
    ).toBe(6 + 6 + 2);
  });

  it("adds a photo bonus", () => {
    expect(scoreFeaturedListing(candidate({ hasPhoto: true }), NOW)).toBe(10);
  });

  it("adds a verified-seller bonus", () => {
    expect(scoreFeaturedListing(candidate({ verifiedSeller: true }), NOW)).toBe(
      4,
    );
  });

  it("gives full freshness points today and none after 14 days", () => {
    expect(scoreFeaturedListing(candidate({ publishedAt: NOW }), NOW)).toBe(6);
    expect(
      scoreFeaturedListing(candidate({ publishedAt: daysAgo(7) }), NOW),
    ).toBeCloseTo(3);
    expect(
      scoreFeaturedListing(candidate({ publishedAt: daysAgo(14) }), NOW),
    ).toBe(0);
    expect(
      scoreFeaturedListing(candidate({ publishedAt: daysAgo(20) }), NOW),
    ).toBe(0);
  });

  it("treats a future publish date as brand new (no extra points)", () => {
    expect(
      scoreFeaturedListing(candidate({ publishedAt: daysAgo(-3) }), NOW),
    ).toBe(6);
  });
});

describe("rankFeaturedListings", () => {
  it("orders by score, highest first", () => {
    const ranked = rankFeaturedListings(
      [
        candidate({ id: "low", views: 50 }),
        candidate({ id: "high", saves: 5 }),
        candidate({ id: "mid", chats: 2 }),
      ],
      FEATURED_LIMIT,
      NOW,
    );

    expect(ranked).toEqual(["high", "mid", "low"]);
  });

  it("breaks ties by newer listing, then id", () => {
    const ranked = rankFeaturedListings(
      [
        candidate({ id: "b", publishedAt: daysAgo(40) }),
        candidate({ id: "old", publishedAt: daysAgo(60) }),
        candidate({ id: "a", publishedAt: daysAgo(40) }),
      ],
      FEATURED_LIMIT,
      NOW,
    );

    expect(ranked).toEqual(["a", "b", "old"]);
  });

  it("lets a fresh listing beat an old one with a little activity", () => {
    const ranked = rankFeaturedListings(
      [
        candidate({ id: "old", saves: 1 }),
        candidate({ id: "fresh", publishedAt: NOW }),
      ],
      FEATURED_LIMIT,
      NOW,
    );

    expect(ranked[0]).toBe("fresh");
  });

  it("puts listings with photos ahead of fresher listings without", () => {
    const ranked = rankFeaturedListings(
      [
        candidate({ id: "fresh", publishedAt: NOW, saves: 1 }),
        candidate({ id: "photo", hasPhoto: true }),
      ],
      FEATURED_LIMIT,
      NOW,
    );

    expect(ranked).toEqual(["photo", "fresh"]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      candidate({ id: `l${index}`, views: index }),
    );

    expect(rankFeaturedListings(many, 5, NOW)).toHaveLength(5);
    expect(rankFeaturedListings(many, undefined, NOW)).toHaveLength(
      FEATURED_LIMIT,
    );
  });

  it("returns an empty list for no candidates", () => {
    expect(rankFeaturedListings([], FEATURED_LIMIT, NOW)).toEqual([]);
  });
});

describe("toCategoryCounts", () => {
  const options = [
    { value: "commuter", label: "Commuter" },
    { value: "sports", label: "Sports" },
    { value: "scooter", label: "Scooter" },
  ];

  it("keeps every option in schema order, with 0 for missing counts", () => {
    expect(
      toCategoryCounts(options, [
        { value: "scooter", count: 4 },
        { value: "commuter", count: 2 },
      ]),
    ).toEqual([
      { value: "commuter", label: "Commuter", count: 2 },
      { value: "sports", label: "Sports", count: 0 },
      { value: "scooter", label: "Scooter", count: 4 },
    ]);
  });

  it("ignores null values and values that are no longer options", () => {
    const result = toCategoryCounts(options, [
      { value: null, count: 9 },
      { value: "retired-category", count: 3 },
      { value: "sports", count: 1 },
    ]);

    expect(result.map((item) => item.count)).toEqual([0, 1, 0]);
  });
});
