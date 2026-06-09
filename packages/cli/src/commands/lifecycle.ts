import { parseArgs } from "node:util";
import { InvalidTransitionError, type TaskStatus } from "@tasq/core";
import { parseIds } from "../parse";
import type { Command } from "../registry";

interface LifecycleSpec {
  name: string;
  description: string;
  to: TaskStatus;
  // 미지정이면 전이 검증을 store 가드에 위임한다
  allowedFrom?: readonly TaskStatus[];
  warnOpenDeps?: boolean;
}

function makeLifecycleCommand(spec: LifecycleSpec): Command {
  const usage = `tasq ${spec.name} <id...> [--json]`;
  return {
    name: spec.name,
    description: spec.description,
    usage,
    run(args, ctx) {
      const { values, positionals } = parseArgs({
        args,
        options: { json: { type: "boolean" } },
        allowPositionals: true,
      });
      const ids = parseIds(positionals);
      if (ids === null) {
        ctx.stderr(`usage: ${usage}`);
        return 1;
      }
      const warnings: string[] = [];
      // 복수 ID는 단일 트랜잭션 — 하나라도 실패하면 전체 롤백
      const tasks = ctx.store.withTransaction(() =>
        ids.map((id) => {
          const current = ctx.store.get(id);
          if (
            current !== null &&
            spec.allowedFrom !== undefined &&
            !spec.allowedFrom.includes(current.status)
          ) {
            throw new InvalidTransitionError(current.status, spec.to);
          }
          if (spec.warnOpenDeps === true) {
            for (const dep of ctx.store.openDepsOf(id)) {
              warnings.push(`warning: #${id} depends on incomplete #${dep}`);
            }
          }
          return ctx.store.setStatus(id, spec.to);
        }),
      );
      for (const w of warnings) ctx.stderr(w);
      if (values.json === true) {
        ctx.stdout(JSON.stringify(tasks));
        return 0;
      }
      for (const t of tasks) ctx.stdout(`#${t.id} → ${t.status}`);
      return 0;
    },
  };
}

export const doneCommand = makeLifecycleCommand({
  name: "done",
  description: "Complete tasks",
  to: "done",
});

export const startCommand = makeLifecycleCommand({
  name: "start",
  description: "Start tasks",
  to: "in_progress",
  allowedFrom: ["todo", "review", "blocked"],
  warnOpenDeps: true,
});

export const cancelCommand = makeLifecycleCommand({
  name: "cancel",
  description: "Cancel tasks",
  to: "cancelled",
});

export const reopenCommand = makeLifecycleCommand({
  name: "reopen",
  description: "Reopen done or cancelled tasks",
  to: "todo",
  allowedFrom: ["done", "cancelled"],
});
