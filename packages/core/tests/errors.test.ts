import { describe, expect, test } from "bun:test";
import { InvalidStatusError, TaskNotFoundError } from "@tasq/core";

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
