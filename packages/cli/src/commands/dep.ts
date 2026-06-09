import { parseIds } from "../parse";
import type { Command } from "../registry";

const USAGE = "tasq dep <add|rm> <id> <on-id...>";

export const depCommand: Command = {
  name: "dep",
  description: "Manage task dependencies",
  usage: USAGE,
  run(args, ctx) {
    const [sub, ...rest] = args;
    const ids = parseIds(rest);
    if ((sub !== "add" && sub !== "rm") || ids === null || ids.length < 2) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const [taskId, ...onIds] = ids as [number, ...number[]];
    ctx.store.withTransaction(() => {
      for (const onId of onIds) {
        if (sub === "add") ctx.store.addDep(taskId, onId);
        else ctx.store.removeDep(taskId, onId);
      }
    });
    const list = onIds.map((i) => `#${i}`).join(", ");
    ctx.stdout(sub === "add" ? `#${taskId} now depends on ${list}` : `removed ${list} from #${taskId} deps`);
    return 0;
  },
};
