import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/index";

describe("main", () => {
  test("runs commands against process.env.TASQ_HOME", () => {
    const home = mkdtempSync(join(tmpdir(), "tasq-main-"));
    const prev = process.env.TASQ_HOME;
    process.env.TASQ_HOME = home;
    try {
      expect(main(["add", "from main"])).toBe(0);
      expect(main(["list"])).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.TASQ_HOME;
      else process.env.TASQ_HOME = prev;
    }
  });
});
