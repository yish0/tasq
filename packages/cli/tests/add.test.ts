import { describe, expect, test } from "bun:test";
import { addCommand } from "../src/commands/add";
import { createTestCli } from "./helpers";

describe("add", () => {
  test("creates a task from positionals joined with spaces", () => {
    const { ctx, out } = createTestCli();
    const code = addCommand.run(["write", "the", "spec"], ctx);
    expect(code).toBe(0);
    expect(out).toEqual(["created #1: write the spec"]);
    expect(ctx.store.get(1)?.title).toBe("write the spec");
  });

  test("applies options", () => {
    const { ctx } = createTestCli();
    addCommand.run(
      ["t", "--body", "detail", "--priority", "3", "--tag", "a", "--tag", "b", "--project", "tasq", "--start", "2026-06-10", "--due", "2026-07-01"],
      ctx,
    );
    const task = ctx.store.get(1);
    expect(task?.body).toBe("detail");
    expect(task?.priority).toBe(3);
    expect(task?.tags).toEqual(["a", "b"]);
    expect(task?.project).toBe("tasq");
    expect(task?.start).toBe("2026-06-10");
    expect(task?.due).toBe("2026-07-01");
  });

  test("parses taskwarrior-style tokens", () => {
    const { ctx } = createTestCli();
    addCommand.run(["fix", "login", "bug", "^3", ":backend", "+bug", "+urgent"], ctx);
    const task = ctx.store.get(1);
    expect(task?.title).toBe("fix login bug");
    expect(task?.priority).toBe(3);
    expect(task?.project).toBe("backend");
    expect(task?.tags).toEqual(["bug", "urgent"]);
  });

  test("flags win over tokens for the same field", () => {
    const { ctx } = createTestCli();
    addCommand.run(["t", "^1", ":a", "+x", "--priority", "5", "--project", "b", "--tag", "y"], ctx);
    const task = ctx.store.get(1);
    expect(task?.priority).toBe(5);
    expect(task?.project).toBe("b");
    expect(task?.tags).toEqual(["y"]);
  });

  test("prints task JSON with --json", () => {
    const { ctx, out } = createTestCli();
    addCommand.run(["t", "--json"], ctx);
    const task = JSON.parse(out[0] ?? "");
    expect(task.id).toBe(1);
    expect(task.title).toBe("t");
  });

  test("exits 1 without title", () => {
    const { ctx, err } = createTestCli();
    expect(addCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("exits 1 for non-numeric priority", () => {
    const { ctx, err } = createTestCli();
    expect(addCommand.run(["t", "--priority", "high"], ctx)).toBe(1);
    expect(err).toEqual(["invalid priority: high"]);
  });

  test("creates a subtask with --parent", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "p" });
    addCommand.run(["c", "--parent", "1"], ctx);
    expect(ctx.store.get(2)?.parentId).toBe(1);
  });

  test("rejects an invalid --parent value", () => {
    const { ctx, err } = createTestCli();
    expect(addCommand.run(["c", "--parent", "x"], ctx)).toBe(1);
    expect(err).toEqual(["invalid parent: x"]);
  });

  test("resolves date expressions for --due and --start", () => {
    const { ctx } = createTestCli();
    addCommand.run(["t", "--due", "tomorrow", "--start", "today"], ctx);
    const task = ctx.store.get(1);
    // 상대 표현이 ISO 날짜로 해석되고(리터럴 미저장) tomorrow가 today보다 뒤임을 확인.
    // 정확한 값 대신 형태+순서를 단정해 자정 경계 flake를 제거한다.
    expect(task?.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(task?.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(task?.start) < String(task?.due)).toBe(true);
  });

  test("throws on an invalid date expression (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => addCommand.run(["t", "--due", "blah"], ctx)).toThrow("invalid date expression");
  });
});
