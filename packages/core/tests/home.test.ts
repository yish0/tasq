import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTasqHome, resolveTasqHome } from "@tasq/core";

describe("resolveTasqHome", () => {
  test("TASQ_HOME env var determines root", () => {
    const home = resolveTasqHome({ TASQ_HOME: "/tmp/custom" });
    expect(home.root).toBe("/tmp/custom");
    expect(home.dbPath).toBe(join("/tmp/custom", "tasq.db"));
    expect(home.pluginsDir).toBe(join("/tmp/custom", "plugins"));
  });

  test("defaults to ~/.tasq", () => {
    const home = resolveTasqHome({});
    expect(home.root).toBe(join(homedir(), ".tasq"));
  });
});

describe("ensureTasqHome", () => {
  test("creates directories recursively", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tasq-home-"));
    const home = ensureTasqHome(resolveTasqHome({ TASQ_HOME: join(tmp, "nested", ".tasq") }));
    expect(existsSync(home.pluginsDir)).toBe(true);
  });
});
