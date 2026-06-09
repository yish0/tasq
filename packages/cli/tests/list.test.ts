import { describe, expect, test } from "bun:test";
import { listCommand } from "../src/commands/list";
import { createTestCli, type TestCli } from "./helpers";

function seeded(): TestCli {
  const cli = createTestCli();
  cli.ctx.store.create({ title: "a", priority: 1, tags: ["x"], project: "p1" });
  cli.ctx.store.create({ title: "b", priority: 5, project: "p2" });
  return cli;
}

describe("list", () => {
  test("prints one line per task", () => {
    const { ctx, out } = seeded();
    expect(listCommand.run([], ctx)).toBe(0);
    expect(out).toEqual(["○ #2 P5 b (p2)", "○ #1 P1 a (p1) [x]"]);
  });

  test("prints no tasks when empty", () => {
    const { ctx, out } = createTestCli();
    expect(listCommand.run([], ctx)).toBe(0);
    expect(out).toEqual(["no tasks"]);
  });

  test("prints JSON array with --json", () => {
    const { ctx, out } = seeded();
    listCommand.run(["--json"], ctx);
    expect(JSON.parse(out[0] ?? "")).toHaveLength(2);
  });

  test("filters by status, project and multiple tags", () => {
    const { ctx, out } = seeded();
    ctx.store.create({ title: "c", tags: ["x", "y"], project: "p1" });
    listCommand.run(["--project", "p1", "--tag", "x", "--tag", "y", "--status", "todo"], ctx);
    expect(out).toEqual(["○ #3 P0 c (p1) [x,y]"]);
  });

  test("exits 1 for invalid status", () => {
    const { ctx, err } = seeded();
    expect(listCommand.run(["--status", "doing"], ctx)).toBe(1);
    expect(err).toEqual(["invalid status: doing"]);
  });

  test("filters overdue tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "old", due: "2000-01-01" });
    ctx.store.create({ title: "future", due: "2999-01-01" });
    listCommand.run(["--overdue"], ctx);
    expect(out).toEqual(["○ #1 P0 old"]);
  });

  test("filters by due-before with a date expression", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "old", due: "2000-01-01" });
    ctx.store.create({ title: "future", due: "2999-01-01" });
    listCommand.run(["--due-before", "today"], ctx);
    expect(out).toEqual(["○ #1 P0 old"]);
  });

  test("searches title and body", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "fix login" });
    ctx.store.create({ title: "other" });
    listCommand.run(["--search", "login"], ctx);
    expect(out).toEqual(["○ #1 P0 fix login"]);
  });

  test("ready excludes dep-blocked tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "blocked" });
    ctx.store.create({ title: "dep" });
    ctx.store.addDep(1, 2);
    listCommand.run(["--ready"], ctx);
    expect(out).toEqual(["○ #2 P0 dep"]);
  });

  test("renders a tree by default and flat with --flat", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "c", parentId: 1 });
    listCommand.run([], ctx);
    expect(out).toEqual(["○ #1 P0 p", "  ○ #2 P0 c"]);
    out.length = 0;
    listCommand.run(["--flat"], ctx);
    expect(out).toEqual(["○ #1 P0 p", "○ #2 P0 c"]);
  });

  test("any filter forces flat output", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "c", parentId: 1 });
    listCommand.run(["--status", "todo"], ctx);
    expect(out).toEqual(["○ #1 P0 p", "○ #2 P0 c"]);
  });

  test("marks dep-blocked tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "blocked" });
    ctx.store.create({ title: "dep" });
    ctx.store.addDep(1, 2);
    listCommand.run([], ctx);
    expect(out).toEqual(["○ #1 P0 blocked [blocked]", "○ #2 P0 dep"]);
  });

  test("includes archived tasks with --all keeping the tree", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "live" });
    ctx.store.create({ title: "dead" });
    ctx.store.archive(2);
    listCommand.run(["--all"], ctx);
    expect(out).toEqual(["○ #1 P0 live", "○ #2 P0 dead [archived]"]);
  });
});
