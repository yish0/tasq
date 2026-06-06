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
