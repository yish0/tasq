import { describe, expect, test } from "bun:test";
import { updateCommand } from "../src/commands/update";
import { createTestCli } from "./helpers";

describe("update", () => {
  test("patches only flagged fields", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "old", priority: 1, project: "keep" });
    const code = updateCommand.run(["1", "--title", "new", "--tag", "a", "--priority", "4"], ctx);
    expect(code).toBe(0);
    expect(out).toEqual(["updated #1"]);
    const task = ctx.store.get(1);
    expect(task?.title).toBe("new");
    expect(task?.tags).toEqual(["a"]);
    expect(task?.priority).toBe(4);
    expect(task?.project).toBe("keep");
  });

  test("patches body, project, start and due", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t" });
    updateCommand.run(["1", "--body", "detail", "--project", "tasq", "--start", "2026-07-15", "--due", "2026-08-01"], ctx);
    const task = ctx.store.get(1);
    expect(task?.body).toBe("detail");
    expect(task?.project).toBe("tasq");
    expect(task?.start).toBe("2026-07-15");
    expect(task?.due).toBe("2026-08-01");
  });

  test("prints updated task JSON with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "old" });
    updateCommand.run(["1", "--title", "new", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "").title).toBe("new");
  });

  test("errors with nothing to update when no flags given", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(updateCommand.run(["1"], ctx)).toBe(1);
    expect(err).toEqual(["nothing to update"]);
  });

  test("prints usage and exits 1 for invalid id", () => {
    const { ctx, err } = createTestCli();
    expect(updateCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("exits 1 for non-numeric priority", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(updateCommand.run(["1", "--priority", "high"], ctx)).toBe(1);
    expect(err).toEqual(["invalid priority: high"]);
  });

  test("throws core error for missing task (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => updateCommand.run(["99", "--title", "x"], ctx)).toThrow("task not found: 99");
  });

  test("moves under a parent and clears with none", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "c" });
    updateCommand.run(["2", "--parent", "1"], ctx);
    expect(ctx.store.get(2)?.parentId).toBe(1);
    updateCommand.run(["2", "--parent", "none"], ctx);
    expect(ctx.store.get(2)?.parentId).toBeNull();
  });

  test("rejects an invalid --parent value", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(updateCommand.run(["1", "--parent", "x"], ctx)).toBe(1);
    expect(err).toEqual(["invalid parent: x"]);
  });

  test("clears nullable fields with none", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t", project: "p", due: "2026-07-01", start: "2026-06-20" });
    updateCommand.run(["1", "--project", "none", "--due", "none", "--start", "none"], ctx);
    const task = ctx.store.get(1);
    expect(task?.project).toBeNull();
    expect(task?.due).toBeNull();
    expect(task?.start).toBeNull();
  });

  test("resolves date expressions for --due", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t" });
    updateCommand.run(["1", "--due", "2026-12-31"], ctx);
    expect(ctx.store.get(1)?.due).toBe("2026-12-31");
  });
});
