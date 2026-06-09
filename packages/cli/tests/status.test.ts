import { describe, expect, test } from "bun:test";
import { statusCommand } from "../src/commands/status";
import { createTestCli } from "./helpers";

describe("status", () => {
  test("transitions task status", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    const code = statusCommand.run(["1", "in_progress"], ctx);
    expect(code).toBe(0);
    expect(out).toEqual(["#1 → in_progress"]);
    expect(ctx.store.get(1)?.status).toBe("in_progress");
  });

  test("updates multiple ids in one transaction", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    expect(statusCommand.run(["1", "2", "in_progress"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → in_progress", "#2 → in_progress"]);
  });

  test("prints updated task JSON with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    statusCommand.run(["1", "done", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "")[0].status).toBe("done");
  });

  test("prints usage and exits 1 when id or status is missing", () => {
    const { ctx, err } = createTestCli();
    expect(statusCommand.run(["1"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("throws core error for invalid status (handled by runCli)", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(() => statusCommand.run(["1", "doing"], ctx)).toThrow("invalid status: doing");
  });
});
