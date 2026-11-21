import {
  ListingStatus,
  Role,
  TestRideStatus,
} from "../../../generated/prisma/enums";
import {
  dayOfWeekOf,
  formatLocalDateTime,
  localTimeToUtc,
  minutesToTime,
  shiftDateKey,
  timeToMinutes,
  toLocalDateKey,
} from "../../helper/timeZone";
import { CHAT_ROLES } from "../chat/chat.utils";

// ============================================
// Constants
// ============================================

// buyers book from chat, so the chat roles take part
export const TEST_RIDE_ROLES: Role[] = CHAT_ROLES;

// roles that own listings and therefore set availability
export const AVAILABILITY_ROLES: Role[] = [Role.SELLER, Role.DEALER];

export const SLOT_MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

export const MAX_AVAILABILITY_RULES = 50;

export const MAX_SLOT_CAPACITY = 10;

export const MAX_TEST_RIDE_NOTE_LENGTH = 300;

// blocked dates can be set up to a year ahead
export const MAX_BLOCKED_DATE_DAYS_AHEAD = 365;

// new bookings per user per hour
export const TEST_RIDE_RATE_LIMIT_PER_HOUR = 10;

export const TEST_RIDE_SWEEP_BATCH_LIMIT = 200;

// bookings that hold a slot
export const ACTIVE_TEST_RIDE_STATUSES: TestRideStatus[] = [
  TestRideStatus.REQUESTED,
  TestRideStatus.CONFIRMED,
];

// advisory lock namespace (offers use 1)
export const TEST_RIDE_LOCK_NAMESPACE = 2;

export const TEST_RIDE_REMINDERS = [
  { kind: "24h", hoursBefore: 24 },
  { kind: "2h", hoursBefore: 2 },
] as const;

export type TReminderKind = (typeof TEST_RIDE_REMINDERS)[number]["kind"];

export const testRideRateKey = (userId: string) => `test-ride-rate:${userId}`;

// BullMQ custom job ids must not contain ":"
export const testRideExpireJobId = (id: string) => `test-ride-expire-${id}`;

export const testRideReminderJobId = (id: string, kind: TReminderKind) =>
  `test-ride-reminder-${id}-${kind}`;

// ============================================
// Availability rules
// ============================================

type TRuleTimes = {
  listingId?: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

/*
 * Two rules for the same scope (one listing, or the defaults) on the same
 * day must not overlap. Returns the first clash, or null.
 */
export const findOverlappingRules = <T extends TRuleTimes>(rules: T[]) => {
  const groups = new Map<string, T[]>();

  for (const rule of rules) {
    const key = `${rule.listingId ?? "default"}|${rule.dayOfWeek}`;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    );

    for (let index = 1; index < sorted.length; index++) {
      if (
        timeToMinutes(sorted[index].startTime) <
        timeToMinutes(sorted[index - 1].endTime)
      ) {
        return [sorted[index - 1], sorted[index]] as const;
      }
    }
  }

  return null;
};

/*
 * Rules that apply to one listing: its own rules if it has any,
 * otherwise the seller's defaults (listingId null).
 */
export const rulesForListing = <T extends { listingId: string | null }>(
  rules: T[],
  listingId: string,
) => {
  const own = rules.filter((rule) => rule.listingId === listingId);

  return own.length ? own : rules.filter((rule) => rule.listingId === null);
};

// ============================================
// Slots (pure, unit-tested)
// ============================================

type TSlotRule = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  capacity: number;
};

type TBooking = { startsAt: Date; endsAt: Date };

export type TSlot = {
  startsAt: Date;
  endsAt: Date;
  // local "HH:mm"
  time: string;
  capacity: number;
  remaining: number;
};

export type TDaySlots = {
  // local "YYYY-MM-DD"
  date: string;
  dayOfWeek: number;
  slots: TSlot[];
};

// bookings that overlap [start, end)
export const countOverlapping = (
  bookings: TBooking[],
  start: Date,
  end: Date,
) =>
  bookings.filter(
    (booking) =>
      booking.startsAt.getTime() < end.getTime() &&
      booking.endsAt.getTime() > start.getTime(),
  ).length;

/*
 * The bookable window: today (local) up to `bookingDays` ahead,
 * narrowed by optional from / to keys.
 */
export const bookingWindow = (input: {
  now: Date;
  bookingDays: number;
  timeZone: string;
  fromKey?: string;
  toKey?: string;
}) => {
  const todayKey = toLocalDateKey(input.now, input.timeZone);
  const lastKey = shiftDateKey(todayKey, input.bookingDays);

  const fromKey =
    input.fromKey && input.fromKey > todayKey ? input.fromKey : todayKey;
  const toKey = input.toKey && input.toKey < lastKey ? input.toKey : lastKey;

  return { todayKey, lastKey, fromKey, toKey };
};

/*
 * Free slots per local day. A slot is listed when it fits a rule, is not on
 * a blocked date, starts after now + lead time, and still has capacity
 * (overlapping REQUESTED / CONFIRMED bookings of the seller are subtracted).
 */
export const generateSlots = (input: {
  rules: TSlotRule[];
  blockedDateKeys: Set<string>;
  bookings: TBooking[];
  now: Date;
  fromKey: string;
  toKey: string;
  minLeadHours: number;
  timeZone: string;
}): TDaySlots[] => {
  const earliest = input.now.getTime() + input.minLeadHours * 60 * 60 * 1000;
  const days: TDaySlots[] = [];

  for (
    let dateKey = input.fromKey;
    dateKey <= input.toKey;
    dateKey = shiftDateKey(dateKey, 1)
  ) {
    if (input.blockedDateKeys.has(dateKey)) continue;

    const dayOfWeek = dayOfWeekOf(dateKey);
    const slots = new Map<number, TSlot>();

    for (const rule of input.rules) {
      if (rule.dayOfWeek !== dayOfWeek) continue;

      const end = timeToMinutes(rule.endTime);

      for (
        let minute = timeToMinutes(rule.startTime);
        minute + rule.slotMinutes <= end;
        minute += rule.slotMinutes
      ) {
        const time = minutesToTime(minute);
        const startsAt = localTimeToUtc(dateKey, time, input.timeZone);

        if (startsAt.getTime() < earliest) continue;
        if (slots.has(startsAt.getTime())) continue;

        const endsAt = new Date(
          startsAt.getTime() + rule.slotMinutes * 60 * 1000,
        );
        const remaining =
          rule.capacity - countOverlapping(input.bookings, startsAt, endsAt);

        if (remaining <= 0) continue;

        slots.set(startsAt.getTime(), {
          startsAt,
          endsAt,
          time,
          capacity: rule.capacity,
          remaining,
        });
      }
    }

    if (slots.size) {
      days.push({
        date: dateKey,
        dayOfWeek,
        slots: [...slots.values()].sort(
          (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
        ),
      });
    }
  }

  return days;
};

// ============================================
// Booking & action rules (pure, unit-tested)
// ============================================

type TRuleResult<TCode extends string> =
  | { allowed: true }
  | { allowed: false; code: TCode; reason: string };

export const evaluateBooking = (input: {
  userId: string;
  listing: {
    sellerId: string;
    status: ListingStatus;
    isDeleted: boolean;
  } | null;
  hasActiveBooking: boolean;
}): TRuleResult<
  "LISTING_NOT_FOUND" | "OWN_LISTING" | "LISTING_UNAVAILABLE" | "ALREADY_BOOKED"
> => {
  const { listing } = input;

  if (!listing || listing.isDeleted) {
    return {
      allowed: false,
      code: "LISTING_NOT_FOUND",
      reason: "Listing not found",
    };
  }

  if (listing.sellerId === input.userId) {
    return {
      allowed: false,
      code: "OWN_LISTING",
      reason: "You cannot book a test ride on your own listing",
    };
  }

  if (listing.status !== ListingStatus.APPROVED) {
    return {
      allowed: false,
      code: "LISTING_UNAVAILABLE",
      reason: "This listing is not taking test ride bookings right now",
    };
  }

  if (input.hasActiveBooking) {
    return {
      allowed: false,
      code: "ALREADY_BOOKED",
      reason:
        "You already have an upcoming test ride for this listing. Cancel it to pick another time.",
    };
  }

  return { allowed: true };
};

export type TTestRideAction =
  | "confirm"
  | "decline"
  | "cancel"
  | "complete"
  | "noShow";

const ACTION_FROM: Record<TTestRideAction, TestRideStatus[]> = {
  confirm: [TestRideStatus.REQUESTED],
  decline: [TestRideStatus.REQUESTED],
  cancel: [TestRideStatus.REQUESTED, TestRideStatus.CONFIRMED],
  complete: [TestRideStatus.CONFIRMED],
  noShow: [TestRideStatus.CONFIRMED],
};

// statuses an action may start from (also used as the update guard)
export const actionFromStatuses = (action: TTestRideAction) =>
  ACTION_FROM[action];

/*
 * Seller: confirm / decline a request before it starts; mark a confirmed
 * ride completed or no-show once it has started.
 * Either side: cancel a requested or confirmed ride before it starts.
 */
export const evaluateTestRideAction = (input: {
  action: TTestRideAction;
  userId: string;
  ride: {
    buyerId: string;
    sellerId: string;
    status: TestRideStatus;
    startsAt: Date;
  };
  now?: Date;
}): TRuleResult<
  "NOT_FOUND" | "NOT_ALLOWED" | "WRONG_STATUS" | "TOO_EARLY" | "TOO_LATE"
> => {
  const { ride, action } = input;
  const now = input.now ?? new Date();
  const isSeller = ride.sellerId === input.userId;
  const isBuyer = ride.buyerId === input.userId;

  if (!isSeller && !isBuyer) {
    return {
      allowed: false,
      code: "NOT_FOUND",
      reason: "Test ride not found",
    };
  }

  if (action !== "cancel" && !isSeller) {
    return {
      allowed: false,
      code: "NOT_ALLOWED",
      reason: "Only the seller can do this",
    };
  }

  if (!ACTION_FROM[action].includes(ride.status)) {
    return {
      allowed: false,
      code: "WRONG_STATUS",
      reason: `This test ride is ${ride.status.toLowerCase().replace("_", "-")}`,
    };
  }

  const started = ride.startsAt.getTime() <= now.getTime();

  if ((action === "complete" || action === "noShow") && !started) {
    return {
      allowed: false,
      code: "TOO_EARLY",
      reason: "You can update the outcome once the test ride has started",
    };
  }

  if ((action === "confirm" || action === "cancel") && started) {
    return {
      allowed: false,
      code: "TOO_LATE",
      reason: "This test ride has already started",
    };
  }

  return { allowed: true };
};

// ============================================
// Texts
// ============================================

export const testRidePreview = (startsAt: Date) =>
  `🏍️ Test ride request: ${formatLocalDateTime(startsAt)}`;

export const testRideNoticeText = (
  event:
    | "confirmed"
    | "declined"
    | "cancelled"
    | "completed"
    | "noShow"
    | "expired",
  startsAt: Date,
  extra?: string | null,
) => {
  const when = formatLocalDateTime(startsAt);

  switch (event) {
    case "confirmed":
      return extra
        ? `Test ride confirmed for ${when}. Note from the seller: ${extra}`
        : `Test ride confirmed for ${when}.`;
    case "declined":
      return extra
        ? `Test ride request for ${when} declined: ${extra}`
        : `Test ride request for ${when} declined.`;
    case "cancelled":
      return extra
        ? `Test ride on ${when} cancelled: ${extra}`
        : `Test ride on ${when} cancelled.`;
    case "completed":
      return `Test ride on ${when} completed.`;
    case "noShow":
      return `Test ride on ${when} marked as a no-show.`;
    case "expired":
      return `Test ride request for ${when} expired without a confirmation.`;
  }
};
