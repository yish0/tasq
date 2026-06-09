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
