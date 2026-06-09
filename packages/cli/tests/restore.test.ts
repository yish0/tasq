import { describe, expect, test } from "bun:test";
import { restoreCommand } from "../src/commands/restore";
import { createTestCli } from "./helpers";

describe("restore", () => {
  test("restores archived tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    ctx.store.archive(1);
    ctx.store.archive(2);
    expect(restoreCommand.run(["1", "2"], ctx)).toBe(0);
    expect(out).toEqual(["restored #1, #2"]);
    expect(ctx.store.get(1)?.archivedAt).toBeNull();
  });

  test("prints JSON with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.archive(1);
    restoreCommand.run(["1", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "")[0].archivedAt).toBeNull();
  });

  test("prints usage without ids", () => {
    const { ctx, err } = createTestCli();
    expect(restoreCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("throws for a non-archived task (handled by runCli)", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(() => restoreCommand.run(["1"], ctx)).toThrow("not archived");
  });
});
