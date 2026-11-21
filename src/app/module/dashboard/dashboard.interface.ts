export type TDashboardRangeKey = "7d" | "30d" | "90d";

export interface IDashboardRange {
  key: TDashboardRangeKey;
  days: number;
  // local "YYYY-MM-DD" of the first and last day
  fromKey: string;
  toKey: string;
  // UTC instant of local midnight on the first day
  from: Date;
  to: Date;
}

// one row from a daily GROUP BY
export interface IDailyCountRow {
  day: string;
  count: number;
}

export type TSeriesPoint<TKey extends string> = { date: string } & Record<
  TKey,
  number
>;

export interface ILabelCount {
  id?: string | null;
  label: string;
  count: number;
}

export interface IDashboardRangeInfo {
  key: TDashboardRangeKey;
  days: number;
  from: string;
  to: string;
}

export interface IQueueCounts {
  listings: number;
  reports: number;
  // null for moderators, who don't review verifications
  verifications: number | null;
}
