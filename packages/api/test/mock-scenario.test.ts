/**
 * The mock is meant to show every kind of thing the screen can show. If a
 * change to the domain quietly drops one of them from the mock, this says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Battlestation } from "@battlestation/domain";
import { SqliteStore } from "@battlestation/data";
import { mockClock, seedScenario } from "../src/mock-scenario.js";

const store = SqliteStore.open(":memory:");
seedScenario(store);
const o = new Battlestation({ store, clock: mockClock }).getOverview();
const ids = o.signals.map((s) => s.id);

test("the sprints are where the scenario says", () => {
  assert.deepEqual(o.sprints.map((s) => `${s.sprint.id}:${s.phase}`), ["38:closed", "39:closed", "40:closed", "41:active", "42:future", "43:future"]);
  assert.deepEqual(o.velocity.sprints.map((s) => s.done), [14, 17, 15]);
  assert.equal(o.velocity.average, 15.3);
  const s41 = o.sprints[3];
  assert.equal(s41.daysLeft, 3);
  assert.deepEqual(s41.points, { committed: 20, done: 8, doing: 5, todo: 7, unestimated: 1 });
  assert.ok(s41.behind);
  assert.ok(s41.over);
});

test("every kind of signal is there to be seen", () => {
  for (const id of ["doing-PAY-141", "doing-PAY-146", "stale-PAY-141", "blocked-PAY-144", "flagged-PAY-147", "estimate-PAY-146", "estimate-PAY-203", "late-PAY-303", "behind-41", "over-41", "soon-"]) {
    assert.ok(ids.some((x) => x.startsWith(id)), `missing ${id}`);
  }
  assert.ok(ids.some((x) => x.startsWith("task-doing-")));
  assert.ok(ids.some((x) => x.startsWith("task-blocked-")));
  assert.ok(ids.some((x) => x.startsWith("park-")));
});

test("backlog, inbox, parents, tasks and meetings", () => {
  assert.deepEqual(o.backlog.map((v) => v.issue.key), ["PAY-110", "PAY-204", "PAY-303"]);
  assert.deepEqual(o.inbox.map((v) => v.issue.key).sort(), ["PAY-147", "PAY-202", "PAY-203"]);
  assert.deepEqual(Object.keys(o.parents).sort(), ["PAY-100", "PAY-200", "PAY-300"]);
  assert.equal(o.issues["PAY-141"].tasks.length, 2);
  assert.equal(o.unplaced.length, 2);
  assert.equal(o.sprints[3].tasks.length, 1);
  assert.deepEqual(o.events.map((e) => e.title), ["One-to-one with Sam", "Sprint 41 review", "Sprint 41 retro", "Sprint 42 planning", "Refinement: account settings"]);
  assert.equal(o.lastPull?.me, "Alex Rivera");
});
