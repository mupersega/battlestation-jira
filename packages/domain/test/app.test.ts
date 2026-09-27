import { test } from "node:test";
import assert from "node:assert/strict";
import { Battlestation, DomainError } from "../src/index.js";
import { MemoryStore, issue, sprint } from "./memory-store.js";

const clock = { now: () => new Date("2026-10-14T10:00:00+10:00") };

function setup() {
  const store = new MemoryStore();
  const writes: number[] = [];
  const app = new Battlestation({ store, clock, onWrite: () => writes.push(1) });
  store.saveSprint(sprint("41", { state: "active", startDate: "2026-10-05", endDate: "2026-10-16" }));
  store.saveSprint(sprint("42", { state: "future", startDate: "2026-10-19", endDate: "2026-10-30" }));
  store.saveIssue(issue("ABC-1", { sprintIds: ["41"] }));
  return { store, app, writes };
}

test("a task can serve an issue, and follows it into its sprint", () => {
  const { store, app } = setup();
  const t = app.upsertTask("test", { title: "Write the migration", issueKey: "abc-1" });
  assert.equal(t.number, 1);
  assert.equal(t.issueKey, "ABC-1");
  assert.equal(t.sprintId, "41");
  assert.equal(t.type, "build");
  const free = app.upsertTask("test", { title: "Read the RFC", sprintId: "42", type: "research" });
  assert.equal(free.sprintId, "42");
  assert.equal(app.requireTask("T-2").id, free.id);
  assert.throws(() => app.upsertTask("test", { title: "x", type: "nonsense" }), DomainError);
  assert.throws(() => app.upsertTask("test", { title: "x", issueKey: "not a key" }), DomainError);
  assert.throws(() => app.upsertTask("test", { title: "x", sprintId: "99" }), /No sprint 99/);
  assert.throws(() => app.upsertTask("test", { title: "  " }), /needs a title/);
  assert.equal(store.audit.at(-1)?.action, "upsert_task");
  assert.equal(app.getOverview().issues["ABC-1"].tasks.length, 1);
});

test("moving a task records when it started and finished, and a block needs a reason", () => {
  const { app } = setup();
  const t = app.upsertTask("test", { title: "Wire it up" });
  assert.equal(app.setTaskStatus("test", { id: t.id, status: "doing" }).startedOn, "2026-10-14");
  assert.throws(() => app.setTaskStatus("test", { id: t.id, status: "blocked" }), /blocking/);
  const blocked = app.setTaskStatus("test", { id: t.id, status: "blocked", reason: "Waiting on access" });
  assert.equal(blocked.blockedBy, "Waiting on access");
  assert.ok(app.getOverview().signals.some((s) => s.id === `task-blocked-${t.id}`));
  const done = app.setTaskStatus("test", { id: t.id, status: "done", on: "2026-10-15" });
  assert.equal(done.doneOn, "2026-10-15");
  assert.equal(done.blockedBy, "");
  assert.equal(app.setTaskStatus("test", { id: t.id, status: "todo" }).startedOn, null, "back in the queue is not started");
});

test("meetings and their agendas", () => {
  const { app } = setup();
  const e = app.upsertEvent("test", { title: "Sprint 42 planning", kind: "planning", at: "2026-10-19T10:00:00+10:00" });
  assert.equal(e.number, 1);
  assert.throws(() => app.upsertEvent("test", { title: "x", kind: "party" as never }), DomainError);
  assert.throws(() => app.upsertEvent("test", { id: e.id, at: "next week" }), DomainError);
  const item = app.addAgendaItem("test", { eventId: "E-1", text: "Who owns the flaky test?", issueKey: "abc-1" });
  assert.equal(item.issueKey, "ABC-1");
  assert.throws(() => app.addAgendaItem("test", { eventId: e.id, text: "  " }), /Write the point/);
  const answered = app.updateAgendaItem("test", { id: item.id, answer: "Platform team" });
  assert.equal(answered.status, "answered");
  assert.equal(app.getEvent(e.id)?.agenda.length, 1);
  app.upsertEvent("test", { id: e.id, status: "done" });
  assert.equal(app.listEvents().length, 0);
  assert.equal(app.listEvents(true).length, 1);
});

test("notes on issues stay here, and an unknown issue is refused", () => {
  const { app } = setup();
  assert.equal(app.noteIssue("test", { key: "abc-1", note: " Ask about the edge case. " }).note, "Ask about the edge case.");
  assert.equal(app.getIssue("ABC-1").note, "Ask about the edge case.");
  assert.throws(() => app.noteIssue("test", { key: "ABC-9", note: "x" }), /No issue ABC-9/);
  assert.throws(() => app.markSeen("test", ["ABC-9"]), /No issue ABC-9/);
});

test("a pull replaces copies, moves tasks with their issue, and releases what is no longer yours", () => {
  const { store, app } = setup();
  store.saveIssue(issue("ABC-2", { sprintIds: ["41"] }));
  const t = app.upsertTask("test", { title: "Sub-step", issueKey: "ABC-1" });
  const r = app.recordPull("pull", {
    issues: [issue("ABC-1", { sprintIds: ["41", "42"], updated: "2026-10-14T09:00:00.000+10:00" }), issue("ABC-3")],
    sprints: [sprint("41", { state: "active", startDate: "2026-10-05", endDate: "2026-10-16" })],
    me: "Me",
  });
  assert.deepEqual(r, { added: ["ABC-3"], changed: ["ABC-1"], released: ["ABC-2"], sprints: 1 });
  assert.equal(app.requireTask(t.id).sprintId, "42");
  assert.equal(store.getIssue("ABC-2")?.assignedToMe, false);
  assert.equal(app.getOverview().lastPull?.issues, 2);
  assert.equal(store.audit.at(-1)?.detail, "1 new, 1 changed, 1 released");
});

test("settings are checked before they are kept", () => {
  const { app, writes } = setup();
  const s = app.updateSettings("test", { title: "Payments team", capacityPoints: 12, jira: { baseUrl: "https://example.atlassian.net/", boardId: "7" } });
  assert.equal(s.jira.baseUrl, "https://example.atlassian.net");
  assert.equal(s.jira.boardId, "7");
  assert.equal(s.jira.jql, "", "untouched fields are kept");
  assert.throws(() => app.updateSettings("test", { capacityPoints: 0 }), DomainError);
  assert.throws(() => app.updateSettings("test", { staleAfterDays: 1.5 }), DomainError);
  assert.throws(() => app.updateSettings("test", { taskTypes: [" "] }), DomainError);
  assert.throws(() => app.updateSettings("test", { jira: { baseUrl: "http://example.com" } }), /https/);
  assert.equal(app.updateSettings("test", { taskTypes: ["a", "a", "b"] }).taskTypes.join(), "a,b");
  assert.ok(writes.length >= 2);
});

test("a failed change leaves nothing behind", () => {
  const { store, app } = setup();
  const before = store.audit.length;
  assert.throws(() => app.upsertEvent("test", { id: "nope" }));
  assert.equal(store.audit.length, before);
});
