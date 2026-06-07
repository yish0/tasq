import { describe, expect, test } from "bun:test";
import { runCli } from "../src/app";
import { CommandRegistry, type Command } from "../src/registry";
import { createTestCli } from "./helpers";

const hello: Command = {
  name: "hello",
  description: "say hello",
  usage: "tasq hello",
  run(_args, ctx) {
    ctx.stdout("hi");
    return 0;
  },
};

const boomError: Command = {
  name: "boom-error",
  description: "throw Error",
  usage: "tasq boom-error",
  run() {
    throw new Error("kaboom");
  },
};

const boomString: Command = {
  name: "boom-string",
  description: "throw string",
  usage: "tasq boom-string",
  run() {
    throw "raw failure";
  },
};

function makeRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(hello);
  registry.register(boomError);
  registry.register(boomString);
  return registry;
}

describe("runCli", () => {
  test("dispatches to a command", () => {
    const { ctx, out } = createTestCli();
    const code = runCli(["hello"], ctx, makeRegistry());
    expect(code).toBe(0);
    expect(out).toEqual(["hi"]);
  });

  test("prints help when no args", () => {
    const { ctx, out } = createTestCli();
    const code = runCli([], ctx, makeRegistry());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("hello");
    expect(out.join("\n")).toContain("say hello");
  });

  test("prints help for help and --help", () => {
    for (const arg of ["help", "--help"]) {
      const { ctx, out } = createTestCli();
      expect(runCli([arg], ctx, makeRegistry())).toBe(0);
      expect(out.join("\n")).toContain("usage: tasq");
    }
  });

  test("exits 1 for unknown command", () => {
    const { ctx, err } = createTestCli();
    const code = runCli(["nope"], ctx, makeRegistry());
    expect(code).toBe(1);
    expect(err).toEqual(["unknown command: nope"]);
  });

  test("writes Error message to stderr", () => {
    const { ctx, err } = createTestCli();
    expect(runCli(["boom-error"], ctx, makeRegistry())).toBe(1);
    expect(err).toEqual(["kaboom"]);
  });

  test("handles non-Error throws", () => {
    const { ctx, err } = createTestCli();
    expect(runCli(["boom-string"], ctx, makeRegistry())).toBe(1);
    expect(err).toEqual(["raw failure"]);
  });
});
