/**
 * Where a thing is in its life. Every kind of object moves through a short,
 * fixed run of stages; this says which are behind it, which one it is in,
 * and whether that one is in trouble. Derived from stored facts.
 */

import { compareDates, datePart, dateIn, type ISODate } from "./dates.js";
import type { IssueSnapshot, SprintSnapshot } from "./jira.js";
import type { Event, Task } from "./types.js";

export type StageState = "done" | "current" | "trouble" | "ahead";

export interface Stage {
  key: string;
  label: string;
  state: StageState;
  /** When it was reached, or when it is due, if known. */
  date: ISODate | null;
}

export interface Lifecycle {
  stages: Stage[];
  /** The stage it is in, in words: "in progress", "in progress, blocked". */
  now: string;
}

type Draft = { key: string; label: string; date?: ISODate | null };

/**
 * `at` is the stage the thing is in now: the last one it has reached. The
 * stages before it are done, and the ones after are still ahead, so a lit
 * stage always means "this is where it is", never "this is what comes next".
 * `at` past the end means every stage is done.
 */
function run(drafts: Draft[], at: number, trouble = false, now?: string): Lifecycle {
  const stages: Stage[] = drafts.map((d, i) => ({
    key: d.key,
    label: d.label,
    state: i < at ? "done" : i === at ? (trouble ? "trouble" : "current") : "ahead",
    date: d.date ?? null,
  }));
  const current = stages[Math.min(at, stages.length - 1)];
  return { stages, now: now ?? current.label };
}

export function taskLifecycle(t: Task): Lifecycle {
  const drafts: Draft[] = [
    { key: "queued", label: "queued", date: datePart(t.createdAt) },
    { key: "doing", label: "in hand", date: t.startedOn },
    { key: "done", label: "done", date: t.doneOn },
  ];
  switch (t.status) {
    case "todo":
      return run(drafts, 0);
    case "doing":
      return run(drafts, 1);
    case "blocked":
      return run(drafts, t.startedOn ? 1 : 0, true, t.startedOn ? "in hand, blocked" : "queued, blocked");
    case "done":
      return run(drafts, 3, false, "done");
    case "dropped":
      return run(drafts, t.startedOn ? 1 : 0, true, "dropped");
  }
}

export function issueLifecycle(input: { issue: IssueSnapshot; sprintStart: ISODate | null; blocked: boolean }): Lifecycle {
  const { issue: i } = input;
  const drafts: Draft[] = [
    { key: "raised", label: "raised", date: datePart(i.created) },
    { key: "planned", label: "in a sprint", date: input.sprintStart },
    { key: "doing", label: "in progress", date: i.started ? datePart(i.started) : null },
    { key: "done", label: "done", date: i.resolved ? datePart(i.resolved) : null },
  ];
  const trouble = input.blocked || i.flagged;
  const why = i.flagged ? "flagged" : "blocked";
  if (i.statusCategory === "done") return run(drafts, 4, false, i.status.toLowerCase());
  if (i.statusCategory === "doing") return run(drafts, 2, trouble, trouble ? `${i.status.toLowerCase()}, ${why}` : i.status.toLowerCase());
  const planned = i.sprintIds.length > 0;
  return run(drafts, planned ? 1 : 0, trouble, `${planned ? "planned" : "in the backlog"}${trouble ? `, ${why}` : ""}`);
}

export function sprintLifecycle(s: SprintSnapshot, behind: boolean): Lifecycle {
  const drafts: Draft[] = [
    { key: "planned", label: "planned", date: null },
    { key: "active", label: "active", date: s.startDate },
    { key: "closed", label: "closed", date: s.completeDate ?? s.endDate },
  ];
  if (s.state === "closed") return run(drafts, 3, false, "closed");
  if (s.state === "active") return run(drafts, 1, behind, behind ? "active, behind" : "active");
  return run(drafts, 0, false, s.startDate ? "planned" : "planned, no dates yet");
}

export function eventLifecycle(e: Event, today: ISODate): Lifecycle {
  const drafts: Draft[] = [
    { key: "agreed", label: "agreed", date: datePart(e.createdAt) },
    { key: "booked", label: "booked", date: e.at ? dateIn(e.at) : null },
    { key: "happened", label: "happened", date: e.status === "done" && e.at ? dateIn(e.at) : null },
  ];
  if (e.status === "cancelled") return run(drafts, e.at ? 1 : 0, true, "cancelled");
  if (e.status === "done") return run(drafts, 3, false, "happened");
  if (!e.at) return run(drafts, 0, false, "agreed, no date yet");
  const passed = compareDates(dateIn(e.at) ?? datePart(e.at), today) < 0;
  return run(drafts, 1, passed, passed ? "date passed, not recorded as happened" : "booked");
}
