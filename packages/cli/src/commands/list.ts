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
