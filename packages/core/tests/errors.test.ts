import { describe, expect, test } from "bun:test";
import {
  DependencyCycleError,
  HasSubtasksError,
  IncompleteSubtaskError,
  InvalidStatusError,
  InvalidTransitionError,
  NotArchivedError,
  ParentArchivedError,
  ParentCycleError,
  TaskNotFoundError,
} from "@tasq/core";

describe("errors", () => {
  test("TaskNotFoundError preserves task id", () => {
    const err = new TaskNotFoundError(42);
    expect(err.taskId).toBe(42);
    expect(err.message).toBe("task not found: 42");
    expect(err.name).toBe("TaskNotFoundError");
  });

  test("InvalidStatusError preserves status", () => {
    const err = new InvalidStatusError("doing");
    expect(err.status).toBe("doing");
    expect(err.message).toBe("invalid status: doing");
    expect(err.name).toBe("InvalidStatusError");
  });
});

describe("batch A errors", () => {
  test("DependencyCycleError names the edge", () => {
    const e = new DependencyCycleError(1, 2);
    expect(e.name).toBe("DependencyCycleError");
    expect(e.message).toBe("dependency cycle: #1 -> #2");
  });

  test("ParentCycleError names the edge", () => {
    const e = new ParentCycleError(3, 4);
    expect(e.name).toBe("ParentCycleError");
    expect(e.message).toBe("parent cycle: #3 -> #4");
  });

  test("IncompleteSubtaskError lists open subtasks", () => {
    const e = new IncompleteSubtaskError(1, [2, 3]);
    expect(e.name).toBe("IncompleteSubtaskError");
    expect(e.message).toBe("cannot complete #1: incomplete subtasks #2, #3");
  });

  test("InvalidTransitionError shows from and to", () => {
    const e = new InvalidTransitionError("cancelled", "done");
    expect(e.name).toBe("InvalidTransitionError");
    expect(e.message).toBe("invalid transition: cancelled -> done");
  });

  test("HasSubtasksError suggests --recursive", () => {
    const e = new HasSubtasksError(5);
    expect(e.name).toBe("HasSubtasksError");
    expect(e.message).toBe("#5 has subtasks — use --recursive");
  });

  test("ParentArchivedError suggests restoring the parent first", () => {
    const e = new ParentArchivedError(6, 2);
    expect(e.name).toBe("ParentArchivedError");
    expect(e.message).toBe("cannot restore #6: parent #2 is archived — restore it first");
  });

  test("NotArchivedError names the task", () => {
    const e = new NotArchivedError(7);
    expect(e.name).toBe("NotArchivedError");
    expect(e.message).toBe("#7 is not archived");
  });
});
