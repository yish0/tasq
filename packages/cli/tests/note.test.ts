import { describe, expect, test } from "bun:test";
import { noteCommand } from "../src/commands/note";
import { createTestCli } from "./helpers";

describe("note", () => {
  test("appends a comment built from remaining args", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(noteCommand.run(["1", "tried", "the", "fix"], ctx)).toBe(0);
    expect(out).toEqual(["note added to #1"]);
    expect(ctx.store.comments(1)[0]?.payload).toEqual({ text: "tried the fix" });
  });

  test("prints the event as JSON with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    noteCommand.run(["1", "hello", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "").type).toBe("comment");
  });

  test("prints usage when id or text is missing", () => {
    const { ctx, err } = createTestCli();
    expect(noteCommand.run([], ctx)).toBe(1);
    expect(noteCommand.run(["1"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("throws for a missing task (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => noteCommand.run(["99", "x"], ctx)).toThrow("task not found: 99");
  });
});
