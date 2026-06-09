import { TaskStore, ensureTasqHome, openDb, resolveTasqHome } from "@tasq/core";
import type { CliContext } from "./registry";

export function createContext(
  env: Record<string, string | undefined> = process.env,
): CliContext {
  const home = ensureTasqHome(resolveTasqHome(env));
  return {
    store: new TaskStore(openDb(home.dbPath, { backupDir: home.backupsDir })),
    stdout: console.log,
    stderr: console.error,
  };
}
