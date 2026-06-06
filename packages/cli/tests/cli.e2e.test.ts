import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("e2e: add → list → status round trip", () => {
  const home = mkdtempSync(join(tmpdir(), "tasq-e2e-"));
  const entry = join(import.meta.dir, "../src/index.ts");
  const env = { ...process.env, TASQ_HOME: home };
  const run = (...args: string[]) => Bun.spawnSync(["bun", "run", entry, ...args], { env });

  const add = run("add", "hello world");
  expect(add.exitCode).toBe(0);
  expect(add.stdout.toString()).toContain("created #1");

  const list = run("list", "--json");
  const tasks = JSON.parse(list.stdout.toString());
  expect(tasks).toHaveLength(1);
  expect(tasks[0].title).toBe("hello world");

  const done = run("status", "1", "done");
  expect(done.exitCode).toBe(0);
  expect(done.stdout.toString()).toContain("#1 → done");
});
