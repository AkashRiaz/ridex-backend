import { describe, expect, it } from "vitest";
import {
  conditionGroup,
  diffFromMedian,
  formatYearSpan,
  matchesTier,
  median,
  percentile,
  pickComparableTier,
  rateListingPrice,
  roundPrice,
  trimOutliers,
} from "../src/app/module/priceInsight/priceInsight.utils";

const subject = {
  id: "subject",
  price: 450000,
  year: 2022,
  mileage: 10000,
  condition: "USED" as const,
};

const comparable = (
  id: string,
  price: number,
  year = 2022,
  mileage = 10000,
) => ({ id, price, year, mileage });

describe("percentile / median", () => {
  it("interpolates between ranks", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(percentile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.75)).toBe(32.5);
  });

  it("returns null for no data", () => {
    expect(median([])).toBeNull();
  });

  it("does not mutate the input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("trimOutliers", () => {
  it("drops typo and parts prices around the raw median", () => {
    expect(trimOutliers([5000, 400000, 420000, 450000, 2500000])).toEqual([
      400000, 420000, 450000,
    ]);
  });

  it("keeps the 0.4× and 2.5× bounds", () => {
    expect(trimOutliers([40, 100, 100, 250])).toEqual([40, 100, 100, 250]);
  });
});

describe("rateListingPrice", () => {
  it("uses inclusive ±percent bounds", () => {
    expect(rateListingPrice(90, 100, 10)).toBe("GOOD_DEAL");
    expect(rateListingPrice(91, 100, 10)).toBe("FAIR");
    expect(rateListingPrice(109, 100, 10)).toBe("FAIR");
    expect(rateListingPrice(110, 100, 10)).toBe("HIGH");
  });

  it("follows the configured percent", () => {
    expect(rateListingPrice(95, 100, 5)).toBe("GOOD_DEAL");
    expect(rateListingPrice(95, 100, 10)).toBe("FAIR");
  });
});

describe("diffFromMedian / roundPrice / formatYearSpan", () => {
  it("rounds the difference to one decimal", () => {
    expect(diffFromMedian(450000, 400000)).toBe(12.5);
    expect(diffFromMedian(100, 300)).toBe(-66.7);
  });

  it("rounds money to the nearest 100", () => {
    expect(roundPrice(412345)).toBe(412300);
    expect(roundPrice(null)).toBeNull();
  });

  it("formats the year span", () => {
    expect(formatYearSpan({ from: 2021, to: 2023 })).toBe("2021–2023");
    expect(formatYearSpan({ from: 2022, to: 2022 })).toBe("2022");
  });
});

describe("conditionGroup", () => {
  it("keeps new bikes apart from used ones", () => {
    expect(conditionGroup("NEW")).toEqual(["NEW"]);
    expect(conditionGroup("RECONDITIONED")).toEqual(["USED", "RECONDITIONED"]);
  });
});

describe("matchesTier", () => {
  const tight = { yearRange: 1, mileageRange: 0.5 };

  it("checks year distance", () => {
    expect(matchesTier(subject, comparable("a", 1, 2023), tight)).toBe(true);
    expect(matchesTier(subject, comparable("a", 1, 2024), tight)).toBe(false);
  });

  it("checks mileage relative to the larger value", () => {
    expect(matchesTier(subject, comparable("a", 1, 2022, 20000), tight)).toBe(
      true,
    );
    expect(matchesTier(subject, comparable("a", 1, 2022, 21000), tight)).toBe(
      false,
    );
  });

  it("uses a 5,000 km floor for nearly-new bikes", () => {
    expect(
      matchesTier(
        { ...subject, mileage: 0 },
        comparable("a", 1, 2022, 2500),
        tight,
      ),
    ).toBe(true);
  });

  it("ignores mileage when the tier allows any", () => {
    expect(
      matchesTier(subject, comparable("a", 1, 2022, 90000), {
        yearRange: 2,
        mileageRange: null,
      }),
    ).toBe(true);
  });
});

describe("pickComparableTier", () => {
  it("uses the narrowest tier with enough listings", () => {
    const candidates = [1, 2, 3, 4, 5].map((n) =>
      comparable(`c${n}`, 400000 + n * 1000),
    );

    const picked = pickComparableTier(subject, candidates, 5);

    expect(picked?.tier.yearRange).toBe(1);
    expect(picked?.prices).toHaveLength(5);
    expect(picked?.yearSpan).toEqual({ from: 2022, to: 2022 });
  });

  it("widens when the narrow tier is too small", () => {
    const candidates = [
      comparable("a", 400000),
      comparable("b", 410000),
      comparable("c", 420000, 2020),
      comparable("d", 430000, 2024),
      comparable("e", 440000, 2022, 60000),
    ];

    const picked = pickComparableTier(subject, candidates, 5);

    expect(picked?.tier.yearRange).toBe(2);
    // the span comes from the comparables, not from subject ± range
    expect(picked?.yearSpan).toEqual({ from: 2020, to: 2024 });
  });

  it("never counts the listing itself or outliers", () => {
    const candidates = [
      comparable("subject", 450000),
      comparable("a", 400000),
      comparable("b", 410000),
      comparable("c", 420000),
      comparable("d", 430000),
      comparable("junk", 1000),
    ];

    expect(pickComparableTier(subject, candidates, 5)).toBeNull();
  });

  it("returns null without enough data", () => {
    expect(pickComparableTier(subject, [], 5)).toBeNull();
  });
});
