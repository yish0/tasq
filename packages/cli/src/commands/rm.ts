import { parseArgs } from "node:util";
import { parseIds } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq rm <id...> [--recursive|-r] [--hard]";

export const rmCommand: Command = {
  name: "rm",
  description: "Archive tasks (--hard to delete permanently)",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        recursive: { type: "boolean", short: "r" },
        hard: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const ids = parseIds(positionals);
    if (ids === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const recursive = values.recursive === true;
    ctx.store.withTransaction(() => {
      for (const id of ids) {
        if (values.hard === true) ctx.store.hardDelete(id, { recursive });
        else ctx.store.archive(id, { recursive });
      }
    });
    const list = ids.map((i) => `#${i}`).join(", ");
    ctx.stdout(values.hard === true ? `deleted ${list}` : `archived ${list}`);
    return 0;
  },
};
