import { describe, expect, test } from "bun:test";
import { InvalidStatusError, TaskNotFoundError, TaskStore, openDb } from "@tasq/core";

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

describe("TaskStore.list", () => {
  function seeded(): TaskStore {
    const store = makeStore();
    store.create({ title: "a", priority: 1, tags: ["x"], project: "p1" });
    store.create({ title: "b", priority: 5, tags: ["x", "y"], project: "p2" });
    store.create({ title: "c", priority: 3, project: "p1" });
    return store;
  }

  test("returns all ordered by priority desc without filter", () => {
    const titles = seeded().list().map((t) => t.title);
    expect(titles).toEqual(["b", "c", "a"]);
  });

  test("filters by status", () => {
    const store = seeded();
    expect(store.list({ status: "todo" })).toHaveLength(3);
    expect(store.list({ status: "done" })).toHaveLength(0);
  });

  test("filters by project", () => {
    const titles = seeded().list({ project: "p1" }).map((t) => t.title);
    expect(titles).toEqual(["c", "a"]);
  });

  test("filters by tag", () => {
    const titles = seeded().list({ tag: "y" }).map((t) => t.title);
    expect(titles).toEqual(["b"]);
  });
});

describe("TaskStore.update", () => {
  test("updates patched fields and records an updated event", () => {
    const store = makeStore();
    const created = store.create({ title: "old", priority: 1 });
    const updated = store.update(created.id, { title: "new", tags: ["t"] });
    expect(updated.title).toBe("new");
    expect(updated.tags).toEqual(["t"]);
    expect(updated.priority).toBe(1);
    const events = store.events(created.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("updated");
    expect(events[1]?.payload).toEqual({ fields: ["title", "tags"] });
  });

  test("clears fields with null", () => {
    const store = makeStore();
    const created = store.create({ title: "t", project: "p", start: "2026-06-20", due: "2026-07-01" });
    const updated = store.update(created.id, { project: null, start: null, due: null });
    expect(updated.project).toBeNull();
    expect(updated.start).toBeNull();
    expect(updated.due).toBeNull();
  });

  test("empty patch changes nothing and records no event", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    const result = store.update(created.id, {});
    expect(result).toEqual(created);
    expect(store.events(created.id)).toHaveLength(1);
  });

  test("throws TaskNotFoundError for missing id", () => {
    expect(() => makeStore().update(999, { title: "x" })).toThrow(TaskNotFoundError);
  });
});

describe("TaskStore.setStatus", () => {
  test("changes status and records a status_changed event", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    const updated = store.setStatus(created.id, "in_progress");
    expect(updated.status).toBe("in_progress");
    const events = store.events(created.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("status_changed");
    expect(events[1]?.payload).toEqual({ from: "todo", to: "in_progress" });
  });

  test("throws InvalidStatusError for invalid status", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    expect(() => store.setStatus(created.id, "doing")).toThrow(InvalidStatusError);
  });

  test("throws TaskNotFoundError for missing id", () => {
    expect(() => makeStore().setStatus(999, "done")).toThrow(TaskNotFoundError);
  });
});
