/** Shared by the live and mock entry points. */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function version(): string {
  try {
    return (createRequire(import.meta.url)("../../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/** The built web app, if it has been built. */
export function defaultWebDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/src -> packages/api -> packages -> repo root
  const candidate = resolve(here, "..", "..", "..", "..", "apps", "web", "dist", "web", "browser");
  return existsSync(join(candidate, "index.html")) ? candidate : null;
}

export function webDir(): string | null {
  return process.env.BATTLESTATION_WEB_DIR?.trim() || defaultWebDir();
}
