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

  test("shows parent, deps and notes", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "dep" });
    ctx.store.create({ title: "t", parentId: 1 });
    ctx.store.addDep(3, 2);
    ctx.store.addComment(3, "first note");
    showCommand.run(["3"], ctx);
    const detail = out.join("\n");
    expect(detail).toContain("parent:   #1");
    expect(detail).toContain("deps:     #2");
    expect(detail).toContain("first note");
  });

  test("includes deps and notes in JSON output", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    ctx.store.create({ title: "dep" });
    ctx.store.addDep(1, 2);
    ctx.store.addComment(1, "n");
    showCommand.run(["1", "--json"], ctx);
    const data = JSON.parse(out[0] ?? "");
    expect(data.deps).toEqual([2]);
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0].payload.text).toBe("n");
  });
});
