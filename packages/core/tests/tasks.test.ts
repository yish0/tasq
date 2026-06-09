import { describe, expect, test } from "bun:test";
import {
  DependencyCycleError,
  InvalidStatusError,
  ParentCycleError,
  TaskNotFoundError,
  TaskStore,
  openDb,
} from "@tasq/core";

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
    expect(task.parentId).toBeNull();
    expect(task.archivedAt).toBeNull();
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
    const titles = seeded().list({ tags: ["x"] }).map((t) => t.title);
    expect(titles).toEqual(["b", "a"]);
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
    expect(events[1]?.payload).toEqual({
      fields: {
        title: { from: "old", to: "new" },
        tags: { from: [], to: ["t"] },
      },
    });
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

describe("TaskStore.remove", () => {
  test("removes the task but keeps the deleted event", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    store.remove(created.id);
    expect(store.get(created.id)).toBeNull();
    const events = store.events(created.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("deleted");
  });

  test("throws TaskNotFoundError for missing id", () => {
    expect(() => makeStore().remove(999)).toThrow(TaskNotFoundError);
  });
});

describe("TaskStore subtasks", () => {
  test("creates a task under a parent", () => {
    const store = makeStore();
    const parent = store.create({ title: "p" });
    const child = store.create({ title: "c", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  test("rejects a missing parent on create", () => {
    const store = makeStore();
    expect(() => store.create({ title: "c", parentId: 99 })).toThrow("task not found: 99");
  });

  test("lists children ordered by priority then id", () => {
    const store = makeStore();
    const parent = store.create({ title: "p" });
    store.create({ title: "low", parentId: parent.id, priority: 1 });
    store.create({ title: "high", parentId: parent.id, priority: 5 });
    store.create({ title: "other" });
    expect(store.children(parent.id).map((t) => t.title)).toEqual(["high", "low"]);
  });

  test("moves a task to a new parent and clears with null", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    expect(store.update(b.id, { parentId: a.id }).parentId).toBe(a.id);
    expect(store.update(b.id, { parentId: null }).parentId).toBeNull();
  });

  test("rejects self and descendant as parent", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b", parentId: a.id });
    const c = store.create({ title: "c", parentId: b.id });
    expect(() => store.update(a.id, { parentId: a.id })).toThrow(ParentCycleError);
    expect(() => store.update(a.id, { parentId: c.id })).toThrow(ParentCycleError);
  });

  test("rejects a missing parent on update", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    expect(() => store.update(a.id, { parentId: 99 })).toThrow("task not found: 99");
  });
});

describe("TaskStore.update event payload", () => {
  test("records before and after values per field", () => {
    const store = makeStore();
    const task = store.create({ title: "old", priority: 1 });
    store.update(task.id, { title: "new", priority: 3 });
    const updated = store.events(task.id).find((e) => e.type === "updated");
    expect(updated?.payload).toEqual({
      fields: {
        title: { from: "old", to: "new" },
        priority: { from: 1, to: 3 },
      },
    });
  });
});

describe("TaskStore dependencies", () => {
  test("adds a dependency and lists it", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    store.addDep(a.id, b.id);
    expect(store.depsOf(a.id)).toEqual([b.id]);
    const events = store.events(a.id);
    expect(events.at(-1)?.type).toBe("dep_added");
    expect(events.at(-1)?.payload).toEqual({ dependsOnId: b.id });
  });

  test("duplicate add is a silent no-op without an event", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    store.addDep(a.id, b.id);
    const count = store.events(a.id).length;
    store.addDep(a.id, b.id);
    expect(store.events(a.id)).toHaveLength(count);
  });

  test("rejects self, direct and transitive cycles", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    const c = store.create({ title: "c" });
    expect(() => store.addDep(a.id, a.id)).toThrow(DependencyCycleError);
    store.addDep(a.id, b.id);
    expect(() => store.addDep(b.id, a.id)).toThrow(DependencyCycleError);
    store.addDep(b.id, c.id);
    expect(() => store.addDep(c.id, a.id)).toThrow(DependencyCycleError);
  });

  test("rejects missing tasks on either side", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    expect(() => store.addDep(a.id, 99)).toThrow("task not found: 99");
    expect(() => store.addDep(99, a.id)).toThrow("task not found: 99");
  });

  test("removes a dependency with an event, no-op when absent", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    store.addDep(a.id, b.id);
    store.removeDep(a.id, b.id);
    expect(store.depsOf(a.id)).toEqual([]);
    expect(store.events(a.id).at(-1)?.type).toBe("dep_removed");
    const count = store.events(a.id).length;
    store.removeDep(a.id, b.id);
    expect(store.events(a.id)).toHaveLength(count);
  });

  test("blockedTaskIds contains tasks with open deps only", () => {
    const store = makeStore();
    const blocked = store.create({ title: "blocked" });
    const openDep = store.create({ title: "open" });
    const free = store.create({ title: "free" });
    const doneDep = store.create({ title: "done" });
    store.addDep(blocked.id, openDep.id);
    store.addDep(free.id, doneDep.id);
    store.setStatus(doneDep.id, "done");
    const ids = store.blockedTaskIds();
    expect(ids.has(blocked.id)).toBe(true);
    expect(ids.has(free.id)).toBe(false);
  });

  test("openDepsOf lists incomplete prerequisites", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    const open = store.create({ title: "open" });
    const closed = store.create({ title: "closed" });
    store.addDep(t.id, open.id);
    store.addDep(t.id, closed.id);
    store.setStatus(closed.id, "done");
    expect(store.openDepsOf(t.id)).toEqual([open.id]);
  });
});
