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
    const tasks = JSON.parse(out[0] ?? "");
    expect(tasks).toHaveLength(2);
  });

  test("filters by status/project/tag", () => {
    const { ctx, out } = seeded();
    listCommand.run(["--project", "p1", "--tag", "x", "--status", "todo"], ctx);
    expect(out).toEqual(["○ #1 P1 a (p1) [x]"]);
  });

  test("exits 1 for invalid status", () => {
    const { ctx, err } = seeded();
    expect(listCommand.run(["--status", "doing"], ctx)).toBe(1);
    expect(err).toEqual(["invalid status: doing"]);
  });
});
