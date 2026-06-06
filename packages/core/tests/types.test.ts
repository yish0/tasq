import { describe, expect, test } from "bun:test";
import { TASK_STATUSES, isTaskStatus } from "@tasq/core";

describe("isTaskStatus", () => {
  test("returns true for defined statuses", () => {
    for (const s of TASK_STATUSES) expect(isTaskStatus(s)).toBe(true);
  });

  test("returns false for unknown statuses", () => {
    expect(isTaskStatus("doing")).toBe(false);
    expect(isTaskStatus("")).toBe(false);
  });
});
