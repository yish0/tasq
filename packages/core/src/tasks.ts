import type { Database } from "bun:sqlite";
import {
  DependencyCycleError,
  HasSubtasksError,
  IncompleteSubtaskError,
  InvalidStatusError,
  InvalidTransitionError,
  NotArchivedError,
  ParentArchivedError,
  ParentCycleError,
  TaskNotFoundError,
} from "./errors";
import { isTaskStatus } from "./types";
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
  start: string | null;
  due: string | null;
  parent_id: number | null;
  archived_at: string | null;
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
    start: row.start,
    due: row.due,
    parentId: row.parent_id,
    archivedAt: row.archived_at,
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

  // note 커맨드와 (Phase 2의) agent report가 공유하는 통로.
  // 태스크 row는 건드리지 않는다 — updated_at도 그대로.
  addComment(id: number, text: string): TaskEvent {
    this.mustGet(id);
    return this.recordEvent(id, "comment", { text }, new Date().toISOString());
  }

  comments(taskId: number): TaskEvent[] {
    return this.events(taskId).filter((e) => e.type === "comment");
  }

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

  children(id: number): Task[] {
    const rows = this.db
      .query("SELECT * FROM tasks WHERE parent_id = ? ORDER BY priority DESC, id ASC")
      .all(id) as TaskRow[];
    return rows.map(rowToTask);
  }

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

  // 조상 체인을 걸어 자기 자신(또는 자손을 경유한 자신)을 부모로 삼는 것을 차단
  private assertNoParentCycle(id: number, parentId: number): void {
    let cursor: number | null = parentId;
    while (cursor !== null) {
      if (cursor === id) throw new ParentCycleError(id, parentId);
      cursor = this.mustGet(cursor).parentId;
    }
  }

  private mustGet(id: number): Task {
    const task = this.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }

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
}
