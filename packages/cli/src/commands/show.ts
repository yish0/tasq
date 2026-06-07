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
