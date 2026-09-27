import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Battlestation } from "@battlestation/domain";
import { SqliteStore } from "@battlestation/data";
import { createApiServer } from "../src/server.js";
import { seedScenario, mockClock } from "../src/mock-scenario.js";

const dir = mkdtempSync(join(tmpdir(), "bsj-api-"));
const webDir = join(dir, "web");
let server: Server;
let store: SqliteStore;
let port: number;
let base: string;

before(async () => {
  mkdirSync(join(webDir, "assets"), { recursive: true });
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(webDir, "assets", "app.css"), "body{}");

  store = SqliteStore.open(join(dir, "api.sqlite"));
  seedScenario(store);
  const app = new Battlestation({ store, clock: mockClock });
  server = createApiServer({ app, version: "test", staticDir: webDir, env: {} });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string) => {
  const res = await fetch(base + path);
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, type, keep: res.headers.get("cache-control") ?? "", body: type.includes("json") ? await res.json() : await res.text() };
};

const post = (path: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

/** A request that names some other host, as a page on another site would after pointing its name at this machine. */
const asOtherHost = (path: string) =>
  new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host: `evil.example:${port}` } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });

test("health and the whole picture", async () => {
  const h = await get("/api/health");
  assert.deepEqual(h.body, { ok: true, version: "test", today: "2027-03-10", mode: "live" });
  const o = (await get("/api/overview")).body;
  assert.equal(o.activeSprintId, "41");
  assert.equal(o.title, "Payments squad");
});

test("a page that is not this machine's gets nothing", async () => {
  assert.equal(await asOtherHost("/api/overview"), 421);
  assert.equal(await asOtherHost("/"), 421);
});

test("changes come only as JSON from the app's own pages", async () => {
  const key = "PAY-145";
  assert.equal((await post("/api/issues/note", { key, note: "x" }, { "content-type": "application/json", origin: "https://elsewhere.test" })).status, 403);
  assert.equal((await post("/api/issues/note", { key, note: "x" }, { "content-type": "text/plain" })).status, 403);
  assert.equal((await post("/api/issues/note", { key, note: "x" }, { "content-type": "application/json", "sec-fetch-site": "cross-site" })).status, 403);
  // Another page on this machine, on another port, is not one of ours.
  assert.equal((await post("/api/issues/note", { key, note: "x" }, { "content-type": "application/json", origin: "http://127.0.0.1:3000" })).status, 403);
  assert.equal((await post("/api/issues/note", { key, note: "x" }, { "content-type": "application/json", "sec-fetch-site": "same-site" })).status, 403);
  assert.equal((await post("/api/issues/note", [1, 2])).status, 400);
  const ok = await post("/api/issues/note", { key, note: "Wire to the new events schema" }, { "content-type": "application/json", origin: base });
  assert.equal(ok.status, 200);
  assert.equal((await get("/api/overview")).body.issues[key].note, "Wire to the new events schema");
});

test("seen, tasks, meetings and settings from the screen", async () => {
  let o = (await get("/api/overview")).body;
  assert.equal(o.inbox.length, 3);
  assert.deepEqual((await post("/api/issues/seen", { keys: ["PAY-203"] })).body, ["PAY-203"]);
  assert.equal((await post("/api/issues/seen", { all: true })).body.length, 2);
  assert.equal((await get("/api/overview")).body.inbox.length, 0);

  assert.equal((await post("/api/tasks/save", { title: "" })).status, 400);
  const t = (await post("/api/tasks/save", { title: "Check the tax rounding tests", issueKey: "PAY-144", type: "fix" })).body;
  assert.equal(t.sprintId, "41");
  assert.equal((await post("/api/tasks/status", { id: t.id, status: "doing" })).body.startedOn, "2027-03-10");
  assert.equal((await post("/api/tasks/status", { id: t.id, status: "blocked" })).status, 400);
  assert.equal((await post("/api/tasks/status", { id: t.id, status: "lost" })).status, 400);

  const e = (await post("/api/events/save", { title: "Pairing", kind: "meeting", at: "2027-03-11T13:00:00+10:00" })).body;
  assert.equal(e.number > 1, true);
  assert.equal((await post("/api/events/save", { title: "x", kind: "party" })).status, 400);
  const item = (await post("/api/events/agenda/add", { eventId: e.id, text: "Walk through PAY-146", issueKey: "PAY-146" })).body;
  assert.equal((await post("/api/events/agenda/update", { id: item.id, answer: "Done together" })).body.status, "answered");
  assert.equal((await post("/api/events/save", { id: e.id, status: "done" })).body.status, "done");

  const s = (await post("/api/settings", { capacityPoints: 18, boardId: "12" })).body;
  assert.equal(s.capacityPoints, 18);
  assert.equal((await post("/api/settings", { capacityPoints: -1 })).status, 400);

  o = (await get("/api/overview")).body;
  assert.ok(o.issues["PAY-144"].tasks.some((x: { title: string }) => x.title === "Check the tax rounding tests"));
  assert.equal((await get("/api/audit?limit=1")).body[0].actor, "bridge");
});

test("a pull with no connection says what is missing", async () => {
  const r = await post("/api/jira/pull", {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /No Jira address/);
});

test("static files, the app shell, bad addresses, and no way out of the web folder", async () => {
  const css = await get("/assets/app.css");
  assert.equal(css.status, 200);
  assert.match(css.type, /text\/css/);
  assert.equal(css.keep, "no-cache");
  const page = await fetch(base + "/");
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.match((await get("/assets/app.css?v=0123abcd")).keep, /immutable/);
  const shell = await get("/sprints");
  assert.match(shell.body, /<title>shell<\/title>/);
  assert.equal((await get("/%E0%A4%A")).status, 400);
  const escape = await get("/..%2F..%2Fapi.sqlite");
  assert.match(escape.body, /<title>shell<\/title>/);
  assert.equal((await get("/api/nothing")).status, 404);
  assert.equal((await fetch(base + "/api/overview", { method: "DELETE" })).status, 405);
});

test("a request target that is not an address is refused, and the server keeps going", async () => {
  const answer = await new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write("GET http://[/ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
    let got = "";
    socket.on("data", (d) => (got += d.toString()));
    socket.on("end", () => resolve(got));
    socket.on("error", reject);
  });
  assert.match(answer, /^HTTP\/1\.1 400/);
  assert.equal((await get("/api/health")).status, 200);
});
