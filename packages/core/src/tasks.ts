import type { Database } from "bun:sqlite";
import { TaskNotFoundError } from "./errors";
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
        `INSERT INTO tasks (title, body, priority, tags, project, start, due, external_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  update(id: number, patch: UpdateTaskPatch): Task {
    const current = this.mustGet(id);
    const fields = Object.keys(patch);
    if (fields.length === 0) return current;
    const next = { ...current, ...patch };
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE tasks
         SET title = ?, body = ?, priority = ?, tags = ?, project = ?, start = ?, due = ?, external_ref = ?, updated_at = ?
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
