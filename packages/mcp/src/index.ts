#!/usr/bin/env node
/**
 * Stdio entry point. Claude Code (or any MCP client) launches this process;
 * it opens the SQLite file in the data directory, applies migrations, and
 * serves the Battlestation tools over stdin/stdout. Logs go to stderr.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Battlestation } from "@battlestation/domain";
import { SqliteStore, writeSnapshot } from "@battlestation/data";
import { loadConfig, packageVersion } from "./config.js";
import { buildServer } from "./server.js";

function main(): void {
  const cfg = loadConfig();
  const store = SqliteStore.open(cfg.dbPath);
  const app = new Battlestation({
    store,
    onWrite: (snapshot) => {
      try {
        writeSnapshot(snapshot, cfg.exportDir);
      } catch (err) {
        console.error("[battlestation] export failed:", (err as Error).message);
      }
    },
  });

  console.error(`[battlestation] version:  ${packageVersion()}`);
  console.error(`[battlestation] data dir: ${cfg.dataDir} (from ${cfg.source})`);
  console.error(`[battlestation] database: ${cfg.dbPath}`);

  serveStdio(() => buildServer({ app, version: packageVersion() }), {
    onerror: (err) => console.error("[battlestation] transport error:", err.message),
  });
  console.error("[battlestation] MCP server running on stdio");
}

main();
