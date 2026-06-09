import { describe, expect, test } from "bun:test";
import {
  cancelCommand,
  doneCommand,
  reopenCommand,
  startCommand,
} from "../src/commands/lifecycle";
import { createTestCli } from "./helpers";

describe("done", () => {
  test("completes multiple tasks in one call", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    expect(doneCommand.run(["1", "2"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → done", "#2 → done"]);
  });

  test("rolls back all when one id fails", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(() => doneCommand.run(["1", "99"], ctx)).toThrow("task not found: 99");
    expect(ctx.store.get(1)?.status).toBe("todo");
  });

  test("prints a JSON array with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    doneCommand.run(["1", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "")[0].status).toBe("done");
  });

  test("prints usage without ids", () => {
    const { ctx, err } = createTestCli();
    expect(doneCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });
});

describe("start", () => {
  test("starts a todo task", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(startCommand.run(["1"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → in_progress"]);
  });

  test("warns about incomplete prerequisites but proceeds", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "dep" });
    ctx.store.addDep(1, 2);
    expect(startCommand.run(["1"], ctx)).toBe(0);
    expect(err).toEqual(["warning: #1 depends on incomplete #2"]);
    expect(ctx.store.get(1)?.status).toBe("in_progress");
  });

  test("warns once per open prerequisite", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "d1" });
    ctx.store.create({ title: "d2" });
    ctx.store.addDep(1, 2);
    ctx.store.addDep(1, 3);
    expect(startCommand.run(["1"], ctx)).toBe(0);
    expect(err).toEqual([
      "warning: #1 depends on incomplete #2",
      "warning: #1 depends on incomplete #3",
    ]);
  });

  test("rejects starting from done", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.setStatus(1, "done");
    expect(() => startCommand.run(["1"], ctx)).toThrow("invalid transition: done -> in_progress");
  });
});

describe("cancel", () => {
  test("cancels an open task", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(cancelCommand.run(["1"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → cancelled"]);
  });

  test("rejects cancelling a done task", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.setStatus(1, "done");
    expect(() => cancelCommand.run(["1"], ctx)).toThrow("invalid transition: done -> cancelled");
  });
});

describe("reopen", () => {
  test("reopens done and cancelled tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    ctx.store.setStatus(1, "done");
    ctx.store.setStatus(2, "cancelled");
    expect(reopenCommand.run(["1", "2"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → todo", "#2 → todo"]);
  });

  test("rejects reopening an open task", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(() => reopenCommand.run(["1"], ctx)).toThrow("invalid transition: todo -> todo");
  });
});
