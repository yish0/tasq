import { describe, expect, test } from "bun:test";
import { rmCommand } from "../src/commands/rm";
import { createTestCli } from "./helpers";

describe("rm", () => {
  test("archives by default", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(rmCommand.run(["1"], ctx)).toBe(0);
    expect(out).toEqual(["archived #1"]);
    expect(ctx.store.get(1)?.archivedAt).not.toBeNull();
  });

  test("deletes permanently with --hard", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(rmCommand.run(["1", "--hard"], ctx)).toBe(0);
    expect(out).toEqual(["deleted #1"]);
    expect(ctx.store.get(1)).toBeNull();
  });

  test("archives multiple ids in one transaction", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    expect(rmCommand.run(["1", "2"], ctx)).toBe(0);
    expect(out).toEqual(["archived #1, #2"]);
  });

  test("blocks on subtasks without --recursive", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "c", parentId: 1 });
    expect(() => rmCommand.run(["1"], ctx)).toThrow("has subtasks");
    expect(rmCommand.run(["1", "-r"], ctx)).toBe(0);
    expect(ctx.store.get(2)?.archivedAt).not.toBeNull();
  });

  test("prints usage and exits 1 for invalid id", () => {
    const { ctx, err } = createTestCli();
    expect(rmCommand.run(["x"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("throws for a missing task (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => rmCommand.run(["99"], ctx)).toThrow("task not found: 99");
  });
});
