import { InvalidDateExprError } from "./errors";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// 월 연산은 대상 월의 말일로 클램프한다 (1/31 + 1m = 2/28)
function addMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay));
}

// 날짜는 date-only(YYYY-MM-DD). 모든 상대 표현은 미래 시점으로 해석한다
// (예외: yesterday). 주의 시작은 월요일.
export function parseDateExpr(expr: string, now: Date): string {
  const e = expr.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    const [y, m, d] = e.split("-").map(Number) as [number, number, number];
    const parsed = new Date(y, m - 1, d);
    if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
      throw new InvalidDateExprError(expr);
    }
    return e;
  }
  if (e === "today") return toIso(today);
  if (e === "tomorrow") return toIso(addDays(today, 1));
  if (e === "yesterday") return toIso(addDays(today, -1));

  const weekday = WEEKDAYS.findIndex((w) => w === e || w.slice(0, 3) === e);
  if (weekday >= 0) {
    const diff = (weekday - today.getDay() + 7) % 7;
    return toIso(addDays(today, diff === 0 ? 7 : diff));
  }

  const rel = /^(\d+)([dwmy])$/.exec(e);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    if (unit === "d") return toIso(addDays(today, n));
    if (unit === "w") return toIso(addDays(today, n * 7));
    if (unit === "m") return toIso(addMonths(today, n));
    return toIso(addMonths(today, n * 12));
  }

  // getDay(): 일요일=0. 월요일 시작 주에서 이번 주 일요일까지는 (7 - dow) % 7일
  const dow = today.getDay();
  if (e === "eow") return toIso(addDays(today, (7 - dow) % 7));
  if (e === "sow") {
    const diff = (8 - dow) % 7;
    return toIso(addDays(today, diff === 0 ? 7 : diff));
  }
  if (e === "eom") return toIso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  if (e === "som") return toIso(new Date(today.getFullYear(), today.getMonth() + 1, 1));
  if (e === "eoy") return toIso(new Date(today.getFullYear(), 11, 31));
  if (e === "soy") return toIso(new Date(today.getFullYear() + 1, 0, 1));

  throw new InvalidDateExprError(expr);
}
