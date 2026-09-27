import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Battlestation, DEFAULT_SETTINGS, type IssueSnapshot } from "@battlestation/domain";
import { SqliteStore, loadConfig, writeSnapshot } from "../src/index.js";

const issue: IssueSnapshot = {
  key: "ABC-1",
  url: "https://example.atlassian.net/browse/ABC-1",
  summary: "Checkout button",
  type: "Story",
  subtask: false,
  status: "In Progress",
  statusCategory: "doing",
  priority: "High",
  points: 3,
  assignee: "Me",
  assignedToMe: true,
  reporter: null,
  sprintIds: ["41"],
  parent: { key: "ABC-100", summary: "Checkout", type: "Epic" },
  labels: ["web"],
  description: "Done means: it works.",
  created: "2026-10-01T09:00:00.000+1000",
  updated: "2026-10-02T09:00:00.000+1000",
  resolved: null,
  due: null,
  started: "2026-10-02T09:00:00.000+1000",
  flagged: false,
  links: [],
  comments: [{ author: "Sam", at: "2026-10-02T10:00:00.000+1000", body: "Looks good" }],
  fetchedAt: "2026-10-03T00:00:00.000Z",
};

test("everything kept comes back as it went in, across a reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "bsj-store-"));
  try {
    const file = join(dir, "db.sqlite");
    let store = SqliteStore.open(file);
    const app = new Battlestation({ store, clock: { now: () => new Date("2026-10-14T10:00:00+10:00") } });
    assert.deepEqual(store.getSettings(), DEFAULT_SETTINGS);
    app.updateSettings("test", { title: "Team", jira: { boardId: "7" } });
    app.recordPull("pull", {
      issues: [issue],
      sprints: [{ id: "41", name: "S 41", state: "active", startDate: "2026-10-05", endDate: "2026-10-16", completeDate: null, goal: "Ship", boardId: "7", fetchedAt: "x" }],
      me: "Me",
    });
    const t = app.upsertTask("test", { title: "Step one", issueKey: "ABC-1" });
    app.setTaskStatus("test", { id: t.id, status: "doing" });
    const e = app.upsertEvent("test", { title: "Planning", kind: "planning" });
    app.addAgendaItem("test", { eventId: e.id, text: "Capacity", issueKey: "ABC-1" });
    app.noteIssue("test", { key: "ABC-1", note: "Mine" });
    app.markSeen("test", ["ABC-1"]);
    const before = store.snapshot();
    store.close();

    store = SqliteStore.open(file);
    const after = store.snapshot();
    assert.deepEqual({ ...after, exportedAt: "" }, { ...before, exportedAt: "" });
    assert.deepEqual(store.getIssue("ABC-1"), issue);
    assert.equal(store.getSettings().jira.boardId, "7");
    assert.equal(store.getSettings().jira.jql, "");
    assert.equal(store.listTasks()[0].sprintId, "41");
    assert.equal(store.nextNumber("task"), 2);
    assert.equal(store.listAudit(1)[0].action, "mark_seen");
    store.close();

    const out = writeSnapshot(after, join(dir, "export"));
    assert.equal(JSON.parse(readFileSync(out, "utf8")).issues[0].key, "ABC-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed change is rolled back, nested or not", () => {
  const store = SqliteStore.open(":memory:");
  assert.throws(() =>
    store.transaction(() => {
      store.saveNote({ key: "A-1", note: "x", seenUpdated: null, updatedAt: "t" });
      store.transaction(() => {
        store.saveNote({ key: "A-2", note: "y", seenUpdated: null, updatedAt: "t" });
      });
      throw new Error("no");
    }),
  );
  assert.equal(store.listNotes().length, 0);
  store.close();
});

test("the data directory comes from the environment, or a default", () => {
  assert.equal(loadConfig({ BATTLESTATION_DATA_DIR: join(tmpdir(), "x") }).source, "env");
  const d = loadConfig({});
  assert.equal(d.source, "default");
  assert.ok(d.dataDir.endsWith(".battlestation-jira"));
});
