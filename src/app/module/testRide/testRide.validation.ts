import { z } from "zod";
import { TestRideStatus } from "../../../generated/prisma/enums";
import { timeToMinutes } from "../../helper/timeZone";
import {
  MAX_AVAILABILITY_RULES,
  MAX_SLOT_CAPACITY,
  MAX_TEST_RIDE_NOTE_LENGTH,
  SLOT_MINUTE_OPTIONS,
  findOverlappingRules,
} from "./testRide.utils";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const time = z
  .string({ message: "Time is required" })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour HH:mm format");

// a real calendar day, "YYYY-MM-DD"
export const DateKeyZodSchema = z
  .string({ message: "Date is required" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  }, "This date does not exist");

const note = z
  .string()
  .trim()
  .max(
    MAX_TEST_RIDE_NOTE_LENGTH,
    `A note can be at most ${MAX_TEST_RIDE_NOTE_LENGTH} characters`,
  )
  .optional();

const requiredReason = z
  .string({ message: "Please give a reason" })
  .trim()
  .min(3, "Please give a reason")
  .max(
    MAX_TEST_RIDE_NOTE_LENGTH,
    `A reason can be at most ${MAX_TEST_RIDE_NOTE_LENGTH} characters`,
  );

export const AvailabilityRuleZodSchema = z
  .object({
    listingId: z.uuid("Invalid listing ID").nullable().optional(),
    dayOfWeek: z.coerce
      .number()
      .int()
      .min(0, "Day must be 0 (Sunday) to 6 (Saturday)")
      .max(6, "Day must be 0 (Sunday) to 6 (Saturday)"),
    startTime: time,
    endTime: time,
    slotMinutes: z.coerce
      .number()
      .refine(
        (value) => (SLOT_MINUTE_OPTIONS as readonly number[]).includes(value),
        `Slot length must be one of ${SLOT_MINUTE_OPTIONS.join(", ")} minutes`,
      ),
    capacity: z.coerce
      .number()
      .int()
      .min(1, "Capacity must be at least 1")
      .max(MAX_SLOT_CAPACITY, `Capacity can be at most ${MAX_SLOT_CAPACITY}`)
      .default(1),
  })
  .refine(
    (rule) => timeToMinutes(rule.startTime) < timeToMinutes(rule.endTime),
    { message: "End time must be after start time", path: ["endTime"] },
  )
  .refine(
    (rule) =>
      timeToMinutes(rule.endTime) - timeToMinutes(rule.startTime) >=
      rule.slotMinutes,
    {
      message: "The time range is shorter than one slot",
      path: ["endTime"],
    },
  );

export const ReplaceAvailabilityZodSchema = z
  .object({
    rules: z
      .array(AvailabilityRuleZodSchema)
      .max(
        MAX_AVAILABILITY_RULES,
        `You can set at most ${MAX_AVAILABILITY_RULES} time ranges`,
      ),
  })
  .superRefine((value, ctx) => {
    const clash = findOverlappingRules(value.rules);

    if (clash) {
      ctx.addIssue({
        code: "custom",
        path: ["rules"],
        message: `${DAY_NAMES[clash[0].dayOfWeek]}: ${clash[0].startTime}–${clash[0].endTime} overlaps ${clash[1].startTime}–${clash[1].endTime}`,
      });
    }
  });

export const CreateBlockedDateZodSchema = z.object({
  date: DateKeyZodSchema,
  reason: note,
});

export const SlotsQueryZodSchema = z
  .object({
    listingId: z.uuid("Invalid listing ID"),
    from: DateKeyZodSchema.optional(),
    to: DateKeyZodSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from must be on or before to",
    path: ["to"],
  });

export const CreateTestRideZodSchema = z.object({
  listingId: z.uuid("Invalid listing ID"),
  startsAt: z.coerce.date({ message: "Pick a valid time slot" }),
  note,
});

export const ConfirmTestRideZodSchema = z.object({
  note,
});

export const DeclineTestRideZodSchema = z.object({
  reason: requiredReason,
});

export const CancelTestRideZodSchema = z.object({
  reason: requiredReason,
});

export const TestRideParamZodSchema = z.object({
  id: z.uuid("Invalid test ride ID"),
});

export const BlockedDateParamZodSchema = z.object({
  id: z.uuid("Invalid blocked date ID"),
});

export const TestRideQueryZodSchema = z.object({
  as: z.enum(["buyer", "seller"]).optional(),
  status: z.enum(TestRideStatus).optional(),
  upcoming: z.enum(["true", "false"]).optional(),
  listingId: z.uuid("Invalid listing ID").optional(),
});
