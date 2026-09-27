/**
 * Everything at once, with every object tied to what it belongs to. This is
 * what the bridge draws: sprints with your issues in them, each issue with
 * what blocks it and your own tasks under it, the backlog, your meetings,
 * and signals that point at the object they are about.
 *
 * Derived, never stored.
 */

import { addDays, compareDates, compareMoments, datePart, dateIn, diffDays, sayDate, workingDaysBetween, type ISODate } from "./dates.js";
import { currentSprintId, type IssueLinkView, type IssueSnapshot, type SprintSnapshot, type SprintState } from "./jira.js";
import { eventLifecycle, issueLifecycle, sprintLifecycle, taskLifecycle, type Lifecycle } from "./lifecycle.js";
import type { AgendaItem, Event, IssueNote, PullRecord, Settings, Task } from "./types.js";

export type RefType = "sprint" | "issue" | "task" | "event" | "board";

export interface Ref {
  type: RefType;
  id: string;
}

/** "work" is what is being worked on now; the rest are things that want a decision or an action. */
export type SignalLevel = "work" | "critical" | "warning" | "info";

/**
 * A standing condition on one object: something in hand, or something that
 * wants a decision or an action. Not a message. It is worked out from the
 * facts every time, so it appears when the condition holds and goes when
 * the thing is dealt with; there is nothing to mark as read.
 */
export interface Signal {
  id: string;
  level: SignalLevel;
  /** The thing it is about, by name. */
  subject: string;
  /** What is the case with it, short enough to read at a glance. */
  text: string;
  /** What to do about it. */
  next: string;
  /** Words to give an agent to get it done, when there are any. */
  say: string | null;
  ref: Ref;
  /** Where it sits in time, when it has a date. */
  date: ISODate | null;
}

export interface IssueView {
  issue: IssueSnapshot;
  /** Your private note on it. */
  note: string;
  /** New to you, or changed in Jira since you last marked it seen. */
  fresh: boolean;
  /** Issues that block it and are not done yet. */
  blockedBy: IssueLinkView[];
  /** Issues it blocks. */
  blocks: IssueLinkView[];
  /** Your own tasks under it, in order. Dropped tasks are left out. */
  tasks: Task[];
  /** Working days since it went into progress, while it is in progress. */
  daysInProgress: number | null;
  /** In progress for longer than the settings allow. */
  stale: boolean;
}

export interface Points {
  /** Every estimated point of yours in the sprint. */
  committed: number;
  done: number;
  doing: number;
  todo: number;
  /** Issues of yours in the sprint with no estimate. */
  unestimated: number;
}

export interface SprintOverview {
  sprint: SprintSnapshot;
  phase: SprintState;
  /** Your issues whose sprint this is now, open first, then by key. */
  issues: IssueView[];
  /** Your own tasks planned for it that serve no issue. */
  tasks: Task[];
  points: Points;
  /** Working days left, today included, while it is active. */
  daysLeft: number | null;
  /** Working days in it. */
  days: number | null;
  /** Points that would be done by today on a straight line from start to end, while active. */
  expected: number | null;
  /** Done is well short of where a straight line says it should be. */
  behind: boolean;
  /** Committed points over your capacity. */
  over: boolean;
}

export interface Overview {
  today: ISODate;
  title: string;
  subtitle: string;
  /** The Jira site, for opening things there. */
  jiraUrl: string | null;
  sprints: SprintOverview[];
  activeSprintId: string | null;
  /** Your open issues that are in no sprint that is still to run. */
  backlog: IssueView[];
  /** New to you or changed since you last looked. */
  inbox: IssueView[];
  /** Every issue read, by key. */
  issues: Record<string, IssueView>;
  /** The epics and parents your issues sit under, by key. */
  parents: Record<string, { key: string; summary: string; type: string; issueKeys: string[] }>;
  /** Your own tasks that are in no sprint and serve no issue. */
  unplaced: Task[];
  events: Array<Event & { agenda: AgendaItem[] }>;
  signals: Signal[];
  /** Where each object is in its life, keyed by "type:id". */
  lifecycles: Record<string, Lifecycle>;
  /** What each object is called for short, keyed by "type:id": PROJ-12, S41, T-3, E-2. */
  refs: Record<string, string>;
  /** Points done in each closed sprint, oldest first, and the average of the last three. */
  velocity: { sprints: Array<{ sprintId: string; name: string; done: number }>; average: number | null };
  capacity: number | null;
  staleAfterDays: number;
  taskTypes: string[];
  lastPull: PullRecord | null;
}

export interface OverviewInputs {
  today: ISODate;
  settings: Settings;
  issues: IssueSnapshot[];
  sprints: SprintSnapshot[];
  notes: IssueNote[];
  tasks: Task[];
  events: Event[];
  agendaByEvent: (eventId: string) => AgendaItem[];
  lastPull: PullRecord | null;
}

const LEVEL_ORDER: Record<SignalLevel, number> = { work: 0, critical: 1, warning: 2, info: 3 };
const PHASE_ORDER: Record<SprintState, number> = { closed: 0, active: 1, future: 2 };

/** A sprint's short name: "S41" for "Team Sprint 41", else its name. */
export function sprintRef(s: SprintSnapshot): string {
  const n = /(\d+)\s*$/.exec(s.name);
  return n ? `S${n[1]}` : s.name;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pts = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} pt${n === 1 ? "" : "s"}`;

export function deriveOverview(input: OverviewInputs): Overview {
  const { today, settings } = input;
  const signals: Signal[] = [];
  const lifecycles: Record<string, Lifecycle> = {};
  const refs: Record<string, string> = {};

  const noteOf = new Map(input.notes.map((n) => [n.key, n]));
  const sprintOf = new Map(input.sprints.map((s) => [s.id, s]));
  const live = input.tasks.filter((t) => t.status !== "dropped").sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

  // Issues, each with what blocks it and your tasks under it.
  const issues: Record<string, IssueView> = {};
  for (const i of input.issues) {
    const note = noteOf.get(i.key);
    const started = i.started ? datePart(i.started) : null;
    const daysInProgress = i.statusCategory === "doing" && started ? Math.max(0, workingDaysBetween(started, today) - 1) : null;
    issues[i.key] = {
      issue: i,
      note: note?.note ?? "",
      fresh: !note?.seenUpdated || compareMoments(note.seenUpdated, i.updated) < 0,
      blockedBy: i.links.filter((l) => l.direction === "blocked_by" && l.statusCategory !== "done"),
      blocks: i.links.filter((l) => l.direction === "blocks"),
      tasks: live.filter((t) => t.issueKey === i.key),
      daysInProgress,
      stale: daysInProgress !== null && daysInProgress > settings.staleAfterDays,
    };
    refs[`issue:${i.key}`] = i.key;
  }
  const mine = Object.values(issues).filter((v) => v.issue.assignedToMe);
  const mineKeys = new Set(mine.map((v) => v.issue.key));
  const loose = (t: Task) => !t.issueKey || !mineKeys.has(t.issueKey);
  const byKey = (a: IssueView, b: IssueView) => {
    const open = (v: IssueView) => (v.issue.statusCategory === "done" ? 1 : 0);
    const [pa, na] = a.issue.key.split("-");
    const [pb, nb] = b.issue.key.split("-");
    return open(a) - open(b) || pa.localeCompare(pb) || Number(na) - Number(nb);
  };

  // Sprints, with your points in each.
  const ordered = [...input.sprints].sort(
    (a, b) => PHASE_ORDER[a.state] - PHASE_ORDER[b.state] || (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || Number(a.id) - Number(b.id),
  );
  // An issue can name a sprint of another board. With a board set, only its own can be the one under way or next.
  const board = settings.jira.boardId;
  const ours = (s: SprintSnapshot) => !board || s.boardId === null || s.boardId === board;
  const active = ordered.find((s) => s.state === "active" && ours(s)) ?? null;
  const nextSprint = ordered.find((s) => s.state === "future" && ours(s)) ?? null;
  const sprints: SprintOverview[] = ordered.map((s) => {
    const inIt = mine.filter((v) => currentSprintId(v.issue) === s.id).sort(byKey);
    const points: Points = { committed: 0, done: 0, doing: 0, todo: 0, unestimated: 0 };
    const closedOn = s.state === "closed" ? (s.completeDate ?? s.endDate) : null;
    for (const v of inIt) {
      const p = v.issue.points;
      let category = v.issue.statusCategory;
      // Left open when its sprint closed and finished later: not that sprint's work.
      if (category === "done" && closedOn && v.issue.resolved && compareDates(datePart(v.issue.resolved), closedOn) > 0) category = "todo";
      if (p === null) {
        if (category !== "done") points.unestimated += 1;
        continue;
      }
      points.committed += p;
      points[category] += p;
    }
    const days = s.startDate && s.endDate ? workingDaysBetween(s.startDate, s.endDate) : null;
    let daysLeft: number | null = null;
    let expected: number | null = null;
    let behind = false;
    if (s.state === "active" && s.startDate && s.endDate && days) {
      daysLeft = workingDaysBetween(today, s.endDate);
      const elapsed = Math.min(days, Math.max(0, days - daysLeft));
      expected = Math.round(((points.committed * elapsed) / days) * 10) / 10;
      behind = elapsed / days >= 0.3 && points.done < expected - Math.max(2, points.committed * 0.15);
    }
    const over = settings.capacityPoints !== null && s.state !== "closed" && points.committed > settings.capacityPoints;
    lifecycles[`sprint:${s.id}`] = sprintLifecycle(s, behind);
    refs[`sprint:${s.id}`] = sprintRef(s);
    return {
      sprint: s,
      phase: s.state,
      issues: inIt,
      tasks: live.filter((t) => t.sprintId === s.id && loose(t)),
      points,
      daysLeft,
      days,
      expected,
      behind,
      over,
    };
  });
  const openSprintIds = new Set(sprints.filter((s) => s.phase !== "closed").map((s) => s.sprint.id));
  const backlog = mine.filter((v) => v.issue.statusCategory !== "done" && !openSprintIds.has(currentSprintId(v.issue) ?? "")).sort(byKey);

  // Epics and parents.
  const parents: Overview["parents"] = {};
  for (const v of Object.values(issues)) {
    const p = v.issue.parent;
    if (!p) continue;
    parents[p.key] ??= { key: p.key, summary: p.summary, type: p.type, issueKeys: [] };
    parents[p.key].issueKeys.push(v.issue.key);
  }

  // Velocity: points done in each closed sprint.
  const closed = sprints.filter((s) => s.phase === "closed");
  const velocitySprints = closed.map((s) => ({ sprintId: s.sprint.id, name: s.sprint.name, done: s.points.done }));
  const recent = velocitySprints.slice(-3);
  const velocity = { sprints: velocitySprints, average: recent.length ? Math.round((recent.reduce((a, s) => a + s.done, 0) / recent.length) * 10) / 10 : null };

  // Signals about issues.
  const activeId = active?.id ?? null;
  for (const v of mine) {
    const i = v.issue;
    const ref: Ref = { type: "issue", id: i.key };
    const sprintId = currentSprintId(i);
    const sprint = sprintId ? sprintOf.get(sprintId) : undefined;
    lifecycles[`issue:${i.key}`] = issueLifecycle({ issue: i, sprintStart: sprint?.startDate ?? null, blocked: v.blockedBy.length > 0 });
    if (i.statusCategory === "done") continue;
    const inActive = sprintId !== null && sprintId === activeId;
    if (i.statusCategory === "doing") {
      signals.push({
        id: `doing-${i.key}`,
        level: "work",
        subject: i.summary,
        text: `${i.status}${v.daysInProgress ? `, ${plural(v.daysInProgress, "working day")}` : ""}`,
        next: `${i.status}.${v.tasks.length ? ` ${plural(v.tasks.filter((t) => t.status !== "done").length, "task")} of yours still open under it.` : ""}`,
        say: null,
        ref,
        date: i.started ? datePart(i.started) : null,
      });
    }
    if (v.blockedBy.length && (inActive || i.statusCategory === "doing")) {
      const first = v.blockedBy[0];
      signals.push({
        id: `blocked-${i.key}`,
        level: "warning",
        subject: i.summary,
        text: `Blocked by ${v.blockedBy.map((b) => b.key).join(", ")}`,
        next: `Waiting on ${first.key}, "${first.summary}". Chase it, or raise it at the next meeting.`,
        say: `Add "${i.key} is blocked by ${first.key}" to the agenda of my next meeting.`,
        ref,
        date: null,
      });
    }
    if (i.flagged) {
      signals.push({ id: `flagged-${i.key}`, level: "warning", subject: i.summary, text: "Flagged in Jira", next: "Flagged as an impediment. Find out what it needs.", say: null, ref, date: null });
    }
    if (v.stale) {
      signals.push({
        id: `stale-${i.key}`,
        level: "warning",
        subject: i.summary,
        text: `${i.status} for ${plural(v.daysInProgress!, "working day")}`,
        next: `In progress longer than ${plural(settings.staleAfterDays, "working day")}. Split it, finish it, or say what it is waiting on.`,
        say: `Help me split ${i.key} into smaller pieces.`,
        ref,
        date: i.started ? datePart(i.started) : null,
      });
    }
    if (i.points === null && sprintId !== null && (sprintId === activeId || sprintId === nextSprint?.id)) {
      signals.push({ id: `estimate-${i.key}`, level: "warning", subject: i.summary, text: "No estimate", next: "In a sprint without story points, so the sprint's numbers are short.", say: null, ref, date: null });
    }
    if (i.due) {
      const days = diffDays(today, i.due);
      if (days < 0) {
        signals.push({ id: `late-${i.key}`, level: "critical", subject: i.summary, text: `Was due ${sayDate(i.due)}`, next: `Past its due date by ${plural(-days, "day")}. Finish it or agree a new date.`, say: null, ref, date: i.due });
      } else if (days <= 3) {
        signals.push({ id: `due-${i.key}`, level: "info", subject: i.summary, text: days === 0 ? "Due today" : `Due ${sayDate(i.due)}`, next: `Due in ${plural(days, "day")}.`, say: null, ref, date: i.due });
      }
    }
  }
  for (const v of Object.values(issues)) {
    if (!lifecycles[`issue:${v.issue.key}`]) {
      const sprintId = currentSprintId(v.issue);
      lifecycles[`issue:${v.issue.key}`] = issueLifecycle({ issue: v.issue, sprintStart: sprintId ? (sprintOf.get(sprintId)?.startDate ?? null) : null, blocked: v.blockedBy.length > 0 });
    }
  }

  // Signals about sprints.
  for (const so of sprints) {
    const s = so.sprint;
    const ref: Ref = { type: "sprint", id: s.id };
    const open = so.points.doing + so.points.todo;
    if (so.phase === "active" && so.daysLeft !== null) {
      if (so.daysLeft <= 2 && open > 0) {
        signals.push({
          id: `ending-${s.id}`,
          level: "critical",
          subject: s.name,
          text: `Ends ${s.endDate ? sayDate(s.endDate) : "soon"}, ${pts(open)} not done`,
          next: `${plural(so.daysLeft, "working day")} left. Decide what will not make it, and say so before the review.`,
          say: `Which of my issues in ${s.name} will not be done by ${s.endDate}?`,
          ref,
          date: s.endDate,
        });
      } else if (so.behind) {
        signals.push({
          id: `behind-${s.id}`,
          level: "warning",
          subject: s.name,
          text: `${pts(so.points.done)} done, ${pts(so.expected ?? 0)} expected by now`,
          next: `Behind a straight line from start to finish, with ${plural(so.daysLeft, "working day")} left.`,
          say: null,
          ref,
          date: null,
        });
      }
    }
    if (so.over && so.phase !== "closed") {
      signals.push({
        id: `over-${s.id}`,
        level: "warning",
        subject: s.name,
        text: `${pts(so.points.committed)} planned, capacity ${pts(settings.capacityPoints!)}`,
        next: "More is planned than you usually take on. Raise it at planning, or move something out.",
        say: null,
        ref,
        date: s.startDate,
      });
    }
    if (so.phase === "future" && s === nextSprint && s.startDate) {
      const days = diffDays(today, s.startDate);
      if (days >= 0 && days <= 4) {
        signals.push({
          id: `next-${s.id}`,
          level: "info",
          subject: s.name,
          text: `Starts ${sayDate(s.startDate)}, ${pts(so.points.committed)} planned`,
          next: `${plural(so.issues.length, "issue")} of yours in it so far${so.points.unestimated ? `, ${so.points.unestimated} without an estimate` : ""}.`,
          say: `Help me plan ${s.name}: what should I take on, given my velocity?`,
          ref,
          date: s.startDate,
        });
      }
    }
  }

  // Your own tasks.
  for (const t of live) {
    const ref: Ref = { type: "task", id: t.id };
    lifecycles[`task:${t.id}`] = taskLifecycle(t);
    refs[`task:${t.id}`] = `T-${t.number}`;
    const under = t.issueKey ? `, for ${t.issueKey}` : "";
    if (t.status === "doing") {
      signals.push({ id: `task-doing-${t.id}`, level: "work", subject: t.title, text: `In hand${under}`, next: `In hand${under}.`, say: null, ref, date: t.startedOn });
    } else if (t.status === "blocked") {
      signals.push({ id: `task-blocked-${t.id}`, level: "warning", subject: t.title, text: `Blocked. ${t.blockedBy}`, next: `Blocked: ${t.blockedBy}`, say: null, ref, date: null });
    }
  }

  // Meetings.
  const events = input.events
    .filter((e) => e.status === "planned")
    .sort((a, b) => (a.at === null ? 1 : b.at === null ? -1 : compareMoments(a.at, b.at)))
    .map((e) => ({ ...e, agenda: input.agendaByEvent(e.id) }));
  for (const e of input.events) refs[`event:${e.id}`] = `E-${e.number}`;
  for (const e of events) {
    const ref: Ref = { type: "event", id: e.id };
    lifecycles[`event:${e.id}`] = eventLifecycle(e, today);
    const open = e.agenda.filter((a) => a.status === "open").length;
    if (e.at === null) {
      signals.push({ id: `park-${e.id}`, level: "info", subject: e.title, text: "No date set", next: `Agreed but not booked${open ? `, with ${plural(open, "point")} waiting` : ""}.`, say: null, ref, date: null });
      continue;
    }
    const on = dateIn(e.at) ?? datePart(e.at);
    const days = diffDays(today, on);
    if (days < 0) {
      signals.push({ id: `passed-${e.id}`, level: "warning", subject: e.title, text: "Date passed", next: "Record that it happened, or give it a new date.", say: null, ref, date: on });
    } else if (days <= 3) {
      signals.push({
        id: `soon-${e.id}`,
        level: "info",
        subject: e.title,
        text: `${days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`}${open ? `, ${open} to raise` : ""}`,
        next: open ? `${plural(open, "point")} to raise.` : "Nothing on the agenda yet.",
        say: `What should I raise at "${e.title}"?`,
        ref,
        date: on,
      });
    }
  }

  signals.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.subject.localeCompare(b.subject));

  const inbox = mine.filter((v) => v.fresh && v.issue.statusCategory !== "done").sort((a, b) => compareMoments(b.issue.updated, a.issue.updated));

  return {
    today,
    title: settings.title,
    subtitle: settings.subtitle,
    jiraUrl: settings.jira.baseUrl,
    sprints,
    activeSprintId: activeId,
    backlog,
    inbox,
    issues,
    parents,
    unplaced: live.filter((t) => !t.sprintId && loose(t)),
    events,
    signals,
    lifecycles,
    refs,
    velocity,
    capacity: settings.capacityPoints,
    staleAfterDays: settings.staleAfterDays,
    taskTypes: settings.taskTypes,
    lastPull: input.lastPull,
  };
}

/** The sprint that is under way, or the next one to start, or the last one to have run. */
export function focusSprint(o: Overview): SprintOverview | null {
  return o.sprints.find((s) => s.phase === "active") ?? o.sprints.find((s) => s.phase === "future") ?? o.sprints.at(-1) ?? null;
}

/** Days from `from`, for placing on a line. */
export function dayOf(from: ISODate, date: ISODate): number {
  return diffDays(from, date);
}

export { addDays, compareDates };
