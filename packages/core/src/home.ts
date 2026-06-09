import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TasqHome {
  root: string;
  dbPath: string;
  pluginsDir: string;
  backupsDir: string;
}

export function resolveTasqHome(
  env: Record<string, string | undefined> = process.env,
): TasqHome {
  const root = env.TASQ_HOME ?? join(homedir(), ".tasq");
  return {
    root,
    dbPath: join(root, "tasq.db"),
    pluginsDir: join(root, "plugins"),
    backupsDir: join(root, "backups"),
  };
}

export function ensureTasqHome(home: TasqHome): TasqHome {
  mkdirSync(home.pluginsDir, { recursive: true });
  return home;
}
