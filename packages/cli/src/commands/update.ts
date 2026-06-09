import { parseArgs } from "node:util";
import type { UpdateTaskPatch } from "@tasq/core";
import { noneToNull, parseDateOption, parseId, parsePriority } from "../parse";
import type { Command } from "../registry";

const USAGE =
  "tasq update <id> [--title <t>] [--body <b>] [--priority <n>] [--tag <tag>]... [--project <p|none>] [--start <d|none>] [--due <d|none>] [--parent <id|none>] [--json]";

export const updateCommand: Command = {
  name: "update",
  description: "Update task fields",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        title: { type: "string" },
        body: { type: "string" },
        priority: { type: "string" },
        tag: { type: "string", multiple: true },
        project: { type: "string" },
        start: { type: "string" },
        due: { type: "string" },
        parent: { type: "string" },
        json: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const id = parseId(positionals[0]);
    if (id === null) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    const patch: UpdateTaskPatch = {};
    if (values.title !== undefined) patch.title = values.title;
    if (values.body !== undefined) patch.body = values.body;
    if (values.priority !== undefined) {
      const parsed = parsePriority(values.priority);
      if (parsed === null) {
        ctx.stderr(`invalid priority: ${values.priority}`);
        return 1;
      }
      patch.priority = parsed;
    }
    if (values.tag !== undefined) patch.tags = values.tag;
    if (values.parent !== undefined) {
      if (values.parent === "none") {
        patch.parentId = null;
      } else {
        const parsed = parseId(values.parent);
        if (parsed === null) {
          ctx.stderr(`invalid parent: ${values.parent}`);
          return 1;
        }
        patch.parentId = parsed;
      }
    }
    const now = new Date();
    if (values.project !== undefined) patch.project = noneToNull(values.project);
    if (values.start !== undefined) patch.start = parseDateOption(values.start, now);
    if (values.due !== undefined) patch.due = parseDateOption(values.due, now);
    if (Object.keys(patch).length === 0) {
      ctx.stderr("nothing to update");
      return 1;
    }
    const task = ctx.store.update(id, patch);
    ctx.stdout(values.json ? JSON.stringify(task) : `updated #${task.id}`);
    return 0;
  },
};
