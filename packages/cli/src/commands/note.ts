import { parseArgs } from "node:util";
import { parseId } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq note <id> <text> [--json]";

export const noteCommand: Command = {
  name: "note",
  description: "Append a note to a task",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: { json: { type: "boolean" } },
      allowPositionals: true,
    });
    const id = parseId(positionals[0]);
    const text = positionals.slice(1).join(" ").trim();
    if (id === null || text === "") {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const event = ctx.store.addComment(id, text);
    ctx.stdout(values.json === true ? JSON.stringify(event) : `note added to #${id}`);
    return 0;
  },
};
