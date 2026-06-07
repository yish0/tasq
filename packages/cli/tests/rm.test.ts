import { describe, expect, test } from "bun:test";
import { rmCommand } from "../src/commands/rm";
import { createTestCli } from "./helpers";

describe("rm", () => {
  test("deletes a task", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(rmCommand.run(["1"], ctx)).toBe(0);
    expect(out).toEqual(["deleted #1"]);
    expect(ctx.store.get(1)).toBeNull();
  });

  test("prints usage and exits 1 for invalid id", () => {
    const { ctx, err } = createTestCli();
    expect(rmCommand.run(["x"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("throws core error for missing task (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => rmCommand.run(["99"], ctx)).toThrow("task not found: 99");
  });
});
