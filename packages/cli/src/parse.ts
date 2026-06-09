import { parseDateExpr } from "@tasq/core";

export function parseId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parsePriority(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedTokens {
  words: string[];
  tags: string[];
  project: string | undefined;
  priority: number | undefined;
}

// taskwarrior식 토큰: +tag / :project / ^priority
// 공백 없는 단독 인자만 토큰으로 인식한다 — 쿼트로 묶인 타이틀("fix +bar thing")은
// 공백을 포함하므로 그대로 단어가 된다. ^뒤가 숫자가 아니면 일반 단어로 취급.
export function parseTokens(args: string[]): ParsedTokens {
  const words: string[] = [];
  const tags: string[] = [];
  let project: string | undefined;
  let priority: number | undefined;
  for (const arg of args) {
    if (arg.length > 1 && !/\s/.test(arg)) {
      if (arg.startsWith("+")) {
        tags.push(arg.slice(1));
        continue;
      }
      if (arg.startsWith(":")) {
        project = arg.slice(1);
        continue;
      }
      if (arg.startsWith("^")) {
        const parsed = parsePriority(arg.slice(1));
        if (parsed !== null) {
          priority = parsed;
          continue;
        }
      }
    }
    words.push(arg);
  }
  return { words, tags, project, priority };
}

export function parseIds(raws: string[]): number[] | null {
  if (raws.length === 0) return null;
  const ids: number[] = [];
  for (const raw of raws) {
    const id = parseId(raw);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

// nullable 필드 클리어 컨벤션: 리터럴 'none'은 null
export function noneToNull(value: string): string | null {
  return value === "none" ? null : value;
}

// 날짜 옵션: 'none'은 클리어, 그 외는 날짜 표현으로 해석.
// 실패 시 InvalidDateExprError가 위로 던져져 runCli가 stderr+exit 1 처리한다.
export function parseDateOption(value: string, now: Date): string | null {
  if (value === "none") return null;
  return parseDateExpr(value, now);
}
