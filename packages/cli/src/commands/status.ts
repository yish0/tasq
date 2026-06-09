import { parseArgs } from "node:util";
import { parseIds } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq status <id...> <todo|in_progress|review|done|blocked|cancelled> [--json]";

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
    const status = positionals.pop();
    const ids = parseIds(positionals);
    if (status === undefined || ids === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const tasks = ctx.store.withTransaction(() =>
      ids.map((id) => ctx.store.setStatus(id, status)),
    );
    if (values.json === true) {
      ctx.stdout(JSON.stringify(tasks));
      return 0;
    }
    for (const t of tasks) ctx.stdout(`#${t.id} → ${t.status}`);
    return 0;
  },
};
