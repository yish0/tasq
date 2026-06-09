import { parseArgs } from "node:util";
import { parseDateExpr } from "@tasq/core";
import { parseId, parsePriority, parseTokens } from "../parse";
import type { Command } from "../registry";

const USAGE =
  "tasq add <title> [^N] [:project] [+tag]... [--body <text>] [--priority <n>] [--tag <tag>]... [--project <name>] [--start <date>] [--due <date>] [--parent <id>] [--json]";

export const addCommand: Command = {
  name: "add",
  description: "Create a new task",
  usage: USAGE,
  run(args, ctx) {
    const { values, positionals } = parseArgs({
      args,
      options: {
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
    const tokens = parseTokens(positionals);
    const title = tokens.words.join(" ").trim();
    if (!title) {
      ctx.stderr(`usage: ${USAGE}`);
      return 1;
    }
    // 같은 필드를 flag와 토큰 둘 다 주면 명시적인 flag가 이긴다
    let priority = tokens.priority;
    if (values.priority !== undefined) {
      const parsed = parsePriority(values.priority);
      if (parsed === null) {
        ctx.stderr(`invalid priority: ${values.priority}`);
        return 1;
      }
      priority = parsed;
    }
    const tags = values.tag ?? (tokens.tags.length > 0 ? tokens.tags : undefined);
    let parentId: number | undefined;
    if (values.parent !== undefined) {
      const parsed = parseId(values.parent);
      if (parsed === null) {
        ctx.stderr(`invalid parent: ${values.parent}`);
        return 1;
      }
      parentId = parsed;
    }
    const now = new Date();
    const task = ctx.store.create({
      title,
      body: values.body,
      priority,
      tags,
      project: values.project ?? tokens.project,
      start: values.start !== undefined ? parseDateExpr(values.start, now) : undefined,
      due: values.due !== undefined ? parseDateExpr(values.due, now) : undefined,
      parentId,
    });
    ctx.stdout(values.json ? JSON.stringify(task) : `created #${task.id}: ${task.title}`);
    return 0;
  },
};
