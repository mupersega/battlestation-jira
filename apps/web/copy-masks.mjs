// The mask images live in the design package. Angular only serves files from
// inside this app, so they are copied into public/masks before a build.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../packages/design/src/masks", import.meta.url));
const to = fileURLToPath(new URL("./public/masks", import.meta.url));
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
