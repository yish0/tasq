import { describe, expect, test } from "bun:test";
import { TaskStore, openDb } from "@tasq/core";

function makeStore(): TaskStore {
  return new TaskStore(openDb(":memory:"));
}

describe("TaskStore.create", () => {
  test("creates a task with defaults", () => {
    const store = makeStore();
    const task = store.create({ title: "write spec" });
    expect(task.id).toBe(1);
    expect(task.title).toBe("write spec");
    expect(task.status).toBe("todo");
    expect(task.priority).toBe(0);
    expect(task.tags).toEqual([]);
    expect(task.body).toBe("");
    expect(task.project).toBeNull();
    expect(task.start).toBeNull();
    expect(task.due).toBeNull();
    expect(task.externalRef).toBeNull();
    expect(task.createdAt).toBe(task.updatedAt);
  });

  test("applies input values", () => {
    const store = makeStore();
    const task = store.create({
      title: "t",
      body: "detail",
      priority: 3,
      tags: ["a", "b"],
      project: "tasq",
      start: "2026-06-20",
      due: "2026-07-01",
      externalRef: "github:yish0/tasq#1",
    });
    expect(task.body).toBe("detail");
    expect(task.priority).toBe(3);
    expect(task.tags).toEqual(["a", "b"]);
    expect(task.project).toBe("tasq");
    expect(task.start).toBe("2026-06-20");
    expect(task.due).toBe("2026-07-01");
    expect(task.externalRef).toBe("github:yish0/tasq#1");
  });

  test("records a created event", () => {
    const store = makeStore();
    const task = store.create({ title: "t" });
    const events = store.events(task.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("created");
    expect(events[0]?.payload).toEqual({ title: "t" });
  });
});

describe("TaskStore.get", () => {
  test("returns null for missing id", () => {
    expect(makeStore().get(999)).toBeNull();
  });

  test("returns the created task", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    expect(store.get(created.id)).toEqual(created);
  });
});

describe("TaskStore.events", () => {
  test("returns empty array when no events", () => {
    expect(makeStore().events(1)).toEqual([]);
  });
});
