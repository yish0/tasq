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
    expect(home.backupsDir).toBe(join("/tmp/custom", "backups"));
  });

  test("defaults to ~/.tasq", () => {
    const home = resolveTasqHome({});
    const root = join(homedir(), ".tasq");
    expect(home.root).toBe(root);
    expect(home.backupsDir).toBe(join(root, "backups"));
  });
});

describe("ensureTasqHome", () => {
  test("creates directories recursively", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tasq-home-"));
    const home = ensureTasqHome(resolveTasqHome({ TASQ_HOME: join(tmp, "nested", ".tasq") }));
    expect(existsSync(home.pluginsDir)).toBe(true);
  });
});
