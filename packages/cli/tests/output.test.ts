import { describe, expect, test } from "bun:test";
import type { Task } from "@tasq/core";
import { formatTaskDetail, formatTaskLine } from "../src/output";

const base: Task = {
  id: 7,
  title: "ship it",
  body: "",
  status: "in_progress",
  priority: 2,
  tags: [],
  project: null,
  start: null,
  due: null,
  externalRef: null,
  parentId: null,
  archivedAt: null,
  createdAt: "2026-06-06T00:00:00.000Z",
  updatedAt: "2026-06-06T01:00:00.000Z",
};

describe("formatTaskLine", () => {
  test("formats a basic single line", () => {
    expect(formatTaskLine(base)).toBe("◐ #7 P2 ship it");
  });

  test("includes project and tags", () => {
    const task: Task = { ...base, status: "todo", project: "tasq", tags: ["a", "b"] };
    expect(formatTaskLine(task)).toBe("○ #7 P2 ship it (tasq) [a,b]");
  });
});

describe("formatTaskDetail", () => {
  test("shows fields as multiple lines", () => {
    const detail = formatTaskDetail(base);
    expect(detail).toContain("#7 ship it");
    expect(detail).toContain("status:   in_progress");
    expect(detail).toContain("tags:     -");
    expect(detail).toContain("project:  -");
  });

  test("appends body at the end when present", () => {
    const detail = formatTaskDetail({ ...base, body: "long description" });
    expect(detail.endsWith("long description")).toBe(true);
  });
});
