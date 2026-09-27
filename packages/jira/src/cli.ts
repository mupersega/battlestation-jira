/**
 * npm run pull: read your issues and sprints from Jira, one way, into the
 * local copy. The connection comes from .env (see .env.example).
 *
 *   npm run pull
 *   npm run pull -- --board 7              remember the board whose sprints are read
 *   npm run pull -- --jql "project = ABC"  remember which issues are read
 */

import { Battlestation } from "@battlestation/domain";
import { SqliteStore, loadConfig, writeSnapshot } from "@battlestation/data";
import { JiraError, connectionFromEnv, pullFromJira } from "./index.js";

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const config = loadConfig();
const store = SqliteStore.open(config.dbPath);
const app = new Battlestation({ store, onWrite: (s) => writeSnapshot(s, config.exportDir) });

try {
  const board = option("board");
  const jql = option("jql");
  if (board !== undefined || jql !== undefined) app.updateSettings("cli", { jira: { ...(board !== undefined ? { boardId: board } : {}), ...(jql !== undefined ? { jql } : {}) } });
  const connection = connectionFromEnv(process.env, app.getSettings().jira.baseUrl);
  const r = await pullFromJira(app, { connection, actor: "cli" });
  const o = app.getOverview();
  console.log(`Read from ${connection.baseUrl} for ${r.me}: ${r.added.length} new, ${r.changed.length} changed, ${r.released.length} no longer yours, ${r.sprints} sprints.`);
  console.log(`${o.inbox.length} new to you. Data in ${config.dataDir}.`);
  if (!app.getSettings().jira.boardId) console.log("No board set, so only the sprints your issues are in are known. Set one with: npm run pull -- --board <id>");
} catch (err) {
  console.error(err instanceof JiraError ? err.message : err);
  process.exitCode = 1;
} finally {
  store.close();
}
