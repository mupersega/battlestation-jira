/**
 * JSON export: the whole database as one readable file,
 * written atomically after every write batch. Point the data directory's
 * export folder at something that is backed up; the live SQLite file itself
 * should not be touched by a sync client.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "@battlestation/domain";

export const EXPORT_FILE = "battlestation.json";

export function writeSnapshot(snapshot: Snapshot, exportDir: string): string {
  mkdirSync(exportDir, { recursive: true });
  const target = join(exportDir, EXPORT_FILE);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  renameSync(tmp, target);
  return target;
}
