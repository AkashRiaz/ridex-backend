import { config } from "../../config";
import {
  IDailyCountRow,
  IDashboardRange,
  TDashboardRangeKey,
  TSeriesPoint,
} from "./dashboard.interface";

/*
 * Pure helpers for the dashboard overviews: date ranges in the
 * platform time zone, empty-day filling for charts, small ratios.
 */

export const DASHBOARD_RANGES: Record<TDashboardRangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const DEFAULT_DASHBOARD_RANGE: TDashboardRangeKey = "30d";

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================
// Time zone helpers
// ============================================

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
const getTimeZoneOffset = (date: Date, timeZone: string) => {
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

const shiftDateKey = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
};

// ============================================
// Ranges
// ============================================

export const isDashboardRange = (value: unknown): value is TDashboardRangeKey =>
  typeof value === "string" && value in DASHBOARD_RANGES;

/*
 * ?range=7d|30d|90d → the local days it covers, ending today.
 * Unknown values fall back to 30 days.
 */
export const parseDashboardRange = (
  value: unknown,
  now = new Date(),
  timeZone = config.timezone,
): IDashboardRange => {
  const key = isDashboardRange(value) ? value : DEFAULT_DASHBOARD_RANGE;
  const days = DASHBOARD_RANGES[key];

  const toKey = toLocalDateKey(now, timeZone);
  const fromKey = shiftDateKey(toKey, -(days - 1));

  return {
    key,
    days,
    fromKey,
    toKey,
    from: localMidnightToUtc(fromKey, timeZone),
    to: now,
  };
};

/*
 * Every local day of the range, oldest first.
 */
export const listRangeDays = (
  range: Pick<IDashboardRange, "fromKey" | "days">,
) =>
  Array.from({ length: range.days }, (_, index) =>
    shiftDateKey(range.fromKey, index),
  );

// ============================================
// Series
// ============================================

/*
 * Turns sparse SQL rows into one point per day, with 0 for empty days:
 * fillDailySeries(range, { listings: rows, users: rows })
 * → [{ date: "2026-11-01", listings: 3, users: 0 }, ...]
 */
export const fillDailySeries = <TKey extends string>(
  range: Pick<IDashboardRange, "fromKey" | "days">,
  seriesRows: Record<TKey, IDailyCountRow[]>,
): TSeriesPoint<TKey>[] => {
  const keys = Object.keys(seriesRows) as TKey[];

  const lookup = new Map<string, Map<string, number>>();
  for (const key of keys) {
    lookup.set(
      key,
      new Map(seriesRows[key].map((row) => [row.day, Number(row.count)])),
    );
  }

  return listRangeDays(range).map((date) => {
    const point = { date } as TSeriesPoint<TKey>;

    for (const key of keys) {
      (point as Record<string, number | string>)[key] =
        lookup.get(key)?.get(date) ?? 0;
    }

    return point;
  });
};

export const sumSeries = <TKey extends string>(
  series: TSeriesPoint<TKey>[],
  key: TKey,
) => series.reduce((total, point) => total + Number(point[key] ?? 0), 0);

// ============================================
// Counts and ratios
// ============================================

/*
 * groupBy rows → { KEY: count } with every known key present (0 when missing).
 */
export const toCountMap = <TKey extends string>(
  keys: readonly TKey[],
  rows: { key: string | null; count: number }[],
) => {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
    TKey,
    number
  >;

  for (const row of rows) {
    if (row.key && row.key in counts) counts[row.key as TKey] = row.count;
  }

  return counts;
};

/*
 * Percentage with one decimal; 0 when there is nothing to divide by.
 */
export const toPercent = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

/*
 * Change between the current and the previous period, in percent.
 * null when there was nothing before (avoids "+∞%").
 */
export const percentChange = (current: number, previous: number) =>
  previous > 0
    ? Math.round(((current - previous) / previous) * 1000) / 10
    : null;

export const dashboardCacheKey = (...parts: string[]) =>
  `dashboard:${parts.join(":")}`;
