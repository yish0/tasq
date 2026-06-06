import { describe, expect, test } from "bun:test";
import { openDb } from "@tasq/core";

describe("openDb", () => {
  test("creates tasks and events tables", () => {
    const db = openDb(":memory:");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("tasks");
    expect(names).toContain("events");
  });

  test("sets user_version to 1", () => {
    const db = openDb(":memory:");
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(1);
  });
});
