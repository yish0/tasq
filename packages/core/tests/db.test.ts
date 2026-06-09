import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, SchemaTooNewError, openDb } from "@tasq/core";

// 테스트용 v1 스키마 스냅샷 — 마이그레이션 경로 검증에 사용
const V1_DDL = `
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  project TEXT,
  start TEXT,
  due TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_events_task_id ON events(task_id);
`;

function makeV1Db(dir: string): string {
  const path = join(dir, "tasq.db");
  const db = new Database(path, { create: true });
  db.exec(V1_DDL);
  db.exec("PRAGMA user_version = 1;");
  db.query(
    "INSERT INTO tasks (title, created_at, updated_at) VALUES ('keep me', '2026-01-01', '2026-01-01')",
  ).run();
  db.close();
  return path;
}

describe("openDb", () => {
  test("creates a fresh database at the latest schema version", () => {
    const db = openDb(":memory:");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("tasks");
    expect(names).toContain("events");
    expect(names).toContain("task_deps");
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(SCHEMA_VERSION);
  });

  test("v2 adds parent_id and archived_at columns to tasks", () => {
    const db = openDb(":memory:");
    const cols = db.query("PRAGMA table_info(tasks)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("parent_id");
    expect(names).toContain("archived_at");
  });

  test("upgrades a v1 database preserving rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasq-db-"));
    const path = makeV1Db(dir);
    const db = openDb(path);
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(SCHEMA_VERSION);
    const task = db.query("SELECT * FROM tasks WHERE id = 1").get() as {
      title: string;
      parent_id: number | null;
    };
    expect(task.title).toBe("keep me");
    expect(task.parent_id).toBeNull();
  });

  test("writes a backup snapshot before migrating when backupDir is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasq-db-"));
    const path = makeV1Db(dir);
    const backupDir = join(dir, "backups");
    openDb(path, { backupDir });
    expect(existsSync(join(backupDir, "tasq-v1.db"))).toBe(true);
  });

  test("skips backup for a fresh database", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasq-db-"));
    const backupDir = join(dir, "backups");
    openDb(join(dir, "tasq.db"), { backupDir });
    expect(existsSync(backupDir)).toBe(false);
  });

  test("reopening an up-to-date database is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasq-db-"));
    const path = join(dir, "tasq.db");
    openDb(path).close();
    const db = openDb(path);
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(SCHEMA_VERSION);
  });

  test("refuses to open a database newer than the app supports", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasq-db-"));
    const path = join(dir, "tasq.db");
    const raw = new Database(path, { create: true });
    raw.exec("PRAGMA user_version = 99;");
    raw.close();
    expect(() => openDb(path)).toThrow(SchemaTooNewError);
  });
});
