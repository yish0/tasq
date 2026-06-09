# Batch B: 신뢰성 + 자동화 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development로 태스크 단위 실행을 권장. 스텝은 체크박스(`- [ ]`)로 추적한다.

**Goal:** [core 보강 설계](../design/2026-06-07-core-enhancement.md)의 Batch B 전체 — urgency 자동 정렬, undo(append-only `reverted`), recurrence(rolling).

**Architecture:** Batch A 위에 쌓는다. urgency는 `now` 주입 순수 함수로 계산해 정렬·`--json`에 노출. recurrence는 스키마 v3(`recur` 컬럼) + done 시점 다음 인스턴스 1개 생성. undo는 이벤트를 지우지 않고 `reverted` 이벤트를 append하며 마지막 mutation을 역적용 — Batch A에서 강화한 `updated {fields:{from,to}}` 페이로드를 그대로 소비한다.

**Tech Stack:** Bun workspace, `bun:sqlite`, `bun test` (커버리지 100% 게이트), TypeScript strict.

**Branch:** `feat/batch-b-core` (Batch A가 머지된 main에서 분기)

## 규칙 (Batch A와 동일)

- **테스트 커버리지 100%.** `bun test` 시 bunfig coverageThreshold=1.0 강제. 미달이면 미완료.
- **도달 불가 분기를 만들지 않는다.** ignore 주석으로 회피하지 말고, 분기 자체가 생기지 않게 설계 (Batch A의 restore dangling-parent 사례 참조).
- **TDD.** 실패 테스트 먼저.
- **커밋/PR에 AI 어시스턴트 푸터 금지.**
- **외부 런타임 의존성 0개.**
- 테스트 항목명 영어, 주석·prose 한국어.
- nullable 클리어는 `none` 컨벤션 (Batch A에서 확립).

## 계획 단계 결정 (설계 §5 보강)

| 결정 | 내용 |
|---|---|
| urgency × 트리 | urgency가 **기본 정렬 키**. flat 모드는 정렬 순서대로, 트리 모드는 형제(sibling) 정렬에 적용 (정렬된 flat 리스트를 treeOrder가 순서 보존). `--sort id\|priority\|due\|urgency`로 변경 |
| urgency 노출 | `list --json`에만 `urgency` 필드 추가. 사람용 라인은 기존 유지(클러터 회피) |
| dep-blocked 항 | `computeUrgency(task, now, blocked)` — blocked는 호출자가 `blockedTaskIds()`로 주입 (순수 함수 유지) |
| recurrence 방식 | rolling — done 시 다음 인스턴스 1개. `recur` 없는 due-less 금지 (`RecurWithoutDueError`). cancel은 생성 안 함 |
| recur 복사 범위 | title/body/tags/project/priority/recur/parent_id + due/start를 recur만큼 시프트. **복사 안 함**: deps, 서브트리, externalRef. `created` 페이로드에 `recurredFrom` |
| undo 범위 | 전역 마지막 mutation 1개. `reverted {targetEventId}` append (원본 불변). reverted된 이벤트와 reverted 자신은 스킵 → 반복 호출로 거슬러 올라감 |
| undo와 events | `comments()`는 reverted된 comment를 숨김(→ show 노트에서 사라짐). **`events` 커맨드는 전체 로그를 그대로 표시** — append-only 감사 로그의 취지상 항목을 숨기지 않는다. reverted 이벤트가 뒤따라 보이므로 로그는 자명 (설계 §5.2의 "events 숨김" 문구에서 의도적으로 벗어남) |
| hard delete undo | 불가 — `CannotUndoError` |

## 전체 파일 맵

| 파일 | 작업 |
|---|---|
| `packages/core/src/db.ts` | 마이그레이션 v3 (`recur` 컬럼) |
| `packages/core/src/urgency.ts` | 신규 — `computeUrgency` |
| `packages/core/src/dates.ts` | `isDuration`, `shiftDate` 추가 |
| `packages/core/src/types.ts` | Task/Create/Update에 `recur`, TaskEventType에 `reverted` |
| `packages/core/src/errors.ts` | RecurWithoutDueError, InvalidDurationError, NothingToUndoError, CannotUndoError |
| `packages/core/src/tasks.ts` | create/update recur 배선·검증, setStatus 재발 spawn, undo + revert 헬퍼, comments 필터 |
| `packages/core/src/index.ts` | urgency export |
| `packages/cli/src/output.ts` | formatTaskDetail에 `recur:` 라인 |
| `packages/cli/src/commands/list.ts` | `--sort` + urgency `--json` |
| `packages/cli/src/commands/add.ts` `update.ts` | `--recur` |
| `packages/cli/src/commands/undo.ts` | 신규 |
| `packages/cli/src/commands/index.ts` | undo 등록 (15 커맨드) |

준비: `git checkout main && git pull && git checkout -b feat/batch-b-core`

---

## Unit 1: urgency

### Task 1: computeUrgency 순수 함수

**Files:**
- Create: `packages/core/src/urgency.ts`
- Modify: `packages/core/src/index.ts` (export 추가)
- Test: `packages/core/tests/urgency.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `packages/core/tests/urgency.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import type { Task } from "@tasq/core";
import { computeUrgency } from "@tasq/core";

const NOW = new Date(2026, 5, 10); // 2026-06-10

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "t",
    body: "",
    status: "todo",
    priority: 0,
    tags: [],
    project: null,
    start: null,
    due: null,
    parentId: null,
    archivedAt: null,
    externalRef: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  };
}
// 주의: Task 3에서 Task에 recur 필드가 추가되면 이 fixture에 `recur: null,`을 더한다.
// (Task 1 시점엔 recur가 타입에 없어 object literal excess-property 에러가 난다.)

describe("computeUrgency", () => {
  test("a fresh todo task with no due and no priority is zero", () => {
    expect(computeUrgency(task(), NOW)).toBe(0);
  });

  test("in_progress adds 4", () => {
    expect(computeUrgency(task({ status: "in_progress" }), NOW)).toBe(4);
  });

  test("priority contributes with weight 1", () => {
    expect(computeUrgency(task({ priority: 3 }), NOW)).toBe(3);
  });

  test("due today or overdue gives the full due weight", () => {
    expect(computeUrgency(task({ due: "2026-06-10" }), NOW)).toBe(12);
    expect(computeUrgency(task({ due: "2026-06-01" }), NOW)).toBe(12);
  });

  test("due exactly 7 days out is half the due weight", () => {
    expect(computeUrgency(task({ due: "2026-06-17" }), NOW)).toBe(6);
  });

  test("due at or beyond the 14-day horizon contributes nothing", () => {
    expect(computeUrgency(task({ due: "2026-06-24" }), NOW)).toBe(0);
    expect(computeUrgency(task({ due: "2026-08-01" }), NOW)).toBe(0);
  });

  test("age ramps to 2 over a year and caps", () => {
    expect(computeUrgency(task({ createdAt: "2025-06-10T00:00:00.000Z" }), NOW)).toBeCloseTo(2, 5);
    expect(computeUrgency(task({ createdAt: "2020-06-10T00:00:00.000Z" }), NOW)).toBeCloseTo(2, 5);
    expect(computeUrgency(task({ createdAt: "2025-12-10T00:00:00.000Z" }), NOW)).toBeCloseTo(
      (182 / 365) * 2,
      1,
    );
  });

  test("a future createdAt does not produce negative age", () => {
    expect(computeUrgency(task({ createdAt: "2027-01-01T00:00:00.000Z" }), NOW)).toBe(0);
  });

  test("dependency-blocked subtracts 5", () => {
    expect(computeUrgency(task({ priority: 10 }), NOW, true)).toBe(5);
  });

  test("blocked status subtracts 3", () => {
    expect(computeUrgency(task({ status: "blocked", priority: 10 }), NOW)).toBe(7);
  });

  test("terms combine additively", () => {
    // in_progress(4) + due 7d(6) + priority 2(2) + fresh age(0) - blocked dep(5)
    const t = task({ status: "in_progress", due: "2026-06-17", priority: 2 });
    expect(computeUrgency(t, NOW, true)).toBe(7);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/urgency.test.ts` / Expected: FAIL (export 없음)

- [ ] **Step 3: 구현** — `packages/core/src/urgency.ts`

```ts
import type { Task } from "./types";

const DUE_HORIZON_DAYS = 14;
const DUE_WEIGHT = 12.0;
const AGE_HORIZON_DAYS = 365;
const AGE_WEIGHT = 2.0;
const IN_PROGRESS_WEIGHT = 4.0;
const PRIORITY_WEIGHT = 1.0;
const DEP_BLOCKED_PENALTY = 5.0;
const STATUS_BLOCKED_PENALTY = 3.0;
const MS_PER_DAY = 86_400_000;

// 로컬 달력 자정 epoch — parseDateExpr과 동일한 날짜 해석을 쓴다
function localDayEpoch(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// YYYY-MM-DD 또는 ISO 타임스탬프의 날짜 부분 → 로컬 자정 epoch
function isoDayEpoch(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

// 가중합으로 계산하는 파생값. 저장하지 않는다. dep-blocked는 호출자가 주입.
export function computeUrgency(task: Task, now: Date, blocked = false): number {
  const today = localDayEpoch(now);
  let urgency = 0;

  if (task.status === "in_progress") urgency += IN_PROGRESS_WEIGHT;

  if (task.due !== null) {
    const daysUntil = Math.round((isoDayEpoch(task.due) - today) / MS_PER_DAY);
    if (daysUntil <= 0) urgency += DUE_WEIGHT;
    else if (daysUntil < DUE_HORIZON_DAYS) {
      urgency += DUE_WEIGHT * ((DUE_HORIZON_DAYS - daysUntil) / DUE_HORIZON_DAYS);
    }
  }

  urgency += PRIORITY_WEIGHT * task.priority;

  const ageDays = Math.max(0, Math.round((today - isoDayEpoch(task.createdAt)) / MS_PER_DAY));
  urgency += AGE_WEIGHT * Math.min(ageDays / AGE_HORIZON_DAYS, 1);

  if (blocked) urgency -= DEP_BLOCKED_PENALTY;
  if (task.status === "blocked") urgency -= STATUS_BLOCKED_PENALTY;

  return urgency;
}
```

`packages/core/src/index.ts`에 `export * from "./urgency";` 추가.

- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run typecheck` / Expected: PASS, 100%
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(core): urgency scoring function"`

### Task 2: list `--sort` + urgency `--json`

**Files:**
- Modify: `packages/cli/src/commands/list.ts`
- Test: `packages/cli/tests/list.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — list.test.ts에 추가

```ts
  test("defaults to urgency-descending order", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "low", priority: 1 });
    ctx.store.create({ title: "due-soon", due: "2026-06-10" });
    // due-soon: urgency ~12 (overdue/today) > low: 1
    listCommand.run(["--flat"], ctx);
    expect(out[0]).toContain("due-soon");
    expect(out[1]).toContain("low");
  });

  test("--sort priority orders by priority desc", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a", priority: 1, due: "2000-01-01" });
    ctx.store.create({ title: "b", priority: 9 });
    listCommand.run(["--flat", "--sort", "priority"], ctx);
    expect(out[0]).toContain("b");
    expect(out[1]).toContain("a");
  });

  test("--sort id orders by id asc", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "a", priority: 9 });
    ctx.store.create({ title: "b", priority: 1 });
    listCommand.run(["--flat", "--sort", "id"], ctx);
    expect(out[0]).toContain("#1");
    expect(out[1]).toContain("#2");
  });

  test("--sort due orders earliest first with nulls last", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "none" });
    ctx.store.create({ title: "late", due: "2026-12-31" });
    ctx.store.create({ title: "early", due: "2026-06-01" });
    listCommand.run(["--flat", "--sort", "due"], ctx);
    expect(out.map((l) => l.replace(/^.*P0 /, "").split(" ")[0])).toEqual(["early", "late", "none"]);
  });

  test("rejects an unknown --sort key", () => {
    const { ctx, err } = createTestCli();
    expect(listCommand.run(["--sort", "bogus"], ctx)).toBe(1);
    expect(err).toEqual(["invalid sort: bogus"]);
  });

  test("--json includes a computed urgency field", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t", priority: 4 });
    listCommand.run(["--json"], ctx);
    const tasks = JSON.parse(out[0] ?? "");
    // 정확값은 urgency.test에서 검증 — 여기선 필드 존재와 priority 반영만 (재계산 flake 회피)
    expect(typeof tasks[0].urgency).toBe("number");
    expect(tasks[0].urgency).toBeGreaterThanOrEqual(4);
  });

  test("urgency order applies to siblings within the tree", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "p" });
    ctx.store.create({ title: "low", parentId: 1, priority: 1 });
    ctx.store.create({ title: "high", parentId: 1, priority: 9 });
    listCommand.run([], ctx);
    expect(out).toEqual([
      "○ #1 P0 p",
      "  ○ #3 P9 high",
      "  ○ #2 P1 low",
    ]);
  });
```

주의: 기존 "prints one line per task" 테스트(우선순위 정렬 가정)는 그대로 통과한다 — fresh·due 없는 태스크의 urgency는 priority와 같아 순서가 보존된다.

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/list.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — list.ts 전체 교체

```ts
import { parseArgs } from "node:util";
import { computeUrgency, isTaskStatus, parseDateExpr, type Task, type TaskStatus } from "@tasq/core";
import { formatTaskLine, treeOrder } from "../output";
import type { Command } from "../registry";

const SORT_KEYS = ["id", "priority", "due", "urgency"] as const;
type SortKey = (typeof SORT_KEYS)[number];

function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

const USAGE =
  "tasq list [--status <s>] [--tag <t>]... [--project <p>] [--search <q>] [--due-before <expr>] [--due-after <expr>] [--overdue] [--ready] [--sort id|priority|due|urgency] [--all] [--flat] [--json]";

// 정렬 비교기. 동률은 id 오름차순으로 안정화. urgency는 미리 계산한 맵을 쓴다.
function compareBy(key: SortKey, urgency: Map<number, number>): (a: Task, b: Task) => number {
  return (a, b) => {
    if (key === "id") return a.id - b.id;
    if (key === "priority") return b.priority - a.priority || a.id - b.id;
    if (key === "due") {
      if (a.due === b.due) return a.id - b.id;
      if (a.due === null) return 1;
      if (b.due === null) return -1;
      return a.due < b.due ? -1 : 1;
    }
    return (urgency.get(b.id) ?? 0) - (urgency.get(a.id) ?? 0) || a.id - b.id;
  };
}

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
        sort: { type: "string" },
        all: { type: "boolean" },
        flat: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    if (values.status !== undefined && !isTaskStatus(values.status)) {
      ctx.stderr(`invalid status: ${values.status}`);
      return 1;
    }
    const sort = values.sort ?? "urgency";
    if (!isSortKey(sort)) {
      ctx.stderr(`invalid sort: ${sort}`);
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
    const blocked = ctx.store.blockedTaskIds();
    const urgency = new Map(tasks.map((t) => [t.id, computeUrgency(t, now, blocked.has(t.id))]));
    const sorted = [...tasks].sort(compareBy(sort, urgency));
    if (values.json === true) {
      ctx.stdout(JSON.stringify(sorted.map((t) => ({ ...t, urgency: urgency.get(t.id) }))));
      return 0;
    }
    if (sorted.length === 0) {
      ctx.stdout("no tasks");
      return 0;
    }
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
      for (const task of sorted) {
        ctx.stdout(formatTaskLine(task, { blocked: blocked.has(task.id) }));
      }
      return 0;
    }
    for (const { task, depth } of treeOrder(sorted)) {
      ctx.stdout(formatTaskLine(task, { blocked: blocked.has(task.id), depth }));
    }
    return 0;
  },
};
```

- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run typecheck` / Expected: PASS, 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): urgency-based sorting and --sort/--json"`

---

## Unit 2: recurrence

### Task 3: 스키마 v3 + recur 필드 + duration 헬퍼 (컴파일 그린)

**Files:**
- Modify: `packages/core/src/db.ts`, `packages/core/src/types.ts`, `packages/core/src/dates.ts`, `packages/core/src/errors.ts`, `packages/core/src/tasks.ts` (row+create/update 배선), `packages/cli/src/output.ts` (detail recur 라인)
- Test: `packages/core/tests/db.test.ts`, `packages/core/tests/dates.test.ts`, `packages/core/tests/errors.test.ts`, `packages/core/tests/tasks.test.ts`, `packages/cli/tests/output.test.ts`, `packages/core/tests/urgency.test.ts` (fixture에 recur 추가)

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/db.test.ts`에 추가:

```ts
  test("v3 adds the recur column to tasks", () => {
    const db = openDb(":memory:");
    const cols = db.query("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("recur");
  });
```

`packages/core/tests/dates.test.ts`에 추가:

```ts
import { isDuration, shiftDate } from "@tasq/core";

describe("isDuration", () => {
  test("accepts N followed by d/w/m/y", () => {
    expect(isDuration("3d")).toBe(true);
    expect(isDuration("2w")).toBe(true);
    expect(isDuration("1m")).toBe(true);
    expect(isDuration("1y")).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isDuration("tomorrow")).toBe(false);
    expect(isDuration("3")).toBe(false);
    expect(isDuration("3x")).toBe(false);
    expect(isDuration("")).toBe(false);
  });
});

describe("shiftDate", () => {
  test("adds a duration to an ISO date", () => {
    expect(shiftDate("2026-06-10", "3d")).toBe("2026-06-13");
    expect(shiftDate("2026-06-10", "2w")).toBe("2026-06-24");
    expect(shiftDate("2026-06-10", "1m")).toBe("2026-07-10");
    expect(shiftDate("2026-06-10", "1y")).toBe("2027-06-10");
  });

  test("clamps month arithmetic to the last day", () => {
    expect(shiftDate("2026-01-31", "1m")).toBe("2026-02-28");
  });

  test("throws InvalidDurationError on a bad duration", () => {
    expect(() => shiftDate("2026-06-10", "soon")).toThrow("invalid duration: soon");
  });
});
```

`packages/core/tests/errors.test.ts`에 추가 (import 병합):

```ts
import {
  CannotUndoError,
  InvalidDurationError,
  NothingToUndoError,
  RecurWithoutDueError,
} from "@tasq/core";

describe("batch B errors", () => {
  test("RecurWithoutDueError explains the requirement", () => {
    const e = new RecurWithoutDueError();
    expect(e.name).toBe("RecurWithoutDueError");
    expect(e.message).toBe("recur requires a due date");
  });

  test("InvalidDurationError names the value", () => {
    const e = new InvalidDurationError("3x");
    expect(e.name).toBe("InvalidDurationError");
    expect(e.message).toBe("invalid duration: 3x");
  });

  test("NothingToUndoError has a clear message", () => {
    const e = new NothingToUndoError();
    expect(e.name).toBe("NothingToUndoError");
    expect(e.message).toBe("nothing to undo");
  });

  test("CannotUndoError names the hard-deleted task", () => {
    const e = new CannotUndoError(7);
    expect(e.name).toBe("CannotUndoError");
    expect(e.message).toBe("cannot undo: #7 was hard-deleted");
  });
});
```

`packages/core/tests/tasks.test.ts` — "creates a task with defaults" 테스트에 추가:

```ts
    expect(task.recur).toBeNull();
```

`packages/cli/tests/output.test.ts` — `base` fixture에 `recur: null,` 추가. 그리고 detail recur 라인 테스트 추가:

```ts
  test("shows recur when set", () => {
    expect(formatTaskDetail({ ...base, recur: "1w" })).toContain("recur:    1w");
  });

  test("shows a dash for recur when unset", () => {
    expect(formatTaskDetail(base)).toContain("recur:    -");
  });
```

`packages/core/tests/urgency.test.ts` — Task 1에서 뺐던 `recur: null,`을 fixture에 다시 추가한다.

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests` / Expected: FAIL

- [ ] **Step 3: 구현**

`packages/core/src/db.ts` — MIGRATIONS 배열 끝에 v3 추가:

```ts
  // v3: rolling recurrence
  `
  ALTER TABLE tasks ADD COLUMN recur TEXT;
  `,
```

`packages/core/src/types.ts`:
- Task 인터페이스에 (externalRef 앞) `readonly recur: string | null;` 추가
- CreateTaskInput에 `recur?: string;`
- UpdateTaskPatch에 `recur?: string | null;`
- TaskEventType union에 `| "reverted"` 추가 (undo용 — 여기서 미리 추가해 둔다)

`packages/core/src/errors.ts`에 추가:

```ts
export class RecurWithoutDueError extends Error {
  constructor() {
    super("recur requires a due date");
    this.name = "RecurWithoutDueError";
  }
}

export class InvalidDurationError extends Error {
  constructor(public readonly value: string) {
    super(`invalid duration: ${value}`);
    this.name = "InvalidDurationError";
  }
}

export class NothingToUndoError extends Error {
  constructor() {
    super("nothing to undo");
    this.name = "NothingToUndoError";
  }
}

export class CannotUndoError extends Error {
  constructor(public readonly taskId: number) {
    super(`cannot undo: #${taskId} was hard-deleted`);
    this.name = "CannotUndoError";
  }
}
```

`packages/core/src/dates.ts` — import에 `InvalidDurationError` 추가, 끝에:

```ts
export function isDuration(s: string): boolean {
  return /^\d+[dwmy]$/.test(s);
}

// 기준 ISO 날짜(YYYY-MM-DD)에 기간을 더한다 — recurrence 다음 인스턴스 계산용
export function shiftDate(iso: string, duration: string): string {
  const m = /^(\d+)([dwmy])$/.exec(duration);
  if (!m) throw new InvalidDurationError(duration);
  const n = Number(m[1]);
  const unit = m[2];
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const base = new Date(y, mo - 1, d);
  if (unit === "d") return toIso(addDays(base, n));
  if (unit === "w") return toIso(addDays(base, n * 7));
  if (unit === "m") return toIso(addMonths(base, n));
  return toIso(addMonths(base, n * 12));
}
```

`packages/core/src/tasks.ts`:
- `TaskRow`에 `recur: string | null;` 추가 (external_ref 앞)
- `rowToTask`에 `recur: row.recur,` 추가
- `create`의 INSERT에 `recur` 컬럼 추가:

```ts
      .query(
        `INSERT INTO tasks (title, body, priority, tags, project, start, due, recur, external_ref, parent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        input.recur ?? null,
        input.externalRef ?? null,
        input.parentId ?? null,
        now,
        now,
      ) as TaskRow;
```

- `update`의 UPDATE SET에 `recur = ?` 추가 (external_ref 앞), 파라미터에 `next.recur` 추가:

```ts
        `UPDATE tasks
         SET title = ?, body = ?, priority = ?, tags = ?, project = ?, start = ?, due = ?, recur = ?, external_ref = ?, parent_id = ?, updated_at = ?
         WHERE id = ?`,
```
```ts
        next.title, next.body, next.priority, JSON.stringify(next.tags),
        next.project, next.start, next.due, next.recur, next.externalRef, next.parentId, now, id,
```

`packages/cli/src/output.ts` — formatTaskDetail의 lines 배열에서 `due:` 다음에 추가:

```ts
    `recur:    ${task.recur ?? "-"}`,
```

주의: 이 태스크는 recur를 컬럼/타입에 배선만 한다. **검증(RecurWithoutDueError)·재발 생성은 Task 4.** 따라서 여기서 RecurWithoutDueError/Undo 에러는 정의만 하고 사용처는 다음 태스크들.

- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run typecheck` / Expected: PASS, 100%
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(core): v3 recur column, duration helpers and batch B errors"`

### Task 4: recur 검증 + done 시 재발 생성

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — tasks.test.ts에 추가

```ts
import { InvalidDurationError, RecurWithoutDueError } from "@tasq/core";

describe("TaskStore recurrence", () => {
  test("create accepts recur with a due date", () => {
    const store = makeStore();
    const t = store.create({ title: "standup", due: "2026-06-10", recur: "1d" });
    expect(t.recur).toBe("1d");
  });

  test("create rejects recur without a due date", () => {
    const store = makeStore();
    expect(() => store.create({ title: "t", recur: "1d" })).toThrow(RecurWithoutDueError);
  });

  test("create rejects an invalid recur duration", () => {
    const store = makeStore();
    expect(() => store.create({ title: "t", due: "2026-06-10", recur: "soon" })).toThrow(
      InvalidDurationError,
    );
  });

  test("update rejects clearing due on a recurring task", () => {
    const store = makeStore();
    const t = store.create({ title: "t", due: "2026-06-10", recur: "1w" });
    expect(() => store.update(t.id, { due: null })).toThrow(RecurWithoutDueError);
  });

  test("update can clear recur with null", () => {
    const store = makeStore();
    const t = store.create({ title: "t", due: "2026-06-10", recur: "1w" });
    expect(store.update(t.id, { recur: null }).recur).toBeNull();
  });

  test("completing a recurring task spawns the next instance", () => {
    const store = makeStore();
    const t = store.create({
      title: "weekly review",
      body: "notes",
      tags: ["ops"],
      project: "p",
      priority: 2,
      start: "2026-06-08",
      due: "2026-06-10",
      recur: "1w",
    });
    store.setStatus(t.id, "done");
    const next = store.get(t.id + 1);
    expect(next?.title).toBe("weekly review");
    expect(next?.body).toBe("notes");
    expect(next?.tags).toEqual(["ops"]);
    expect(next?.project).toBe("p");
    expect(next?.priority).toBe(2);
    expect(next?.recur).toBe("1w");
    expect(next?.due).toBe("2026-06-17");
    expect(next?.start).toBe("2026-06-15");
    expect(next?.status).toBe("todo");
  });

  test("the spawned instance records recurredFrom", () => {
    const store = makeStore();
    const t = store.create({ title: "t", due: "2026-06-10", recur: "1d" });
    store.setStatus(t.id, "done");
    const created = store.events(t.id + 1).find((e) => e.type === "created");
    expect(created?.payload).toEqual({ title: "t", recurredFrom: t.id });
  });

  test("recurrence keeps the parent but copies neither deps nor externalRef", () => {
    const store = makeStore();
    const parent = store.create({ title: "parent" }); // id 1
    const dep = store.create({ title: "dep" }); // id 2
    const t = store.create({
      title: "child", // id 3
      parentId: parent.id,
      due: "2026-06-10",
      recur: "1d",
      externalRef: "gh#1",
    });
    store.addDep(t.id, dep.id);
    store.setStatus(t.id, "done"); // t는 자식이 없어 done 가드 통과 → spawn id 4
    const next = store.get(t.id + 1);
    expect(next?.title).toBe("child");
    expect(next?.parentId).toBe(parent.id);
    expect(next?.externalRef).toBeNull();
    expect(store.depsOf(next?.id ?? -1)).toEqual([]);
  });

  test("recurrence does not copy the subtree", () => {
    const store = makeStore();
    const t = store.create({ title: "t", due: "2026-06-10", recur: "1d" }); // id 1
    const child = store.create({ title: "c", parentId: t.id }); // id 2
    store.setStatus(child.id, "done"); // 부모 done 가드 통과
    store.setStatus(t.id, "done"); // spawn id 3
    const next = store.get(t.id + 2);
    expect(next?.title).toBe("t");
    expect(store.children(next?.id ?? -1)).toEqual([]);
  });

  test("cancelling a recurring task does not spawn an instance", () => {
    const store = makeStore();
    const t = store.create({ title: "t", due: "2026-06-10", recur: "1d" });
    store.setStatus(t.id, "cancelled");
    expect(store.get(t.id + 1)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/tasks.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — `packages/core/src/tasks.ts`

import에 `InvalidDurationError, RecurWithoutDueError` 추가, `isDuration, shiftDate` 추가:

```ts
import { isDuration, shiftDate } from "./dates";
```

`create`에 parent 검증 다음, INSERT 전에:

```ts
    if (input.recur !== undefined) {
      if (!isDuration(input.recur)) throw new InvalidDurationError(input.recur);
      if ((input.due ?? null) === null) throw new RecurWithoutDueError();
    }
```

`update`에 parent-cycle 가드 다음, `next` 계산 후, DB write 전에:

```ts
    if (next.recur !== null) {
      if (!isDuration(next.recur)) throw new InvalidDurationError(next.recur);
      if (next.due === null) throw new RecurWithoutDueError();
    }
```

`setStatus`의 `return this.mustGet(id);` 직전에:

```ts
    if (status === "done" && current.recur !== null) this.spawnRecurrence(current, now);
```

private 메서드 추가:

```ts
  // rolling recurrence — done 시점에 다음 인스턴스 1개를 만든다.
  // recur는 due 없이는 설정 불가하므로 current.due/recur는 non-null이 보장된다.
  private spawnRecurrence(task: Task, now: string): void {
    const recur = task.recur as string;
    const due = shiftDate(task.due as string, recur);
    const start = task.start !== null ? shiftDate(task.start, recur) : null;
    const row = this.db
      .query(
        `INSERT INTO tasks (title, body, priority, tags, project, start, due, recur, external_ref, parent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        task.title,
        task.body,
        task.priority,
        JSON.stringify(task.tags),
        task.project,
        start,
        due,
        recur,
        null,
        task.parentId,
        now,
        now,
      ) as { id: number };
    this.recordEvent(row.id, "created", { title: task.title, recurredFrom: task.id }, now);
  }
```

- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run typecheck` / Expected: PASS, 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): recur validation and rolling recurrence on done"`

### Task 5: add/update `--recur`

**Files:**
- Modify: `packages/cli/src/commands/add.ts`, `packages/cli/src/commands/update.ts`
- Test: `packages/cli/tests/add.test.ts`, `packages/cli/tests/update.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

add.test.ts에 추가:

```ts
  test("creates a recurring task with --recur", () => {
    const { ctx } = createTestCli();
    addCommand.run(["t", "--due", "2026-06-10", "--recur", "1w"], ctx);
    expect(ctx.store.get(1)?.recur).toBe("1w");
  });

  test("rejects --recur without a due date (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => addCommand.run(["t", "--recur", "1w"], ctx)).toThrow("recur requires a due date");
  });
```

update.test.ts에 추가:

```ts
  test("sets and clears recur with none", () => {
    const { ctx } = createTestCli();
    ctx.store.create({ title: "t", due: "2026-06-10" });
    updateCommand.run(["1", "--recur", "1w"], ctx);
    expect(ctx.store.get(1)?.recur).toBe("1w");
    updateCommand.run(["1", "--recur", "none"], ctx);
    expect(ctx.store.get(1)?.recur).toBeNull();
  });
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/add.test.ts packages/cli/tests/update.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

`add.ts` — options에 `recur: { type: "string" },` 추가. USAGE에 `[--recur <dur>]` 추가. create 호출에 `recur: values.recur,` 추가 (core가 검증).

`update.ts` — options에 `recur: { type: "string" },` 추가. USAGE에 `[--recur <dur|none>]` 추가. patch 구성에 (parent 블록 근처):

```ts
    if (values.recur !== undefined) patch.recur = noneToNull(values.recur);
```

(`noneToNull`은 이미 import됨.)

- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run typecheck` / Expected: PASS, 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): --recur on add and update"`

---

## Unit 3: undo

### Task 6: undo core (역적용 + reverted 이벤트 + comments 필터)

**Files:**
- Modify: `packages/core/src/tasks.ts`
- Test: `packages/core/tests/tasks.test.ts`

(`reverted` 이벤트 타입과 undo 에러는 Task 3에서 이미 추가됨.)

- [ ] **Step 1: 실패하는 테스트 작성** — tasks.test.ts에 추가

```ts
import { CannotUndoError, NothingToUndoError } from "@tasq/core";

describe("TaskStore.undo", () => {
  test("throws when there is nothing to undo", () => {
    const store = makeStore();
    expect(() => store.undo()).toThrow(NothingToUndoError);
  });

  test("undoes a status change", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.setStatus(t.id, "in_progress");
    const reverted = store.undo();
    expect(reverted.type).toBe("status_changed");
    expect(store.get(t.id)?.status).toBe("todo");
  });

  test("undoes an update by restoring previous field values", () => {
    const store = makeStore();
    const t = store.create({ title: "old", priority: 1, tags: ["a"] });
    store.update(t.id, { title: "new", priority: 5, tags: ["b", "c"] });
    store.undo();
    const back = store.get(t.id);
    expect(back?.title).toBe("old");
    expect(back?.priority).toBe(1);
    expect(back?.tags).toEqual(["a"]);
  });

  test("undoes a create by deleting the task", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.undo();
    expect(store.get(t.id)).toBeNull();
  });

  test("undoes dep_added and dep_removed", () => {
    const store = makeStore();
    const a = store.create({ title: "a" });
    const b = store.create({ title: "b" });
    store.addDep(a.id, b.id);
    store.undo();
    expect(store.depsOf(a.id)).toEqual([]);
    store.addDep(a.id, b.id);
    store.removeDep(a.id, b.id);
    store.undo();
    expect(store.depsOf(a.id)).toEqual([b.id]);
  });

  test("undoes archive and restore", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.archive(t.id);
    store.undo();
    expect(store.get(t.id)?.archivedAt).toBeNull();
    store.archive(t.id);
    store.restore(t.id);
    store.undo();
    expect(store.get(t.id)?.archivedAt).not.toBeNull();
  });

  test("undoing a comment hides it from comments", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.addComment(t.id, "oops");
    expect(store.comments(t.id)).toHaveLength(1);
    const reverted = store.undo();
    expect(reverted.type).toBe("comment");
    expect(store.comments(t.id)).toHaveLength(0);
  });

  test("refuses to undo a hard delete", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.hardDelete(t.id);
    expect(() => store.undo()).toThrow(CannotUndoError);
  });

  test("repeated undo walks back, skipping already-reverted events", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.setStatus(t.id, "in_progress");
    store.setStatus(t.id, "review");
    store.undo(); // review -> in_progress
    store.undo(); // in_progress -> todo
    expect(store.get(t.id)?.status).toBe("todo");
    store.undo(); // undo the create
    expect(store.get(t.id)).toBeNull();
    expect(() => store.undo()).toThrow(NothingToUndoError);
  });

  test("undo records a reverted event referencing the target", () => {
    const store = makeStore();
    const t = store.create({ title: "t" });
    store.setStatus(t.id, "in_progress");
    const target = store.events(t.id).find((e) => e.type === "status_changed");
    store.undo();
    const reverted = store.events(t.id).find((e) => e.type === "reverted");
    expect(reverted?.payload).toEqual({ targetEventId: target?.id });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/core/tests/tasks.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현** — `packages/core/src/tasks.ts`

import에 `CannotUndoError, NothingToUndoError` 추가.

`comments`를 reverted 필터로 교체:

```ts
  comments(taskId: number): TaskEvent[] {
    const reverted = this.revertedEventIds();
    return this.events(taskId).filter((e) => e.type === "comment" && !reverted.has(e.id));
  }
```

메서드 추가:

```ts
  // 전역 마지막 mutation 1개를 역적용하고 reverted 이벤트를 append한다.
  // 원본 이벤트는 지우지 않는다 — append-only 유지.
  undo(): TaskEvent {
    const reverted = this.revertedEventIds();
    const rows = this.db
      .query("SELECT * FROM events WHERE type != 'reverted' ORDER BY id DESC")
      .all() as EventRow[];
    const target = rows.map(rowToEvent).find((e) => !reverted.has(e.id));
    if (target === undefined) throw new NothingToUndoError();
    this.applyReverse(target);
    this.recordEvent(target.taskId, "reverted", { targetEventId: target.id }, new Date().toISOString());
    return target;
  }

  // reverted 이벤트가 가리키는 대상 이벤트 id 집합
  private revertedEventIds(): Set<number> {
    const rows = this.db
      .query("SELECT payload FROM events WHERE type = 'reverted'")
      .all() as { payload: string }[];
    return new Set(rows.map((r) => (JSON.parse(r.payload) as { targetEventId: number }).targetEventId));
  }

  private applyReverse(e: TaskEvent): void {
    switch (e.type) {
      case "created":
        this.db.query("DELETE FROM task_deps WHERE task_id = ? OR depends_on_id = ?").run(e.taskId, e.taskId);
        this.db.query("DELETE FROM tasks WHERE id = ?").run(e.taskId);
        return;
      case "updated":
        this.reverseUpdate(e.taskId, e.payload.fields as Record<string, { from: unknown; to: unknown }>);
        return;
      case "status_changed":
        this.db
          .query("UPDATE tasks SET status = ? WHERE id = ?")
          .run((e.payload as { from: string }).from, e.taskId);
        return;
      case "comment":
        // reverted 이벤트가 마킹 — comments()가 숨긴다. row 변경 없음.
        return;
      case "dep_added":
        this.db
          .query("DELETE FROM task_deps WHERE task_id = ? AND depends_on_id = ?")
          .run(e.taskId, (e.payload as { dependsOnId: number }).dependsOnId);
        return;
      case "dep_removed":
        this.db
          .query("INSERT OR IGNORE INTO task_deps (task_id, depends_on_id) VALUES (?, ?)")
          .run(e.taskId, (e.payload as { dependsOnId: number }).dependsOnId);
        return;
      case "archived":
        this.db.query("UPDATE tasks SET archived_at = NULL WHERE id = ?").run(e.taskId);
        return;
      case "restored":
        this.db
          .query("UPDATE tasks SET archived_at = ? WHERE id = ?")
          .run(new Date().toISOString(), e.taskId);
        return;
      case "deleted":
        throw new CannotUndoError(e.taskId);
    }
  }

  // updated 이벤트의 fields.{from}을 컬럼에 되돌린다. 변경된 필드만 SET.
  private reverseUpdate(
    taskId: number,
    fields: Record<string, { from: unknown; to: unknown }>,
  ): void {
    const COLS: ReadonlyArray<readonly [string, string]> = [
      ["title", "title"],
      ["body", "body"],
      ["priority", "priority"],
      ["tags", "tags"],
      ["project", "project"],
      ["start", "start"],
      ["due", "due"],
      ["recur", "recur"],
      ["externalRef", "external_ref"],
      ["parentId", "parent_id"],
    ];
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [key, col] of COLS) {
      const change = fields[key];
      if (change === undefined) continue;
      sets.push(`${col} = ?`);
      params.push(key === "tags" ? JSON.stringify(change.from) : (change.from as string | number | null));
    }
    params.push(taskId);
    this.db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
```

주의 (도달 불가 분기 회피):
- `applyReverse`의 switch는 `reverted`를 제외한 모든 TaskEventType을 case로 가진다. `reverted`는 undo 스캔(`WHERE type != 'reverted'`)에서 제외되므로 applyReverse에 도달하지 않는다 → `reverted` case와 `default`를 만들지 않는다 (만들면 미커버). switch는 그대로 두면 TS가 `reverted` 경로에서 암묵 void 반환을 허용한다.
- `reverseUpdate`의 `change === undefined` continue는 **부분 업데이트에서 항상 발생**(대부분의 업데이트는 일부 필드만 변경)하므로 커버된다. `sets.length === 0`은 update가 빈 패치 이벤트를 절대 기록하지 않으므로 발생 불가 → **가드를 두지 않는다** (두면 미커버). updated 이벤트는 항상 ≥1 필드.

- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run typecheck` / Expected: PASS, 100%
- [ ] **Step 5: 커밋** — `git commit -am "feat(core): undo via reverse-applied events"`

### Task 7: undo 커맨드 + 레지스트리 조립

**Files:**
- Create: `packages/cli/src/commands/undo.ts`
- Modify: `packages/cli/src/commands/index.ts`
- Test: `packages/cli/tests/undo.test.ts` (신규), `packages/cli/tests/commands-index.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/cli/tests/undo.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { undoCommand } from "../src/commands/undo";
import { createTestCli } from "./helpers";

describe("undo", () => {
  test("undoes the last change and reports it", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    ctx.store.setStatus(1, "in_progress");
    expect(undoCommand.run([], ctx)).toBe(0);
    expect(out).toEqual(["undid status_changed on #1"]);
    expect(ctx.store.get(1)?.status).toBe("todo");
  });

  test("prints the reverted event as JSON with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    undoCommand.run(["--json"], ctx);
    expect(JSON.parse(out[0] ?? "").type).toBe("created");
  });

  test("throws when there is nothing to undo (handled by runCli)", () => {
    const { ctx } = createTestCli();
    expect(() => undoCommand.run([], ctx)).toThrow("nothing to undo");
  });
});
```

`packages/cli/tests/commands-index.test.ts` — 기대 배열에 `undo` 추가 (정렬 위치 주의):

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
      "undo",
      "update",
    ]);
```

- [ ] **Step 2: 실패 확인** — Run: `bun test packages/cli/tests/undo.test.ts packages/cli/tests/commands-index.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

`packages/cli/src/commands/undo.ts`:

```ts
import { parseArgs } from "node:util";
import type { Command } from "../registry";

const USAGE = "tasq undo [--json]";

export const undoCommand: Command = {
  name: "undo",
  description: "Undo the last change",
  usage: USAGE,
  run(args, ctx) {
    const { values } = parseArgs({ args, options: { json: { type: "boolean" } } });
    const event = ctx.store.undo();
    ctx.stdout(values.json === true ? JSON.stringify(event) : `undid ${event.type} on #${event.taskId}`);
    return 0;
  },
};
```

`packages/cli/src/commands/index.ts` — import에 `import { undoCommand } from "./undo";` 추가, buildRegistry 배열에 `undoCommand` 추가 (eventsCommand 옆).

- [ ] **Step 4: 최종 검증** — Run: `bun test && bun run typecheck` / Expected: 전체 PASS, 100% (라인·함수), typecheck clean. 15개 커맨드 등록 확인.
- [ ] **Step 5: 커밋** — `git commit -am "feat(cli): undo command and registry assembly"`

---

## 마무리

- [ ] 전체 self-review: `git diff main --stat`, 설계 §5 대비 누락 점검
- [ ] PR 생성: 제목 `feat: Batch B — 신뢰성 + 자동화 (urgency·undo·recurrence)`. 본문에 설계 링크, **breaking change**(list 기본 정렬이 priority→urgency로 전환; `list --json`에 urgency 필드 추가) 명시. **AI 어시스턴트 푸터 금지.**

## 스펙 커버리지 체크리스트 (설계 §5 대비)

- [x] urgency 가중합 (in_progress·due·priority·age·dep-blocked·status-blocked) → Task 1
- [x] list 기본 urgency 정렬 + `--sort id|priority|due|urgency` + `--json` urgency → Task 2
- [x] recurrence 스키마 v3 + `recur` 필드 + duration 헬퍼 → Task 3
- [x] recur는 due 필수(`RecurWithoutDueError`) + duration 검증 → Task 4
- [x] done 시 rolling 다음 인스턴스(parent 유지, deps/subtree/externalRef 제외, recurredFrom) → Task 4
- [x] add/update `--recur <dur|none>` → Task 5
- [x] undo: 마지막 mutation 역적용 + `reverted` append + 스킵 → Task 6
- [x] 역적용 매핑(created/updated/status_changed/comment/dep_*/archived/restored, deleted→에러) → Task 6
- [x] reverted comment는 comments/show에서 숨김 → Task 6
- [x] undo 커맨드 + 등록 → Task 7
