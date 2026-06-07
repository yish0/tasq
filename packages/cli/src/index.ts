#!/usr/bin/env bun
import { runCli } from "./app";
import { buildRegistry } from "./commands/index";
import { createContext } from "./context";

export function main(argv: string[] = process.argv.slice(2)): number {
  return runCli(argv, createContext(), buildRegistry());
}

// 커버리지: 단일 라인 유지 (조건 평가로 라인 커버, exit는 E2E에서 검증)
if (import.meta.main) process.exit(main());
