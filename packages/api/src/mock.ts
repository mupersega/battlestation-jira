#!/usr/bin/env node
/**
 * `npm run mock`: the app in the middle of an invented sprint. Builds a
 * fresh throwaway database from the mock scenario every time, pretends today
 * is the scenario's date, and serves it on its own port so it can run beside
 * the real one. Nothing here touches the real data directory.
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Battlestation } from "@battlestation/domain";
import { SqliteStore } from "@battlestation/data";
import { MOCK_TODAY, mockClock, seedScenario } from "./mock-scenario.js";
import { createApiServer } from "./server.js";
import { version, webDir } from "./runtime.js";

function main(): void {
  const port = Number(process.env.BATTLESTATION_MOCK_PORT ?? 4758);
  const dir = join(tmpdir(), "battlestation-jira-mock");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const store = SqliteStore.open(join(dir, "mock.sqlite"));
  seedScenario(store);
  const app = new Battlestation({ store, clock: mockClock });
  const staticDir = webDir();
  const server = createApiServer({ app, version: version(), staticDir, mode: "mock" });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Battlestation ${version()}, MOCK DATA`);
    console.log(`  pretending today is ${MOCK_TODAY}`);
    console.log(`  data:  ${dir} (rebuilt on every start)`);
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
