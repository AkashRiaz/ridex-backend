import { describe, expect, it } from "vitest";
import { Role } from "../src/generated/prisma/enums";
import {
  REDACTED_VALUE,
  canViewAuditLog,
  getAuditLogVisibilityFilter,
  isAuditAction,
  parseAuditDateRange,
  redactSensitiveData,
} from "../src/app/module/auditLog/auditLog.utils";
import {
  dashboardCacheKey,
  fillDailySeries,
  listRangeDays,
  localMidnightToUtc,
  parseDashboardRange,
  percentChange,
  sumSeries,
  toCountMap,
  toLocalDateKey,
  toPercent,
} from "../src/app/module/dashboard/dashboard.utils";
import { buildAuditDiff } from "../src/app/utils/auditLogger";

const DHAKA = "Asia/Dhaka";

// ============================================
// Ranges and local days
// ============================================

describe("dashboard ranges", () => {
  // 2026-11-20 20:30 UTC is already 2026-11-21 02:30 in Dhaka (UTC+6)
  const now = new Date("2026-11-20T20:30:00Z");

  it("uses the local date, not the UTC date", () => {
    expect(toLocalDateKey(now, DHAKA)).toBe("2026-11-21");
    expect(toLocalDateKey(now, "UTC")).toBe("2026-11-20");
  });

  it("finds local midnight in UTC", () => {
    expect(localMidnightToUtc("2026-11-21", DHAKA).toISOString()).toBe(
      "2026-11-20T18:00:00.000Z",
    );
    expect(localMidnightToUtc("2026-11-21", "UTC").toISOString()).toBe(
      "2026-11-21T00:00:00.000Z",
    );
  });

  it("covers N local days ending today", () => {
    const range = parseDashboardRange("7d", now, DHAKA);

    expect(range.key).toBe("7d");
    expect(range.fromKey).toBe("2026-11-15");
    expect(range.toKey).toBe("2026-11-21");
    expect(range.from.toISOString()).toBe("2026-11-14T18:00:00.000Z");
    expect(listRangeDays(range)).toHaveLength(7);
    expect(listRangeDays(range).at(-1)).toBe("2026-11-21");
  });

  it("falls back to 30 days for unknown values", () => {
    for (const value of [undefined, "", "1y", ["7d"], 7]) {
      expect(parseDashboardRange(value, now, DHAKA).days).toBe(30);
    }
  });

  it("crosses month and year boundaries", () => {
    const range = parseDashboardRange(
      "90d",
      new Date("2026-01-15T06:00:00Z"),
      DHAKA,
    );
    expect(range.fromKey).toBe("2025-10-18");
    expect(listRangeDays(range)).toHaveLength(90);
  });
});

// ============================================
// Series filling
// ============================================

describe("fillDailySeries", () => {
  const range = { fromKey: "2026-11-19", days: 3 };

  it("adds a point for every day with 0 for missing days", () => {
    const series = fillDailySeries(range, {
      users: [{ day: "2026-11-20", count: 4 }],
      listings: [
        { day: "2026-11-19", count: 1 },
        { day: "2026-11-21", count: 2 },
      ],
    });

    expect(series).toEqual([
      { date: "2026-11-19", users: 0, listings: 1 },
      { date: "2026-11-20", users: 4, listings: 0 },
      { date: "2026-11-21", users: 0, listings: 2 },
    ]);
    expect(sumSeries(series, "listings")).toBe(3);
  });

  it("ignores rows outside the range and coerces string counts", () => {
    const series = fillDailySeries(range, {
      users: [
        { day: "2026-11-01", count: 9 },
        { day: "2026-11-20", count: "5" as unknown as number },
      ],
    });

    expect(series.map((point) => point.users)).toEqual([0, 5, 0]);
  });
});

// ============================================
// Counts and ratios
// ============================================

describe("counts and ratios", () => {
  it("fills every known key", () => {
    expect(
      toCountMap(["OPEN", "RESOLVED", "DISMISSED"] as const, [
        { key: "OPEN", count: 3 },
        { key: "UNKNOWN", count: 7 },
        { key: null, count: 1 },
      ]),
    ).toEqual({ OPEN: 3, RESOLVED: 0, DISMISSED: 0 });
  });

  it("computes percentages safely", () => {
    expect(toPercent(1, 3)).toBe(33.3);
    expect(toPercent(0, 0)).toBe(0);
    expect(toPercent(5, 5)).toBe(100);
  });

  it("returns null change when there was nothing before", () => {
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(5, 10)).toBe(-50);
  });

  it("builds namespaced cache keys", () => {
    expect(dashboardCacheKey("admin", "ADMIN", "30d")).toBe(
      "dashboard:admin:ADMIN:30d",
    );
  });
});

// ============================================
// Audit log rules
// ============================================

describe("audit log redaction", () => {
  it("redacts sensitive keys at any depth", () => {
    const redacted = redactSensitiveData({
      name: "Rafi",
      password: "hash",
      nested: { tokenHash: "abc", otpCode: "123456", keep: 1 },
      list: [{ clientSecret: "s", ok: true }],
    });

    expect(redacted).toEqual({
      name: "Rafi",
      password: REDACTED_VALUE,
      nested: { tokenHash: REDACTED_VALUE, otpCode: REDACTED_VALUE, keep: 1 },
      list: [{ clientSecret: REDACTED_VALUE, ok: true }],
    });
  });

  it("leaves primitives and null alone", () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData("text")).toBe("text");
  });
});

describe("audit log visibility", () => {
  it("super admins see everything", () => {
    expect(getAuditLogVisibilityFilter(Role.SUPER_ADMIN)).toBeNull();
    expect(canViewAuditLog(Role.SUPER_ADMIN, Role.SUPER_ADMIN)).toBe(true);
  });

  it("admins don't see super admin entries but see system entries", () => {
    expect(getAuditLogVisibilityFilter(Role.ADMIN)).toEqual({
      OR: [
        { userId: null },
        { user: { is: { role: { not: Role.SUPER_ADMIN } } } },
      ],
    });
    expect(canViewAuditLog(Role.ADMIN, Role.SUPER_ADMIN)).toBe(false);
    expect(canViewAuditLog(Role.ADMIN, Role.MODERATOR)).toBe(true);
    expect(canViewAuditLog(Role.ADMIN, null)).toBe(true);
  });

  it("knows the audit actions", () => {
    expect(isAuditAction("APPROVE")).toBe(true);
    expect(isAuditAction("approve")).toBe(false);
    expect(isAuditAction(undefined)).toBe(false);
  });
});

describe("audit log date filter", () => {
  it("turns local dates into an inclusive day range", () => {
    const range = parseAuditDateRange("2026-11-01", "2026-11-21");

    expect(range.gte?.toISOString()).toBe(
      localMidnightToUtc("2026-11-01").toISOString(),
    );
    expect(range.lt?.toISOString()).toBe(
      localMidnightToUtc("2026-11-22").toISOString(),
    );
  });

  it("allows open-ended ranges", () => {
    expect(parseAuditDateRange(undefined, "")).toEqual({
      gte: undefined,
      lt: undefined,
    });
  });

  it("rejects bad dates and reversed ranges", () => {
    expect(() => parseAuditDateRange("21-11-2026")).toThrow(/date like/);
    expect(() => parseAuditDateRange("2026-13-45")).toThrow(/date like/);
    expect(() => parseAuditDateRange("2026-11-21", "2026-11-01")).toThrow(
      /on or before/,
    );
  });
});

describe("buildAuditDiff", () => {
  it("keeps only changed keys", () => {
    const diff = buildAuditDiff(
      { name: "Yamaha", isActive: true, sortOrder: 1 },
      { name: "Yamaha", isActive: false, sortOrder: undefined },
    );

    expect(diff).toEqual({
      oldData: { isActive: true },
      newData: { isActive: false },
      changed: true,
    });
  });

  it("compares dates and nested values by JSON", () => {
    const date = new Date("2026-11-21T00:00:00Z");
    const diff = buildAuditDiff(
      { publishedAt: date, specs: { cc: 150 } },
      { publishedAt: new Date(date), specs: { cc: 150 } },
    );

    expect(diff.changed).toBe(false);
  });

  it("records a value that was cleared", () => {
    const diff = buildAuditDiff({ description: "Old" }, { description: null });
    expect(diff.newData).toEqual({ description: null });
  });
});
