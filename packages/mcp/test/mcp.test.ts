/**
 * Drives the built server the way an agent's client would: spawn
 * dist/src/index.js over stdio and call tools with the SDK client.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Battlestation } from "@battlestation/domain";
import { SqliteStore } from "@battlestation/data";

const dataDir = mkdtempSync(join(tmpdir(), "bsj-mcp-"));
const serverEntry = fileURLToPath(new URL("../src/index.js", import.meta.url));

let client: Client;

const textOf = (r: unknown): string => {
  const c = (r as { content: Array<{ type: string; text?: string }> }).content;
  return c.map((x) => x.text ?? "").join("\n");
};
const jsonOf = <T = any>(r: unknown): T => JSON.parse(textOf(r)) as T;
const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

before(async () => {
  // Some issues and a sprint, as a pull would have left them.
  const store = SqliteStore.open(join(dataDir, "battlestation.sqlite"));
  const app = new Battlestation({ store });
  app.recordPull("pull", {
    me: "Me",
    sprints: [{ id: "41", name: "ABC Sprint 41", state: "active", startDate: "2026-10-05", endDate: "2026-10-16", completeDate: null, goal: "Ship checkout", boardId: "7", fetchedAt: "x" }],
    issues: [
      {
        key: "ABC-1",
        url: "https://example.atlassian.net/browse/ABC-1",
        summary: "Checkout button",
        type: "Story",
        subtask: false,
        status: "In Progress",
        statusCategory: "doing",
        priority: null,
        points: 3,
        assignee: "Me",
        assignedToMe: true,
        reporter: null,
        sprintIds: ["41"],
        parent: null,
        labels: [],
        description: "",
        created: "2026-10-01T09:00:00.000+1000",
        updated: "2026-10-02T09:00:00.000+1000",
        resolved: null,
        due: null,
        started: "2026-10-06T09:00:00.000+1000",
        flagged: false,
        links: [],
        comments: [],
        fetchedAt: "x",
      },
    ],
  });
  store.close();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--no-warnings=ExperimentalWarning", serverEntry],
    env: { ...process.env, BATTLESTATION_DATA_DIR: dataDir, JIRA_BASE_URL: "", JIRA_PAT: "", JIRA_EMAIL: "", JIRA_API_TOKEN: "" } as Record<string, string>,
    stderr: "pipe",
  });
  client = new Client({ name: "bsj-test", version: "0.0.0" });
  await client.connect(transport);
});

after(async () => {
  await client.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("the tools, in a stable order", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["get_today", "get_overview", "list_issues", "get_issue", "list_sprints", "pull_jira", "mark_seen", "note_issue", "list_tasks", "upsert_task", "set_task_status", "list_events", "upsert_event", "add_agenda_item", "update_agenda_item", "get_settings", "update_settings", "list_audit", "export_json"],
  );
  for (const t of tools) assert.ok(t.annotations, `${t.name} says whether it changes anything`);
});

test("today tells the sprint, what is in hand, and what is new", async () => {
  const t = textOf(await call("get_today"));
  assert.match(t, /## ABC Sprint 41 \(active/);
  assert.match(t, /Goal: Ship checkout/);
  assert.match(t, /ABC-1 Checkout button/);
  assert.match(t, /## New to you \(1\)/);
  const j = jsonOf(await call("get_today", { format: "json" }));
  assert.equal(j.sprint.sprint.id, "41");
});

test("issues, notes and seen", async () => {
  assert.match(textOf(await call("list_issues", { where: "active" })), /ABC-1/);
  assert.equal(textOf(await call("list_issues", { where: "backlog" })), "(none)");
  await call("note_issue", { key: "abc-1", note: "Check the mobile layout" });
  assert.equal(jsonOf(await call("get_issue", { key: "ABC-1" })).note, "Check the mobile layout");
  assert.deepEqual(jsonOf(await call("mark_seen", { all: true })), ["ABC-1"]);
  assert.doesNotMatch(textOf(await call("get_today")), /New to you/);
  const missing = await call("get_issue", { key: "ABC-99" });
  assert.equal(missing.isError, true);
});

test("tasks and meetings through the tools, and every change is on the record", async () => {
  const t = jsonOf(await call("upsert_task", { title: "Write the test", issue_key: "ABC-1" }));
  assert.equal(t.sprintId, "41");
  assert.equal(jsonOf(await call("set_task_status", { id: "T-1", status: "doing" })).status, "doing");
  const refused = await call("set_task_status", { id: t.id, status: "blocked" });
  assert.equal(refused.isError, true);
  const e = jsonOf(await call("upsert_event", { title: "Sprint 42 planning", kind: "planning", at: "2026-10-19T10:00:00+10:00" }));
  const item = jsonOf(await call("add_agenda_item", { event_id: e.id, text: "Carry over ABC-1?", issue_key: "ABC-1" }));
  assert.equal(jsonOf(await call("update_agenda_item", { id: item.id, answer: "Yes" })).status, "answered");
  const audit = jsonOf<Array<{ actor: string; action: string }>>(await call("list_audit", { limit: 3 }));
  assert.equal(audit[0].action, "update_agenda_item");
  assert.match(audit[0].actor, /^mcp/);
  assert.ok(existsSync(join(dataDir, "export", "battlestation.json")));
});

test("settings, and a pull with no connection says what is missing", async () => {
  const s = jsonOf(await call("update_settings", { title: "Payments", capacity_points: 10, board_id: "7" }));
  assert.equal(s.title, "Payments");
  assert.equal(s.jira.boardId, "7");
  const r = await call("pull_jira");
  assert.equal(r.isError, true);
  assert.match(textOf(r), /No Jira address/);
});
