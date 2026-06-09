import { describe, expect, test } from "bun:test";
import { InvalidDateExprError, parseDateExpr } from "@tasq/core";

// 2026-06-10은 수요일
const NOW = new Date(2026, 5, 10, 15, 30);

describe("parseDateExpr", () => {
  test("passes through a valid ISO date", () => {
    expect(parseDateExpr("2026-07-01", NOW)).toBe("2026-07-01");
  });

  test("rejects calendar-invalid ISO dates", () => {
    expect(() => parseDateExpr("2026-02-30", NOW)).toThrow(InvalidDateExprError);
    expect(() => parseDateExpr("2026-13-01", NOW)).toThrow(InvalidDateExprError);
  });

  test("resolves today, tomorrow and yesterday", () => {
    expect(parseDateExpr("today", NOW)).toBe("2026-06-10");
    expect(parseDateExpr("tomorrow", NOW)).toBe("2026-06-11");
    expect(parseDateExpr("yesterday", NOW)).toBe("2026-06-09");
  });

  test("is case-insensitive", () => {
    expect(parseDateExpr("TODAY", NOW)).toBe("2026-06-10");
  });

  test("resolves weekday names to the next future occurrence", () => {
    expect(parseDateExpr("fri", NOW)).toBe("2026-06-12");
    expect(parseDateExpr("friday", NOW)).toBe("2026-06-12");
    expect(parseDateExpr("monday", NOW)).toBe("2026-06-15");
  });

  test("same weekday as today jumps a full week", () => {
    expect(parseDateExpr("wed", NOW)).toBe("2026-06-17");
  });

  test("resolves relative offsets", () => {
    expect(parseDateExpr("3d", NOW)).toBe("2026-06-13");
    expect(parseDateExpr("2w", NOW)).toBe("2026-06-24");
    expect(parseDateExpr("1m", NOW)).toBe("2026-07-10");
    expect(parseDateExpr("1y", NOW)).toBe("2027-06-10");
  });

  test("clamps month arithmetic to the target month's last day", () => {
    expect(parseDateExpr("1m", new Date(2026, 0, 31))).toBe("2026-02-28");
  });

  test("resolves period boundaries with monday-start weeks", () => {
    expect(parseDateExpr("eow", NOW)).toBe("2026-06-14");
    expect(parseDateExpr("sow", NOW)).toBe("2026-06-15");
    expect(parseDateExpr("eom", NOW)).toBe("2026-06-30");
    expect(parseDateExpr("som", NOW)).toBe("2026-07-01");
    expect(parseDateExpr("eoy", NOW)).toBe("2026-12-31");
    expect(parseDateExpr("soy", NOW)).toBe("2027-01-01");
  });

  test("eow on a sunday is today, sow on a monday is next monday", () => {
    const sunday = new Date(2026, 5, 14);
    const monday = new Date(2026, 5, 8);
    expect(parseDateExpr("eow", sunday)).toBe("2026-06-14");
    expect(parseDateExpr("sow", monday)).toBe("2026-06-15");
  });

  test("throws InvalidDateExprError for unknown expressions", () => {
    expect(() => parseDateExpr("someday", NOW)).toThrow("invalid date expression: someday");
  });
});
