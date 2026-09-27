#!/usr/bin/env node
/**
 * `npm start`: serves the API and the built web app on localhost. A separate
 * process from the MCP server (which Claude Code spawns over stdio); both
 * open the same SQLite file, which WAL mode allows.
 */

import { Battlestation } from "@battlestation/domain";
import { SqliteStore, loadConfig, writeSnapshot } from "@battlestation/data";
import { createApiServer } from "./server.js";
import { version, webDir } from "./runtime.js";

function main(): void {
  const cfg = loadConfig();
  const port = Number(process.env.BATTLESTATION_PORT ?? 4757);
  const host = "127.0.0.1";
  const staticDir = webDir();

  const store = SqliteStore.open(cfg.dbPath);
  const app = new Battlestation({ store, onWrite: (s) => writeSnapshot(s, cfg.exportDir) });
  const server = createApiServer({ app, version: version(), staticDir, mode: "live" });

  server.listen(port, host, () => {
    console.log(`Battlestation ${version()}`);
    console.log(`  data:  ${cfg.dataDir} (from ${cfg.source})`);
    console.log(`  web:   ${staticDir ?? "not built (run npm run build:web)"}`);
    console.log(`  open:  http://localhost:${port}`);
  });

  const stop = () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main();
