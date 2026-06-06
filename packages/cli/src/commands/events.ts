import { parseArgs } from "node:util";
import { parseId } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq events <id> [--json]";

export const eventsCommand: Command = {
  name: "events",
  description: "Show task event log",
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
    const events = ctx.store.events(id);
    if (values.json) {
      ctx.stdout(JSON.stringify(events));
      return 0;
    }
    for (const event of events) {
      ctx.stdout(`${event.createdAt} ${event.type} ${JSON.stringify(event.payload)}`);
    }
    return 0;
  },
};
