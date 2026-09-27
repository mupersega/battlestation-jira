/**
 * Where the data lives. The data directory is outside the code repository
 * (it holds copies of your issues and your own notes). Set
 * BATTLESTATION_DATA_DIR; the default is ~/.battlestation-jira. Shared by
 * the MCP server and the HTTP API so both always open the same database.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Config {
  dataDir: string;
  dbPath: string;
  exportDir: string;
  source: "env" | "default";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const fromEnv = env.BATTLESTATION_DATA_DIR?.trim();
  const dataDir = resolve(fromEnv || join(homedir(), ".battlestation-jira"));
  return {
    dataDir,
    dbPath: join(dataDir, "battlestation.sqlite"),
    exportDir: join(dataDir, "export"),
    source: fromEnv ? "env" : "default",
  };
}
