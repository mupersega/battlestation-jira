/**
 * Opening the database and applying migrations. Migrations are plain SQL
 * files in ../migrations, applied in name order, each once, recorded in
 * schema_migrations.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Compiled: dist/src -> package root is two up. Source: src -> one up.
  for (const candidate of [join(here, "..", "..", "migrations"), join(here, "..", "migrations")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`migrations directory not found near ${here}`);
}

export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>).map((r) => r.name),
  );
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const newlyApplied: string[] = [];
  const record = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      record.run(f, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${f} failed: ${(err as Error).message}`);
    }
    newlyApplied.push(f);
  }
  return newlyApplied;
}
