import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SchemaTooNewError } from "./errors";

// events는 append-only 로그다. 태스크 삭제 후에도 이력이 남아야 하므로
// 의도적으로 FOREIGN KEY를 걸지 않는다.
// 마이그레이션은 append-only — 과거 항목은 절대 수정하지 않는다.
const MIGRATIONS: readonly string[] = [
  // v1: 초기 스키마
  `
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
  `,
  // v2: sub-task 트리 / soft delete / dependencies
  `
  ALTER TABLE tasks ADD COLUMN parent_id INTEGER;
  ALTER TABLE tasks ADD COLUMN archived_at TEXT;
  CREATE TABLE task_deps (
    task_id INTEGER NOT NULL,
    depends_on_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, depends_on_id)
  );
  CREATE INDEX idx_tasks_parent_id ON tasks(parent_id);
  CREATE INDEX idx_deps_depends_on ON task_deps(depends_on_id);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export interface OpenDbOptions {
  backupDir?: string;
}

export function openDb(path: string, options: OpenDbOptions = {}): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  const version = row.user_version;
  if (version > SCHEMA_VERSION) throw new SchemaTooNewError(version, SCHEMA_VERSION);
  if (version === SCHEMA_VERSION) return db;
  // 마이그레이션 직전 스냅샷 — 실패해도 백업 복원으로 회수 가능
  if (version > 0 && options.backupDir !== undefined) {
    backupTo(db, options.backupDir, version);
  }
  for (const [index, sql] of MIGRATIONS.entries()) {
    const target = index + 1;
    if (target <= version) continue;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${target};`);
    })();
  }
  return db;
}

function backupTo(db: Database, backupDir: string, version: number): void {
  mkdirSync(backupDir, { recursive: true });
  const path = join(backupDir, `tasq-v${version}.db`);
  rmSync(path, { force: true });
  // VACUUM INTO는 WAL 미체크포인트 분까지 포함한 일관 스냅샷을 만든다
  db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}';`);
}
