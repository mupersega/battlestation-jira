/**
 * The HTTP layer for the screen. Thin: every route is one call into the
 * domain service, the same one the MCP server uses, so neither client has
 * logic the other lacks.
 *
 * It listens on this machine only and has no login, because it is for one
 * person at their own computer. Two things keep other pages in the browser
 * out: a request must name this machine as its host (so a page on another
 * site cannot reach it by pointing a name at 127.0.0.1), and a change must
 * be JSON sent from this server's own pages.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Battlestation, DomainError, EVENT_KINDS, type EventKind } from "@battlestation/domain";
import { JiraError, connectionFromEnv, pullFromJira, type FetchLike } from "@battlestation/jira";

export interface ApiOptions {
  app: Battlestation;
  version: string;
  /** Mock mode serves an invented scenario and says so, so it is never mistaken for your real work. */
  mode?: "live" | "mock";
  /** Directory holding the built web app (index.html and assets). Null serves the API only. */
  staticDir?: string | null;
  /** Where the Jira connection is read from. Replaced in tests. */
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const MAX_BODY = 64 * 1024;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

/** The host a request names, without its port. */
function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const nullableText = (v: unknown): string | null | undefined => (v === null ? null : text(v));

type Handler = (url: URL) => unknown;

export function createApiServer({ app, version, staticDir = null, mode = "live", env = process.env, fetch }: ApiOptions): Server {
  const reads = new Map<string, Handler>([
    ["/api/health", () => ({ ok: true, version, today: app.today(), mode })],
    ["/api/overview", () => app.getOverview()],
    ["/api/settings", () => app.getSettings()],
    ["/api/audit", (url) => app.listAudit(Number(url.searchParams.get("limit") ?? 50) || 50)],
  ]);

  // What the screen may change. The actor recorded in the audit trail is "bridge".
  const writes = new Map<string, (body: Record<string, unknown>) => unknown>([
    [
      "/api/issues/seen",
      (b) => {
        const keys = b.all === true ? app.getOverview().inbox.map((v) => v.issue.key) : Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === "string") : [];
        return app.markSeen("bridge", keys);
      },
    ],
    ["/api/issues/note", (b) => app.noteIssue("bridge", { key: text(b.key) ?? "", note: text(b.note) ?? "" })],
    [
      "/api/tasks/save",
      (b) =>
        app.upsertTask("bridge", {
          id: text(b.id) || undefined,
          title: text(b.title),
          description: text(b.description),
          type: text(b.type) || undefined,
          issueKey: nullableText(b.issueKey),
          sprintId: nullableText(b.sprintId),
        }),
    ],
    [
      "/api/tasks/status",
      (b) => {
        const status = text(b.status);
        if (status !== "todo" && status !== "doing" && status !== "blocked" && status !== "done") throw new DomainError("status must be todo, doing, blocked or done.");
        return app.setTaskStatus("bridge", { id: text(b.id) ?? "", status, reason: text(b.reason) });
      },
    ],
    [
      "/api/events/save",
      (b) => {
        const status = text(b.status);
        if (status !== undefined && status !== "planned" && status !== "done" && status !== "cancelled") throw new DomainError("status must be planned, done or cancelled.");
        const kind = text(b.kind);
        if (kind !== undefined && !EVENT_KINDS.includes(kind as EventKind)) throw new DomainError(`kind must be one of ${EVENT_KINDS.join(", ")}.`);
        return app.upsertEvent("bridge", { id: text(b.id) || undefined, title: text(b.title), kind: kind as EventKind | undefined, at: nullableText(b.at), status, notes: text(b.notes) });
      },
    ],
    ["/api/events/agenda/add", (b) => app.addAgendaItem("bridge", { eventId: text(b.eventId) ?? "", text: text(b.text) ?? "", issueKey: nullableText(b.issueKey) })],
    [
      "/api/events/agenda/update",
      (b) => {
        const status = text(b.status);
        if (status !== undefined && status !== "open" && status !== "answered" && status !== "dropped") throw new DomainError("status must be open, answered or dropped.");
        return app.updateAgendaItem("bridge", { id: text(b.id) ?? "", answer: nullableText(b.answer), status });
      },
    ],
    [
      "/api/settings",
      (b) =>
        app.updateSettings("bridge", {
          title: text(b.title),
          subtitle: text(b.subtitle),
          capacityPoints: b.capacityPoints === null ? null : typeof b.capacityPoints === "number" ? b.capacityPoints : undefined,
          staleAfterDays: typeof b.staleAfterDays === "number" ? b.staleAfterDays : undefined,
          jira: { boardId: nullableText(b.boardId), jql: text(b.jql) },
        }),
    ],
  ]);

  const root = staticDir ? resolve(staticDir) : null;

  // A browser may keep a file only when the file's address changes whenever the file does:
  // the built bundles carry a mark in their names, the pictures carry one after a question mark.
  const KEEPABLE = /(-[A-Z0-9]{8}\.[a-z0-9]+$)|(\?v=[0-9a-f]{8}$)/;

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string, search: string): void {
    if (!root || !existsSync(join(root, "index.html"))) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("The web app is not built. Run `npm run build:web`, then restart. The API is available under /api.\n");
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad address.\n");
      return;
    }
    const wanted = normalize(join(root, decoded));
    const inside = wanted === root || wanted.startsWith(root + sep);
    const isFile = inside && existsSync(wanted) && statSync(wanted).isFile();
    // Anything that is not a real file is a route inside the app: serve the app shell.
    const file = isFile ? wanted : join(root, "index.html");
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": isFile && file !== join(root, "index.html") && KEEPABLE.test(file + search) ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
    });
    if (req.method === "HEAD") res.end();
    else
      createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
  }

  /**
   * A change is JSON from this server's own pages: an origin with the same
   * host and port, and a browser that says the request is from the same
   * origin. Another page on this machine, on another port, is not one.
   */
  function fromOwnPage(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    let sameOrigin = !origin;
    if (origin) {
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
    }
    const site = req.headers["sec-fetch-site"];
    return sameOrigin && (site === undefined || site === "same-origin" || site === "none") && (req.headers["content-type"] ?? "").includes("application/json");
  }

  return createServer((req, res) => {
    // Only a request that names this machine is answered.
    if (!LOCAL_HOSTS.has(hostOf(req.headers.host) ?? "")) return sendJson(res, 421, { error: "This server answers only to localhost." });

    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return sendJson(res, 400, { error: "Bad address." });
    }
    const isApi = url.pathname.startsWith("/api/");

    // Reading from Jira takes time, so it is the one change that answers later.
    if (req.method === "POST" && url.pathname === "/api/jira/pull") {
      if (!fromOwnPage(req)) return sendJson(res, 403, { error: "Changes are accepted only as JSON from the Battlestation's own pages." });
      if (mode === "mock") return sendJson(res, 400, { error: "The mock has no Jira to read from." });
      let connection;
      try {
        connection = connectionFromEnv(env);
      } catch (err) {
        return sendJson(res, 400, { error: (err as Error).message });
      }
      pullFromJira(app, { connection, fetch, actor: "bridge" }).then(
        (r) => sendJson(res, 200, r),
        (err) => {
          if (err instanceof JiraError || err instanceof DomainError) return sendJson(res, 502, { error: err.message });
          console.error("[battlestation] pull error:", err);
          sendJson(res, 500, { error: "The pull failed. See the server log." });
        },
      );
      return;
    }

    if (req.method === "POST" && writes.has(url.pathname)) {
      if (!fromOwnPage(req)) return sendJson(res, 403, { error: "Changes are accepted only as JSON from the Battlestation's own pages." });
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
      });
      req.on("end", () => {
        if (size > MAX_BODY) return sendJson(res, 413, { error: "Too large." });
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new DomainError("Send an object.");
          sendJson(res, 200, writes.get(url.pathname)!(parsed as Record<string, unknown>));
        } catch (err) {
          if (err instanceof DomainError) return sendJson(res, 400, { error: err.message });
          if (err instanceof SyntaxError) return sendJson(res, 400, { error: "The request was not valid JSON." });
          console.error("[battlestation] api error:", err);
          sendJson(res, 500, { error: "Internal error. See the server log." });
        }
      });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET, HEAD");
      return sendJson(res, 405, { error: "Not something the screen can change. Other changes go through the MCP tools." });
    }

    if (!isApi) return serveStatic(req, res, url.pathname, url.search);

    const read = reads.get(url.pathname);
    if (!read) return sendJson(res, 404, { error: `No such endpoint: ${url.pathname}` });
    try {
      return sendJson(res, 200, read(url));
    } catch (err) {
      if (err instanceof DomainError) return sendJson(res, 404, { error: err.message });
      console.error("[battlestation] api error:", err);
      return sendJson(res, 500, { error: "Internal error. See the server log." });
    }
  });
}
