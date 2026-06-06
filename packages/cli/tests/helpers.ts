import { TaskStore, openDb } from "@tasq/core";
import type { CliContext } from "../src/registry";

export interface TestCli {
  ctx: CliContext;
  out: string[];
  err: string[];
}

export function createTestCli(): TestCli {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    store: new TaskStore(openDb(":memory:")),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
  return { ctx, out, err };
}
