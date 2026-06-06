import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../src/context";

describe("createContext", () => {
  test("bootstraps TASQ_HOME and creates a working store", () => {
    const home = mkdtempSync(join(tmpdir(), "tasq-ctx-"));
    const ctx = createContext({ TASQ_HOME: home });
    const task = ctx.store.create({ title: "t" });
    expect(task.id).toBe(1);
    expect(existsSync(join(home, "tasq.db"))).toBe(true);
  });
});
