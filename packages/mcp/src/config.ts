import { createRequire } from "node:module";

export { loadConfig, type Config } from "@battlestation/data";

export function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("../../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}
