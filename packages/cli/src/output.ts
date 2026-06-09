import type { Task, TaskStatus } from "@tasq/core";

const STATUS_ICONS: Record<TaskStatus, string> = {
  todo: "○",
  in_progress: "◐",
  review: "◎",
  done: "●",
  blocked: "✗",
  cancelled: "⊘",
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
    `start:    ${task.start ?? "-"}`,
    `due:      ${task.due ?? "-"}`,
    `external: ${task.externalRef ?? "-"}`,
    `created:  ${task.createdAt}`,
    `updated:  ${task.updatedAt}`,
  ];
  if (task.body) lines.push("", task.body);
  return lines.join("\n");
}
