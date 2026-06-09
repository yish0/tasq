import { describe, expect, test } from "bun:test";
import { depCommand } from "../src/commands/dep";
import { createTestCli } from "./helpers";

function seed3(ctx: ReturnType<typeof createTestCli>["ctx"]): void {
  ctx.store.create({ title: "a" });
  ctx.store.create({ title: "b" });
  ctx.store.create({ title: "c" });
}

describe("dep", () => {
  test("adds multiple dependencies at once", () => {
    const { ctx, out } = createTestCli();
    seed3(ctx);
    expect(depCommand.run(["add", "1", "2", "3"], ctx)).toBe(0);
    expect(ctx.store.depsOf(1)).toEqual([2, 3]);
    expect(out).toEqual(["#1 now depends on #2, #3"]);
  });

  test("removes a dependency", () => {
    const { ctx, out } = createTestCli();
    seed3(ctx);
    ctx.store.addDep(1, 2);
    expect(depCommand.run(["rm", "1", "2"], ctx)).toBe(0);
    expect(ctx.store.depsOf(1)).toEqual([]);
    expect(out).toEqual(["removed #2 from #1 deps"]);
  });

  test("rolls back the whole add when one edge would create a cycle", () => {
    const { ctx } = createTestCli();
    seed3(ctx);
    ctx.store.addDep(2, 1);
    expect(() => depCommand.run(["add", "1", "3", "2"], ctx)).toThrow("dependency cycle");
    expect(ctx.store.depsOf(1)).toEqual([]);
  });

  test("prints usage for bad subcommand or missing ids", () => {
    const { ctx, err } = createTestCli();
    expect(depCommand.run(["link", "1", "2"], ctx)).toBe(1);
    expect(depCommand.run(["add", "1"], ctx)).toBe(1);
    expect(depCommand.run(["add"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });
});
