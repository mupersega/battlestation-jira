import type { IssueView, Overview, Ref, SprintOverview, Task } from '@battlestation/domain';
import { addDays, toUtc } from '../core/dates';

/**
 * The scene: everything placed in time (days from an origin, left to right)
 * and in rows (top to bottom). Pure data; the component turns days into
 * pixels for the current zoom.
 */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral';
export type Shape = 'band' | 'bar' | 'row' | 'outline' | 'dot' | 'diamond' | 'flag' | 'pip';

export interface Item {
  key: string;
  ref: Ref;
  shape: Shape;
  tone: Tone;
  /** Days from the origin. */
  start: number;
  end: number;
  y: number;
  h: number;
  /** Drawn beside the item, or inside a band. */
  label: string;
  /** Read out and shown on hover. */
  title: string;
  /** The sprint this belongs to, for highlighting what goes together. */
  sprintId: string | null;
  /** Draws the eye: something is moving or late. */
  live: boolean;
}

export interface RowLabel {
  key: string;
  ref: Ref;
  text: string;
  tone: Tone;
  y: number;
  /** The label stays inside this span of days as the map moves. */
  from: number;
  to: number;
  sprintId: string | null;
}

export interface Zone {
  key: string;
  sprintId: string;
  phase: 'closed' | 'active' | 'future';
  from: number;
  to: number;
}

export interface Tick {
  day: number;
  label: string;
  major: boolean;
}

export interface Scene {
  origin: string;
  today: number;
  first: number;
  last: number;
  height: number;
  items: Item[];
  labels: RowLabel[];
  zones: Zone[];
  ticks: Tick[];
  /** The day each week starts on (Mondays), for telling weeks apart by tone. */
  weeks: number[];
}

const BAND = 24;
const ROW = 30;
const LANE = 9;
const GAP = 18;
const TASK = 19;
/** A sprint with no dates yet is drawn this long, after the one before it. */
const GUESS = 14;

const monthYear = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

const PHASE_TONE: Record<SprintOverview['phase'], Tone> = { closed: 'success', active: 'primary', future: 'neutral' };

/** How an issue looks: its tone and whether it wants the eye. */
export function issueTone(v: IssueView): Tone {
  const i = v.issue;
  if (i.statusCategory === 'done') return 'success';
  if (v.blockedBy.length || i.flagged) return 'danger';
  if (v.stale) return 'warning';
  if (i.statusCategory === 'doing') return 'primary';
  return 'neutral';
}

export function buildScene(o: Overview): Scene {
  const dated = o.sprints.map((s) => s.sprint.startDate).filter((d): d is string => d !== null);
  const started = Object.values(o.issues)
    .map((v) => v.issue.started?.slice(0, 10))
    .filter((d): d is string => !!d);
  const earliest = [...dated, ...started, o.today].sort()[0];
  const origin = addDays(earliest, -7);
  const day = (date: string) => daysBetween(origin, date.slice(0, 10));
  const today = day(o.today);

  const items: Item[] = [];
  const labels: RowLabel[] = [];
  const zones: Zone[] = [];
  let y = 10;
  let last = today + 42;

  /**
   * Your own tasks under something. Finished ones are short bars where they
   * happened, packed onto compact lines. Each one still open gets a line of
   * its own with its name: in hand runs up to today, blocked is the same in
   * outline, queued is a hollow mark just ahead of today.
   */
  const placeTasks = (tasks: Task[], sprintId: string | null, top: number, refs: Record<string, string>): number => {
    if (tasks.length === 0) return top;
    let yy = top;
    const ends: number[] = [];
    const finished = tasks.filter((t) => t.status === 'done' && t.doneOn).sort((a, b) => (a.startedOn ?? a.doneOn!).localeCompare(b.startedOn ?? b.doneOn!));
    for (const t of finished) {
      const start = day(t.startedOn ?? t.doneOn!);
      const end = Math.max(day(t.doneOn!) + 1, start + 1);
      let lane = ends.findIndex((e) => e <= start);
      if (lane === -1) {
        lane = ends.length;
        ends.push(0);
      }
      ends[lane] = end;
      items.push({ key: `task-${t.id}`, ref: { type: 'task', id: t.id }, shape: 'bar', tone: 'success', start, end, y: yy + lane * LANE + 2, h: 5, label: '', title: `${refs[`task:${t.id}`] ?? ''} ${t.title}: done ${t.doneOn}`, sprintId, live: false });
    }
    yy += ends.length * LANE + (ends.length ? 3 : 0);
    for (const t of tasks.filter((x) => x.status !== 'done')) {
      const s = t.status;
      const since = t.startedOn ? day(t.startedOn) : day(t.createdAt.slice(0, 10));
      items.push({
        key: `task-${t.id}`,
        ref: { type: 'task', id: t.id },
        shape: s === 'doing' ? 'bar' : s === 'blocked' ? 'outline' : 'pip',
        tone: s === 'doing' ? 'primary' : s === 'blocked' ? 'danger' : 'neutral',
        start: s === 'todo' ? today + 1 : Math.min(since, today),
        end: s === 'todo' ? today + 1 : today + 1,
        y: yy + 3,
        h: 10,
        label: `${refs[`task:${t.id}`] ?? ''}  ${t.title}${s === 'blocked' ? ', blocked' : ''}`,
        title: `${t.title}: ${s === 'doing' ? `in hand since ${t.startedOn}` : s === 'blocked' ? `blocked. ${t.blockedBy}` : 'queued'}`,
        sprintId,
        live: s === 'doing',
      });
      yy += TASK;
    }
    return yy + 4;
  };

  /** One issue on its own line: a bar where its work happened, or where it still has to. */
  const placeIssue = (v: IssueView, sprintId: string | null, from: number, to: number, top: number): number => {
    const i = v.issue;
    const ref: Ref = { type: 'issue', id: i.key };
    const tone = issueTone(v);
    const pts = i.points === null ? 'no estimate' : `${i.points} pt${i.points === 1 ? '' : 's'}`;
    labels.push({ key: `label-${i.key}`, ref, text: `${i.key}  ${i.summary}`, tone, y: top + 12, from, to, sprintId });
    items.push({ key: `row-${i.key}`, ref, shape: 'row', tone, start: from, end: to, y: top + 1, h: ROW - 5, label: '', title: `${i.key} ${i.summary}: ${i.status}, ${pts}`, sprintId, live: false });
    const bar = { key: `bar-${i.key}`, ref, tone, y: top + 16, h: 8, label: '', sprintId };
    if (i.statusCategory === 'done') {
      const end = i.resolved ? day(i.resolved) + 1 : to;
      const start = i.started ? day(i.started) : Math.max(from, end - 1);
      items.push({ ...bar, shape: 'bar', start, end: Math.max(end, start + 1), title: `${i.key} done${i.resolved ? ` ${i.resolved.slice(0, 10)}` : ''}`, live: false });
    } else if (i.statusCategory === 'doing') {
      const start = i.started ? day(i.started) : Math.min(from, today);
      items.push({ ...bar, shape: 'bar', start: Math.min(start, today), end: today + 1, title: `${i.key} ${i.status.toLowerCase()}${v.daysInProgress !== null ? `, ${v.daysInProgress} working days` : ''}`, live: true });
    } else {
      const start = Math.max(from, today);
      items.push({ ...bar, shape: 'outline', start, end: Math.max(to, start + 1), title: `${i.key} not started${v.blockedBy.length ? `, blocked by ${v.blockedBy.map((b) => b.key).join(', ')}` : ''}`, live: false });
    }
    if (i.due) {
      const late = i.statusCategory !== 'done' && i.due < o.today;
      items.push({ key: `due-${i.key}`, ref, shape: 'diamond', tone: late ? 'danger' : 'warning', start: day(i.due), end: day(i.due), y: top + 14, h: 12, label: '', title: `${i.key} due ${i.due}`, sprintId, live: late });
    }
    return placeTasks(v.tasks, sprintId, top + ROW, o.refs);
  };

  let previousEnd: number | null = null;
  for (const so of o.sprints) {
    const s = so.sprint;
    const from: number = s.startDate ? day(s.startDate) : (previousEnd ?? today) + 3;
    const to: number = s.endDate ? day(s.endDate) + 1 : from + GUESS;
    previousEnd = to;
    last = Math.max(last, to + 21);
    const ref: Ref = { type: 'sprint', id: s.id };
    zones.push({ key: s.id, sprintId: s.id, phase: so.phase, from, to });
    const p = so.points;
    const numbers = p.committed ? `  ${p.done} of ${p.committed}` : '';
    items.push({
      key: `band-${s.id}`,
      ref,
      shape: s.startDate ? 'band' : 'outline',
      tone: so.behind || so.over ? 'warning' : PHASE_TONE[so.phase],
      start: from,
      end: to,
      y,
      h: BAND,
      label: `${o.refs[`sprint:${s.id}`] ?? s.name}${numbers}${s.startDate ? '' : '  no dates yet'}`,
      title: `${s.name}, ${so.phase}. ${p.done} of ${p.committed} points done${p.unestimated ? `, ${p.unestimated} unestimated` : ''}`,
      sprintId: s.id,
      live: false,
    });
    y += BAND + 6;

    if (so.phase === 'closed') {
      // A closed sprint is history: its issues are packed onto a few lanes.
      const ends: number[] = [];
      const done = so.issues.filter((v) => v.issue.statusCategory === 'done');
      for (const v of done) {
        const end = v.issue.resolved ? day(v.issue.resolved) + 1 : to;
        const start = v.issue.started ? day(v.issue.started) : end - 1;
        let lane = ends.findIndex((e) => e <= start);
        if (lane === -1) {
          lane = ends.length;
          ends.push(0);
        }
        ends[lane] = end;
        items.push({ key: `bar-${v.issue.key}`, ref: { type: 'issue', id: v.issue.key }, shape: 'bar', tone: 'success', start, end: Math.max(end, start + 1), y: y + lane * LANE, h: 6, label: '', title: `${v.issue.key} ${v.issue.summary}: done`, sprintId: s.id, live: false });
      }
      y += ends.length * LANE + GAP;
      continue;
    }

    for (const v of so.issues) y = placeIssue(v, s.id, from, to, y);
    y = placeTasks(so.tasks, s.id, y + 2, o.refs);
    y += GAP;
  }

  // The backlog: yours, open, in no sprint still to run. It sits around today.
  if (o.backlog.length) {
    const from = today - 5;
    const to = today + 30;
    items.push({ key: 'backlog', ref: { type: 'board', id: 'backlog' }, shape: 'row', tone: 'neutral', start: from, end: to, y: y + 2, h: 17, label: `backlog, ${o.backlog.length} in no sprint`, title: 'Your open issues that are in no sprint still to run', sprintId: null, live: false });
    y += 24;
    for (const v of o.backlog) y = placeIssue(v, null, from, to, y);
    y += GAP;
  }

  // Meetings. Ones close together go on lanes, so that their names do not
  // run into each other; a name takes about a day for every four letters.
  const laneEnds: number[] = [];
  for (const e of o.events) {
    if (!e.at) continue;
    const at = day(e.at);
    last = Math.max(last, at + 14);
    let lane = laneEnds.findIndex((end) => end < at);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = at + Math.ceil(e.title.length / 4) + 2;
    const open = e.agenda.filter((a) => a.status === 'open').length;
    items.push({ key: `event-${e.id}`, ref: { type: 'event', id: e.id }, shape: 'flag', tone: 'primary', start: at, end: at, y: y + lane * 22, h: 26, label: e.title, title: `${e.title}, ${e.at.slice(0, 16).replace('T', ' ')}${open ? `, ${open} to raise` : ''}`, sprintId: null, live: false });
  }
  if (laneEnds.length) y += laneEnds.length * 22 + GAP;

  // Work of yours that is in no sprint and serves no issue.
  if (o.unplaced.length) {
    items.push({ key: 'unplaced', ref: { type: 'board', id: 'unplaced' }, shape: 'row', tone: 'neutral', start: today - 5, end: today + 30, y: y + 2, h: 17, label: 'your own, in no sprint', title: 'Your tasks that are in no sprint and serve no issue', sprintId: null, live: false });
    y = placeTasks(o.unplaced, null, y + 26, o.refs);
  }

  // Time axis: months, and Mondays within them.
  const ticks: Tick[] = [];
  const weeks: number[] = [];
  for (let d = -30; d <= last + 30; d++) {
    const date = addDays(origin, d);
    const utc = toUtc(date);
    if (utc.getUTCDay() === 1) weeks.push(d);
    if (utc.getUTCDate() === 1) ticks.push({ day: d, label: monthYear.format(utc), major: true });
    else if (utc.getUTCDay() === 1) ticks.push({ day: d, label: String(utc.getUTCDate()), major: false });
  }

  // Room at the bottom so the last row clears the controls that float over the map.
  return { origin, today, first: 0, last, height: y + 64, items, labels, zones, ticks, weeks };
}

/** The first item that stands for an object, to fly to it. */
export function locate(scene: Scene, ref: Ref): { day: number; y: number } | null {
  const found = scene.items.filter((i) => i.ref.type === ref.type && i.ref.id === ref.id);
  if (found.length === 0) return null;
  // Prefer where the action is: the latest dated mark, not the span of a whole row.
  const marks = found.filter((i) => i.shape !== 'row' && i.shape !== 'band');
  const pick = (marks.length ? marks : found).reduce((a, b) => (b.end > a.end ? b : a));
  return { day: pick.shape === 'band' ? pick.start : pick.end, y: pick.y };
}
