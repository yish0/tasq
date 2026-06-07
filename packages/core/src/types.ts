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

// 불변 데이터 — 변이는 TaskStore의 단일 경로로만. store 밖 변이는 컴파일 타임에 차단한다.
export interface Task {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly status: TaskStatus;
  readonly priority: number;
  readonly tags: readonly string[];
  readonly project: string | null;
  readonly start: string | null;
  readonly due: string | null;
  readonly externalRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  priority?: number;
  tags?: string[];
  project?: string;
  start?: string;
  due?: string;
  externalRef?: string;
}

export interface UpdateTaskPatch {
  title?: string;
  body?: string;
  priority?: number;
  tags?: string[];
  project?: string | null;
  start?: string | null;
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
  readonly id: number;
  readonly taskId: number;
  readonly type: TaskEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}
