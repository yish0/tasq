import { describe, expect, test } from "bun:test";
import { showCommand } from "../src/commands/show";
import { createTestCli } from "./helpers";

describe("show", () => {
  test("prints task detail", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(showCommand.run(["1"], ctx)).toBe(0);
    expect(out[0]).toContain("#1 t");
    expect(out[0]).toContain("status:   todo");
  });

  test("prints task JSON with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    showCommand.run(["1", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "").title).toBe("t");
  });

  test("prints usage and exits 1 for invalid id", () => {
    const { ctx, err } = createTestCli();
    expect(showCommand.run(["abc"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("exits 1 for missing task", () => {
    const { ctx, err } = createTestCli();
    expect(showCommand.run(["99"], ctx)).toBe(1);
    expect(err).toEqual(["task not found: 99"]);
  });
});
