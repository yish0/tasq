import { describe, expect, test } from "bun:test";
import type { Task } from "@tasq/core";
import { formatTaskDetail, formatTaskLine, treeOrder } from "../src/output";

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

describe("formatTaskLine markers", () => {
  test("indents by depth", () => {
    expect(formatTaskLine(base, { depth: 2 })).toBe("    ◐ #7 P2 ship it");
  });

  test("appends a blocked marker", () => {
    expect(formatTaskLine(base, { blocked: true })).toBe("◐ #7 P2 ship it [blocked]");
  });

  test("appends an archived marker from the task itself", () => {
    const archived: Task = { ...base, archivedAt: "2026-06-07T00:00:00.000Z" };
    expect(formatTaskLine(archived)).toBe("◐ #7 P2 ship it [archived]");
  });
});

describe("formatTaskDetail extras", () => {
  test("shows parent, deps and notes", () => {
    const task: Task = { ...base, parentId: 3 };
    const detail = formatTaskDetail(task, {
      deps: [1, 2],
      notes: [{ createdAt: "2026-06-07T10:00:00.000Z", text: "first note" }],
    });
    expect(detail).toContain("parent:   #3");
    expect(detail).toContain("deps:     #1, #2");
    expect(detail).toContain("notes:");
    expect(detail).toContain("2026-06-07T10:00:00.000Z first note");
  });

  test("marks archived in the status line", () => {
    const detail = formatTaskDetail({ ...base, archivedAt: "2026-06-07T00:00:00.000Z" });
    expect(detail).toContain("status:   in_progress (archived)");
  });

  test("renders dashes when extras are absent", () => {
    const detail = formatTaskDetail(base);
    expect(detail).toContain("parent:   -");
    expect(detail).toContain("deps:     -");
    expect(detail).not.toContain("notes:");
  });
});

describe("treeOrder", () => {
  function t(id: number, parentId: number | null): Task {
    return { ...base, id, parentId };
  }

  test("nests children under parents preserving input order", () => {
    // 입력 순서: 부모(2) → 부모(1) → 자식들
    const tasks = [t(2, null), t(1, null), t(3, 1), t(4, 2), t(5, 3)];
    expect(treeOrder(tasks).map((e) => [e.task.id, e.depth])).toEqual([
      [2, 0],
      [4, 1],
      [1, 0],
      [3, 1],
      [5, 2],
    ]);
  });

  test("promotes children of absent parents to roots", () => {
    const tasks = [t(3, 99)];
    expect(treeOrder(tasks).map((e) => [e.task.id, e.depth])).toEqual([[3, 0]]);
  });
});
