import { config } from "../config";

/*
 * Wall-clock helpers for config.timezone (IANA name), built on Intl only.
 * Dates are passed around as "YYYY-MM-DD" keys and "HH:mm" strings.
 * Used by dashboard charts (local days) and test-ride slots (local hours).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * "YYYY-MM-DD" of an instant in the given time zone.
 */
export const toLocalDateKey = (date: Date, timeZone = config.timezone) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/*
 * Offset of the time zone from UTC at an instant, in ms (Asia/Dhaka → +6h).
 */
export const getTimeZoneOffset = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );

  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/*
 * The UTC instant of a local wall time ("YYYY-MM-DD" + "HH:mm").
 * The offset is re-read at the result, so DST zones land on the right hour.
 */
export const localTimeToUtc = (
  dateKey: string,
  time = "00:00",
  timeZone = config.timezone,
) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  const first = guess - getTimeZoneOffset(new Date(guess), timeZone);
  const second = guess - getTimeZoneOffset(new Date(first), timeZone);

  return new Date(second);
};

/*
 * The UTC instant of local midnight for a "YYYY-MM-DD" key.
 */
export const localMidnightToUtc = (
  dateKey: string,
  timeZone = config.timezone,
) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day));

  return new Date(guess.getTime() - getTimeZoneOffset(guess, timeZone));
};

export const shiftDateKey = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
};

// 0 = Sunday … 6 = Saturday (the calendar day itself, no time zone involved)
export const dayOfWeekOf = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

// "HH:mm" → minutes after midnight
export const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
};

export const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/*
 * "Sat, 23 Nov, 10:30 AM" in the app's zone and locale, for notices and emails.
 */
export const formatLocalDateTime = (
  date: Date,
  timeZone = config.timezone,
  locale = config.currency_locale,
) =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
