import { test } from "node:test";
import assert from "node:assert/strict";
import { Battlestation, deriveOverview, DEFAULT_SETTINGS, sprintRef } from "../src/index.js";
import { MemoryStore, issue, sprint } from "./memory-store.js";

// Wednesday 14 October 2026, in the middle of sprint 41.
const clock = { now: () => new Date("2026-10-14T10:00:00+10:00") };

function setup() {
  const store = new MemoryStore();
  const app = new Battlestation({ store, clock });
  store.saveSettings({ ...DEFAULT_SETTINGS, title: "Team", capacityPoints: 10 });
  store.saveSprint(sprint("40", { state: "closed", startDate: "2026-09-21", endDate: "2026-10-02", completeDate: "2026-10-02" }));
  store.saveSprint(sprint("41", { state: "active", startDate: "2026-10-05", endDate: "2026-10-16" }));
  store.saveSprint(sprint("42", { state: "future", startDate: "2026-10-19", endDate: "2026-10-30" }));
  return { store, app };
}

test("sprints carry your points, and a closed sprint's done points are its velocity", () => {
  const { store, app } = setup();
  store.saveIssue(issue("T-1", { sprintIds: ["40"], statusCategory: "done", status: "Done", points: 5, resolved: "2026-10-01T10:00:00+10:00" }));
  store.saveIssue(issue("T-2", { sprintIds: ["40", "41"], statusCategory: "doing", status: "In Progress", points: 3, started: "2026-10-06T10:00:00+10:00" }));
  store.saveIssue(issue("T-3", { sprintIds: ["41"], statusCategory: "done", status: "Done", points: 2 }));
  store.saveIssue(issue("T-4", { sprintIds: ["41"], points: null }));
  store.saveIssue(issue("T-5", { sprintIds: ["41"], assignedToMe: false, assignee: "Someone else", points: 8 }));
  const o = app.getOverview();
  const [s40, s41, s42] = o.sprints;
  assert.deepEqual(o.sprints.map((s) => s.phase), ["closed", "active", "future"]);
  assert.equal(o.activeSprintId, "41");
  assert.deepEqual(s40.points, { committed: 5, done: 5, doing: 0, todo: 0, unestimated: 0 });
  assert.deepEqual(s41.points, { committed: 5, done: 2, doing: 3, todo: 0, unestimated: 1 });
  assert.deepEqual(s41.issues.map((v) => v.issue.key), ["T-2", "T-4", "T-3"], "open first, not someone else's");
  assert.equal(s41.days, 10);
  assert.equal(s41.daysLeft, 3, "Wed, Thu, Fri");
  assert.equal(s42.issues.length, 0);
  assert.deepEqual(o.velocity, { sprints: [{ sprintId: "40", name: "Team Sprint 40", done: 5 }], average: 5 });
  assert.equal(o.refs["sprint:41"], "S41");
  assert.equal(sprintRef(sprint("9", { name: "Planning board" })), "Planning board");
});

test("what is in progress is in hand, and what has sat there too long is called out", () => {
  const { store, app } = setup();
  store.saveIssue(issue("T-2", { sprintIds: ["41"], statusCategory: "doing", status: "In Review", started: "2026-10-05T10:00:00+10:00" }));
  const o = app.getOverview();
  const v = o.issues["T-2"];
  assert.equal(v.daysInProgress, 7);
  assert.ok(v.stale);
  const work = o.signals.filter((s) => s.level === "work");
  assert.equal(work.length, 1);
  assert.equal(work[0].text, "In Review, 7 working days");
  assert.ok(o.signals.some((s) => s.id === "stale-T-2"));
  assert.equal(o.lifecycles["issue:T-2"].now, "in review");
});

test("blocked, flagged, unestimated and late issues each say so", () => {
  const { store, app } = setup();
  store.saveIssue(
    issue("T-6", {
      sprintIds: ["41"],
      flagged: true,
      points: null,
      due: "2026-10-12",
      links: [
        { key: "OPS-1", summary: "Open the firewall", statusCategory: "todo", direction: "blocked_by", label: "is blocked by" },
        { key: "OPS-2", summary: "Old blocker", statusCategory: "done", direction: "blocked_by", label: "is blocked by" },
      ],
    }),
  );
  const o = app.getOverview();
  const ids = o.signals.filter((s) => s.ref.id === "T-6").map((s) => s.id);
  assert.deepEqual(ids.sort(), ["blocked-T-6", "estimate-T-6", "flagged-T-6", "late-T-6"]);
  assert.equal(o.issues["T-6"].blockedBy.length, 1, "a done blocker no longer blocks");
  assert.equal(o.signals[0].level, "critical", "late comes first");
  assert.equal(o.lifecycles["issue:T-6"].now, "planned, flagged");
});

test("a sprint that is over capacity, behind, or nearly over says so", () => {
  const { store, app } = setup();
  store.saveIssue(issue("T-7", { sprintIds: ["41"], points: 8 }));
  store.saveIssue(issue("T-8", { sprintIds: ["41"], points: 5 }));
  store.saveIssue(issue("T-9", { sprintIds: ["42"], points: 13 }));
  const o = app.getOverview();
  const ids = o.signals.map((s) => s.id);
  assert.ok(ids.includes("over-41"));
  assert.ok(ids.includes("over-42"));
  assert.ok(ids.includes("behind-41"), "nothing done with seven of ten days gone");
  assert.ok(!ids.includes("ending-41"), "three days left is not yet the end");
  // Two working days left: Thursday.
  const later = new Battlestation({ store, clock: { now: () => new Date("2026-10-15T10:00:00+10:00") } }).getOverview();
  const ending = later.signals.find((s) => s.id === "ending-41");
  assert.ok(ending);
  assert.equal(ending.text, "Ends Fri 16 Oct, 13 pts not done");
  assert.equal(later.sprints[1].expected, 10.4);
  assert.ok(later.sprints[1].behind);
  assert.equal(later.lifecycles["sprint:41"].now, "active, behind");
});

test("the next sprint is announced a few days before it starts", () => {
  const { store } = setup();
  store.saveIssue(issue("T-9", { sprintIds: ["42"], points: 5 }));
  const friday = new Battlestation({ store, clock: { now: () => new Date("2026-10-16T10:00:00+10:00") } }).getOverview();
  const next = friday.signals.find((s) => s.id === "next-42");
  assert.ok(next);
  assert.equal(next.text, "Starts Mon 19 Oct, 5 pts planned");
});

test("backlog, inbox and seen", () => {
  const { store, app } = setup();
  store.saveIssue(issue("T-10", { sprintIds: [], updated: "2026-10-13T10:00:00.000+10:00" }));
  store.saveIssue(issue("T-11", { sprintIds: ["40"], statusCategory: "todo" }));
  store.saveIssue(issue("T-12", { sprintIds: ["41"] }));
  let o = app.getOverview();
  assert.deepEqual(o.backlog.map((v) => v.issue.key), ["T-10", "T-11"], "no sprint, or left behind in a closed one");
  assert.equal(o.inbox.length, 3);
  assert.equal(o.inbox[0].issue.key, "T-10", "most recently changed first");
  app.markSeen("test", ["T-10", "T-12"]);
  o = app.getOverview();
  assert.deepEqual(o.inbox.map((v) => v.issue.key), ["T-11"]);
  store.saveIssue(issue("T-10", { updated: "2026-10-14T09:00:00.000+10:00" }));
  assert.deepEqual(app.getOverview().inbox.map((v) => v.issue.key), ["T-10", "T-11"], "changed since seen is new again");
});

test("epics and parents gather their issues", () => {
  const o = deriveOverview({
    today: "2026-10-14",
    settings: DEFAULT_SETTINGS,
    issues: [issue("A-1", { parent: { key: "A-100", summary: "Checkout", type: "Epic" } }), issue("A-2", { parent: { key: "A-100", summary: "Checkout", type: "Epic" } })],
    sprints: [],
    notes: [],
    tasks: [],
    events: [],
    agendaByEvent: () => [],
    lastPull: null,
  });
  assert.deepEqual(o.parents["A-100"], { key: "A-100", summary: "Checkout", type: "Epic", issueKeys: ["A-1", "A-2"] });
});
