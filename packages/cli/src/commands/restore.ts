import { parseArgs } from "node:util";
import { parseIds } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq restore <id...> [--json]";

export const restoreCommand: Command = {
  name: "restore",
  description: "Restore archived tasks",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
    });
    const ids = parseIds(positionals);
    if (ids === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const tasks = ctx.store.withTransaction(() => ids.map((id) => ctx.store.restore(id)));
    if (values.json === true) {
      ctx.stdout(JSON.stringify(tasks));
      return 0;
    }
    ctx.stdout(`restored ${tasks.map((t) => `#${t.id}`).join(", ")}`);
    return 0;
  },
};
