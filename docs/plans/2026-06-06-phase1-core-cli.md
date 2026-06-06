# tasq Phase 1: core + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 에이전트가 CLI만으로 태스크 CRUD·상태 전이·이벤트 조회를 할 수 있는 최소체를 만든다 (concept.md Phase 1).

**Architecture:** Bun workspace 모노레포. `@tasq/core`(도메인 + SQLite + 이벤트 로그)와 `tasq` CLI(커맨드 레지스트리 + `--json` 출력) 두 패키지. 데몬 없음. 모든 변이는 `events` 테이블에 append-only로 기록된다.

**Tech Stack:** Bun (`bun:sqlite`, `bun test`), TypeScript strict, devbox, GitHub Actions.

**Rules:**
- 커버리지 100% 유지 (`bunfig.toml`의 `coverageThreshold = 1.0`). 매 태스크 종료 시 `bun test --coverage`가 통과해야 한다.
- TDD: 실패하는 테스트 → 최소 구현 → 통과 → 커밋.
- 커밋 메시지에 `Co-Authored-By` / "Generated with Claude Code" 류의 AI footer를 **절대 넣지 않는다**.
- 외부 런타임 의존성 0개. devDependencies는 `typescript`, `@types/bun`만.

---

## File Structure

```
tasq/
├── devbox.json                          # bun 설치
├── package.json                         # workspace 루트
├── tsconfig.json                        # strict 타입체크 (noEmit)
├── bunfig.toml                          # 커버리지 100% 강제
├── .github/workflows/ci.yml             # typecheck + test
├── packages/
│   ├── core/
│   │   ├── package.json                 # @tasq/core
│   │   ├── src/
│   │   │   ├── index.ts                 # 공개 API barrel
│   │   │   ├── home.ts                  # ~/.tasq 해석/부트스트랩
│   │   │   ├── db.ts                    # SQLite open + 스키마
│   │   │   ├── types.ts                 # Task/TaskEvent/입력 타입, isTaskStatus
│   │   │   ├── errors.ts                # TaskNotFoundError, InvalidStatusError
│   │   │   └── tasks.ts                 # TaskStore (CRUD + 이벤트 기록)
│   │   └── tests/
│   │       ├── home.test.ts
│   │       ├── db.test.ts
│   │       ├── types.test.ts
│   │       ├── errors.test.ts
│   │       └── tasks.test.ts
│   └── cli/
│       ├── package.json                 # tasq (bin)
│       ├── src/
│       │   ├── index.ts                 # bin 엔트리 (main)
│       │   ├── app.ts                   # runCli 디스패치 + help
│       │   ├── registry.ts              # Command/CliContext/CommandRegistry
│       │   ├── context.ts               # 실환경 CliContext 생성
│       │   ├── parse.ts                 # parseId/parsePriority
│       │   ├── output.ts                # 사람용 포맷터
│       │   └── commands/
│       │       ├── index.ts             # buildRegistry
│       │       ├── add.ts  list.ts  show.ts  update.ts
│       │       ├── status.ts  rm.ts  events.ts
│       └── tests/
│           ├── helpers.ts               # 인메모리 CliContext
│           ├── app.test.ts  parse.test.ts  output.test.ts
│           ├── add.test.ts  list.test.ts  show.test.ts
│           ├── update.test.ts  status.test.ts  rm.test.ts  events.test.ts
│           ├── commands-index.test.ts  context.test.ts  main.test.ts
│           └── cli.e2e.test.ts          # 실 바이너리 smoke (pragmatic)
└── docs/
```

설계 원칙: CLI 커맨드는 `CliContext`(store + stdout/stderr 주입)를 받아 순수하게 테스트 가능. `runCli`가 에러를 일괄 처리(메시지 → stderr, exit 1)하므로 커맨드는 core 에러를 그대로 던져도 된다.

---

### Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `devbox.json`, `.gitignore`, `package.json`, `tsconfig.json`, `bunfig.toml`
- Create: `packages/core/package.json`, `packages/cli/package.json`

- [ ] **Step 1: 설정 파일 작성**

`devbox.json`:
```json
{
  "packages": ["bun@latest"]
}
```

`.gitignore`:
```
node_modules/
.DS_Store
```

`package.json`:
```json
{
  "name": "tasq-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["bun"]
  },
  "include": ["packages"]
}
```

`bunfig.toml`:
```toml
[test]
coverage = true
coverageThreshold = 1.0
coverageSkipTestFiles = true
```

`packages/core/package.json`:
```json
{
  "name": "@tasq/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/cli/package.json`:
```json
{
  "name": "tasq",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "bin": { "tasq": "./src/index.ts" },
  "dependencies": { "@tasq/core": "workspace:*" }
}
```

- [ ] **Step 2: 설치 및 검증**

Run: `devbox run -- bun install` (devbox 미사용 환경이면 `bun install`)
Expected: `bun.lock` 생성, 에러 없음.

Run: `bun run typecheck`
Expected: 에러 없음 (소스가 아직 없으므로 통과).

주의: 아직 테스트 파일이 없으므로 `bun test`는 실행하지 않는다.

- [ ] **Step 3: Commit**

```bash
git add devbox.json .gitignore package.json tsconfig.json bunfig.toml bun.lock packages/
git commit -m "chore: scaffold bun workspace with devbox and 100% coverage gate"
```

---

### Task 2: core — TasqHome (~/.tasq 해석/부트스트랩)

**Files:**
- Create: `packages/core/src/home.ts`, `packages/core/src/index.ts`
- Test: `packages/core/tests/home.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/home.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTasqHome, resolveTasqHome } from "@tasq/core";

describe("resolveTasqHome", () => {
  test("TASQ_HOME 환경변수가 root를 결정한다", () => {
    const home = resolveTasqHome({ TASQ_HOME: "/tmp/custom" });
    expect(home.root).toBe("/tmp/custom");
    expect(home.dbPath).toBe(join("/tmp/custom", "tasq.db"));
    expect(home.pluginsDir).toBe(join("/tmp/custom", "plugins"));
  });

  test("기본값은 ~/.tasq", () => {
    const home = resolveTasqHome({});
    expect(home.root).toBe(join(homedir(), ".tasq"));
  });
});

describe("ensureTasqHome", () => {
  test("디렉토리를 재귀 생성한다", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tasq-home-"));
    const home = ensureTasqHome(resolveTasqHome({ TASQ_HOME: join(tmp, "nested", ".tasq") }));
    expect(existsSync(home.pluginsDir)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/core/tests/home.test.ts`
Expected: FAIL — `@tasq/core` 모듈에 export 없음.

- [ ] **Step 3: 구현**

`packages/core/src/home.ts`:
```ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TasqHome {
  root: string;
  dbPath: string;
  pluginsDir: string;
}

export function resolveTasqHome(
  env: Record<string, string | undefined> = process.env,
): TasqHome {
  const root = env.TASQ_HOME ?? join(homedir(), ".tasq");
  return {
    root,
    dbPath: join(root, "tasq.db"),
    pluginsDir: join(root, "plugins"),
  };
}

export function ensureTasqHome(home: TasqHome): TasqHome {
  mkdirSync(home.pluginsDir, { recursive: true });
  return home;
}
```

`packages/core/src/index.ts`:
```ts
export * from "./home";
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): resolve and bootstrap ~/.tasq home directory"
```

---

### Task 3: core — openDb + 스키마

**Files:**
- Create: `packages/core/src/db.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/db.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/db.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { openDb } from "@tasq/core";

describe("openDb", () => {
  test("tasks/events 테이블을 생성한다", () => {
    const db = openDb(":memory:");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("tasks");
    expect(names).toContain("events");
  });

  test("user_version을 1로 설정한다", () => {
    const db = openDb(":memory:");
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/core/tests/db.test.ts`
Expected: FAIL — `openDb` export 없음.

- [ ] **Step 3: 구현**

`packages/core/src/db.ts`:
```ts
import { Database } from "bun:sqlite";

// events는 append-only 로그다. 태스크 삭제 후에도 이력이 남아야 하므로
// 의도적으로 FOREIGN KEY를 걸지 않는다.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  project TEXT,
  due TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
`;

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  db.exec("PRAGMA user_version = 1;");
  return db;
}
```

`packages/core/src/index.ts`:
```ts
export * from "./db";
export * from "./home";
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): open sqlite db with tasks/events schema"
```

---

### Task 4: core — 타입과 에러

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/errors.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/types.test.ts`, `packages/core/tests/errors.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/types.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { TASK_STATUSES, isTaskStatus } from "@tasq/core";

describe("isTaskStatus", () => {
  test("정의된 상태는 true", () => {
    for (const s of TASK_STATUSES) expect(isTaskStatus(s)).toBe(true);
  });

  test("정의되지 않은 상태는 false", () => {
    expect(isTaskStatus("doing")).toBe(false);
    expect(isTaskStatus("")).toBe(false);
  });
});
```

`packages/core/tests/errors.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { InvalidStatusError, TaskNotFoundError } from "@tasq/core";

describe("errors", () => {
  test("TaskNotFoundError는 id를 보존한다", () => {
    const err = new TaskNotFoundError(42);
    expect(err.taskId).toBe(42);
    expect(err.message).toBe("task not found: 42");
    expect(err.name).toBe("TaskNotFoundError");
  });

  test("InvalidStatusError는 status를 보존한다", () => {
    const err = new InvalidStatusError("doing");
    expect(err.status).toBe("doing");
    expect(err.message).toBe("invalid status: doing");
    expect(err.name).toBe("InvalidStatusError");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/core/tests/types.test.ts packages/core/tests/errors.test.ts`
Expected: FAIL — export 없음.

- [ ] **Step 3: 구현**

`packages/core/src/types.ts`:
```ts
export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "review",
  "done",
  "blocked",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export interface Task {
  id: number;
  title: string;
  body: string;
  status: TaskStatus;
  priority: number;
  tags: string[];
  project: string | null;
  due: string | null;
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  priority?: number;
  tags?: string[];
  project?: string;
  due?: string;
  externalRef?: string;
}

export interface UpdateTaskPatch {
  title?: string;
  body?: string;
  priority?: number;
  tags?: string[];
  project?: string | null;
  due?: string | null;
  externalRef?: string | null;
}

export interface TaskFilter {
  status?: TaskStatus;
  tag?: string;
  project?: string;
}

export type TaskEventType = "created" | "updated" | "status_changed" | "deleted";

export interface TaskEvent {
  id: number;
  taskId: number;
  type: TaskEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

`packages/core/src/errors.ts`:
```ts
export class TaskNotFoundError extends Error {
  constructor(public readonly taskId: number) {
    super(`task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class InvalidStatusError extends Error {
  constructor(public readonly status: string) {
    super(`invalid status: ${status}`);
    this.name = "InvalidStatusError";
  }
}
```

`packages/core/src/index.ts`:
```ts
export * from "./db";
export * from "./errors";
export * from "./home";
export * from "./types";
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): task domain types and error classes"
```

---

### Task 5: core — TaskStore.create / get / events

**Files:**
- Create: `packages/core/src/tasks.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/tasks.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { TaskStore, openDb } from "@tasq/core";

function makeStore(): TaskStore {
  return new TaskStore(openDb(":memory:"));
}

describe("TaskStore.create", () => {
  test("기본값으로 태스크를 생성한다", () => {
    const store = makeStore();
    const task = store.create({ title: "write spec" });
    expect(task.id).toBe(1);
    expect(task.title).toBe("write spec");
    expect(task.status).toBe("todo");
    expect(task.priority).toBe(0);
    expect(task.tags).toEqual([]);
    expect(task.body).toBe("");
    expect(task.project).toBeNull();
    expect(task.due).toBeNull();
    expect(task.externalRef).toBeNull();
    expect(task.createdAt).toBe(task.updatedAt);
  });

  test("입력값을 반영한다", () => {
    const store = makeStore();
    const task = store.create({
      title: "t",
      body: "detail",
      priority: 3,
      tags: ["a", "b"],
      project: "tasq",
      due: "2026-07-01",
      externalRef: "github:yish0/tasq#1",
    });
    expect(task.body).toBe("detail");
    expect(task.priority).toBe(3);
    expect(task.tags).toEqual(["a", "b"]);
    expect(task.project).toBe("tasq");
    expect(task.due).toBe("2026-07-01");
    expect(task.externalRef).toBe("github:yish0/tasq#1");
  });

  test("created 이벤트를 기록한다", () => {
    const store = makeStore();
    const task = store.create({ title: "t" });
    const events = store.events(task.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("created");
    expect(events[0]?.payload).toEqual({ title: "t" });
  });
});

describe("TaskStore.get", () => {
  test("없는 id는 null", () => {
    expect(makeStore().get(999)).toBeNull();
  });

  test("생성한 태스크를 돌려준다", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    expect(store.get(created.id)).toEqual(created);
  });
});

describe("TaskStore.events", () => {
  test("이벤트가 없으면 빈 배열", () => {
    expect(makeStore().events(1)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/core/tests/tasks.test.ts`
Expected: FAIL — `TaskStore` export 없음.

- [ ] **Step 3: 구현**

`packages/core/src/tasks.ts`:
```ts
import type { Database } from "bun:sqlite";
import type {
  CreateTaskInput,
  Task,
  TaskEvent,
  TaskEventType,
  TaskFilter,
  TaskStatus,
  UpdateTaskPatch,
} from "./types";

interface TaskRow {
  id: number;
  title: string;
  body: string;
  status: string;
  priority: number;
  tags: string;
  project: string | null;
  due: string | null;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: number;
  task_id: number;
  type: string;
  payload: string;
  created_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status as TaskStatus,
    priority: row.priority,
    tags: JSON.parse(row.tags) as string[],
    project: row.project,
    due: row.due,
    externalRef: row.external_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: EventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type as TaskEventType,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export class TaskStore {
  constructor(private readonly db: Database) {}

  create(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const row = this.db
      .query(
        `INSERT INTO tasks (title, body, priority, tags, project, due, external_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        input.title,
        input.body ?? "",
        input.priority ?? 0,
        JSON.stringify(input.tags ?? []),
        input.project ?? null,
        input.due ?? null,
        input.externalRef ?? null,
        now,
        now,
      ) as TaskRow;
    const task = rowToTask(row);
    this.recordEvent(task.id, "created", { title: task.title }, now);
    return task;
  }

  get(id: number): Task | null {
    const row = this.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    return row ? rowToTask(row) : null;
  }

  events(taskId: number): TaskEvent[] {
    const rows = this.db
      .query("SELECT * FROM events WHERE task_id = ? ORDER BY id ASC")
      .all(taskId) as EventRow[];
    return rows.map(rowToEvent);
  }

  private recordEvent(
    taskId: number,
    type: TaskEventType,
    payload: Record<string, unknown>,
    createdAt: string,
  ): void {
    this.db
      .query("INSERT INTO events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(taskId, type, JSON.stringify(payload), createdAt);
  }
}
```

`packages/core/src/index.ts`:
```ts
export * from "./db";
export * from "./errors";
export * from "./home";
export * from "./tasks";
export * from "./types";
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): TaskStore create/get with created event"
```

---

### Task 6: core — TaskStore.list 필터

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`packages/core/tests/tasks.test.ts`에 추가:
```ts
describe("TaskStore.list", () => {
  function seeded(): TaskStore {
    const store = makeStore();
    store.create({ title: "a", priority: 1, tags: ["x"], project: "p1" });
    store.create({ title: "b", priority: 5, tags: ["x", "y"], project: "p2" });
    store.create({ title: "c", priority: 3, project: "p1" });
    return store;
  }

  test("필터 없이 priority 내림차순으로 전체 반환", () => {
    const titles = seeded().list().map((t) => t.title);
    expect(titles).toEqual(["b", "c", "a"]);
  });

  test("status 필터", () => {
    const store = seeded();
    expect(store.list({ status: "todo" })).toHaveLength(3);
    expect(store.list({ status: "done" })).toHaveLength(0);
  });

  test("project 필터", () => {
    const titles = seeded().list({ project: "p1" }).map((t) => t.title);
    expect(titles).toEqual(["c", "a"]);
  });

  test("tag 필터", () => {
    const titles = seeded().list({ tag: "y" }).map((t) => t.title);
    expect(titles).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/core/tests/tasks.test.ts`
Expected: FAIL — `list` 메서드 없음.

- [ ] **Step 3: 구현**

`packages/core/src/tasks.ts`의 `TaskStore`에 추가 (`get` 메서드 아래):
```ts
  list(filter: TaskFilter = {}): Task[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.project) {
      where.push("project = ?");
      params.push(filter.project);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .query(`SELECT * FROM tasks ${clause} ORDER BY priority DESC, id ASC`)
      .all(...params) as TaskRow[];
    let tasks = rows.map(rowToTask);
    if (filter.tag !== undefined) {
      const tag = filter.tag;
      tasks = tasks.filter((t) => t.tags.includes(tag));
    }
    return tasks;
  }
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): TaskStore.list with status/project/tag filters"
```

---

### Task 7: core — TaskStore.update

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`packages/core/tests/tasks.test.ts` 상단 import에 에러 클래스 추가:
```ts
import { TaskNotFoundError, TaskStore, openDb } from "@tasq/core";
```

테스트 추가:
```ts
describe("TaskStore.update", () => {
  test("패치 필드만 갱신하고 updated 이벤트를 기록한다", () => {
    const store = makeStore();
    const created = store.create({ title: "old", priority: 1 });
    const updated = store.update(created.id, { title: "new", tags: ["t"] });
    expect(updated.title).toBe("new");
    expect(updated.tags).toEqual(["t"]);
    expect(updated.priority).toBe(1);
    const events = store.events(created.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("updated");
    expect(events[1]?.payload).toEqual({ fields: ["title", "tags"] });
  });

  test("null로 필드를 비울 수 있다", () => {
    const store = makeStore();
    const created = store.create({ title: "t", project: "p", due: "2026-07-01" });
    const updated = store.update(created.id, { project: null, due: null });
    expect(updated.project).toBeNull();
    expect(updated.due).toBeNull();
  });

  test("빈 패치는 변경도 이벤트도 없다", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    const result = store.update(created.id, {});
    expect(result).toEqual(created);
    expect(store.events(created.id)).toHaveLength(1);
  });

  test("없는 id는 TaskNotFoundError", () => {
    expect(() => makeStore().update(999, { title: "x" })).toThrow(TaskNotFoundError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/core/tests/tasks.test.ts`
Expected: FAIL — `update` 메서드 없음.

- [ ] **Step 3: 구현**

`packages/core/src/tasks.ts` 상단 import에 에러 추가:
```ts
import { TaskNotFoundError } from "./errors";
```

`TaskStore`에 추가:
```ts
  update(id: number, patch: UpdateTaskPatch): Task {
    const current = this.mustGet(id);
    const fields = Object.keys(patch);
    if (fields.length === 0) return current;
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE tasks
         SET title = ?, body = ?, priority = ?, tags = ?, project = ?, due = ?, external_ref = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.body,
        next.priority,
        JSON.stringify(next.tags),
        next.project,
        next.due,
        next.externalRef,
        now,
        id,
      );
    this.recordEvent(id, "updated", { fields }, now);
    return this.mustGet(id);
  }

  private mustGet(id: number): Task {
    const task = this.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): TaskStore.update with updated event"
```

---

### Task 8: core — TaskStore.setStatus

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`packages/core/tests/tasks.test.ts` 상단 import에 `InvalidStatusError` 추가:
```ts
import { InvalidStatusError, TaskNotFoundError, TaskStore, openDb } from "@tasq/core";
```

테스트 추가:
```ts
describe("TaskStore.setStatus", () => {
  test("상태를 바꾸고 status_changed 이벤트를 기록한다", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    const updated = store.setStatus(created.id, "in_progress");
    expect(updated.status).toBe("in_progress");
    const events = store.events(created.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("status_changed");
    expect(events[1]?.payload).toEqual({ from: "todo", to: "in_progress" });
  });

  test("잘못된 상태는 InvalidStatusError", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    expect(() => store.setStatus(created.id, "doing")).toThrow(InvalidStatusError);
  });

  test("없는 id는 TaskNotFoundError", () => {
    expect(() => makeStore().setStatus(999, "done")).toThrow(TaskNotFoundError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/core/tests/tasks.test.ts`
Expected: FAIL — `setStatus` 메서드 없음.

- [ ] **Step 3: 구현**

`packages/core/src/tasks.ts` 상단 import 수정:
```ts
import { InvalidStatusError, TaskNotFoundError } from "./errors";
import { isTaskStatus } from "./types";
```

`TaskStore`에 추가:
```ts
  setStatus(id: number, status: string): Task {
    if (!isTaskStatus(status)) throw new InvalidStatusError(status);
    const current = this.mustGet(id);
    const now = new Date().toISOString();
    this.db
      .query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, id);
    this.recordEvent(id, "status_changed", { from: current.status, to: status }, now);
    return this.mustGet(id);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): TaskStore.setStatus with transition event"
```

---

### Task 9: core — TaskStore.remove

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
describe("TaskStore.remove", () => {
  test("태스크를 지우고 deleted 이벤트는 남긴다", () => {
    const store = makeStore();
    const created = store.create({ title: "t" });
    store.remove(created.id);
    expect(store.get(created.id)).toBeNull();
    const events = store.events(created.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("deleted");
  });

  test("없는 id는 TaskNotFoundError", () => {
    expect(() => makeStore().remove(999)).toThrow(TaskNotFoundError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/core/tests/tasks.test.ts`
Expected: FAIL — `remove` 메서드 없음.

- [ ] **Step 3: 구현**

`TaskStore`에 추가:
```ts
  remove(id: number): void {
    this.mustGet(id);
    const now = new Date().toISOString();
    this.db.query("DELETE FROM tasks WHERE id = ?").run(id);
    this.recordEvent(id, "deleted", {}, now);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage` 그리고 `bun run typecheck`
Expected: 둘 다 PASS. core 패키지 완성.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): TaskStore.remove keeping deleted event"
```

---

### Task 10: cli — CommandRegistry + runCli

**Files:**
- Create: `packages/cli/src/registry.ts`, `packages/cli/src/app.ts`
- Create: `packages/cli/tests/helpers.ts`
- Test: `packages/cli/tests/app.test.ts`

- [ ] **Step 1: 테스트 헬퍼와 실패하는 테스트 작성**

`packages/cli/tests/helpers.ts`:
```ts
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
```

`packages/cli/tests/app.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { runCli } from "../src/app";
import { CommandRegistry, type Command } from "../src/registry";
import { createTestCli } from "./helpers";

const hello: Command = {
  name: "hello",
  description: "say hello",
  usage: "tasq hello",
  run(_args, ctx) {
    ctx.stdout("hi");
    return 0;
  },
};

const boomError: Command = {
  name: "boom-error",
  description: "throw Error",
  usage: "tasq boom-error",
  run() {
    throw new Error("kaboom");
  },
};

const boomString: Command = {
  name: "boom-string",
  description: "throw string",
  usage: "tasq boom-string",
  run() {
    throw "raw failure";
  },
};

function makeRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(hello);
  registry.register(boomError);
  registry.register(boomString);
  return registry;
}

describe("runCli", () => {
  test("커맨드를 디스패치한다", () => {
    const { ctx, out } = createTestCli();
    const code = runCli(["hello"], ctx, makeRegistry());
    expect(code).toBe(0);
    expect(out).toEqual(["hi"]);
  });

  test("인자 없으면 help를 출력한다", () => {
    const { ctx, out } = createTestCli();
    const code = runCli([], ctx, makeRegistry());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("hello");
    expect(out.join("\n")).toContain("say hello");
  });

  test("help / --help도 help를 출력한다", () => {
    for (const arg of ["help", "--help"]) {
      const { ctx, out } = createTestCli();
      expect(runCli([arg], ctx, makeRegistry())).toBe(0);
      expect(out.join("\n")).toContain("usage: tasq");
    }
  });

  test("모르는 커맨드는 exit 1", () => {
    const { ctx, err } = createTestCli();
    const code = runCli(["nope"], ctx, makeRegistry());
    expect(code).toBe(1);
    expect(err).toEqual(["unknown command: nope"]);
  });

  test("Error를 던지면 메시지를 stderr로", () => {
    const { ctx, err } = createTestCli();
    expect(runCli(["boom-error"], ctx, makeRegistry())).toBe(1);
    expect(err).toEqual(["kaboom"]);
  });

  test("Error가 아닌 throw도 처리한다", () => {
    const { ctx, err } = createTestCli();
    expect(runCli(["boom-string"], ctx, makeRegistry())).toBe(1);
    expect(err).toEqual(["raw failure"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/cli/tests/app.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/cli/src/registry.ts`:
```ts
import type { TaskStore } from "@tasq/core";

export interface CliContext {
  store: TaskStore;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface Command {
  name: string;
  description: string;
  usage: string;
  run(args: string[], ctx: CliContext): number;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }
}
```

`packages/cli/src/app.ts`:
```ts
import type { CliContext, CommandRegistry } from "./registry";

function printHelp(registry: CommandRegistry, ctx: CliContext): void {
  ctx.stdout("usage: tasq <command> [options]");
  ctx.stdout("");
  for (const command of registry.all()) {
    ctx.stdout(`  ${command.name.padEnd(8)} ${command.description}`);
  }
}

export function runCli(argv: string[], ctx: CliContext, registry: CommandRegistry): number {
  const [name, ...rest] = argv;
  if (name === undefined || name === "help" || name === "--help") {
    printHelp(registry, ctx);
    return 0;
  }
  const command = registry.get(name);
  if (!command) {
    ctx.stderr(`unknown command: ${name}`);
    return 1;
  }
  try {
    return command.run(rest, ctx);
  } catch (err) {
    ctx.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): command registry and dispatch with error handling"
```

---

### Task 11: cli — parse/output 헬퍼

**Files:**
- Create: `packages/cli/src/parse.ts`, `packages/cli/src/output.ts`
- Test: `packages/cli/tests/parse.test.ts`, `packages/cli/tests/output.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/cli/tests/parse.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { parseId, parsePriority } from "../src/parse";

describe("parseId", () => {
  test("양의 정수 문자열을 숫자로", () => {
    expect(parseId("42")).toBe(42);
  });

  test("undefined/비정수/0 이하는 null", () => {
    expect(parseId(undefined)).toBeNull();
    expect(parseId("abc")).toBeNull();
    expect(parseId("1.5")).toBeNull();
    expect(parseId("0")).toBeNull();
    expect(parseId("-3")).toBeNull();
  });
});

describe("parsePriority", () => {
  test("유한 숫자 문자열을 숫자로", () => {
    expect(parsePriority("3")).toBe(3);
    expect(parsePriority("-1")).toBe(-1);
  });

  test("숫자가 아니면 null", () => {
    expect(parsePriority("high")).toBeNull();
  });
});
```

`packages/cli/tests/output.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import type { Task } from "@tasq/core";
import { formatTaskDetail, formatTaskLine } from "../src/output";

const base: Task = {
  id: 7,
  title: "ship it",
  body: "",
  status: "in_progress",
  priority: 2,
  tags: [],
  project: null,
  due: null,
  externalRef: null,
  createdAt: "2026-06-06T00:00:00.000Z",
  updatedAt: "2026-06-06T01:00:00.000Z",
};

describe("formatTaskLine", () => {
  test("기본 한 줄 포맷", () => {
    expect(formatTaskLine(base)).toBe("◐ #7 P2 ship it");
  });

  test("project와 tags를 포함한다", () => {
    const task: Task = { ...base, status: "todo", project: "tasq", tags: ["a", "b"] };
    expect(formatTaskLine(task)).toBe("○ #7 P2 ship it (tasq) [a,b]");
  });
});

describe("formatTaskDetail", () => {
  test("필드를 멀티라인으로 보여준다", () => {
    const detail = formatTaskDetail(base);
    expect(detail).toContain("#7 ship it");
    expect(detail).toContain("status:   in_progress");
    expect(detail).toContain("tags:     -");
    expect(detail).toContain("project:  -");
  });

  test("body가 있으면 끝에 붙인다", () => {
    const detail = formatTaskDetail({ ...base, body: "long description" });
    expect(detail.endsWith("long description")).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/cli/tests/parse.test.ts packages/cli/tests/output.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/cli/src/parse.ts`:
```ts
export function parseId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parsePriority(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
```

`packages/cli/src/output.ts`:
```ts
import type { Task, TaskStatus } from "@tasq/core";

const STATUS_ICONS: Record<TaskStatus, string> = {
  todo: "○",
  in_progress: "◐",
  review: "◎",
  done: "●",
  blocked: "✗",
};

export function formatTaskLine(task: Task): string {
  const project = task.project ? ` (${task.project})` : "";
  const tags = task.tags.length > 0 ? ` [${task.tags.join(",")}]` : "";
  return `${STATUS_ICONS[task.status]} #${task.id} P${task.priority} ${task.title}${project}${tags}`;
}

export function formatTaskDetail(task: Task): string {
  const lines = [
    `#${task.id} ${task.title}`,
    `status:   ${task.status}`,
    `priority: ${task.priority}`,
    `tags:     ${task.tags.join(", ") || "-"}`,
    `project:  ${task.project ?? "-"}`,
    `due:      ${task.due ?? "-"}`,
    `external: ${task.externalRef ?? "-"}`,
    `created:  ${task.createdAt}`,
    `updated:  ${task.updatedAt}`,
  ];
  if (task.body) lines.push("", task.body);
  return lines.join("\n");
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): id/priority parsing and task formatters"
```

---

### Task 12: cli — add 커맨드

**Files:**
- Create: `packages/cli/src/commands/add.ts`
- Test: `packages/cli/tests/add.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/cli/tests/add.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { addCommand } from "../src/commands/add";
import { createTestCli } from "./helpers";

describe("add", () => {
  test("타이틀로 태스크를 만든다 (positional은 공백으로 join)", () => {
    const { ctx, out } = createTestCli();
    const code = addCommand.run(["write", "the", "spec"], ctx);
    expect(code).toBe(0);
    expect(out).toEqual(["created #1: write the spec"]);
    expect(ctx.store.get(1)?.title).toBe("write the spec");
  });

  test("옵션을 반영한다", () => {
    const { ctx } = createTestCli();
    addCommand.run(
      ["t", "--body", "detail", "--priority", "3", "--tag", "a", "--tag", "b", "--project", "tasq", "--due", "2026-07-01"],
      ctx,
    );
    const task = ctx.store.get(1);
    expect(task?.body).toBe("detail");
    expect(task?.priority).toBe(3);
    expect(task?.tags).toEqual(["a", "b"]);
    expect(task?.project).toBe("tasq");
    expect(task?.due).toBe("2026-07-01");
  });

  test("--json은 태스크 JSON을 출력한다", () => {
    const { ctx, out } = createTestCli();
    addCommand.run(["t", "--json"], ctx);
    const task = JSON.parse(out[0] ?? "");
    expect(task.id).toBe(1);
    expect(task.title).toBe("t");
  });

  test("타이틀이 없으면 exit 1", () => {
    const { ctx, err } = createTestCli();
    expect(addCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("priority가 숫자가 아니면 exit 1", () => {
    const { ctx, err } = createTestCli();
    expect(addCommand.run(["t", "--priority", "high"], ctx)).toBe(1);
    expect(err).toEqual(["invalid priority: high"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/cli/tests/add.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/cli/src/commands/add.ts`:
```ts
import { parseArgs } from "node:util";
import { parsePriority } from "../parse";
import type { Command } from "../registry";

const USAGE =
  "tasq add <title> [--body <text>] [--priority <n>] [--tag <tag>]... [--project <name>] [--due <date>] [--json]";

export const addCommand: Command = {
  name: "add",
  description: "Create a new task",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        body: { type: "string" },
        priority: { type: "string" },
        tag: { type: "string", multiple: true },
        project: { type: "string" },
        due: { type: "string" },
        json: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const title = positionals.join(" ").trim();
    if (!title) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    let priority: number | undefined;
    if (values.priority !== undefined) {
      const parsed = parsePriority(values.priority);
      if (parsed === null) {
        ctx.stderr(`invalid priority: ${values.priority}`);
        return 1;
      }
      priority = parsed;
    }
    const task = ctx.store.create({
      title,
      body: values.body,
      priority,
      tags: values.tag,
      project: values.project,
      due: values.due,
    });
    ctx.stdout(values.json ? JSON.stringify(task) : `created #${task.id}: ${task.title}`);
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): add command"
```

---

### Task 13: cli — list 커맨드

**Files:**
- Create: `packages/cli/src/commands/list.ts`
- Test: `packages/cli/tests/list.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/cli/tests/list.test.ts`:
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
  test("태스크를 한 줄씩 출력한다", () => {
    const { ctx, out } = seeded();
    expect(listCommand.run([], ctx)).toBe(0);
    expect(out).toEqual(["○ #2 P5 b (p2)", "○ #1 P1 a (p1) [x]"]);
  });

  test("비어 있으면 no tasks", () => {
    const { ctx, out } = createTestCli();
    expect(listCommand.run([], ctx)).toBe(0);
    expect(out).toEqual(["no tasks"]);
  });

  test("--json은 배열 JSON", () => {
    const { ctx, out } = seeded();
    listCommand.run(["--json"], ctx);
    const tasks = JSON.parse(out[0] ?? "");
    expect(tasks).toHaveLength(2);
  });

  test("--status/--project/--tag 필터", () => {
    const { ctx, out } = seeded();
    listCommand.run(["--project", "p1", "--tag", "x", "--status", "todo"], ctx);
    expect(out).toEqual(["○ #1 P1 a (p1) [x]"]);
  });

  test("잘못된 status는 exit 1", () => {
    const { ctx, err } = seeded();
    expect(listCommand.run(["--status", "doing"], ctx)).toBe(1);
    expect(err).toEqual(["invalid status: doing"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/cli/tests/list.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/cli/src/commands/list.ts`:
```ts
import { parseArgs } from "node:util";
import { isTaskStatus, type TaskStatus } from "@tasq/core";
import { formatTaskLine } from "../output";
import type { Command } from "../registry";

export const listCommand: Command = {
  name: "list",
  description: "List tasks",
  usage: "tasq list [--status <status>] [--tag <tag>] [--project <name>] [--json]",
  run(args, ctx) {
    const { values } = parseArgs({
      args,
      options: {
        status: { type: "string" },
        tag: { type: "string" },
        project: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (values.status !== undefined && !isTaskStatus(values.status)) {
      ctx.stderr(`invalid status: ${values.status}`);
      return 1;
    }
    const tasks = ctx.store.list({
      status: values.status as TaskStatus | undefined,
      tag: values.tag,
      project: values.project,
    });
    if (values.json) {
      ctx.stdout(JSON.stringify(tasks));
      return 0;
    }
    if (tasks.length === 0) {
      ctx.stdout("no tasks");
      return 0;
    }
    for (const task of tasks) ctx.stdout(formatTaskLine(task));
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): list command with filters and json output"
```

---

### Task 14: cli — show + events 커맨드

**Files:**
- Create: `packages/cli/src/commands/show.ts`, `packages/cli/src/commands/events.ts`
- Test: `packages/cli/tests/show.test.ts`, `packages/cli/tests/events.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/cli/tests/show.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { showCommand } from "../src/commands/show";
import { createTestCli } from "./helpers";

describe("show", () => {
  test("태스크 상세를 출력한다", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(showCommand.run(["1"], ctx)).toBe(0);
    expect(out[0]).toContain("#1 t");
    expect(out[0]).toContain("status:   todo");
  });

  test("--json은 태스크 JSON", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    showCommand.run(["1", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "").title).toBe("t");
  });

  test("잘못된 id는 usage와 exit 1", () => {
    const { ctx, err } = createTestCli();
    expect(showCommand.run(["abc"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("없는 태스크는 exit 1", () => {
    const { ctx, err } = createTestCli();
    expect(showCommand.run(["99"], ctx)).toBe(1);
    expect(err).toEqual(["task not found: 99"]);
  });
});
```

`packages/cli/tests/events.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { eventsCommand } from "../src/commands/events";
import { createTestCli } from "./helpers";

describe("events", () => {
  test("이벤트를 시간순으로 출력한다", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    ctx.store.setStatus(1, "done");
    expect(eventsCommand.run(["1"], ctx)).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("created");
    expect(out[1]).toContain("status_changed");
  });

  test("--json은 배열 JSON", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    eventsCommand.run(["1", "--json"], ctx);
    const events = JSON.parse(out[0] ?? "");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("created");
  });

  test("잘못된 id는 usage와 exit 1", () => {
    const { ctx, err } = createTestCli();
    expect(eventsCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/cli/tests/show.test.ts packages/cli/tests/events.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/cli/src/commands/show.ts`:
```ts
import { parseArgs } from "node:util";
import { formatTaskDetail } from "../output";
import { parseId } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq show <id> [--json]";

export const showCommand: Command = {
  name: "show",
  description: "Show task detail",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
    });
    const id = parseId(positionals[0]);
    if (id === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const task = ctx.store.get(id);
    if (!task) {
      ctx.stderr(`task not found: ${id}`);
      return 1;
    }
    ctx.stdout(values.json ? JSON.stringify(task) : formatTaskDetail(task));
    return 0;
  },
};
```

`packages/cli/src/commands/events.ts`:
```ts
import { parseArgs } from "node:util";
import { parseId } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq events <id> [--json]";

export const eventsCommand: Command = {
  name: "events",
  description: "Show task event log",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
    });
    const id = parseId(positionals[0]);
    if (id === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const events = ctx.store.events(id);
    if (values.json) {
      ctx.stdout(JSON.stringify(events));
      return 0;
    }
    for (const event of events) {
      ctx.stdout(`${event.createdAt} ${event.type} ${JSON.stringify(event.payload)}`);
    }
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): show and events commands"
```

---

### Task 15: cli — update + status 커맨드

**Files:**
- Create: `packages/cli/src/commands/update.ts`, `packages/cli/src/commands/status.ts`
- Test: `packages/cli/tests/update.test.ts`, `packages/cli/tests/status.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/cli/tests/update.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { updateCommand } from "../src/commands/update";
import { createTestCli } from "./helpers";

describe("update", () => {
  test("플래그로 받은 필드만 패치한다", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "old", priority: 1, project: "keep" });
    const code = updateCommand.run(["1", "--title", "new", "--tag", "a", "--priority", "4"], ctx);
    expect(code).toBe(0);
    expect(out).toEqual(["updated #1"]);
    const task = ctx.store.get(1);
    expect(task?.title).toBe("new");
    expect(task?.tags).toEqual(["a"]);
    expect(task?.priority).toBe(4);
    expect(task?.project).toBe("keep");
  });

  test("body/project/due를 패치한다", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t" });
    updateCommand.run(["1", "--body", "detail", "--project", "tasq", "--due", "2026-08-01"], ctx);
    const task = ctx.store.get(1);
    expect(task?.body).toBe("detail");
    expect(task?.project).toBe("tasq");
    expect(task?.due).toBe("2026-08-01");
  });

  test("--json은 갱신된 태스크 JSON", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "old" });
    updateCommand.run(["1", "--title", "new", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "").title).toBe("new");
  });

  test("플래그가 없으면 nothing to update", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(updateCommand.run(["1"], ctx)).toBe(1);
    expect(err).toEqual(["nothing to update"]);
  });

  test("잘못된 id는 usage와 exit 1", () => {
    const { ctx, err } = createTestCli();
    expect(updateCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("priority가 숫자가 아니면 exit 1", () => {
    const { ctx, err } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(updateCommand.run(["1", "--priority", "high"], ctx)).toBe(1);
    expect(err).toEqual(["invalid priority: high"]);
  });

  test("없는 태스크는 core 에러 메시지가 stderr로 (runCli 경유 시)", () => {
    const { ctx } = createTestCli();
    expect(() => updateCommand.run(["99", "--title", "x"], ctx)).toThrow("task not found: 99");
  });
});
```

`packages/cli/tests/status.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { statusCommand } from "../src/commands/status";
import { createTestCli } from "./helpers";

describe("status", () => {
  test("상태를 전이한다", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    const code = statusCommand.run(["1", "in_progress"], ctx);
    expect(code).toBe(0);
    expect(out).toEqual(["#1 → in_progress"]);
    expect(ctx.store.get(1)?.status).toBe("in_progress");
  });

  test("--json은 갱신된 태스크 JSON", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    statusCommand.run(["1", "done", "--json"], ctx);
    expect(JSON.parse(out[0] ?? "").status).toBe("done");
  });

  test("id나 status가 없으면 usage와 exit 1", () => {
    const { ctx, err } = createTestCli();
    expect(statusCommand.run(["1"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("잘못된 상태는 core 에러가 던져진다 (runCli가 처리)", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(() => statusCommand.run(["1", "doing"], ctx)).toThrow("invalid status: doing");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/cli/tests/update.test.ts packages/cli/tests/status.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/cli/src/commands/update.ts`:
```ts
import { parseArgs } from "node:util";
import type { UpdateTaskPatch } from "@tasq/core";
import { parseId, parsePriority } from "../parse";
import type { Command } from "../registry";

const USAGE =
  "tasq update <id> [--title <t>] [--body <b>] [--priority <n>] [--tag <tag>]... [--project <p>] [--due <d>] [--json]";

export const updateCommand: Command = {
  name: "update",
  description: "Update task fields",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        title: { type: "string" },
        body: { type: "string" },
        priority: { type: "string" },
        tag: { type: "string", multiple: true },
        project: { type: "string" },
        due: { type: "string" },
        json: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const id = parseId(positionals[0]);
    if (id === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const patch: UpdateTaskPatch = {};
    if (values.title !== undefined) patch.title = values.title;
    if (values.body !== undefined) patch.body = values.body;
    if (values.priority !== undefined) {
      const parsed = parsePriority(values.priority);
      if (parsed === null) {
        ctx.stderr(`invalid priority: ${values.priority}`);
        return 1;
      }
      patch.priority = parsed;
    }
    if (values.tag !== undefined) patch.tags = values.tag;
    if (values.project !== undefined) patch.project = values.project;
    if (values.due !== undefined) patch.due = values.due;
    if (Object.keys(patch).length === 0) {
      ctx.stderr("nothing to update");
      return 1;
    }
    const task = ctx.store.update(id, patch);
    ctx.stdout(values.json ? JSON.stringify(task) : `updated #${task.id}`);
    return 0;
  },
};
```

`packages/cli/src/commands/status.ts`:
```ts
import { parseArgs } from "node:util";
import { parseId } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq status <id> <todo|in_progress|review|done|blocked> [--json]";

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
    const id = parseId(positionals[0]);
    const status = positionals[1];
    if (id === null || status === undefined) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const task = ctx.store.setStatus(id, status);
    ctx.stdout(values.json ? JSON.stringify(task) : `#${task.id} → ${task.status}`);
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): update and status commands"
```

---

### Task 16: cli — rm 커맨드 + buildRegistry

**Files:**
- Create: `packages/cli/src/commands/rm.ts`, `packages/cli/src/commands/index.ts`
- Test: `packages/cli/tests/rm.test.ts`, `packages/cli/tests/commands-index.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/cli/tests/rm.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { rmCommand } from "../src/commands/rm";
import { createTestCli } from "./helpers";

describe("rm", () => {
  test("태스크를 삭제한다", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    expect(rmCommand.run(["1"], ctx)).toBe(0);
    expect(out).toEqual(["deleted #1"]);
    expect(ctx.store.get(1)).toBeNull();
  });

  test("잘못된 id는 usage와 exit 1", () => {
    const { ctx, err } = createTestCli();
    expect(rmCommand.run(["x"], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("없는 태스크는 core 에러가 던져진다 (runCli가 처리)", () => {
    const { ctx } = createTestCli();
    expect(() => rmCommand.run(["99"], ctx)).toThrow("task not found: 99");
  });
});
```

`packages/cli/tests/commands-index.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { buildRegistry } from "../src/commands/index";

describe("buildRegistry", () => {
  test("모든 커맨드를 등록한다", () => {
    const names = buildRegistry()
      .all()
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(["add", "events", "list", "rm", "show", "status", "update"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/cli/tests/rm.test.ts packages/cli/tests/commands-index.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/cli/src/commands/rm.ts`:
```ts
import { parseId } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq rm <id>";

export const rmCommand: Command = {
  name: "rm",
  description: "Delete a task",
  usage: USAGE,
  run(args, ctx) {
    const id = parseId(args[0]);
    if (id === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    ctx.store.remove(id);
    ctx.stdout(`deleted #${id}`);
    return 0;
  },
};
```

`packages/cli/src/commands/index.ts`:
```ts
import { CommandRegistry } from "../registry";
import { addCommand } from "./add";
import { eventsCommand } from "./events";
import { listCommand } from "./list";
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
    statusCommand,
    rmCommand,
    eventsCommand,
  ]) {
    registry.register(command);
  }
  return registry;
}
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage`
Expected: PASS, 커버리지 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): rm command and command registry assembly"
```

---

### Task 17: cli — context + bin 엔트리 + E2E smoke

**Files:**
- Create: `packages/cli/src/context.ts`, `packages/cli/src/index.ts`
- Test: `packages/cli/tests/context.test.ts`, `packages/cli/tests/main.test.ts`, `packages/cli/tests/cli.e2e.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/cli/tests/context.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../src/context";

describe("createContext", () => {
  test("TASQ_HOME을 부트스트랩하고 동작하는 store를 만든다", () => {
    const home = mkdtempSync(join(tmpdir(), "tasq-ctx-"));
    const ctx = createContext({ TASQ_HOME: home });
    const task = ctx.store.create({ title: "t" });
    expect(task.id).toBe(1);
    expect(existsSync(join(home, "tasq.db"))).toBe(true);
  });
});
```

`packages/cli/tests/main.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/index";

describe("main", () => {
  test("process.env.TASQ_HOME 기준으로 커맨드를 실행한다", () => {
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
```

`packages/cli/tests/cli.e2e.test.ts` — 실 바이너리 smoke. 기본 동작 확인 스콥만 (add → list → status 한 사이클):
```ts
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("e2e: add → list → status 한 사이클", () => {
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
```

- [ ] **Step 2: 실패 확인**

Run: `bun test packages/cli/tests/context.test.ts packages/cli/tests/main.test.ts packages/cli/tests/cli.e2e.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/cli/src/context.ts`:
```ts
import { TaskStore, ensureTasqHome, openDb, resolveTasqHome } from "@tasq/core";
import type { CliContext } from "./registry";

export function createContext(
  env: Record<string, string | undefined> = process.env,
): CliContext {
  const home = ensureTasqHome(resolveTasqHome(env));
  return {
    store: new TaskStore(openDb(home.dbPath)),
    stdout: console.log,
    stderr: console.error,
  };
}
```

`packages/cli/src/index.ts`:
```ts
#!/usr/bin/env bun
import { runCli } from "./app";
import { buildRegistry } from "./commands/index";
import { createContext } from "./context";

export function main(argv: string[] = process.argv.slice(2)): number {
  return runCli(argv, createContext(), buildRegistry());
}

// 커버리지: 단일 라인 유지 (조건 평가로 라인 커버, exit는 E2E에서 검증)
if (import.meta.main) process.exit(main());
```

- [ ] **Step 4: 통과 확인**

Run: `bun test --coverage` 그리고 `bun run typecheck`
Expected: 둘 다 PASS, 커버리지 100%.

수동 검증 (선택): `TASQ_HOME=$(mktemp -d) bun run packages/cli/src/index.ts add "manual check"` → `created #1: manual check`

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): real-env context, bin entrypoint and e2e smoke test"
```

---

### Task 18: CI 워크플로우 + 최종 검증

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 워크플로우 작성**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      # bunfig.toml의 coverageThreshold = 1.0 때문에 커버리지 100% 미만이면 실패한다
      - run: bun test --coverage
```

- [ ] **Step 2: 로컬 최종 검증**

Run: `bun install --frozen-lockfile && bun run typecheck && bun test --coverage`
Expected: 모두 PASS, 커버리지 100%. 이것이 CI와 동일한 게이트다.

- [ ] **Step 3: Commit**

```bash
git add .github
git commit -m "ci: typecheck and 100% coverage gate on push/PR"
```

- [ ] **Step 4: Phase 1 완료 확인 (concept.md 검증 포인트)**

"AI 에이전트가 CLI만으로 태스크를 다룰 수 있는가" — 아래가 전부 동작해야 한다:

```bash
export TASQ_HOME=$(mktemp -d)
alias tq='bun run packages/cli/src/index.ts'
tq add "phase 1 done check" --priority 2 --tag verify
tq list --json
tq show 1 --json
tq update 1 --body "verified"
tq status 1 done
tq events 1 --json
tq rm 1
```

Expected: 전 커맨드 exit 0, `--json` 출력은 유효한 JSON.
