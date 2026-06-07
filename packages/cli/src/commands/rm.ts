import { parseId } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq rm <id>";

export const rmCommand: Command = {
  name: "rm",
  description: "Delete a task",
  usage: USAGE,
  run(args, ctx) {
    const id = parseId(args[0]);
    if (id === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    ctx.store.remove(id);
    ctx.stdout(`deleted #${id}`);
    return 0;
  },
};
