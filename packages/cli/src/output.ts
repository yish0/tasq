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
