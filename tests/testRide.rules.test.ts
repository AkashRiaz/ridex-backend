import { describe, expect, it } from "vitest";
import {
  dayOfWeekOf,
  localTimeToUtc,
  minutesToTime,
  shiftDateKey,
  timeToMinutes,
  toLocalDateKey,
} from "../src/app/helper/timeZone";
import { ListingStatus, TestRideStatus } from "../src/generated/prisma/enums";
import {
  bookingWindow,
  countOverlapping,
  evaluateBooking,
  evaluateTestRideAction,
  findOverlappingRules,
  generateSlots,
  rulesForListing,
  testRideExpireJobId,
  testRideReminderJobId,
} from "../src/app/module/testRide/testRide.utils";
import {
  CancelTestRideZodSchema,
  CreateBlockedDateZodSchema,
  ReplaceAvailabilityZodSchema,
  SlotsQueryZodSchema,
} from "../src/app/module/testRide/testRide.validation";

const DHAKA = "Asia/Dhaka";

// Monday 2026-11-23 is the reference week (2026-11-22 is a Sunday)
const MONDAY = "2026-11-23";

const rule = (overrides: Record<string, unknown> = {}) => ({
  listingId: null as string | null,
  dayOfWeek: 1,
  startTime: "10:00",
  endTime: "12:00",
  slotMinutes: 30,
  capacity: 1,
  ...overrides,
});

const slotsFor = (
  overrides: Partial<Parameters<typeof generateSlots>[0]> = {},
) =>
  generateSlots({
    rules: [rule()],
    blockedDateKeys: new Set(),
    bookings: [],
    // Sunday 22 Nov, 09:00 in Dhaka
    now: new Date("2026-11-22T03:00:00.000Z"),
    fromKey: MONDAY,
    toKey: MONDAY,
    minLeadHours: 2,
    timeZone: DHAKA,
    ...overrides,
  });

describe("time zone helpers", () => {
  it("converts Dhaka wall time to UTC (+06:00, no DST)", () => {
    expect(localTimeToUtc(MONDAY, "10:30", DHAKA).toISOString()).toBe(
      "2026-11-23T04:30:00.000Z",
    );
    // just after local midnight is still the previous UTC day
    expect(localTimeToUtc(MONDAY, "00:15", DHAKA).toISOString()).toBe(
      "2026-11-22T18:15:00.000Z",
    );
  });

  it("handles a DST zone on both sides of the change", () => {
    const zone = "America/New_York";
    // EDT (-04:00) before 1 Nov 2026, EST (-05:00) after
    expect(localTimeToUtc("2026-10-30", "10:00", zone).toISOString()).toBe(
      "2026-10-30T14:00:00.000Z",
    );
    expect(localTimeToUtc("2026-11-02", "10:00", zone).toISOString()).toBe(
      "2026-11-02T15:00:00.000Z",
    );
  });

  it("reads local dates, weekdays and times", () => {
    expect(toLocalDateKey(new Date("2026-11-22T19:00:00.000Z"), DHAKA)).toBe(
      MONDAY,
    );
    expect(dayOfWeekOf(MONDAY)).toBe(1);
    expect(dayOfWeekOf("2026-11-22")).toBe(0);
    expect(shiftDateKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(timeToMinutes("09:45")).toBe(585);
    expect(minutesToTime(585)).toBe("09:45");
  });
});

describe("availability rules", () => {
  it("finds overlaps within the same day and scope only", () => {
    expect(
      findOverlappingRules([
        rule(),
        rule({ startTime: "11:30", endTime: "13:00" }),
      ]),
    ).not.toBeNull();
    // touching ranges are fine
    expect(
      findOverlappingRules([
        rule(),
        rule({ startTime: "12:00", endTime: "13:00" }),
      ]),
    ).toBeNull();
    // other day, or a listing override, never clash with the defaults
    expect(
      findOverlappingRules([
        rule(),
        rule({ dayOfWeek: 2 }),
        rule({ listingId: "listing-1" }),
      ]),
    ).toBeNull();
  });

  it("uses listing rules when present, otherwise the defaults", () => {
    const rules = [
      rule(),
      rule({ listingId: "a", startTime: "15:00", endTime: "16:00" }),
    ];
    expect(rulesForListing(rules, "a")).toHaveLength(1);
    expect(rulesForListing(rules, "a")[0].startTime).toBe("15:00");
    expect(rulesForListing(rules, "b")).toEqual([rules[0]]);
  });
});

describe("generateSlots", () => {
  it("cuts a range into slots on the matching weekday", () => {
    const days = slotsFor();
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe(MONDAY);
    expect(days[0].slots.map((slot) => slot.time)).toEqual([
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ]);
    expect(days[0].slots[0].startsAt.toISOString()).toBe(
      "2026-11-23T04:00:00.000Z",
    );
    expect(days[0].slots[0].endsAt.toISOString()).toBe(
      "2026-11-23T04:30:00.000Z",
    );
  });

  it("drops a last slot that would run past the end time", () => {
    const days = slotsFor({ rules: [rule({ endTime: "11:45" })] });
    expect(days[0].slots.map((slot) => slot.time)).toEqual([
      "10:00",
      "10:30",
      "11:00",
    ]);
  });

  it("skips blocked dates and other weekdays", () => {
    expect(slotsFor({ blockedDateKeys: new Set([MONDAY]) })).toEqual([]);
    expect(slotsFor({ rules: [rule({ dayOfWeek: 2 })] })).toEqual([]);
  });

  it("respects the lead time", () => {
    // Monday 09:00 Dhaka: with 2h lead, 10:00 and 10:30 are too soon
    const days = slotsFor({ now: new Date("2026-11-23T03:00:00.000Z") });
    expect(days[0].slots.map((slot) => slot.time)).toEqual(["11:00", "11:30"]);
  });

  it("subtracts overlapping bookings from capacity", () => {
    const booked = {
      startsAt: new Date("2026-11-23T04:30:00.000Z"),
      endsAt: new Date("2026-11-23T05:00:00.000Z"),
    };

    const full = slotsFor({ bookings: [booked] });
    expect(full[0].slots.map((slot) => slot.time)).toEqual([
      "10:00",
      "11:00",
      "11:30",
    ]);

    const shared = slotsFor({
      rules: [rule({ capacity: 2 })],
      bookings: [booked],
    });
    const slot = shared[0].slots.find((item) => item.time === "10:30");
    expect(slot?.remaining).toBe(1);
  });

  it("counts a longer booking against every slot it overlaps", () => {
    const hour = {
      startsAt: new Date("2026-11-23T04:00:00.000Z"),
      endsAt: new Date("2026-11-23T05:00:00.000Z"),
    };
    expect(
      countOverlapping(
        [hour],
        new Date("2026-11-23T04:30:00.000Z"),
        new Date("2026-11-23T05:00:00.000Z"),
      ),
    ).toBe(1);
    // back-to-back is not an overlap
    expect(
      countOverlapping(
        [hour],
        new Date("2026-11-23T05:00:00.000Z"),
        new Date("2026-11-23T05:30:00.000Z"),
      ),
    ).toBe(0);
  });

  it("spans several days in order", () => {
    const days = slotsFor({
      rules: [rule(), rule({ dayOfWeek: 3 })],
      toKey: "2026-11-29",
    });
    expect(days.map((day) => day.date)).toEqual([MONDAY, "2026-11-25"]);
  });
});

describe("bookingWindow", () => {
  const now = new Date("2026-11-22T03:00:00.000Z");

  it("runs from today for bookingDays", () => {
    expect(
      bookingWindow({ now, bookingDays: 14, timeZone: DHAKA }),
    ).toMatchObject({ fromKey: "2026-11-22", toKey: "2026-12-06" });
  });

  it("clamps from/to into the window", () => {
    expect(
      bookingWindow({
        now,
        bookingDays: 14,
        timeZone: DHAKA,
        fromKey: "2026-11-01",
        toKey: "2027-01-01",
      }),
    ).toMatchObject({ fromKey: "2026-11-22", toKey: "2026-12-06" });
    expect(
      bookingWindow({
        now,
        bookingDays: 14,
        timeZone: DHAKA,
        fromKey: "2026-11-25",
        toKey: "2026-11-26",
      }),
    ).toMatchObject({ fromKey: "2026-11-25", toKey: "2026-11-26" });
  });
});

describe("evaluateBooking", () => {
  const listing = {
    sellerId: "seller",
    status: ListingStatus.APPROVED as ListingStatus,
    isDeleted: false,
  };
  const code = (input: Partial<Parameters<typeof evaluateBooking>[0]>) => {
    const result = evaluateBooking({
      userId: "buyer",
      listing,
      hasActiveBooking: false,
      ...input,
    });
    return result.allowed ? "OK" : result.code;
  };

  it("allows a buyer on a live listing", () => {
    expect(code({})).toBe("OK");
  });

  it("rejects missing, own, unavailable and double bookings", () => {
    expect(code({ listing: null })).toBe("LISTING_NOT_FOUND");
    expect(code({ userId: "seller" })).toBe("OWN_LISTING");
    expect(code({ listing: { ...listing, status: ListingStatus.SOLD } })).toBe(
      "LISTING_UNAVAILABLE",
    );
    expect(code({ hasActiveBooking: true })).toBe("ALREADY_BOOKED");
  });
});

describe("evaluateTestRideAction", () => {
  const now = new Date("2026-11-23T03:00:00.000Z");
  const future = new Date("2026-11-23T06:00:00.000Z");
  const past = new Date("2026-11-23T02:00:00.000Z");

  const code = (
    action: Parameters<typeof evaluateTestRideAction>[0]["action"],
    userId: string,
    status: TestRideStatus,
    startsAt = future,
  ) => {
    const result = evaluateTestRideAction({
      action,
      userId,
      ride: { buyerId: "buyer", sellerId: "seller", status, startsAt },
      now,
    });
    return result.allowed ? "OK" : result.code;
  };

  it("lets the seller confirm or decline a request before it starts", () => {
    expect(code("confirm", "seller", TestRideStatus.REQUESTED)).toBe("OK");
    expect(code("decline", "seller", TestRideStatus.REQUESTED)).toBe("OK");
    expect(code("confirm", "buyer", TestRideStatus.REQUESTED)).toBe(
      "NOT_ALLOWED",
    );
    expect(code("confirm", "seller", TestRideStatus.REQUESTED, past)).toBe(
      "TOO_LATE",
    );
    expect(code("confirm", "seller", TestRideStatus.CONFIRMED)).toBe(
      "WRONG_STATUS",
    );
  });

  it("lets either side cancel before the start", () => {
    for (const userId of ["buyer", "seller"]) {
      expect(code("cancel", userId, TestRideStatus.REQUESTED)).toBe("OK");
      expect(code("cancel", userId, TestRideStatus.CONFIRMED)).toBe("OK");
      expect(code("cancel", userId, TestRideStatus.CONFIRMED, past)).toBe(
        "TOO_LATE",
      );
    }
    expect(code("cancel", "buyer", TestRideStatus.DECLINED)).toBe(
      "WRONG_STATUS",
    );
  });

  it("records outcomes only after a confirmed ride started", () => {
    expect(code("complete", "seller", TestRideStatus.CONFIRMED, past)).toBe(
      "OK",
    );
    expect(code("noShow", "seller", TestRideStatus.CONFIRMED, past)).toBe("OK");
    expect(code("complete", "seller", TestRideStatus.CONFIRMED)).toBe(
      "TOO_EARLY",
    );
    expect(code("complete", "seller", TestRideStatus.REQUESTED, past)).toBe(
      "WRONG_STATUS",
    );
    expect(code("complete", "buyer", TestRideStatus.CONFIRMED, past)).toBe(
      "NOT_ALLOWED",
    );
  });

  it("hides rides from outsiders", () => {
    expect(code("cancel", "stranger", TestRideStatus.REQUESTED)).toBe(
      "NOT_FOUND",
    );
  });

  it("builds job ids without colons", () => {
    expect(testRideExpireJobId("x")).not.toContain(":");
    expect(testRideReminderJobId("x", "24h")).not.toContain(":");
  });
});

describe("test ride validation", () => {
  it("accepts a valid week and rejects overlaps", () => {
    expect(
      ReplaceAvailabilityZodSchema.safeParse({
        rules: [
          rule(),
          rule({
            dayOfWeek: 6,
            startTime: "15:00",
            endTime: "18:00",
            slotMinutes: 60,
          }),
        ],
      }).success,
    ).toBe(true);

    const clash = ReplaceAvailabilityZodSchema.safeParse({
      rules: [rule(), rule({ startTime: "11:00", endTime: "13:00" })],
    });
    expect(clash.success).toBe(false);
    expect(clash.error?.issues[0].message).toMatch(/^Monday: /);
  });

  it("rejects bad times, lengths and capacities", () => {
    const bad = (overrides: Record<string, unknown>) =>
      ReplaceAvailabilityZodSchema.safeParse({ rules: [rule(overrides)] })
        .success;

    expect(bad({ startTime: "24:00" })).toBe(false);
    expect(bad({ endTime: "09:00" })).toBe(false);
    expect(bad({ endTime: "10:15" })).toBe(false);
    expect(bad({ slotMinutes: 20 })).toBe(false);
    expect(bad({ capacity: 0 })).toBe(false);
    expect(bad({ dayOfWeek: 7 })).toBe(false);
  });

  it("validates calendar dates and slot queries", () => {
    expect(
      CreateBlockedDateZodSchema.safeParse({ date: "2026-12-16" }).success,
    ).toBe(true);
    expect(
      CreateBlockedDateZodSchema.safeParse({ date: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      CreateBlockedDateZodSchema.safeParse({ date: "16-12-2026" }).success,
    ).toBe(false);
    expect(
      SlotsQueryZodSchema.safeParse({
        listingId: "4f9c0d7e-1c1f-4c55-9a3e-2d6b6d1f8a10",
        from: "2026-12-02",
        to: "2026-12-01",
      }).success,
    ).toBe(false);
  });

  it("requires a cancel reason", () => {
    expect(CancelTestRideZodSchema.safeParse({}).success).toBe(false);
    expect(CancelTestRideZodSchema.safeParse({ reason: "  " }).success).toBe(
      false,
    );
    expect(
      CancelTestRideZodSchema.safeParse({ reason: "Bike sold" }).success,
    ).toBe(true);
  });
});
