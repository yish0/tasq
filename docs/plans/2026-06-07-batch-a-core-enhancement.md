# Batch A: 일상 사용성 + 구조 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development로 태스크 단위 실행을 권장. 스텝은 체크박스(`- [ ]`)로 추적한다.

**Goal:** [core 보강 설계](../design/2026-06-07-core-enhancement.md)의 Batch A 전체 — 날짜 파싱, 라이프사이클 커맨드(복수 ID), 필터 강화, note, dependencies, sub-task, cancelled, soft delete + restore, `tq` bin alias.

**Architecture:** 버전드 마이그레이션(v2)으로 스키마 확장 → TaskStore에 도메인 로직(가드·순환 탐지·트랜잭션) → CLI 커맨드 추가/개편. SQL은 core의 store 계층에만, CLI는 도메인 타입으로만 일한다.

**Tech Stack:** Bun workspace, `bun:sqlite`, `bun test` (커버리지 100% 게이트), TypeScript strict.

**Branch:** `feat/batch-a-core`

## 규칙 (Phase 1과 동일)

- **테스트 커버리지 100%.** `bun test` 실행 시 bunfig의 coverageThreshold=1.0이 강제한다. 커버리지 미달이면 태스크 미완료.
- **TDD.** 실패하는 테스트 먼저, 구현은 그 다음.
- **커밋/PR에 AI 어시스턴트 푸터(Co-Authored-By 등) 금지.**
- **외부 런타임 의존성 0개.** bun 내장 + node 표준 모듈만.
- 테스트 항목명은 영어, 문서·코드 주석 prose는 한국어.
- bun 커버리지 함정: 클래스 필드 이니셜라이저는 유령 미커버 함수를 만든다 — 명시적 constructor 사용 (registry.ts 참조).

## 전체 파일 맵

| 파일 | 작업 |
|---|---|
| `packages/core/src/db.ts` | 마이그레이션 러너로 재작성 (v1+v2, 백업, 다운그레이드 보호) |
| `packages/core/src/dates.ts` | 신규 — parseDateExpr |
| `packages/core/src/types.ts` | cancelled, parentId/archivedAt, TaskFilter 확장, 이벤트 타입 추가 |
| `packages/core/src/errors.ts` | 신규 에러 8종 |
| `packages/core/src/tasks.ts` | parent/deps/archive/comment/필터/가드/트랜잭션 |
| `packages/core/src/home.ts` | backupsDir 추가 |
| `packages/core/src/index.ts` | dates export 추가 |
| `packages/cli/src/parse.ts` | parseIds, noneToNull, parseDateOption |
| `packages/cli/src/output.ts` | cancelled 아이콘, blocked/archived 마커, 트리, 상세 확장 |
| `packages/cli/src/commands/lifecycle.ts` | 신규 — done/start/cancel/reopen |
| `packages/cli/src/commands/note.ts` `dep.ts` `restore.ts` | 신규 |
| `packages/cli/src/commands/status.ts` `rm.ts` `add.ts` `update.ts` `list.ts` `show.ts` `index.ts` | 개편 |
| `packages/cli/src/context.ts` | backupDir 전달 |
| `packages/cli/package.json` | `tq` bin alias |

준비: `git checkout -b feat/batch-a-core`

---

## Unit 1: core 기반

### Task 1: 마이그레이션 러너 + 스키마 v2 + 백업 + 다운그레이드 보호

**Files:**
- Modify: `packages/core/src/db.ts` (전체 재작성)
- Modify: `packages/core/src/errors.ts` (SchemaTooNewError 추가)
- Modify: `packages/core/src/home.ts` (backupsDir)
- Modify: `packages/cli/src/context.ts` (backupDir 전달)
- Test: `packages/core/tests/db.test.ts` (전체 재작성), `packages/core/tests/home.test.ts` (backupsDir 단정 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `packages/core/tests/db.test.ts` 전체를 다음으로 교체

```ts
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
```

`packages/core/tests/home.test.ts`의 resolveTasqHome 단정에 추가:

```ts
expect(home.backupsDir).toBe(join(root, "backups"));
```

(기존 테스트의 root 변수에 맞춰 dbPath/pluginsDir 단정 옆에 한 줄씩. TASQ_HOME 케이스와 기본 케이스 둘 다.)

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/db.test.ts` / Expected: FAIL (`SCHEMA_VERSION` export 없음)

- [ ] **Step 3: 구현**

`packages/core/src/errors.ts`에 추가:

```ts
export class SchemaTooNewError extends Error {
  constructor(
    public readonly dbVersion: number,
    public readonly appVersion: number,
  ) {
    super(`database schema v${dbVersion} is newer than supported v${appVersion} — upgrade tasq`);
    this.name = "SchemaTooNewError";
  }
}
```

`packages/core/src/db.ts` 전체 교체:

```ts
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
```

`packages/core/src/home.ts` — TasqHome에 `backupsDir: string` 추가, resolveTasqHome에 `backupsDir: join(root, "backups")` 추가 (ensureTasqHome은 변경 없음 — 백업 디렉토리는 backupTo가 지연 생성).

`packages/cli/src/context.ts` — openDb 호출을 다음으로:

```ts
store: new TaskStore(openDb(home.dbPath, { backupDir: home.backupsDir })),
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS, 커버리지 100%
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(core): versioned migration runner with backup and v2 schema"`

### Task 2: 날짜 표현 파서

**Files:**
- Create: `packages/core/src/dates.ts`
- Modify: `packages/core/src/errors.ts` (InvalidDateExprError), `packages/core/src/index.ts` (export 추가)
- Test: `packages/core/tests/dates.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `packages/core/tests/dates.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { InvalidDateExprError, parseDateExpr } from "@tasq/core";

// 2026-06-10은 수요일
const NOW = new Date(2026, 5, 10, 15, 30);

describe("parseDateExpr", () => {
  test("passes through a valid ISO date", () => {
    expect(parseDateExpr("2026-07-01", NOW)).toBe("2026-07-01");
  });

  test("rejects calendar-invalid ISO dates", () => {
    expect(() => parseDateExpr("2026-02-30", NOW)).toThrow(InvalidDateExprError);
    expect(() => parseDateExpr("2026-13-01", NOW)).toThrow(InvalidDateExprError);
  });

  test("resolves today, tomorrow and yesterday", () => {
    expect(parseDateExpr("today", NOW)).toBe("2026-06-10");
    expect(parseDateExpr("tomorrow", NOW)).toBe("2026-06-11");
    expect(parseDateExpr("yesterday", NOW)).toBe("2026-06-09");
  });

  test("is case-insensitive", () => {
    expect(parseDateExpr("TODAY", NOW)).toBe("2026-06-10");
  });

  test("resolves weekday names to the next future occurrence", () => {
    expect(parseDateExpr("fri", NOW)).toBe("2026-06-12");
    expect(parseDateExpr("friday", NOW)).toBe("2026-06-12");
    expect(parseDateExpr("monday", NOW)).toBe("2026-06-15");
  });

  test("same weekday as today jumps a full week", () => {
    expect(parseDateExpr("wed", NOW)).toBe("2026-06-17");
  });

  test("resolves relative offsets", () => {
    expect(parseDateExpr("3d", NOW)).toBe("2026-06-13");
    expect(parseDateExpr("2w", NOW)).toBe("2026-06-24");
    expect(parseDateExpr("1m", NOW)).toBe("2026-07-10");
    expect(parseDateExpr("1y", NOW)).toBe("2027-06-10");
  });

  test("clamps month arithmetic to the target month's last day", () => {
    expect(parseDateExpr("1m", new Date(2026, 0, 31))).toBe("2026-02-28");
  });

  test("resolves period boundaries with monday-start weeks", () => {
    expect(parseDateExpr("eow", NOW)).toBe("2026-06-14");
    expect(parseDateExpr("sow", NOW)).toBe("2026-06-15");
    expect(parseDateExpr("eom", NOW)).toBe("2026-06-30");
    expect(parseDateExpr("som", NOW)).toBe("2026-07-01");
    expect(parseDateExpr("eoy", NOW)).toBe("2026-12-31");
    expect(parseDateExpr("soy", NOW)).toBe("2027-01-01");
  });

  test("eow on a sunday is today, sow on a monday is next monday", () => {
    const sunday = new Date(2026, 5, 14);
    const monday = new Date(2026, 5, 8);
    expect(parseDateExpr("eow", sunday)).toBe("2026-06-14");
    expect(parseDateExpr("sow", monday)).toBe("2026-06-15");
  });

  test("throws InvalidDateExprError for unknown expressions", () => {
    expect(() => parseDateExpr("someday", NOW)).toThrow("invalid date expression: someday");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/dates.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

`packages/core/src/errors.ts`에 추가:

```ts
export class InvalidDateExprError extends Error {
  constructor(public readonly expr: string) {
    super(`invalid date expression: ${expr}`);
    this.name = "InvalidDateExprError";
  }
}
```

`packages/core/src/dates.ts` 신규:

```ts
import { InvalidDateExprError } from "./errors";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// 월 연산은 대상 월의 말일로 클램프한다 (1/31 + 1m = 2/28)
function addMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay));
}

// 날짜는 date-only(YYYY-MM-DD). 모든 상대 표현은 미래 시점으로 해석한다
// (예외: yesterday). 주의 시작은 월요일.
export function parseDateExpr(expr: string, now: Date): string {
  const e = expr.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    const [y, m, d] = e.split("-").map(Number) as [number, number, number];
    const parsed = new Date(y, m - 1, d);
    if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
      throw new InvalidDateExprError(expr);
    }
    return e;
  }
  if (e === "today") return toIso(today);
  if (e === "tomorrow") return toIso(addDays(today, 1));
  if (e === "yesterday") return toIso(addDays(today, -1));

  const weekday = WEEKDAYS.findIndex((w) => w === e || w.slice(0, 3) === e);
  if (weekday >= 0) {
    const diff = (weekday - today.getDay() + 7) % 7;
    return toIso(addDays(today, diff === 0 ? 7 : diff));
  }

  const rel = /^(\d+)([dwmy])$/.exec(e);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    if (unit === "d") return toIso(addDays(today, n));
    if (unit === "w") return toIso(addDays(today, n * 7));
    if (unit === "m") return toIso(addMonths(today, n));
    return toIso(addMonths(today, n * 12));
  }

  // getDay(): 일요일=0. 월요일 시작 주에서 이번 주 일요일까지는 (7 - dow) % 7일
  const dow = today.getDay();
  if (e === "eow") return toIso(addDays(today, (7 - dow) % 7));
  if (e === "sow") {
    const diff = (8 - dow) % 7;
    return toIso(addDays(today, diff === 0 ? 7 : diff));
  }
  if (e === "eom") return toIso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  if (e === "som") return toIso(new Date(today.getFullYear(), today.getMonth() + 1, 1));
  if (e === "eoy") return toIso(new Date(today.getFullYear(), 11, 31));
  if (e === "soy") return toIso(new Date(today.getFullYear() + 1, 0, 1));

  throw new InvalidDateExprError(expr);
}
```

`packages/core/src/index.ts`에 `export * from "./dates";` 추가.

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS, 커버리지 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): date expression parser"`

### Task 3: 타입·에러 확장 (컴파일 그린 유지 세트)

cancelled status와 Task 필드 추가는 여러 파일의 타입을 동시에 깨므로, 컴파일을 유지하는 최소 수정을 한 태스크로 묶는다.

**Files:**
- Modify: `packages/core/src/types.ts`, `packages/core/src/errors.ts`, `packages/core/src/tasks.ts` (row 매핑만), `packages/cli/src/output.ts` (아이콘 1줄), `packages/cli/src/commands/list.ts` (tags 1줄)
- Test: `packages/core/tests/types.test.ts`, `packages/core/tests/errors.test.ts`, `packages/core/tests/tasks.test.ts` (일부), `packages/cli/tests/output.test.ts` (fixture)

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/types.test.ts`의 describe 안에 추가:

```ts
test("recognizes cancelled as a valid status", () => {
  expect(isTaskStatus("cancelled")).toBe(true);
});
```

`packages/core/tests/errors.test.ts`에 추가 (기존 패턴과 동일하게):

```ts
import {
  DependencyCycleError,
  HasSubtasksError,
  IncompleteSubtaskError,
  InvalidTransitionError,
  NotArchivedError,
  ParentArchivedError,
  ParentCycleError,
} from "@tasq/core";

describe("batch A errors", () => {
  test("DependencyCycleError names the edge", () => {
    const e = new DependencyCycleError(1, 2);
    expect(e.name).toBe("DependencyCycleError");
    expect(e.message).toBe("dependency cycle: #1 -> #2");
  });

  test("ParentCycleError names the edge", () => {
    const e = new ParentCycleError(3, 4);
    expect(e.name).toBe("ParentCycleError");
    expect(e.message).toBe("parent cycle: #3 -> #4");
  });

  test("IncompleteSubtaskError lists open subtasks", () => {
    const e = new IncompleteSubtaskError(1, [2, 3]);
    expect(e.name).toBe("IncompleteSubtaskError");
    expect(e.message).toBe("cannot complete #1: incomplete subtasks #2, #3");
  });

  test("InvalidTransitionError shows from and to", () => {
    const e = new InvalidTransitionError("cancelled", "done");
    expect(e.name).toBe("InvalidTransitionError");
    expect(e.message).toBe("invalid transition: cancelled -> done");
  });

  test("HasSubtasksError suggests --recursive", () => {
    const e = new HasSubtasksError(5);
    expect(e.name).toBe("HasSubtasksError");
    expect(e.message).toBe("#5 has subtasks — use --recursive");
  });

  test("ParentArchivedError suggests restoring the parent first", () => {
    const e = new ParentArchivedError(6, 2);
    expect(e.name).toBe("ParentArchivedError");
    expect(e.message).toBe("cannot restore #6: parent #2 is archived — restore it first");
  });

  test("NotArchivedError names the task", () => {
    const e = new NotArchivedError(7);
    expect(e.name).toBe("NotArchivedError");
    expect(e.message).toBe("#7 is not archived");
  });
});
```

`packages/core/tests/tasks.test.ts` — "creates a task with defaults" 테스트에 추가:

```ts
expect(task.parentId).toBeNull();
expect(task.archivedAt).toBeNull();
```

같은 파일의 list tag 필터 테스트에서 `{ tag: "x" }` 형태를 `{ tags: ["x"] }`로 변경.

`packages/cli/tests/output.test.ts` — `base` fixture에 `parentId: null, archivedAt: null,` 두 필드 추가.

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests` / Expected: FAIL (export·필드 없음)

- [ ] **Step 3: 구현**

`packages/core/src/types.ts`:

```ts
export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "review",
  "done",
  "blocked",
  "cancelled",
] as const;
```

Task 인터페이스에 추가 (project 위쪽 아무 곳, externalRef 앞 권장):

```ts
  readonly parentId: number | null;
  readonly archivedAt: string | null;
```

CreateTaskInput에 `parentId?: number;`, UpdateTaskPatch에 `parentId?: number | null;` 추가.

TaskFilter 전체 교체:

```ts
export interface TaskFilter {
  status?: TaskStatus;
  tags?: string[];
  project?: string;
  search?: string;
  dueBefore?: string;
  dueAfter?: string;
  overdueAsOf?: string;
  ready?: boolean;
  includeArchived?: boolean;
}
```

TaskEventType 교체:

```ts
export type TaskEventType =
  | "created"
  | "updated"
  | "status_changed"
  | "comment"
  | "dep_added"
  | "dep_removed"
  | "archived"
  | "restored"
  | "deleted";
```

`packages/core/src/errors.ts`에 추가:

```ts
export class DependencyCycleError extends Error {
  constructor(
    public readonly taskId: number,
    public readonly dependsOnId: number,
  ) {
    super(`dependency cycle: #${taskId} -> #${dependsOnId}`);
    this.name = "DependencyCycleError";
  }
}

export class ParentCycleError extends Error {
  constructor(
    public readonly taskId: number,
    public readonly parentId: number,
  ) {
    super(`parent cycle: #${taskId} -> #${parentId}`);
    this.name = "ParentCycleError";
  }
}

export class IncompleteSubtaskError extends Error {
  constructor(
    public readonly taskId: number,
    public readonly openIds: readonly number[],
  ) {
    super(`cannot complete #${taskId}: incomplete subtasks ${openIds.map((i) => `#${i}`).join(", ")}`);
    this.name = "IncompleteSubtaskError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`invalid transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class HasSubtasksError extends Error {
  constructor(public readonly taskId: number) {
    super(`#${taskId} has subtasks — use --recursive`);
    this.name = "HasSubtasksError";
  }
}

export class ParentArchivedError extends Error {
  constructor(
    public readonly taskId: number,
    public readonly parentId: number,
  ) {
    super(`cannot restore #${taskId}: parent #${parentId} is archived — restore it first`);
    this.name = "ParentArchivedError";
  }
}

export class NotArchivedError extends Error {
  constructor(public readonly taskId: number) {
    super(`#${taskId} is not archived`);
    this.name = "NotArchivedError";
  }
}
```

`packages/core/src/tasks.ts` — TaskRow에 `parent_id: number | null;`와 `archived_at: string | null;` 추가, rowToTask에 `parentId: row.parent_id,`와 `archivedAt: row.archived_at,` 추가. list의 tag 필터 블록을 다음으로 교체:

```ts
    if (filter.tags !== undefined && filter.tags.length > 0) {
      const tags = filter.tags;
      tasks = tasks.filter((t) => tags.every((tag) => t.tags.includes(tag)));
    }
```

`packages/cli/src/output.ts` — STATUS_ICONS에 `cancelled: "⊘",` 추가.

`packages/cli/src/commands/list.ts` — store.list 호출의 `tag: values.tag,`를 다음으로:

```ts
      tags: values.tag === undefined ? undefined : [values.tag],
```

- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run typecheck` / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): cancelled status, subtask/archive fields and new error types"`

---

## Unit 2: TaskStore 확장

### Task 4: sub-task 계층 + updated 이벤트 강화

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — tasks.test.ts에 추가

```ts
import { ParentCycleError } from "@tasq/core";

describe("TaskStore subtasks", () => {
  test("creates a task under a parent", () => {
    const store = makeStore();
    const parent = store.create({ title: "p" });
    const child = store.create({ title: "c", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  test("rejects a missing parent on create", () => {
    const store = makeStore();
    expect(() => store.create({ title: "c", parentId: 99 })).toThrow("task not found: 99");
  });

  test("lists children ordered by priority then id", () => {
    const store = makeStore();
    const parent = store.create({ title: "p" });
    store.create({ title: "low", parentId: parent.id, priority: 1 });
    store.create({ title: "high", parentId: parent.id, priority: 5 });
    store.create({ title: "other" });
    expect(store.children(parent.id).map((t) => t.title)).toEqual(["high", "low"]);
  });

  test("moves a task to a new parent and clears with null", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    expect(store.update(b.id, { parentId: a.id }).parentId).toBe(a.id);
    expect(store.update(b.id, { parentId: null }).parentId).toBeNull();
  });

  test("rejects self and descendant as parent", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b", parentId: a.id });
    const c = store.create({ title: "c", parentId: b.id });
    expect(() => store.update(a.id, { parentId: a.id })).toThrow(ParentCycleError);
    expect(() => store.update(a.id, { parentId: c.id })).toThrow(ParentCycleError);
  });

  test("rejects a missing parent on update", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    expect(() => store.update(a.id, { parentId: 99 })).toThrow("task not found: 99");
  });
});

describe("TaskStore.update event payload", () => {
  test("records before and after values per field", () => {
    const store = makeStore();
    const task = store.create({ title: "old", priority: 1 });
    store.update(task.id, { title: "new", priority: 3 });
    const updated = store.events(task.id).find((e) => e.type === "updated");
    expect(updated?.payload).toEqual({
      fields: {
        title: { from: "old", to: "new" },
        priority: { from: 1, to: 3 },
      },
    });
  });
});
```

기존 updated 이벤트 payload를 단정하던 테스트가 있으면 위 형태(`{ fields: { <field>: { from, to } } }`)로 갱신.

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/tasks.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — `packages/core/src/tasks.ts`

create를 다음으로 교체 (parent 검증 + parent_id 컬럼):

```ts
  create(input: CreateTaskInput): Task {
    if (input.parentId !== undefined) this.mustGet(input.parentId);
    const now = new Date().toISOString();
    const row = this.db
      .query(
        `INSERT INTO tasks (title, body, priority, tags, project, start, due, external_ref, parent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        input.title,
        input.body ?? "",
        input.priority ?? 0,
        JSON.stringify(input.tags ?? []),
        input.project ?? null,
        input.start ?? null,
        input.due ?? null,
        input.externalRef ?? null,
        input.parentId ?? null,
        now,
        now,
      ) as TaskRow;
    const task = rowToTask(row);
    this.recordEvent(task.id, "created", { title: task.title }, now);
    return task;
  }
```

update를 다음으로 교체 (parent 순환 가드 + before/after 페이로드):

```ts
  update(id: number, patch: UpdateTaskPatch): Task {
    const current = this.mustGet(id);
    const keys = Object.keys(patch) as (keyof UpdateTaskPatch)[];
    if (keys.length === 0) return current;
    if (patch.parentId !== undefined && patch.parentId !== null) {
      this.assertNoParentCycle(id, patch.parentId);
    }
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE tasks
         SET title = ?, body = ?, priority = ?, tags = ?, project = ?, start = ?, due = ?, external_ref = ?, parent_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.body,
        next.priority,
        JSON.stringify(next.tags),
        next.project,
        next.start,
        next.due,
        next.externalRef,
        next.parentId,
        now,
        id,
      );
    // 변경 전후를 기록한다 — undo(Batch B)와 감사 추적의 데이터 소스
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of keys) changes[key] = { from: current[key], to: next[key] };
    this.recordEvent(id, "updated", { fields: changes }, now);
    return this.mustGet(id);
  }
```

다음 메서드 추가:

```ts
  children(id: number): Task[] {
    const rows = this.db
      .query("SELECT * FROM tasks WHERE parent_id = ? ORDER BY priority DESC, id ASC")
      .all(id) as TaskRow[];
    return rows.map(rowToTask);
  }

  // 조상 체인을 걸어 자기 자신(또는 자손을 경유한 자신)을 부모로 삼는 것을 차단
  private assertNoParentCycle(id: number, parentId: number): void {
    let cursor: number | null = parentId;
    while (cursor !== null) {
      if (cursor === id) throw new ParentCycleError(id, parentId);
      cursor = this.mustGet(cursor).parentId;
    }
  }
```

errors import에 `ParentCycleError` 추가.

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS, 커버리지 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): subtask hierarchy and enriched update events"`

### Task 5: dependencies + 순환 탐지

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { DependencyCycleError } from "@tasq/core";

describe("TaskStore dependencies", () => {
  test("adds a dependency and lists it", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    store.addDep(a.id, b.id);
    expect(store.depsOf(a.id)).toEqual([b.id]);
    const events = store.events(a.id);
    expect(events.at(-1)?.type).toBe("dep_added");
    expect(events.at(-1)?.payload).toEqual({ dependsOnId: b.id });
  });

  test("duplicate add is a silent no-op without an event", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    store.addDep(a.id, b.id);
    const count = store.events(a.id).length;
    store.addDep(a.id, b.id);
    expect(store.events(a.id)).toHaveLength(count);
  });

  test("rejects self, direct and transitive cycles", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    const c = store.create({ title: "c" });
    expect(() => store.addDep(a.id, a.id)).toThrow(DependencyCycleError);
    store.addDep(a.id, b.id);
    expect(() => store.addDep(b.id, a.id)).toThrow(DependencyCycleError);
    store.addDep(b.id, c.id);
    expect(() => store.addDep(c.id, a.id)).toThrow(DependencyCycleError);
  });

  test("rejects missing tasks on either side", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    expect(() => store.addDep(a.id, 99)).toThrow("task not found: 99");
    expect(() => store.addDep(99, a.id)).toThrow("task not found: 99");
  });

  test("removes a dependency with an event, no-op when absent", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    store.addDep(a.id, b.id);
    store.removeDep(a.id, b.id);
    expect(store.depsOf(a.id)).toEqual([]);
    expect(store.events(a.id).at(-1)?.type).toBe("dep_removed");
    const count = store.events(a.id).length;
    store.removeDep(a.id, b.id);
    expect(store.events(a.id)).toHaveLength(count);
  });

  test("blockedTaskIds contains tasks with open deps only", () => {
    const store = makeStore();
    const blocked = store.create({ title: "blocked" });
    const openDep = store.create({ title: "open" });
    const free = store.create({ title: "free" });
    const doneDep = store.create({ title: "done" });
    store.addDep(blocked.id, openDep.id);
    store.addDep(free.id, doneDep.id);
    store.setStatus(doneDep.id, "done");
    const ids = store.blockedTaskIds();
    expect(ids.has(blocked.id)).toBe(true);
    expect(ids.has(free.id)).toBe(false);
  });

  test("openDepsOf lists incomplete prerequisites", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    const open = store.create({ title: "open" });
    const closed = store.create({ title: "closed" });
    store.addDep(t.id, open.id);
    store.addDep(t.id, closed.id);
    store.setStatus(closed.id, "done");
    expect(store.openDepsOf(t.id)).toEqual([open.id]);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/tasks.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — tasks.ts에 메서드 추가 (errors import에 `DependencyCycleError` 추가):

```ts
  addDep(taskId: number, dependsOnId: number): void {
    this.mustGet(taskId);
    this.mustGet(dependsOnId);
    if (taskId === dependsOnId || this.reachable(dependsOnId, taskId)) {
      throw new DependencyCycleError(taskId, dependsOnId);
    }
    const result = this.db
      .query("INSERT OR IGNORE INTO task_deps (task_id, depends_on_id) VALUES (?, ?)")
      .run(taskId, dependsOnId);
    // 중복 추가는 조용히 무시 — 이벤트도 남기지 않는다
    if (result.changes > 0) {
      this.recordEvent(taskId, "dep_added", { dependsOnId }, new Date().toISOString());
    }
  }

  removeDep(taskId: number, dependsOnId: number): void {
    this.mustGet(taskId);
    const result = this.db
      .query("DELETE FROM task_deps WHERE task_id = ? AND depends_on_id = ?")
      .run(taskId, dependsOnId);
    if (result.changes > 0) {
      this.recordEvent(taskId, "dep_removed", { dependsOnId }, new Date().toISOString());
    }
  }

  depsOf(taskId: number): number[] {
    const rows = this.db
      .query("SELECT depends_on_id FROM task_deps WHERE task_id = ? ORDER BY depends_on_id")
      .all(taskId) as { depends_on_id: number }[];
    return rows.map((r) => r.depends_on_id);
  }

  // 미완료(done/cancelled 아님)·비보관 선행이 남아 있는 태스크 id 집합
  blockedTaskIds(): Set<number> {
    const rows = this.db
      .query(
        `SELECT DISTINCT d.task_id AS id FROM task_deps d
         JOIN tasks t ON t.id = d.depends_on_id
         WHERE t.status NOT IN ('done', 'cancelled') AND t.archived_at IS NULL`,
      )
      .all() as { id: number }[];
    return new Set(rows.map((r) => r.id));
  }

  // start 시 경고용: 특정 태스크의 미완료 선행 목록
  openDepsOf(taskId: number): number[] {
    const rows = this.db
      .query(
        `SELECT d.depends_on_id AS id FROM task_deps d
         JOIN tasks t ON t.id = d.depends_on_id
         WHERE d.task_id = ? AND t.status NOT IN ('done', 'cancelled') AND t.archived_at IS NULL
         ORDER BY id`,
      )
      .all(taskId) as { id: number }[];
    return rows.map((r) => r.id);
  }

  // deps 그래프에서 from → to 도달 가능 여부 (DFS)
  private reachable(from: number, to: number): boolean {
    const stack = [from];
    const seen = new Set<number>();
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...this.depsOf(cur));
    }
    return false;
  }
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS, 커버리지 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): task dependencies with cycle detection"`

### Task 6: setStatus 가드 + withTransaction

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { IncompleteSubtaskError, InvalidTransitionError } from "@tasq/core";

describe("TaskStore.setStatus guards", () => {
  test("same status is a no-op without an event", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    const count = store.events(t.id).length;
    expect(store.setStatus(t.id, "todo").status).toBe("todo");
    expect(store.events(t.id)).toHaveLength(count);
  });

  test("blocks done while open subtasks remain", () => {
    const store = makeStore();
    const p = store.create({ title: "p" });
    const c = store.create({ title: "c", parentId: p.id });
    expect(() => store.setStatus(p.id, "done")).toThrow(IncompleteSubtaskError);
    store.setStatus(c.id, "done");
    expect(store.setStatus(p.id, "done").status).toBe("done");
  });

  test("cancelled subtasks do not block done", () => {
    const store = makeStore();
    const p = store.create({ title: "p" });
    const c = store.create({ title: "c", parentId: p.id });
    store.setStatus(c.id, "cancelled");
    expect(store.setStatus(p.id, "done").status).toBe("done");
  });

  test("rejects done from cancelled and cancelled from done", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    store.setStatus(a.id, "cancelled");
    expect(() => store.setStatus(a.id, "done")).toThrow(InvalidTransitionError);
    const b = store.create({ title: "b" });
    store.setStatus(b.id, "done");
    expect(() => store.setStatus(b.id, "cancelled")).toThrow(InvalidTransitionError);
  });
});

describe("TaskStore.withTransaction", () => {
  test("returns the callback result", () => {
    const store = makeStore();
    expect(store.withTransaction(() => 42)).toBe(42);
  });

  test("rolls back everything when the callback throws", () => {
    const store = makeStore();
    store.create({ title: "keep" });
    expect(() =>
      store.withTransaction(() => {
        store.setStatus(1, "done");
        store.setStatus(99, "done");
      }),
    ).toThrow("task not found: 99");
    expect(store.get(1)?.status).toBe("todo");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/tasks.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — setStatus를 다음으로 교체 (import에 `IncompleteSubtaskError, InvalidTransitionError` 추가):

```ts
  setStatus(id: number, status: string): Task {
    if (!isTaskStatus(status)) throw new InvalidStatusError(status);
    const current = this.mustGet(id);
    // 동일 상태는 no-op — 이벤트도 남기지 않는다
    if (current.status === status) return current;
    if (status === "done") {
      if (current.status === "cancelled") throw new InvalidTransitionError(current.status, status);
      const open = this.children(id).filter(
        (c) => c.archivedAt === null && c.status !== "done" && c.status !== "cancelled",
      );
      if (open.length > 0) {
        throw new IncompleteSubtaskError(id, open.map((c) => c.id));
      }
    }
    if (status === "cancelled" && current.status === "done") {
      throw new InvalidTransitionError(current.status, status);
    }
    const now = new Date().toISOString();
    this.db
      .query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, id);
    this.recordEvent(id, "status_changed", { from: current.status, to: status }, now);
    return this.mustGet(id);
  }

  // 복수 ID 일괄 작업용 — 콜백이 던지면 전체 롤백
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)() as T;
  }
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS, 커버리지 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): status transition guards and transactions"`

### Task 7: archive / restore / hardDelete

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

기존 `remove()` 테스트는 이 태스크에서 archive/hardDelete 테스트로 대체한다. `remove()` 자체는 rm 커맨드가 아직 쓰므로 hardDelete 위임 알리아스로 유지 (Task 14에서 제거).

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 `TaskStore.remove` describe를 삭제하고 다음으로 대체

```ts
import { HasSubtasksError, NotArchivedError, ParentArchivedError } from "@tasq/core";

describe("TaskStore.archive", () => {
  test("sets archivedAt and records an event", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.archive(t.id);
    expect(store.get(t.id)?.archivedAt).not.toBeNull();
    expect(store.events(t.id).at(-1)?.type).toBe("archived");
  });

  test("archiving an already archived task is a no-op", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.archive(t.id);
    const count = store.events(t.id).length;
    store.archive(t.id);
    expect(store.events(t.id)).toHaveLength(count);
  });

  test("blocks when live subtasks exist, archives subtree with recursive", () => {
    const store = makeStore();
    const p = store.create({ title: "p" });
    const c = store.create({ title: "c", parentId: p.id });
    const gc = store.create({ title: "gc", parentId: c.id });
    expect(() => store.archive(p.id)).toThrow(HasSubtasksError);
    store.archive(p.id, { recursive: true });
    for (const id of [p.id, c.id, gc.id]) {
      expect(store.get(id)?.archivedAt).not.toBeNull();
      expect(store.events(id).at(-1)?.type).toBe("archived");
    }
  });

  test("archived-only children do not require recursive", () => {
    const store = makeStore();
    const p = store.create({ title: "p" });
    const c = store.create({ title: "c", parentId: p.id });
    store.archive(c.id);
    store.archive(p.id);
    expect(store.get(p.id)?.archivedAt).not.toBeNull();
  });

  test("archived prerequisites no longer block", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    const dep = store.create({ title: "dep" });
    store.addDep(t.id, dep.id);
    expect(store.blockedTaskIds().has(t.id)).toBe(true);
    store.archive(dep.id);
    expect(store.blockedTaskIds().has(t.id)).toBe(false);
  });
});

describe("TaskStore.restore", () => {
  test("clears archivedAt and records an event", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.archive(t.id);
    expect(store.restore(t.id).archivedAt).toBeNull();
    expect(store.events(t.id).at(-1)?.type).toBe("restored");
  });

  test("rejects restoring a non-archived task", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    expect(() => store.restore(t.id)).toThrow(NotArchivedError);
  });

  test("rejects restoring a child under an archived parent", () => {
    const store = makeStore();
    const p = store.create({ title: "p" });
    const c = store.create({ title: "c", parentId: p.id });
    store.archive(p.id, { recursive: true });
    expect(() => store.restore(c.id)).toThrow(ParentArchivedError);
    store.restore(p.id);
    expect(store.restore(c.id).archivedAt).toBeNull();
  });

});

describe("TaskStore.hardDelete", () => {
  test("deletes the row, its deps and keeps a deleted event", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    const other = store.create({ title: "other" });
    store.addDep(other.id, t.id);
    store.hardDelete(t.id);
    expect(store.get(t.id)).toBeNull();
    expect(store.depsOf(other.id)).toEqual([]);
    expect(store.events(t.id).at(-1)?.type).toBe("deleted");
  });

  test("requires recursive even when children are archived", () => {
    const store = makeStore();
    const p = store.create({ title: "p" });
    const c = store.create({ title: "c", parentId: p.id });
    store.archive(c.id);
    expect(() => store.hardDelete(p.id)).toThrow(HasSubtasksError);
    store.hardDelete(p.id, { recursive: true });
    expect(store.get(p.id)).toBeNull();
    expect(store.get(c.id)).toBeNull();
  });
});
```

**구현 노트**: hardDelete가 항상 서브트리 단위로 동작하므로 "부모 행만 사라진 자식(dangling parent)"은 만들어질 수 없다. 따라서 restore의 부모 검증은 null 분기 없이 `mustGet`을 쓴다 — 도달 불가 분기를 만들지 않는다 (커버리지 100% 게이트의 ignore 주석도 불필요해짐).

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/tasks.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — remove를 다음 세 메서드 + 알리아스로 교체 (import에 `HasSubtasksError, NotArchivedError, ParentArchivedError` 추가):

```ts
  archive(id: number, options: { recursive?: boolean } = {}): void {
    const targets = this.collectSubtree(id, options.recursive === true, false);
    const now = new Date().toISOString();
    for (const t of targets) {
      if (t.archivedAt !== null) continue;
      this.db
        .query("UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, t.id);
      this.recordEvent(t.id, "archived", {}, now);
    }
  }

  restore(id: number): Task {
    const task = this.mustGet(id);
    if (task.archivedAt === null) throw new NotArchivedError(id);
    if (task.parentId !== null && this.mustGet(task.parentId).archivedAt !== null) {
      throw new ParentArchivedError(id, task.parentId);
    }
    const now = new Date().toISOString();
    this.db
      .query("UPDATE tasks SET archived_at = NULL, updated_at = ? WHERE id = ?")
      .run(now, id);
    this.recordEvent(id, "restored", {}, now);
    return this.mustGet(id);
  }

  hardDelete(id: number, options: { recursive?: boolean } = {}): void {
    // hard delete는 보관된 자식도 자식으로 취급한다 — 행이 남아 고아가 되는 것을 방지
    const targets = this.collectSubtree(id, options.recursive === true, true);
    const now = new Date().toISOString();
    for (const t of targets) {
      this.db.query("DELETE FROM task_deps WHERE task_id = ? OR depends_on_id = ?").run(t.id, t.id);
      this.db.query("DELETE FROM tasks WHERE id = ?").run(t.id);
      this.recordEvent(t.id, "deleted", {}, now);
    }
  }

  // Task 14에서 rm 커맨드 개편과 함께 제거 예정
  remove(id: number): void {
    this.hardDelete(id);
  }

  // 자식이 있으면 recursive 없이는 HasSubtasksError. 깊은 자식부터 반환한다
  private collectSubtree(id: number, recursive: boolean, includeArchived: boolean): Task[] {
    const root = this.mustGet(id);
    let kids = this.children(id);
    if (!includeArchived) kids = kids.filter((c) => c.archivedAt === null);
    if (kids.length === 0) return [root];
    if (!recursive) throw new HasSubtasksError(id);
    const result = [root];
    for (const child of kids) {
      result.push(...this.collectSubtree(child.id, true, includeArchived));
    }
    return result;
  }
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS, 커버리지 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): soft delete, restore and hard delete"`

### Task 8: comment(note) + list 필터 확장

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describe("TaskStore comments", () => {
  test("appends a comment event without touching the task row", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    const before = store.get(t.id)?.updatedAt;
    const event = store.addComment(t.id, "progress note");
    expect(event.type).toBe("comment");
    expect(event.payload).toEqual({ text: "progress note" });
    expect(event.taskId).toBe(t.id);
    expect(event.id).toBeGreaterThan(0);
    expect(store.get(t.id)?.updatedAt).toBe(before as string);
  });

  test("rejects a missing task", () => {
    const store = makeStore();
    expect(() => store.addComment(99, "x")).toThrow("task not found: 99");
  });

  test("comments returns only comment events in order", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.addComment(t.id, "one");
    store.setStatus(t.id, "in_progress");
    store.addComment(t.id, "two");
    expect(store.comments(t.id).map((e) => e.payload.text)).toEqual(["one", "two"]);
  });
});

describe("TaskStore.list filters", () => {
  test("excludes archived by default, includes with includeArchived", () => {
    const store = makeStore();
    store.create({ title: "live" });
    const dead = store.create({ title: "dead" });
    store.archive(dead.id);
    expect(store.list().map((t) => t.title)).toEqual(["live"]);
    expect(store.list({ includeArchived: true })).toHaveLength(2);
  });

  test("dueBefore and dueAfter are strict and skip dueless tasks", () => {
    const store = makeStore();
    store.create({ title: "early", due: "2026-06-10" });
    store.create({ title: "late", due: "2026-06-20" });
    store.create({ title: "none" });
    expect(store.list({ dueBefore: "2026-06-15" }).map((t) => t.title)).toEqual(["early"]);
    expect(store.list({ dueAfter: "2026-06-15" }).map((t) => t.title)).toEqual(["late"]);
    expect(store.list({ dueBefore: "2026-06-10" })).toHaveLength(0);
  });

  test("overdueAsOf excludes finished tasks", () => {
    const store = makeStore();
    store.create({ title: "open", due: "2026-06-01" });
    const closed = store.create({ title: "closed", due: "2026-06-01" });
    store.setStatus(closed.id, "done");
    store.create({ title: "future", due: "2026-07-01" });
    expect(store.list({ overdueAsOf: "2026-06-15" }).map((t) => t.title)).toEqual(["open"]);
  });

  test("search matches title and body, escaping LIKE metacharacters", () => {
    const store = makeStore();
    store.create({ title: "fix login bug" });
    store.create({ title: "other", body: "see login flow" });
    store.create({ title: "100% done marker" });
    store.create({ title: "unrelated" });
    expect(store.list({ search: "login" })).toHaveLength(2);
    expect(store.list({ search: "100%" }).map((t) => t.title)).toEqual(["100% done marker"]);
    expect(store.list({ search: "0%" })).toHaveLength(1);
  });

  test("multiple tags combine with AND", () => {
    const store = makeStore();
    store.create({ title: "both", tags: ["a", "b"] });
    store.create({ title: "one", tags: ["a"] });
    expect(store.list({ tags: ["a", "b"] }).map((t) => t.title)).toEqual(["both"]);
  });

  test("ready returns unblocked todo tasks only", () => {
    const store = makeStore();
    const ready = store.create({ title: "ready" });
    const blocked = store.create({ title: "blocked" });
    const dep = store.create({ title: "dep" });
    store.addDep(blocked.id, dep.id);
    const started = store.create({ title: "started" });
    store.setStatus(started.id, "in_progress");
    expect(store.list({ ready: true }).map((t) => t.id)).toEqual([ready.id, dep.id]);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/tasks.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

recordEvent가 이벤트를 반환하도록 교체:

```ts
  private recordEvent(
    taskId: number,
    type: TaskEventType,
    payload: Record<string, unknown>,
    createdAt: string,
  ): TaskEvent {
    const result = this.db
      .query("INSERT INTO events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(taskId, type, JSON.stringify(payload), createdAt);
    return { id: Number(result.lastInsertRowid), taskId, type, payload, createdAt };
  }
```

메서드 추가:

```ts
  // note 커맨드와 (Phase 2의) agent report가 공유하는 통로.
  // 태스크 row는 건드리지 않는다 — updated_at도 그대로.
  addComment(id: number, text: string): TaskEvent {
    this.mustGet(id);
    return this.recordEvent(id, "comment", { text }, new Date().toISOString());
  }

  comments(taskId: number): TaskEvent[] {
    return this.events(taskId).filter((e) => e.type === "comment");
  }
```

list를 다음으로 교체:

```ts
  list(filter: TaskFilter = {}): Task[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.includeArchived !== true) where.push("archived_at IS NULL");
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.project) {
      where.push("project = ?");
      params.push(filter.project);
    }
    if (filter.dueBefore) {
      where.push("due IS NOT NULL AND due < ?");
      params.push(filter.dueBefore);
    }
    if (filter.dueAfter) {
      where.push("due IS NOT NULL AND due > ?");
      params.push(filter.dueAfter);
    }
    if (filter.overdueAsOf) {
      where.push("due IS NOT NULL AND due < ? AND status NOT IN ('done', 'cancelled')");
      params.push(filter.overdueAsOf);
    }
    if (filter.search) {
      // LIKE 메타문자(%/_/\)는 이스케이프해서 리터럴로 매치
      const q = `%${filter.search.replaceAll(/[\\%_]/g, "\\$&")}%`;
      where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      params.push(q, q);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .query(`SELECT * FROM tasks ${clause} ORDER BY priority DESC, id ASC`)
      .all(...params) as TaskRow[];
    let tasks = rows.map(rowToTask);
    if (filter.tags !== undefined && filter.tags.length > 0) {
      const tags = filter.tags;
      tasks = tasks.filter((t) => tags.every((tag) => t.tags.includes(tag)));
    }
    if (filter.ready === true) {
      const blocked = this.blockedTaskIds();
      tasks = tasks.filter((t) => t.status === "todo" && !blocked.has(t.id));
    }
    return tasks;
  }
```

**구현 노트**: `where.length > 0` 삼항은 유지한다 — `includeArchived: true` 단독 호출 시 where가 빈 배열이 되는 경로가 실제로 존재하고, 위 테스트의 `list({ includeArchived: true })`가 그 분기를 커버한다.

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS, 커버리지 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): comments and extended list filters"`

---

## Unit 3: CLI 헬퍼

### Task 9: parse 확장

**Files:**
- Modify: `packages/cli/src/parse.ts`
- Test: `packages/cli/tests/parse.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — parse.test.ts에 추가

```ts
import { InvalidDateExprError } from "@tasq/core";
import { noneToNull, parseDateOption, parseIds } from "../src/parse";

describe("parseIds", () => {
  test("parses a list of positive integers", () => {
    expect(parseIds(["1", "42"])).toEqual([1, 42]);
  });

  test("returns null for empty input or any invalid element", () => {
    expect(parseIds([])).toBeNull();
    expect(parseIds(["1", "x"])).toBeNull();
    expect(parseIds(["0"])).toBeNull();
  });
});

describe("noneToNull", () => {
  test("maps the literal none to null and passes through others", () => {
    expect(noneToNull("none")).toBeNull();
    expect(noneToNull("tasq")).toBe("tasq");
  });
});

describe("parseDateOption", () => {
  const now = new Date(2026, 5, 10);

  test("resolves date expressions to ISO", () => {
    expect(parseDateOption("tomorrow", now)).toBe("2026-06-11");
  });

  test("maps none to null", () => {
    expect(parseDateOption("none", now)).toBeNull();
  });

  test("throws on invalid expressions", () => {
    expect(() => parseDateOption("blah", now)).toThrow(InvalidDateExprError);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/parse.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — parse.ts에 추가

```ts
import { parseDateExpr } from "@tasq/core";

export function parseIds(raws: string[]): number[] | null {
  if (raws.length === 0) return null;
  const ids: number[] = [];
  for (const raw of raws) {
    const id = parseId(raw);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

// nullable 필드 클리어 컨벤션: 리터럴 'none'은 null
export function noneToNull(value: string): string | null {
  return value === "none" ? null : value;
}

// 날짜 옵션: 'none'은 클리어, 그 외는 날짜 표현으로 해석.
// 실패 시 InvalidDateExprError가 위로 던져져 runCli가 stderr+exit 1 처리한다.
export function parseDateOption(value: string, now: Date): string | null {
  if (value === "none") return null;
  return parseDateExpr(value, now);
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): id list, none-clearing and date option parsing"`

### Task 10: output 확장 (마커·트리·상세)

**Files:**
- Modify: `packages/cli/src/output.ts`
- Test: `packages/cli/tests/output.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — output.test.ts에 추가 (base fixture는 Task 3에서 확장됨)

```ts
import { treeOrder } from "../src/output";

describe("formatTaskLine markers", () => {
  test("indents by depth", () => {
    expect(formatTaskLine(base, { depth: 2 })).toBe("    ◐ #7 P2 ship it");
  });

  test("appends a blocked marker", () => {
    expect(formatTaskLine(base, { blocked: true })).toBe("◐ #7 P2 ship it [blocked]");
  });

  test("appends an archived marker from the task itself", () => {
    const archived: Task = { ...base, archivedAt: "2026-06-07T00:00:00.000Z" };
    expect(formatTaskLine(archived)).toBe("◐ #7 P2 ship it [archived]");
  });
});

describe("formatTaskDetail extras", () => {
  test("shows parent, deps and notes", () => {
    const task: Task = { ...base, parentId: 3 };
    const detail = formatTaskDetail(task, {
      deps: [1, 2],
      notes: [{ createdAt: "2026-06-07T10:00:00.000Z", text: "first note" }],
    });
    expect(detail).toContain("parent:   #3");
    expect(detail).toContain("deps:     #1, #2");
    expect(detail).toContain("notes:");
    expect(detail).toContain("2026-06-07T10:00:00.000Z first note");
  });

  test("marks archived in the status line", () => {
    const detail = formatTaskDetail({ ...base, archivedAt: "2026-06-07T00:00:00.000Z" });
    expect(detail).toContain("status:   in_progress (archived)");
  });

  test("renders dashes when extras are absent", () => {
    const detail = formatTaskDetail(base);
    expect(detail).toContain("parent:   -");
    expect(detail).toContain("deps:     -");
    expect(detail).not.toContain("notes:");
  });
});

describe("treeOrder", () => {
  function t(id: number, parentId: number | null): Task {
    return { ...base, id, parentId };
  }

  test("nests children under parents preserving input order", () => {
    // 입력 순서: 부모(2) → 부모(1) → 자식들
    const tasks = [t(2, null), t(1, null), t(3, 1), t(4, 2), t(5, 3)];
    expect(treeOrder(tasks).map((e) => [e.task.id, e.depth])).toEqual([
      [2, 0],
      [4, 1],
      [1, 0],
      [3, 1],
      [5, 2],
    ]);
  });

  test("promotes children of absent parents to roots", () => {
    const tasks = [t(3, 99)];
    expect(treeOrder(tasks).map((e) => [e.task.id, e.depth])).toEqual([[3, 0]]);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/output.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — output.ts를 다음으로 교체

```ts
import type { Task, TaskStatus } from "@tasq/core";

const STATUS_ICONS: Record<TaskStatus, string> = {
  todo: "○",
  in_progress: "◐",
  review: "◎",
  done: "●",
  blocked: "✗",
  cancelled: "⊘",
};

export interface LineOptions {
  // deps에 의한 계산형 블록 — status가 아니라 표시 마커
  blocked?: boolean;
  // sub-task 트리 들여쓰기 깊이
  depth?: number;
}

export function formatTaskLine(task: Task, options: LineOptions = {}): string {
  const indent = "  ".repeat(options.depth ?? 0);
  const project = task.project ? ` (${task.project})` : "";
  const tags = task.tags.length > 0 ? ` [${task.tags.join(",")}]` : "";
  const blocked = options.blocked === true ? " [blocked]" : "";
  const archived = task.archivedAt !== null ? " [archived]" : "";
  return `${indent}${STATUS_ICONS[task.status]} #${task.id} P${task.priority} ${task.title}${project}${tags}${blocked}${archived}`;
}

export interface DetailExtras {
  deps?: readonly number[];
  notes?: readonly { createdAt: string; text: string }[];
}

export function formatTaskDetail(task: Task, extras: DetailExtras = {}): string {
  const deps = extras.deps ?? [];
  const lines = [
    `#${task.id} ${task.title}`,
    `status:   ${task.status}${task.archivedAt !== null ? " (archived)" : ""}`,
    `priority: ${task.priority}`,
    `tags:     ${task.tags.join(", ") || "-"}`,
    `project:  ${task.project ?? "-"}`,
    `parent:   ${task.parentId !== null ? `#${task.parentId}` : "-"}`,
    `deps:     ${deps.length > 0 ? deps.map((d) => `#${d}`).join(", ") : "-"}`,
    `start:    ${task.start ?? "-"}`,
    `due:      ${task.due ?? "-"}`,
    `external: ${task.externalRef ?? "-"}`,
    `created:  ${task.createdAt}`,
    `updated:  ${task.updatedAt}`,
  ];
  if (task.body) lines.push("", task.body);
  const notes = extras.notes ?? [];
  if (notes.length > 0) {
    lines.push("", "notes:");
    for (const n of notes) lines.push(`  ${n.createdAt} ${n.text}`);
  }
  return lines.join("\n");
}

// 입력 정렬 순서를 보존하면서 부모 바로 아래 자식을 깊이 우선으로 배치한다.
// 부모가 결과에 없는 태스크(필터·보관 등)는 루트로 승격해 표시한다.
export function treeOrder(tasks: readonly Task[]): { task: Task; depth: number }[] {
  const ids = new Set(tasks.map((t) => t.id));
  const byParent = new Map<number | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId !== null && ids.has(t.parentId) ? t.parentId : null;
    const group = byParent.get(key) ?? [];
    group.push(t);
    byParent.set(key, group);
  }
  const result: { task: Task; depth: number }[] = [];
  const walk = (parentKey: number | null, depth: number): void => {
    for (const t of byParent.get(parentKey) ?? []) {
      result.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS (기존 formatTaskLine/Detail 테스트도 통과 — 시그니처 하위호환)
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): tree ordering and extended output formatting"`

---

## Unit 4: 신규 커맨드

### Task 11: done / start / cancel / reopen + status 복수 ID

**Files:**
- Create: `packages/cli/src/commands/lifecycle.ts`
- Modify: `packages/cli/src/commands/status.ts`
- Test: `packages/cli/tests/lifecycle.test.ts` (신규), `packages/cli/tests/status.test.ts` (갱신)

- [ ] **Step 1: 실패하는 테스트 작성** — `packages/cli/tests/lifecycle.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import {
  cancelCommand,
  doneCommand,
  reopenCommand,
  startCommand,
} from "../src/commands/lifecycle";
import { createTestCli } from "./helpers";

describe("done", () => {
  test("completes multiple tasks in one call", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    expect(doneCommand.run(["1", "2"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → done", "#2 → done"]);
  });

  test("rolls back all when one id fails", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(() => doneCommand.run(["1", "99"], ctx)).toThrow("task not found: 99");
    expect(ctx.store.get(1)?.status).toBe("todo");
  });

  test("prints a JSON array with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    doneCommand.run(["1", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "")[0].status).toBe("done");
  });

  test("prints usage without ids", () => {
    const { ctx, err } = createTestCli();
    expect(doneCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });
});

describe("start", () => {
  test("starts a todo task", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(startCommand.run(["1"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → in_progress"]);
  });

  test("warns about incomplete prerequisites but proceeds", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "dep" });
    ctx.store.addDep(1, 2);
    expect(startCommand.run(["1"], ctx)).toBe(0);
    expect(err).toEqual(["warning: #1 depends on incomplete #2"]);
    expect(ctx.store.get(1)?.status).toBe("in_progress");
  });

  test("rejects starting from done", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.setStatus(1, "done");
    expect(() => startCommand.run(["1"], ctx)).toThrow("invalid transition: done -> in_progress");
  });
});

describe("cancel", () => {
  test("cancels an open task", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(cancelCommand.run(["1"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → cancelled"]);
  });
});

describe("reopen", () => {
  test("reopens done and cancelled tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    ctx.store.setStatus(1, "done");
    ctx.store.setStatus(2, "cancelled");
    expect(reopenCommand.run(["1", "2"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → todo", "#2 → todo"]);
  });

  test("rejects reopening an open task", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(() => reopenCommand.run(["1"], ctx)).toThrow("invalid transition: todo -> todo");
  });
});
```

`packages/cli/tests/status.test.ts` — 다음 테스트로 갱신/추가:

```ts
  test("updates multiple ids in one transaction", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    expect(statusCommand.run(["1", "2", "in_progress"], ctx)).toBe(0);
    expect(out).toEqual(["#1 → in_progress", "#2 → in_progress"]);
  });
```

기존 `--json` 테스트는 배열 출력으로 변경: `expect(JSON.parse(out[0] ?? "")[0].status).toBe("done");`

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/lifecycle.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

`packages/cli/src/commands/lifecycle.ts` 신규:

```ts
import { parseArgs } from "node:util";
import { InvalidTransitionError, type TaskStatus } from "@tasq/core";
import { parseIds } from "../parse";
import type { Command } from "../registry";

interface LifecycleSpec {
  name: string;
  description: string;
  to: TaskStatus;
  // 미지정이면 전이 검증을 store 가드에 위임한다
  allowedFrom?: readonly TaskStatus[];
  warnOpenDeps?: boolean;
}

function makeLifecycleCommand(spec: LifecycleSpec): Command {
  const usage = `tasq ${spec.name} <id...> [--json]`;
  return {
    name: spec.name,
    description: spec.description,
    usage,
    run(args, ctx) {
      const { values, positionals } = parseArgs({
        args,
        options: { json: { type: "boolean" } },
        allowPositionals: true,
      });
      const ids = parseIds(positionals);
      if (ids === null) {
        ctx.stderr(`usage: ${usage}`);
        return 1;
      }
      const warnings: string[] = [];
      // 복수 ID는 단일 트랜잭션 — 하나라도 실패하면 전체 롤백
      const tasks = ctx.store.withTransaction(() =>
        ids.map((id) => {
          const current = ctx.store.get(id);
          if (
            current !== null &&
            spec.allowedFrom !== undefined &&
            !spec.allowedFrom.includes(current.status)
          ) {
            throw new InvalidTransitionError(current.status, spec.to);
          }
          if (spec.warnOpenDeps === true) {
            for (const dep of ctx.store.openDepsOf(id)) {
              warnings.push(`warning: #${id} depends on incomplete #${dep}`);
            }
          }
          return ctx.store.setStatus(id, spec.to);
        }),
      );
      for (const w of warnings) ctx.stderr(w);
      if (values.json === true) {
        ctx.stdout(JSON.stringify(tasks));
        return 0;
      }
      for (const t of tasks) ctx.stdout(`#${t.id} → ${t.status}`);
      return 0;
    },
  };
}

export const doneCommand = makeLifecycleCommand({
  name: "done",
  description: "Complete tasks",
  to: "done",
});

export const startCommand = makeLifecycleCommand({
  name: "start",
  description: "Start tasks",
  to: "in_progress",
  allowedFrom: ["todo", "review", "blocked"],
  warnOpenDeps: true,
});

export const cancelCommand = makeLifecycleCommand({
  name: "cancel",
  description: "Cancel tasks",
  to: "cancelled",
});

export const reopenCommand = makeLifecycleCommand({
  name: "reopen",
  description: "Reopen done or cancelled tasks",
  to: "todo",
  allowedFrom: ["done", "cancelled"],
});
```

`packages/cli/src/commands/status.ts` 교체:

```ts
import { parseArgs } from "node:util";
import { parseIds } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq status <id...> <todo|in_progress|review|done|blocked|cancelled> [--json]";

export const statusCommand: Command = {
  name: "status",
  description: "Change task status",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
    });
    const status = positionals.pop();
    const ids = parseIds(positionals);
    if (status === undefined || ids === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const tasks = ctx.store.withTransaction(() =>
      ids.map((id) => ctx.store.setStatus(id, status)),
    );
    if (values.json === true) {
      ctx.stdout(JSON.stringify(tasks));
      return 0;
    }
    for (const t of tasks) ctx.stdout(`#${t.id} → ${t.status}`);
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS (e2e의 `status 1 done` 출력 형식 불변)
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): done/start/cancel/reopen and bulk status"`

### Task 12: note 커맨드

**Files:**
- Create: `packages/cli/src/commands/note.ts`
- Test: `packages/cli/tests/note.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, test } from "bun:test";
import { noteCommand } from "../src/commands/note";
import { createTestCli } from "./helpers";

describe("note", () => {
  test("appends a comment built from remaining args", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(noteCommand.run(["1", "tried", "the", "fix"], ctx)).toBe(0);
    expect(out).toEqual(["note added to #1"]);
    expect(ctx.store.comments(1)[0]?.payload).toEqual({ text: "tried the fix" });
  });

  test("prints the event as JSON with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    noteCommand.run(["1", "hello", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "").type).toBe("comment");
  });

  test("prints usage when id or text is missing", () => {
    const { ctx, err } = createTestCli();
    expect(noteCommand.run([], ctx)).toBe(1);
    expect(noteCommand.run(["1"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("throws for a missing task (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => noteCommand.run(["99", "x"], ctx)).toThrow("task not found: 99");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/note.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — `packages/cli/src/commands/note.ts`

```ts
import { parseArgs } from "node:util";
import { parseId } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq note <id> <text> [--json]";

export const noteCommand: Command = {
  name: "note",
  description: "Append a note to a task",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
    });
    const id = parseId(positionals[0]);
    const text = positionals.slice(1).join(" ").trim();
    if (id === null || text === "") {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const event = ctx.store.addComment(id, text);
    ctx.stdout(values.json === true ? JSON.stringify(event) : `note added to #${id}`);
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): note command"`

### Task 13: dep 커맨드

**Files:**
- Create: `packages/cli/src/commands/dep.ts`
- Test: `packages/cli/tests/dep.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, test } from "bun:test";
import { depCommand } from "../src/commands/dep";
import { createTestCli } from "./helpers";

function seed3(ctx: ReturnType<typeof createTestCli>["ctx"]): void {
  ctx.store.create({ title: "a" });
  ctx.store.create({ title: "b" });
  ctx.store.create({ title: "c" });
}

describe("dep", () => {
  test("adds multiple dependencies at once", () => {
    const { ctx, out } = createTestCli();
    seed3(ctx);
    expect(depCommand.run(["add", "1", "2", "3"], ctx)).toBe(0);
    expect(ctx.store.depsOf(1)).toEqual([2, 3]);
    expect(out).toEqual(["#1 now depends on #2, #3"]);
  });

  test("removes a dependency", () => {
    const { ctx, out } = createTestCli();
    seed3(ctx);
    ctx.store.addDep(1, 2);
    expect(depCommand.run(["rm", "1", "2"], ctx)).toBe(0);
    expect(ctx.store.depsOf(1)).toEqual([]);
    expect(out).toEqual(["removed #2 from #1 deps"]);
  });

  test("rolls back the whole add when one edge would create a cycle", () => {
    const { ctx } = createTestCli();
    seed3(ctx);
    ctx.store.addDep(2, 1);
    expect(() => depCommand.run(["add", "1", "3", "2"], ctx)).toThrow("dependency cycle");
    expect(ctx.store.depsOf(1)).toEqual([]);
  });

  test("prints usage for bad subcommand or missing ids", () => {
    const { ctx, err } = createTestCli();
    expect(depCommand.run(["link", "1", "2"], ctx)).toBe(1);
    expect(depCommand.run(["add", "1"], ctx)).toBe(1);
    expect(depCommand.run(["add"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/dep.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — `packages/cli/src/commands/dep.ts`

```ts
import { parseIds } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq dep <add|rm> <id> <on-id...>";

export const depCommand: Command = {
  name: "dep",
  description: "Manage task dependencies",
  usage: USAGE,
  run(args, ctx) {
    const [sub, ...rest] = args;
    const ids = parseIds(rest);
    if ((sub !== "add" && sub !== "rm") || ids === null || ids.length < 2) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const [taskId, ...onIds] = ids as [number, ...number[]];
    ctx.store.withTransaction(() => {
      for (const onId of onIds) {
        if (sub === "add") ctx.store.addDep(taskId, onId);
        else ctx.store.removeDep(taskId, onId);
      }
    });
    const list = onIds.map((i) => `#${i}`).join(", ");
    ctx.stdout(sub === "add" ? `#${taskId} now depends on ${list}` : `removed ${list} from #${taskId} deps`);
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): dep command"`

### Task 14: rm 개편 (soft delete) + restore 커맨드

**Files:**
- Modify: `packages/cli/src/commands/rm.ts` (전체 재작성), `packages/core/src/tasks.ts` (remove 알리아스 제거)
- Create: `packages/cli/src/commands/restore.ts`
- Test: `packages/cli/tests/rm.test.ts` (전체 재작성), `packages/cli/tests/restore.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — rm.test.ts 전체 교체

```ts
import { describe, expect, test } from "bun:test";
import { rmCommand } from "../src/commands/rm";
import { createTestCli } from "./helpers";

describe("rm", () => {
  test("archives by default", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(rmCommand.run(["1"], ctx)).toBe(0);
    expect(out).toEqual(["archived #1"]);
    expect(ctx.store.get(1)?.archivedAt).not.toBeNull();
  });

  test("deletes permanently with --hard", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(rmCommand.run(["1", "--hard"], ctx)).toBe(0);
    expect(out).toEqual(["deleted #1"]);
    expect(ctx.store.get(1)).toBeNull();
  });

  test("archives multiple ids in one transaction", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    expect(rmCommand.run(["1", "2"], ctx)).toBe(0);
    expect(out).toEqual(["archived #1, #2"]);
  });

  test("blocks on subtasks without --recursive", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "c", parentId: 1 });
    expect(() => rmCommand.run(["1"], ctx)).toThrow("has subtasks");
    expect(rmCommand.run(["1", "-r"], ctx)).toBe(0);
    expect(ctx.store.get(2)?.archivedAt).not.toBeNull();
  });

  test("prints usage and exits 1 for invalid id", () => {
    const { ctx, err } = createTestCli();
    expect(rmCommand.run(["x"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("throws for a missing task (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => rmCommand.run(["99"], ctx)).toThrow("task not found: 99");
  });
});
```

`packages/cli/tests/restore.test.ts` 신규:

```ts
import { describe, expect, test } from "bun:test";
import { restoreCommand } from "../src/commands/restore";
import { createTestCli } from "./helpers";

describe("restore", () => {
  test("restores archived tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.create({ title: "b" });
    ctx.store.archive(1);
    ctx.store.archive(2);
    expect(restoreCommand.run(["1", "2"], ctx)).toBe(0);
    expect(out).toEqual(["restored #1, #2"]);
    expect(ctx.store.get(1)?.archivedAt).toBeNull();
  });

  test("prints JSON with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a" });
    ctx.store.archive(1);
    restoreCommand.run(["1", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "")[0].archivedAt).toBeNull();
  });

  test("prints usage without ids", () => {
    const { ctx, err } = createTestCli();
    expect(restoreCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("throws for a non-archived task (handled by runCli)", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "a" });
    expect(() => restoreCommand.run(["1"], ctx)).toThrow("not archived");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/rm.test.ts packages/cli/tests/restore.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

`packages/cli/src/commands/rm.ts` 전체 교체:

```ts
import { parseArgs } from "node:util";
import { parseIds } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq rm <id...> [--recursive|-r] [--hard]";

export const rmCommand: Command = {
  name: "rm",
  description: "Archive tasks (--hard to delete permanently)",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        recursive: { type: "boolean", short: "r" },
        hard: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const ids = parseIds(positionals);
    if (ids === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const recursive = values.recursive === true;
    ctx.store.withTransaction(() => {
      for (const id of ids) {
        if (values.hard === true) ctx.store.hardDelete(id, { recursive });
        else ctx.store.archive(id, { recursive });
      }
    });
    const list = ids.map((i) => `#${i}`).join(", ");
    ctx.stdout(values.hard === true ? `deleted ${list}` : `archived ${list}`);
    return 0;
  },
};
```

`packages/cli/src/commands/restore.ts` 신규:

```ts
import { parseArgs } from "node:util";
import { parseIds } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq restore <id...> [--json]";

export const restoreCommand: Command = {
  name: "restore",
  description: "Restore archived tasks",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
    });
    const ids = parseIds(positionals);
    if (ids === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const tasks = ctx.store.withTransaction(() => ids.map((id) => ctx.store.restore(id)));
    if (values.json === true) {
      ctx.stdout(JSON.stringify(tasks));
      return 0;
    }
    ctx.stdout(`restored ${tasks.map((t) => `#${t.id}`).join(", ")}`);
    return 0;
  },
};
```

`packages/core/src/tasks.ts` — `remove()` 알리아스 메서드 삭제.

- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run typecheck` / Expected: 전체 PASS, 커버리지 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): soft-delete rm and restore commands"`

---

## Unit 5: 기존 커맨드 개편

### Task 15: add / update — 날짜 표현·parent·none 클리어

**Files:**
- Modify: `packages/cli/src/commands/add.ts`, `packages/cli/src/commands/update.ts`
- Test: `packages/cli/tests/add.test.ts`, `packages/cli/tests/update.test.ts` (추가)

- [ ] **Step 1: 실패하는 테스트 작성** — add.test.ts에 추가

```ts
import { parseDateExpr } from "@tasq/core";

  test("creates a subtask with --parent", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "p" });
    addCommand.run(["c", "--parent", "1"], ctx);
    expect(ctx.store.get(2)?.parentId).toBe(1);
  });

  test("rejects an invalid --parent value", () => {
    const { ctx, err } = createTestCli();
    expect(addCommand.run(["c", "--parent", "x"], ctx)).toBe(1);
    expect(err).toEqual(["invalid parent: x"]);
  });

  test("resolves date expressions for --due and --start", () => {
    const { ctx } = createTestCli();
    addCommand.run(["t", "--due", "tomorrow", "--start", "today"], ctx);
    const task = ctx.store.get(1);
    expect(task?.due).toBe(parseDateExpr("tomorrow", new Date()));
    expect(task?.start).toBe(parseDateExpr("today", new Date()));
  });

  test("throws on an invalid date expression (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => addCommand.run(["t", "--due", "blah"], ctx)).toThrow("invalid date expression");
  });
```

update.test.ts에 추가:

```ts
  test("moves under a parent and clears with none", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "c" });
    updateCommand.run(["2", "--parent", "1"], ctx);
    expect(ctx.store.get(2)?.parentId).toBe(1);
    updateCommand.run(["2", "--parent", "none"], ctx);
    expect(ctx.store.get(2)?.parentId).toBeNull();
  });

  test("rejects an invalid --parent value", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(updateCommand.run(["1", "--parent", "x"], ctx)).toBe(1);
    expect(err).toEqual(["invalid parent: x"]);
  });

  test("clears nullable fields with none", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t", project: "p", due: "2026-07-01", start: "2026-06-20" });
    updateCommand.run(["1", "--project", "none", "--due", "none", "--start", "none"], ctx);
    const task = ctx.store.get(1);
    expect(task?.project).toBeNull();
    expect(task?.due).toBeNull();
    expect(task?.start).toBeNull();
  });

  test("resolves date expressions for --due", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t" });
    updateCommand.run(["1", "--due", "2026-12-31"], ctx);
    expect(ctx.store.get(1)?.due).toBe("2026-12-31");
  });
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/add.test.ts packages/cli/tests/update.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

`add.ts` — options에 `parent: { type: "string" },` 추가. USAGE에 `[--parent <id>]` 추가. import에 `parseId` 추가, `import { parseDateExpr } from "@tasq/core";` 추가. store.create 호출 직전에:

```ts
    let parentId: number | undefined;
    if (values.parent !== undefined) {
      const parsed = parseId(values.parent);
      if (parsed === null) {
        ctx.stderr(`invalid parent: ${values.parent}`);
        return 1;
      }
      parentId = parsed;
    }
    const now = new Date();
```

store.create의 start/due/parentId를:

```ts
      start: values.start !== undefined ? parseDateExpr(values.start, now) : undefined,
      due: values.due !== undefined ? parseDateExpr(values.due, now) : undefined,
      parentId,
```

`update.ts` — options에 `parent: { type: "string" },` 추가. USAGE에 `[--parent <id|none>]` 표기, project/start/due에 `none` 클리어 표기. import에 `noneToNull, parseDateOption` 추가. patch 구성 부분을:

```ts
    if (values.parent !== undefined) {
      if (values.parent === "none") {
        patch.parentId = null;
      } else {
        const parsed = parseId(values.parent);
        if (parsed === null) {
          ctx.stderr(`invalid parent: ${values.parent}`);
          return 1;
        }
        patch.parentId = parsed;
      }
    }
    const now = new Date();
    if (values.project !== undefined) patch.project = noneToNull(values.project);
    if (values.start !== undefined) patch.start = parseDateOption(values.start, now);
    if (values.due !== undefined) patch.due = parseDateOption(values.due, now);
```

(기존 project/start/due 대입 줄은 위로 대체.)

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): date expressions, parent and none-clearing in add/update"`

### Task 16: list 개편 — 필터 + 트리 뷰

**Files:**
- Modify: `packages/cli/src/commands/list.ts` (전체 재작성)
- Test: `packages/cli/tests/list.test.ts` (전체 재작성)

- [ ] **Step 1: 실패하는 테스트 작성** — list.test.ts 전체 교체

```ts
import { describe, expect, test } from "bun:test";
import { listCommand } from "../src/commands/list";
import { createTestCli, type TestCli } from "./helpers";

function seeded(): TestCli {
  const cli = createTestCli();
  cli.ctx.store.create({ title: "a", priority: 1, tags: ["x"], project: "p1" });
  cli.ctx.store.create({ title: "b", priority: 5, project: "p2" });
  return cli;
}

describe("list", () => {
  test("prints one line per task", () => {
    const { ctx, out } = seeded();
    expect(listCommand.run([], ctx)).toBe(0);
    expect(out).toEqual(["○ #2 P5 b (p2)", "○ #1 P1 a (p1) [x]"]);
  });

  test("prints no tasks when empty", () => {
    const { ctx, out } = createTestCli();
    expect(listCommand.run([], ctx)).toBe(0);
    expect(out).toEqual(["no tasks"]);
  });

  test("prints JSON array with --json", () => {
    const { ctx, out } = seeded();
    listCommand.run(["--json"], ctx);
    expect(JSON.parse(out[0] ?? "")).toHaveLength(2);
  });

  test("filters by status, project and multiple tags", () => {
    const { ctx, out } = seeded();
    ctx.store.create({ title: "c", tags: ["x", "y"], project: "p1" });
    listCommand.run(["--project", "p1", "--tag", "x", "--tag", "y", "--status", "todo"], ctx);
    expect(out).toEqual(["○ #3 P0 c (p1) [x,y]"]);
  });

  test("exits 1 for invalid status", () => {
    const { ctx, err } = seeded();
    expect(listCommand.run(["--status", "doing"], ctx)).toBe(1);
    expect(err).toEqual(["invalid status: doing"]);
  });

  test("filters overdue tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "old", due: "2000-01-01" });
    ctx.store.create({ title: "future", due: "2999-01-01" });
    listCommand.run(["--overdue"], ctx);
    expect(out).toEqual(["○ #1 P0 old"]);
  });

  test("filters by due-before with a date expression", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "old", due: "2000-01-01" });
    ctx.store.create({ title: "future", due: "2999-01-01" });
    listCommand.run(["--due-before", "today"], ctx);
    expect(out).toEqual(["○ #1 P0 old"]);
  });

  test("searches title and body", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "fix login" });
    ctx.store.create({ title: "other" });
    listCommand.run(["--search", "login"], ctx);
    expect(out).toEqual(["○ #1 P0 fix login"]);
  });

  test("ready excludes dep-blocked tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "blocked" });
    ctx.store.create({ title: "dep" });
    ctx.store.addDep(1, 2);
    listCommand.run(["--ready"], ctx);
    expect(out).toEqual(["○ #2 P0 dep"]);
  });

  test("renders a tree by default and flat with --flat", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "c", parentId: 1 });
    listCommand.run([], ctx);
    expect(out).toEqual(["○ #1 P0 p", "  ○ #2 P0 c"]);
    out.length = 0;
    listCommand.run(["--flat"], ctx);
    expect(out).toEqual(["○ #1 P0 p", "○ #2 P0 c"]);
  });

  test("any filter forces flat output", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "c", parentId: 1 });
    listCommand.run(["--status", "todo"], ctx);
    expect(out).toEqual(["○ #1 P0 p", "○ #2 P0 c"]);
  });

  test("marks dep-blocked tasks", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "blocked" });
    ctx.store.create({ title: "dep" });
    ctx.store.addDep(1, 2);
    listCommand.run([], ctx);
    expect(out).toEqual(["○ #1 P0 blocked [blocked]", "○ #2 P0 dep"]);
  });

  test("includes archived tasks with --all keeping the tree", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "live" });
    ctx.store.create({ title: "dead" });
    ctx.store.archive(2);
    listCommand.run(["--all"], ctx);
    expect(out).toEqual(["○ #1 P0 live", "○ #2 P0 dead [archived]"]);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/list.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — list.ts 전체 교체

```ts
import { parseArgs } from "node:util";
import { isTaskStatus, parseDateExpr, type TaskStatus } from "@tasq/core";
import { formatTaskLine, treeOrder } from "../output";
import type { Command } from "../registry";

const USAGE =
  "tasq list [--status <s>] [--tag <t>]... [--project <p>] [--search <q>] [--due-before <expr>] [--due-after <expr>] [--overdue] [--ready] [--all] [--flat] [--json]";

export const listCommand: Command = {
  name: "list",
  description: "List tasks",
  usage: USAGE,
  run(args, ctx) {
    const { values } = parseArgs({
      args,
      options: {
        status: { type: "string" },
        tag: { type: "string", multiple: true },
        project: { type: "string" },
        search: { type: "string" },
        "due-before": { type: "string" },
        "due-after": { type: "string" },
        overdue: { type: "boolean" },
        ready: { type: "boolean" },
        all: { type: "boolean" },
        flat: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    if (values.status !== undefined && !isTaskStatus(values.status)) {
      ctx.stderr(`invalid status: ${values.status}`);
      return 1;
    }
    const now = new Date();
    const tasks = ctx.store.list({
      status: values.status as TaskStatus | undefined,
      tags: values.tag,
      project: values.project,
      search: values.search,
      dueBefore:
        values["due-before"] !== undefined ? parseDateExpr(values["due-before"], now) : undefined,
      dueAfter:
        values["due-after"] !== undefined ? parseDateExpr(values["due-after"], now) : undefined,
      overdueAsOf: values.overdue === true ? parseDateExpr("today", now) : undefined,
      ready: values.ready,
      includeArchived: values.all,
    });
    if (values.json === true) {
      ctx.stdout(JSON.stringify(tasks));
      return 0;
    }
    if (tasks.length === 0) {
      ctx.stdout("no tasks");
      return 0;
    }
    const blocked = ctx.store.blockedTaskIds();
    // 필터가 걸리면 부분 트리의 표시가 모호해지므로 자동 flat — --all은 표시 범위라 예외
    const filtered =
      values.status !== undefined ||
      values.tag !== undefined ||
      values.project !== undefined ||
      values.search !== undefined ||
      values["due-before"] !== undefined ||
      values["due-after"] !== undefined ||
      values.overdue === true ||
      values.ready === true;
    if (filtered || values.flat === true) {
      for (const task of tasks) {
        ctx.stdout(formatTaskLine(task, { blocked: blocked.has(task.id) }));
      }
      return 0;
    }
    for (const { task, depth } of treeOrder(tasks)) {
      ctx.stdout(formatTaskLine(task, { blocked: blocked.has(task.id), depth }));
    }
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): extended list filters and tree view"`

### Task 17: show 개편 — deps·notes 표시

**Files:**
- Modify: `packages/cli/src/commands/show.ts`
- Test: `packages/cli/tests/show.test.ts` (추가)

- [ ] **Step 1: 실패하는 테스트 작성** — show.test.ts에 추가

```ts
  test("shows parent, deps and notes", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "dep" });
    ctx.store.create({ title: "t", parentId: 1 });
    ctx.store.addDep(3, 2);
    ctx.store.addComment(3, "first note");
    showCommand.run(["3"], ctx);
    const detail = out.join("\n");
    expect(detail).toContain("parent:   #1");
    expect(detail).toContain("deps:     #2");
    expect(detail).toContain("first note");
  });

  test("includes deps and notes in JSON output", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    ctx.store.create({ title: "dep" });
    ctx.store.addDep(1, 2);
    ctx.store.addComment(1, "n");
    showCommand.run(["1", "--json"], ctx);
    const data = JSON.parse(out[0] ?? "");
    expect(data.deps).toEqual([2]);
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0].payload.text).toBe("n");
  });
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/show.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — show.ts의 출력 부분을 다음으로 교체

```ts
    const deps = ctx.store.depsOf(id);
    const comments = ctx.store.comments(id);
    if (values.json === true) {
      ctx.stdout(JSON.stringify({ ...task, deps, notes: comments }));
      return 0;
    }
    const notes = comments.map((e) => ({
      createdAt: e.createdAt,
      text: String(e.payload.text),
    }));
    ctx.stdout(formatTaskDetail(task, { deps, notes }));
    return 0;
```

- [ ] **Step 4: 통과 확인** — Run: `bun test` / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): show with deps and notes"`

---

## Unit 6: 조립

### Task 18: 레지스트리 조립 + `tq` bin alias

**Files:**
- Modify: `packages/cli/src/commands/index.ts`, `packages/cli/package.json`
- Test: `packages/cli/tests/commands-index.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — commands-index.test.ts의 기대 배열 교체

```ts
    expect(names).toEqual([
      "add",
      "cancel",
      "dep",
      "done",
      "events",
      "list",
      "note",
      "reopen",
      "restore",
      "rm",
      "show",
      "start",
      "status",
      "update",
    ]);
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/commands-index.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

`commands/index.ts`:

```ts
import { CommandRegistry } from "../registry";
import { addCommand } from "./add";
import { depCommand } from "./dep";
import { eventsCommand } from "./events";
import { cancelCommand, doneCommand, reopenCommand, startCommand } from "./lifecycle";
import { listCommand } from "./list";
import { noteCommand } from "./note";
import { restoreCommand } from "./restore";
import { rmCommand } from "./rm";
import { showCommand } from "./show";
import { statusCommand } from "./status";
import { updateCommand } from "./update";

export function buildRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of [
    addCommand,
    listCommand,
    showCommand,
    updateCommand,
    doneCommand,
    startCommand,
    cancelCommand,
    reopenCommand,
    statusCommand,
    noteCommand,
    depCommand,
    rmCommand,
    restoreCommand,
    eventsCommand,
  ]) {
    registry.register(command);
  }
  return registry;
}
```

`packages/cli/package.json`의 bin을:

```json
  "bin": { "tasq": "./src/index.ts", "tq": "./src/index.ts" },
```

- [ ] **Step 4: 최종 검증** — Run: `bun test && bun run typecheck` / Expected: 전체 PASS, 커버리지 100% (라인·함수 모두)
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): register new commands and tq bin alias"`

---

## 마무리

- [ ] 전체 self-review: `git diff main --stat`로 변경 범위 확인, 스펙(설계 문서 §4) 대비 누락 점검
- [ ] PR 생성: 제목 `feat: Batch A — 일상 사용성 + 구조 (날짜 파싱·라이프사이클·deps·sub-task·soft delete)`. 본문에 설계 문서 링크, 커맨드 표면 변화 요약, **breaking changes**(rm이 soft delete로, status `--json`이 배열로) 명시. **AI 어시스턴트 푸터 금지.**

## 스펙 커버리지 체크리스트 (설계 §4 대비)

- [x] 날짜 파싱 → Task 2 (입력) + Task 15/16 (적용 지점)
- [x] done/start/cancel/reopen + 복수 ID + 트랜잭션 → Task 11
- [x] 필터: due-before/after, overdue, tags AND, search, ready, all → Task 8 + 16
- [x] note → Task 8 + 12
- [x] deps + 순환 탐지 + blocked 계산 + start 경고 → Task 5 + 11 + 13
- [x] sub-task: parent, 순환 차단, 트리, done 차단, rm --recursive → Task 4 + 6 + 7 + 10 + 14 + 16
- [x] cancelled status + 전이 가드 → Task 3 + 6
- [x] soft delete + --hard + restore → Task 7 + 14
- [x] updated 이벤트 before/after + 신규 이벤트 타입 → Task 3 + 4
- [x] 마이그레이션 러너 + 백업 + 다운그레이드 보호 → Task 1
- [x] `tq` bin alias → Task 18
- [x] `none` 클리어 컨벤션 → Task 9 + 15
