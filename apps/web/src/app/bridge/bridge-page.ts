import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import type { EventKind, IssueLinkView, IssueView, Lifecycle, Overview, Ref, Signal, SprintOverview, Task } from '@battlestation/domain';
import { Api } from '../core/api';
import { formatDateTime, formatDay, formatLong, fromField, toField } from '../core/dates';
import { Look } from '../core/look';
import { Icon, type IconName } from '../shared/icon';
import { Tilt } from '../shared/tilt';
import { buildScene, daysBetween, issueTone, locate, type Item, type Tone } from './bridge-model';
import { richText, type Line } from './rich-text';

interface Fact {
  k: string;
  v: string;
  tone?: Tone;
}

interface Step {
  date: string;
  text: string;
  tone: Tone;
  quote: string | null;
}

/** The symbol for each kind of thing. */
const ICON: Record<Ref['type'], IconName> = { sprint: 'sprint', issue: 'issue', task: 'task', event: 'event', board: 'board' };

interface Link {
  ref: Ref | null;
  /** Where it opens when it is not here, such as an issue in Jira that was not read. */
  href: string | null;
  icon: IconName;
  badge: string;
  text: string;
  tone: Tone;
  note: string;
}

interface Detail {
  ref: Ref;
  icon: IconName;
  /** Its short reference: S41, PAY-12, T-3, E-2. */
  badge: string;
  kind: string;
  title: string;
  tone: Tone;
  state: string;
  body: Line[];
  facts: Fact[];
  story: Step[];
  agenda: Array<{ id: string; text: string; answer: string | null; open: boolean; issue: string | null }>;
  links: Link[];
  life: Lifecycle | null;
  next: string | null;
  say: string | null;
  /** The issue's page in Jira. */
  jira: string | null;
  /** Set on an issue: its note can be written, and it can be marked seen. */
  issue: { key: string; note: string; fresh: boolean } | null;
  /** Set on a meeting that has not happened yet. */
  meeting: { id: string; at: string | null } | null;
  /** Set on a task: it can be moved from here. */
  task: { id: string; status: string } | null;
  /** Set on the board: the settings can be changed from here. */
  settings: boolean;
}

/** A task being written. Its place is '' for none yet, 's:<id>' for a sprint, 'i:<key>' for an issue. */
interface TaskDraft {
  title: string;
  type: string;
  description: string;
  place: string;
}

interface MeetingDraft {
  title: string;
  kind: EventKind;
  when: string;
}

const KINDS: Array<{ id: EventKind; label: string }> = [
  { id: 'planning', label: 'Planning' },
  { id: 'refinement', label: 'Refinement' },
  { id: 'review', label: 'Review' },
  { id: 'retro', label: 'Retro' },
  { id: 'one_on_one', label: 'One-to-one' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'deadline', label: 'Deadline' },
];
const KIND_WORD = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<EventKind, string>;

const same = (a: Ref | null, b: Ref | null) => !!a && !!b && a.type === b.type && a.id === b.id;
const pts = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} pt${n === 1 ? '' : 's'}`;

const LEVEL_TONE: Record<Signal['level'], Tone> = { work: 'primary', critical: 'danger', warning: 'warning', info: 'info' };
const TASK_WORD: Record<string, string> = { todo: 'queued', doing: 'in hand', blocked: 'blocked', done: 'done', dropped: 'dropped' };
const TASK_TONE: Record<string, Tone> = { todo: 'neutral', doing: 'primary', blocked: 'danger', done: 'success', dropped: 'neutral' };
const PHASE_TONE: Record<SprintOverview['phase'], Tone> = { closed: 'success', active: 'primary', future: 'neutral' };

const MIN_PX = 2.2;
const MAX_PX = 64;

/**
 * The bridge. The map fills the screen with your sprints laid out in time;
 * the edges carry the sprint's numbers, what wants you, the selected thing
 * and the minimap.
 */
@Component({
  selector: 'app-bridge-page',
  imports: [NgTemplateOutlet, Icon, Tilt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bridge-page.html',
  styleUrl: './bridge-page.css',
  host: { '(window:keydown)': 'onKey($event)', '(click)': 'struck($event)' },
})
export class BridgePage {
  protected readonly api = inject(Api);
  protected readonly look = inject(Look);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly mapEl = viewChild<ElementRef<HTMLElement>>('mapBox');
  private readonly miniEl = viewChild<ElementRef<HTMLElement>>('miniBox');

  protected readonly overview = this.api.overview.value;
  protected readonly scene = computed(() => {
    const o = this.overview();
    return o ? buildScene(o) : null;
  });

  // ------------------------------------------------------------- the view
  protected readonly width = signal(0);
  protected readonly miniWidth = signal(0);
  /** Pixels per day. Zero until the map has been measured. */
  protected readonly px = signal(0);
  /** The day at the left edge of the map. */
  protected readonly offset = signal(0);

  protected readonly selected = signal<Ref | null>(null);
  protected readonly readout = signal('');
  protected readonly copied = signal(false);

  constructor() {
    afterNextRender(() => {
      const watch = (el: HTMLElement | undefined, into: (w: number) => void) => {
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => into(entry.contentRect.width));
        ro.observe(el);
        this.destroyRef.onDestroy(() => ro.disconnect());
      };
      watch(this.mapEl()?.nativeElement, (w) => this.width.set(w));
      watch(this.miniEl()?.nativeElement, (w) => this.miniWidth.set(w));
    });

    // First sight: eight weeks across, today a third of the way in.
    effect(() => {
      const s = this.scene();
      const w = this.width();
      if (!s || w === 0 || untracked(this.px) !== 0) return;
      if (this.route.snapshot.queryParamMap.get('view') === 'all') {
        this.px.set(Math.max(MIN_PX, w / (s.last - s.first)));
        this.offset.set(s.first);
        return;
      }
      this.px.set(w / 56);
      this.offset.set(s.today - 56 * 0.33);
    });

    // Selecting something new puts down whatever was being written.
    effect(() => {
      const sel = this.selected();
      const o = untracked(this.overview);
      this.taskDraft.set(null);
      this.meetingDraft.set(null);
      this.point.set('');
      this.refused.set(null);
      this.when.set(sel?.type === 'event' ? toField(o?.events.find((e) => e.id === sel.id)?.at ?? null) : '');
      this.note.set(sel?.type === 'issue' ? (o?.issues[sel.id]?.note ?? '') : '');
      if (sel?.type === 'board' && sel.id === 'board' && o) this.settingsDraft.set(this.settingsFrom(o));
    });

    // Arrive at the thing in the address, if there is one; otherwise at the sprint under way.
    effect(() => {
      const o = this.overview();
      if (!o || untracked(this.selected)) return;
      const at = this.route.snapshot.queryParamMap.get('at') ?? '';
      const cut = at.indexOf(':');
      const [type, id] = cut === -1 ? [at, ''] : [at.slice(0, cut), at.slice(cut + 1)];
      if (id && describe(o, { type: type as Ref['type'], id })) {
        this.selected.set({ type: type as Ref['type'], id });
        return;
      }
      const focus = o.sprints.find((s) => s.phase === 'active') ?? o.sprints.find((s) => s.phase === 'future') ?? o.sprints.at(-1);
      this.selected.set(focus ? { type: 'sprint', id: focus.sprint.id } : { type: 'board', id: 'board' });
    });
  }

  private x(day: number): number {
    return (day - this.offset()) * this.px();
  }

  protected readonly todayX = computed(() => {
    const s = this.scene();
    return s ? this.x(s.today + 0.5) : 0;
  });

  /** The sprint that the selection belongs to; everything else steps back. */
  protected readonly focusSprint = computed(() => {
    const sel = this.selected();
    const o = this.overview();
    if (!sel || !o) return null;
    if (sel.type === 'sprint') return sel.id;
    if (sel.type === 'issue') return o.issues[sel.id]?.issue.sprintIds.at(-1) ?? null;
    if (sel.type === 'task') {
      const t = [...Object.values(o.issues).flatMap((v) => v.tasks), ...o.sprints.flatMap((s) => s.tasks), ...o.unplaced].find((x) => x.id === sel.id);
      return t?.sprintId ?? null;
    }
    return null;
  });

  protected readonly zones = computed(() => {
    const s = this.scene();
    if (!s || !this.px()) return [];
    const focus = this.focusSprint();
    return s.zones.map((z) => ({ ...z, x: this.x(z.from), w: (z.to - z.from) * this.px(), on: focus === z.sprintId }));
  });

  /** Every other week is a shade lighter, which is how weeks are told apart. */
  protected readonly weeks = computed(() => {
    const s = this.scene();
    const px = this.px();
    if (!s || !px) return [];
    const w = this.width();
    return s.weeks.map((day, i) => ({ day, x: this.x(day), w: 7 * px, odd: i % 2 === 1 })).filter((k) => k.x + k.w > 0 && k.x < w);
  });

  protected readonly ticks = computed(() => {
    const s = this.scene();
    const px = this.px();
    if (!s || !px) return [];
    const w = this.width();
    // Week numbers crowd when zoomed out; keep the months.
    return s.ticks.filter((t) => t.major || px >= 7).map((t) => ({ ...t, x: this.x(t.day) })).filter((t) => t.x > -140 && t.x < w + 20);
  });

  protected readonly drawn = computed(() => {
    const s = this.scene();
    const px = this.px();
    if (!s || !px) return [];
    const w = this.width();
    const sel = this.selected();
    const focus = this.focusSprint();
    const out = [];
    for (const it of s.items) {
      const x = this.x(it.start);
      const point = it.shape === 'dot' || it.shape === 'diamond' || it.shape === 'flag' || it.shape === 'pip';
      const wide = point ? 0 : Math.max((it.end - it.start) * px, 3);
      if (x + wide < -260 || x > w + 40) continue;
      const cx = point ? this.x(it.start + 0.5) : x;
      let lx = point ? cx + 9 : x + wide + 7;
      if (it.shape === 'band' || (it.shape === 'outline' && it.h > 20)) lx = Math.min(Math.max(x + 10, 10), x + wide - it.label.length * 7.2 - 10);
      if (it.shape === 'row' && it.label) lx = Math.min(Math.max(x + 8, 10), x + wide - it.label.length * 6.4 - 8);
      if (it.shape === 'flag') lx = cx + 15;
      // Slanted shapes are drawn as polygons: a sprint's band, and a meeting's pennant.
      const slant = 7;
      const pts =
        it.shape === 'band'
          ? `${x + slant},${it.y} ${x + wide + slant},${it.y} ${x + wide - slant},${it.y + it.h} ${x - slant},${it.y + it.h}`
          : it.shape === 'flag'
            ? `${cx + 3},${it.y + 2} ${cx + 13},${it.y + 2} ${cx + 9},${it.y + 14} ${cx - 1},${it.y + 14}`
            : '';
      out.push({
        ...it,
        x: cx,
        w: wide,
        lx,
        pts,
        ly: it.shape === 'band' || (it.shape === 'outline' && it.h > 20) ? it.y + it.h / 2 + 4.5 : it.shape === 'flag' ? it.y + 12 : it.y + it.h / 2 + 4,
        cls: `item ${it.shape}${it.shape === 'outline' && it.h > 20 ? ' wide' : ''} tone-${it.tone}${it.live ? ' live' : ''}${same(sel, it.ref) ? ' on' : ''}${focus && it.sprintId && it.sprintId !== focus ? ' back' : ''}`,
      });
    }
    return out;
  });

  protected readonly rowLabels = computed(() => {
    const s = this.scene();
    const px = this.px();
    if (!s || !px) return [];
    const w = this.width();
    const sel = this.selected();
    const focus = this.focusSprint();
    return s.labels
      .map((l) => {
        const from = this.x(l.from);
        const to = this.x(l.to);
        const est = l.text.length * 6.9 + 22;
        return { ...l, from, to, x: Math.min(Math.max(from + 10, 10), to - est), cls: `row-label tone-${l.tone}${same(sel, l.ref) ? ' on' : ''}${focus && l.sprintId && l.sprintId !== focus ? ' back' : ''}` };
      })
      .filter((l) => l.to > 0 && l.from < w);
  });

  // ------------------------------------------------------------ the edges
  /** Work in hand first, set apart; then what wants a decision, worst first. Each carries where its object is in its life. */
  protected readonly signals = computed(() => {
    const o = this.overview();
    const list = o?.signals ?? [];
    return list.map((s) => ({
      ...s,
      tone: LEVEL_TONE[s.level],
      on: same(this.selected(), s.ref),
      life: o?.lifecycles[`${s.ref.type}:${s.ref.id}`] ?? null,
      icon: ICON[s.ref.type],
      badge: o?.refs[`${s.ref.type}:${s.ref.id}`] ?? '',
    }));
  });

  /** What is being worked on now. */
  protected readonly work = computed(() => this.signals().filter((s) => s.level === 'work'));
  /** What wants a decision or an action. */
  protected readonly needs = computed(() => this.signals().filter((s) => s.level !== 'work'));

  /** Issues new to you, or changed since you last looked. */
  protected readonly inbox = computed(() => {
    const o = this.overview();
    const sel = this.selected();
    return (o?.inbox ?? []).map((v) => ({ ref: { type: 'issue', id: v.issue.key } as Ref, key: v.issue.key, title: v.issue.summary, status: v.issue.status, tone: issueTone(v), on: same(sel, { type: 'issue', id: v.issue.key }) }));
  });

  /** Meetings coming up, soonest first. */
  protected readonly meetings = computed(() => {
    const o = this.overview();
    const sel = this.selected();
    return (o?.events ?? []).map((e) => ({
      ref: { type: 'event', id: e.id } as Ref,
      badge: `E-${e.number}`,
      title: e.title,
      when: e.at ? formatDateTime(e.at) : 'no date yet',
      open: e.agenda.filter((a) => a.status === 'open').length,
      on: same(sel, { type: 'event', id: e.id }),
    }));
  });

  protected readonly pulling = signal(false);
  protected readonly pullSaid = signal<{ ok: boolean; said: string } | null>(null);
  protected readonly pulledAt = computed(() => {
    const at = this.overview()?.lastPull?.at;
    return at ? formatDateTime(at) : null;
  });
  protected readonly live = computed(() => this.api.health.value()?.mode === 'live');

  protected async pull(): Promise<void> {
    if (this.pulling()) return;
    this.pulling.set(true);
    this.pullSaid.set(await this.api.pull());
    this.pulling.set(false);
  }

  protected readonly clock = computed(() => {
    const o = this.overview();
    return o ? formatLong(o.today) : '';
  });

  /** The numbers across the top: the sprint under way, or the next one. */
  protected readonly gauge = computed(() => {
    const o = this.overview();
    if (!o) return null;
    const s = o.sprints.find((x) => x.phase === 'active') ?? o.sprints.find((x) => x.phase === 'future');
    if (!s) return null;
    const p = s.points;
    const scale = Math.max(p.committed, o.capacity ?? 0, 1);
    const share = (n: number) => (n / scale) * 100;
    const elapsed = s.days && s.daysLeft !== null ? Math.min(100, ((s.days - s.daysLeft) / s.days) * 100) : 0;
    return {
      ref: { type: 'sprint', id: s.sprint.id } as Ref,
      name: o.refs[`sprint:${s.sprint.id}`] ?? s.sprint.name,
      phase: s.phase,
      done: { v: p.done, w: share(p.done) },
      doing: { v: p.doing, w: share(p.doing) },
      todo: { v: p.todo, w: share(p.todo) },
      committed: p.committed,
      unestimated: p.unestimated,
      capacity: o.capacity,
      capacityAt: o.capacity !== null ? share(o.capacity) : null,
      expectedAt: s.expected !== null ? share(s.expected) : null,
      over: s.over,
      behind: s.behind,
      daysLeft: s.daysLeft,
      elapsed,
      velocity: o.velocity.average,
    };
  });

  protected readonly mini = computed(() => {
    const s = this.scene();
    const w = this.miniWidth();
    const o = this.overview();
    if (!s || !w || !o) return null;
    const span = s.last - s.first;
    const k = w / span;
    const at = (d: number) => (d - s.first) * k;
    const viewDays = this.px() ? this.width() / this.px() : 0;
    return {
      zones: s.zones.map((z) => ({ ...z, x: at(z.from), w: (z.to - z.from) * k, name: o.refs[`sprint:${z.sprintId}`] ?? '' })),
      today: at(s.today + 0.5),
      pings: o.signals.filter((g) => g.date).map((g) => ({ id: g.id, x: at(daysBetween(s.origin, g.date!) + 0.5), tone: LEVEL_TONE[g.level] })),
      view: { x: at(this.offset()), w: Math.max(viewDays * k, 6) },
    };
  });

  protected readonly detail = computed<Detail | null>(() => {
    const o = this.overview();
    const sel = this.selected();
    if (!o || !sel) return null;
    return describe(o, sel);
  });

  /** The selected thing, as a list of one or none, so that each new one arrives. */
  protected readonly shown = computed(() => {
    const d = this.detail();
    return d ? [d] : [];
  });

  // --------------------------------------------------------- writing things
  protected readonly saving = signal(false);
  protected readonly refused = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly when = signal('');
  protected readonly point = signal('');
  protected readonly taskDraft = signal<TaskDraft | null>(null);
  protected readonly meetingDraft = signal<MeetingDraft | null>(null);
  protected readonly settingsDraft = signal<{ title: string; subtitle: string; capacity: string; stale: string; board: string; jql: string } | null>(null);
  protected readonly kinds = KINDS;

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  private async act(doing: Promise<{ refused: string | null }>): Promise<boolean> {
    this.saving.set(true);
    const { refused } = await doing;
    this.refused.set(refused);
    this.saving.set(false);
    return !refused;
  }

  /** Where a new task can go: nowhere yet, a sprint still to run, or one of your open issues. */
  protected readonly places = computed(() => {
    const o = this.overview();
    if (!o) return [];
    const out = [{ value: '', label: 'Nowhere yet' }];
    for (const s of o.sprints.filter((x) => x.phase !== 'closed')) {
      out.push({ value: `s:${s.sprint.id}`, label: `${s.sprint.name}, on its own` });
      for (const v of s.issues.filter((i) => i.issue.statusCategory !== 'done')) out.push({ value: `i:${v.issue.key}`, label: `${v.issue.key}  ${v.issue.summary}` });
    }
    for (const v of o.backlog) out.push({ value: `i:${v.issue.key}`, label: `${v.issue.key}  ${v.issue.summary} (backlog)` });
    return out;
  });

  /** Start writing a task, placed under whatever is selected if that can hold one. */
  protected newTask(): void {
    const o = this.overview();
    const sel = this.selected();
    const place = sel?.type === 'issue' ? `i:${sel.id}` : sel?.type === 'sprint' && o?.sprints.find((s) => s.sprint.id === sel.id)?.phase !== 'closed' ? `s:${sel.id}` : '';
    this.meetingDraft.set(null);
    this.refused.set(null);
    this.taskDraft.set({ title: '', type: o?.taskTypes[0] ?? '', description: '', place });
  }

  protected editTask(field: keyof TaskDraft, value: string): void {
    this.taskDraft.update((d) => (d ? { ...d, [field]: value } : d));
  }

  protected async saveTask(): Promise<void> {
    const d = this.taskDraft();
    if (!d || this.saving()) return;
    this.saving.set(true);
    const made = await this.api.saveTask({
      title: d.title,
      type: d.type || undefined,
      description: d.description,
      issueKey: d.place.startsWith('i:') ? d.place.slice(2) : null,
      sprintId: d.place.startsWith('s:') ? d.place.slice(2) : null,
    });
    this.saving.set(false);
    this.refused.set(made.refused);
    if (made.value) this.pick({ type: 'task', id: made.value.id });
  }

  protected async move(id: string, status: 'todo' | 'doing' | 'done'): Promise<void> {
    if (this.saving()) return;
    await this.act(this.api.setTaskStatus({ id, status }));
  }

  protected newMeeting(): void {
    this.taskDraft.set(null);
    this.refused.set(null);
    this.meetingDraft.set({ title: '', kind: 'meeting', when: '' });
  }

  protected editMeeting(field: keyof MeetingDraft, value: string): void {
    this.meetingDraft.update((d) => (d ? { ...d, [field]: value } : d));
  }

  protected async saveMeeting(): Promise<void> {
    const d = this.meetingDraft();
    if (!d || this.saving()) return;
    this.saving.set(true);
    const made = await this.api.saveEvent({ title: d.title, kind: d.kind, at: d.when ? fromField(d.when) : null });
    this.saving.set(false);
    this.refused.set(made.refused);
    if (made.value) this.pick({ type: 'event', id: made.value.id });
  }

  protected async setDate(id: string): Promise<void> {
    if (this.saving()) return;
    if (!this.when()) return this.refused.set('Pick the date and the time first.');
    await this.act(this.api.saveEvent({ id, at: fromField(this.when()) }));
  }

  protected async happened(id: string, title: string): Promise<void> {
    if (this.saving() || !confirm(`Record that "${title}" happened?`)) return;
    await this.act(this.api.saveEvent({ id, status: 'done' }));
  }

  protected async raise(eventId: string): Promise<void> {
    if (this.saving()) return;
    const text = this.point().trim();
    const key = /\b[A-Z][A-Z0-9_]*-\d+\b/.exec(text)?.[0] ?? null;
    const known = key && this.overview()?.issues[key] ? key : null;
    if (await this.act(this.api.addAgendaItem({ eventId, text, issueKey: known }))) this.point.set('');
  }

  protected async answer(id: string, current: string | null): Promise<void> {
    const said = prompt('What was the answer?', current ?? '');
    if (said === null || this.saving()) return;
    await this.act(this.api.updateAgendaItem({ id, answer: said.trim() || null, status: said.trim() ? 'answered' : 'open' }));
  }

  protected async saveNote(key: string): Promise<void> {
    if (this.saving()) return;
    await this.act(this.api.noteIssue({ key, note: this.note() }));
  }

  protected async seen(keys: string[] | 'all'): Promise<void> {
    if (this.saving()) return;
    await this.act(this.api.markSeen(keys === 'all' ? { all: true } : { keys }));
  }

  private settingsFrom(o: Overview) {
    return { title: o.title, subtitle: o.subtitle, capacity: o.capacity === null ? '' : String(o.capacity), stale: String(o.staleAfterDays), board: '', jql: '' };
  }

  protected editSettings(field: 'title' | 'subtitle' | 'capacity' | 'stale' | 'board' | 'jql', value: string): void {
    this.settingsDraft.update((d) => (d ? { ...d, [field]: value } : d));
  }

  protected async saveSettings(): Promise<void> {
    const d = this.settingsDraft();
    if (!d || this.saving()) return;
    const capacity = d.capacity.trim() === '' ? null : Number(d.capacity);
    const stale = Number(d.stale);
    if (capacity !== null && !Number.isFinite(capacity)) return this.refused.set('Capacity is a number of points, or empty.');
    await this.act(
      this.api.saveSettings({
        title: d.title,
        subtitle: d.subtitle,
        capacityPoints: capacity,
        staleAfterDays: Number.isFinite(stale) ? stale : undefined,
        ...(d.board.trim() ? { boardId: d.board.trim() } : {}),
        ...(d.jql.trim() ? { jql: d.jql.trim() } : {}),
      }),
    );
  }

  // --------------------------------------------------------------- moving
  protected pick(ref: Ref, event?: Event): void {
    event?.stopPropagation();
    this.selected.set(ref);
    this.copied.set(false);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { at: `${ref.type}:${ref.id}` }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** Select a thing and bring it into view. */
  protected flyTo(ref: Ref): void {
    this.pick(ref);
    const s = this.scene();
    if (!s) return;
    const at = locate(s, ref);
    if (!at) return;
    const viewDays = this.width() / this.px();
    const x = this.x(at.day);
    if (x < 80 || x > this.width() - 220) this.offset.set(at.day - viewDays * 0.4);
    const el = this.mapEl()?.nativeElement;
    if (el && (at.y < el.scrollTop + 40 || at.y > el.scrollTop + el.clientHeight - 80)) el.scrollTo({ top: Math.max(0, at.y - el.clientHeight / 3), behavior: 'smooth' });
  }

  protected now(): void {
    const s = this.scene();
    if (s) this.offset.set(s.today - (this.width() / this.px()) * 0.33);
  }

  protected fit(): void {
    const s = this.scene();
    if (!s || !this.width()) return;
    this.px.set(Math.max(MIN_PX, this.width() / (s.last - s.first)));
    this.offset.set(s.first);
  }

  protected zoom(factor: number, atX = this.width() / 2): void {
    const px = this.px();
    if (!px) return;
    const next = Math.min(MAX_PX, Math.max(MIN_PX, px * factor));
    const dayAt = this.offset() + atX / px;
    this.px.set(next);
    this.offset.set(dayAt - atX / next);
  }

  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.offset.update((o) => o + (e.deltaX || e.deltaY) / this.px());
      return;
    }
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.zoom(Math.exp(-e.deltaY * 0.0016), e.clientX - box.left);
  }

  private drag: { x: number; y: number; offset: number; top: number; moving: boolean } | null = null;

  protected onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.drag = { x: e.clientX, y: e.clientY, offset: this.offset(), top: this.mapEl()?.nativeElement.scrollTop ?? 0, moving: false };
  }

  protected onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moving && Math.hypot(dx, dy) < 5) return;
    if (!d.moving) {
      d.moving = true;
      // Capture only once it is a drag, so a plain click still reaches the thing under it.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    this.offset.set(d.offset - dx / this.px());
    const el = this.mapEl()?.nativeElement;
    if (el) el.scrollTop = d.top - dy;
  }

  protected onUp(e: PointerEvent): void {
    if (this.drag?.moving) (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    this.drag = null;
  }

  protected onMini(e: PointerEvent): void {
    if (e.type === 'pointermove' && e.buttons !== 1) return;
    const s = this.scene();
    const w = this.miniWidth();
    if (!s || !w) return;
    if (e.type === 'pointerdown') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const day = s.first + ((e.clientX - box.left) / w) * (s.last - s.first);
    this.offset.set(day - this.width() / this.px() / 2);
  }

  /** A button that is clicked throws its burst. The class is taken off and put back so that it can throw again. */
  protected struck(e: Event): void {
    const button = (e.target as HTMLElement | null)?.closest?.('button');
    if (!button) return;
    button.classList.remove('struck');
    void button.offsetWidth;
    button.classList.add('struck');
  }

  protected onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const week = 7;
    switch (e.key) {
      case 'ArrowLeft':
        this.offset.update((o) => o - week);
        break;
      case 'ArrowRight':
        this.offset.update((o) => o + week);
        break;
      case '+':
      case '=':
        this.zoom(1.25);
        break;
      case '-':
        this.zoom(0.8);
        break;
      case 'n':
        this.now();
        break;
      case 'f':
        this.fit();
        break;
      case 'Escape':
        this.selected.set(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  protected hover(it: Item | null): void {
    this.readout.set(it ? it.title : '');
  }

  protected readonly formatDay = formatDay;
}

// ---------------------------------------------------------------------------
// What the selection panel says about each kind of thing.

function issueLink(o: Overview, v: IssueView, note?: string): Link {
  const i = v.issue;
  return { ref: { type: 'issue', id: i.key }, href: null, icon: 'issue', badge: i.key, text: i.summary, tone: issueTone(v), note: note ?? `${i.status.toLowerCase()}${i.points !== null ? `, ${pts(i.points)}` : ''}` };
}

function taskLink(o: Overview, t: Task): Link {
  return { ref: { type: 'task', id: t.id }, href: null, icon: 'task', badge: o.refs[`task:${t.id}`] ?? '', text: t.title, tone: TASK_TONE[t.status], note: TASK_WORD[t.status] };
}

/** A linked issue: here if it was read, else at its page in Jira. */
function linkedIssue(o: Overview, l: IssueLinkView): Link {
  const here = o.issues[l.key];
  const tone: Tone = l.statusCategory === 'done' ? 'success' : l.direction === 'blocked_by' ? 'danger' : 'neutral';
  return { ref: here ? { type: 'issue', id: l.key } : null, href: here || !o.jiraUrl ? null : `${o.jiraUrl}/browse/${l.key}`, icon: 'issue', badge: l.key, text: l.summary, tone, note: `${l.label}${l.statusCategory === 'done' ? ', done' : ''}` };
}

const blank = { body: [] as Line[], facts: [] as Fact[], story: [] as Step[], agenda: [] as Detail['agenda'], links: [] as Link[], life: null, next: null, say: null, jira: null, issue: null, meeting: null, task: null, settings: false };

export function describe(o: Overview, ref: Ref): Detail | null {
  const lead = o.signals.find((s) => s.ref.type === ref.type && s.ref.id === ref.id) ?? null;
  const life = o.lifecycles[`${ref.type}:${ref.id}`] ?? null;
  const base = { ...blank, ref, icon: ICON[ref.type], badge: o.refs[`${ref.type}:${ref.id}`] ?? '', life, next: lead?.next ?? null, say: lead?.say ?? null };

  if (ref.type === 'sprint') {
    const so = o.sprints.find((s) => s.sprint.id === ref.id);
    if (!so) return null;
    const s = so.sprint;
    const p = so.points;
    const facts: Fact[] = [];
    facts.push({ k: 'Runs', v: s.startDate ? `${formatDay(s.startDate)} to ${s.endDate ? formatDay(s.endDate) : 'open'}` : 'no dates yet' });
    if (so.daysLeft !== null) facts.push({ k: 'Working days left', v: String(so.daysLeft), tone: so.daysLeft <= 2 ? 'warning' : undefined });
    facts.push({ k: 'Your points', v: `${pts(p.committed)}${o.capacity !== null ? `, capacity ${o.capacity}` : ''}`, tone: so.over ? 'warning' : undefined });
    facts.push({ k: 'Done', v: pts(p.done), tone: 'success' });
    if (p.doing) facts.push({ k: 'In progress', v: pts(p.doing), tone: 'primary' });
    if (p.todo) facts.push({ k: 'To do', v: pts(p.todo) });
    if (p.unestimated) facts.push({ k: 'Not estimated', v: `${p.unestimated} issue${p.unestimated === 1 ? '' : 's'}`, tone: 'warning' });
    if (so.expected !== null) facts.push({ k: 'A straight line says', v: `${pts(so.expected)} done by now`, tone: so.behind ? 'warning' : undefined });
    if (o.velocity.average !== null && so.phase !== 'closed') facts.push({ k: 'Your velocity', v: `${o.velocity.average} a sprint` });
    return {
      ...base,
      kind: 'Sprint',
      title: s.name,
      tone: so.behind || so.over ? 'warning' : PHASE_TONE[so.phase],
      state: life?.now ?? so.phase,
      body: richText(s.goal ? `Goal: ${s.goal}` : ''),
      facts,
      links: [...so.issues.map((v) => issueLink(o, v)), ...so.tasks.map((t) => taskLink(o, t))],
      next: lead?.next ?? (so.issues.length ? null : 'Nothing of yours in it yet.'),
    };
  }

  if (ref.type === 'issue') {
    const v = o.issues[ref.id];
    if (!v) return null;
    const i = v.issue;
    const sprintId = i.sprintIds.at(-1);
    const sprint = sprintId ? o.sprints.find((s) => s.sprint.id === sprintId) : undefined;
    const facts: Fact[] = [
      { k: 'Status', v: i.status, tone: issueTone(v) === 'neutral' ? undefined : issueTone(v) },
      { k: 'Points', v: i.points === null ? 'not estimated' : String(i.points), tone: i.points === null ? 'warning' : undefined },
    ];
    if (i.priority) facts.push({ k: 'Priority', v: i.priority });
    facts.push({ k: 'Assignee', v: i.assignee ?? 'nobody', tone: i.assignedToMe ? undefined : 'warning' });
    if (i.reporter) facts.push({ k: 'Reporter', v: i.reporter });
    if (sprint) facts.push({ k: 'Sprint', v: sprint.sprint.name });
    else facts.push({ k: 'Sprint', v: 'backlog' });
    if (i.sprintIds.length > 1) facts.push({ k: 'Carried over', v: `${i.sprintIds.length - 1} time${i.sprintIds.length === 2 ? '' : 's'}`, tone: 'warning' });
    if (i.due) facts.push({ k: 'Due', v: formatDay(i.due), tone: i.statusCategory !== 'done' && i.due < o.today ? 'danger' : undefined });
    if (i.started) facts.push({ k: 'Started', v: `${formatDay(i.started.slice(0, 10))}${v.daysInProgress !== null ? `, ${v.daysInProgress} working days ago` : ''}`, tone: v.stale ? 'warning' : undefined });
    if (i.resolved) facts.push({ k: 'Resolved', v: formatDay(i.resolved.slice(0, 10)), tone: 'success' });
    if (i.labels.length) facts.push({ k: 'Labels', v: i.labels.join(', ') });
    const links: Link[] = [...v.blockedBy.map((l) => linkedIssue(o, l)), ...i.links.filter((l) => !(l.direction === 'blocked_by' && l.statusCategory !== 'done')).map((l) => linkedIssue(o, l)), ...v.tasks.map((t) => taskLink(o, t))];
    if (i.parent) {
      const p = o.parents[i.parent.key];
      links.push({ ref: o.issues[i.parent.key] ? { type: 'issue', id: i.parent.key } : null, href: o.issues[i.parent.key] || !o.jiraUrl ? null : `${o.jiraUrl}/browse/${i.parent.key}`, icon: 'epic', badge: i.parent.key, text: i.parent.summary, tone: 'neutral', note: `${i.parent.type.toLowerCase()}${p ? `, ${p.issueKeys.length} of yours` : ''}` });
    }
    if (sprint) links.push({ ref: { type: 'sprint', id: sprint.sprint.id }, href: null, icon: 'sprint', badge: o.refs[`sprint:${sprint.sprint.id}`] ?? '', text: sprint.sprint.name, tone: PHASE_TONE[sprint.phase], note: sprint.phase });
    return {
      ...base,
      kind: `${i.type}${i.parent ? `, in ${i.parent.summary}` : ''}${i.assignedToMe ? '' : ', not yours'}`,
      title: i.summary,
      tone: issueTone(v),
      state: life?.now ?? i.status.toLowerCase(),
      body: richText(i.description),
      facts,
      story: i.comments.map((c) => ({ date: c.at.slice(0, 10), text: c.author, tone: 'neutral' as Tone, quote: c.body || null })),
      links,
      jira: i.url,
      issue: { key: i.key, note: v.note, fresh: v.fresh },
      next: lead?.next ?? (v.fresh ? 'New to you, or changed since you last looked.' : null),
    };
  }

  if (ref.type === 'task') {
    const all = [...Object.values(o.issues).flatMap((v) => v.tasks), ...o.sprints.flatMap((s) => s.tasks), ...o.unplaced];
    const t = all.find((x) => x.id === ref.id);
    if (!t) return null;
    const facts: Fact[] = [{ k: 'Kind', v: t.type }];
    if (t.startedOn) facts.push({ k: 'Started', v: formatDay(t.startedOn) });
    if (t.doneOn) facts.push({ k: 'Finished', v: formatDay(t.doneOn), tone: 'success' });
    if (t.status === 'blocked') facts.push({ k: 'Blocked by', v: t.blockedBy, tone: 'danger' });
    const links: Link[] = [];
    if (t.issueKey && o.issues[t.issueKey]) links.push(issueLink(o, o.issues[t.issueKey]));
    const sprint = t.sprintId ? o.sprints.find((s) => s.sprint.id === t.sprintId) : undefined;
    if (sprint) links.push({ ref: { type: 'sprint', id: sprint.sprint.id }, href: null, icon: 'sprint', badge: o.refs[`sprint:${sprint.sprint.id}`] ?? '', text: sprint.sprint.name, tone: PHASE_TONE[sprint.phase], note: sprint.phase });
    return {
      ...base,
      kind: `Your task${t.issueKey ? `, for ${t.issueKey}` : sprint ? `, in ${sprint.sprint.name}` : ', in no sprint'}`,
      title: t.title,
      tone: TASK_TONE[t.status],
      state: life?.now ?? TASK_WORD[t.status],
      body: richText(t.description),
      facts,
      links,
      task: { id: t.id, status: t.status },
      next: t.status === 'todo' ? 'Queued. Start it when it is next.' : t.status === 'blocked' ? `Blocked: ${t.blockedBy}` : null,
    };
  }

  if (ref.type === 'event') {
    const e = o.events.find((x) => x.id === ref.id);
    if (!e) return null;
    const open = e.agenda.filter((a) => a.status === 'open').length;
    return {
      ...base,
      kind: KIND_WORD[e.kind],
      title: e.title,
      tone: 'primary',
      state: e.at ? formatDateTime(e.at) : 'no date yet',
      body: richText(e.notes),
      agenda: e.agenda.map((a) => ({ id: a.id, text: a.text, answer: a.answer, open: a.status === 'open', issue: a.issueKey })),
      links: e.agenda.filter((a) => a.issueKey && o.issues[a.issueKey]).map((a) => issueLink(o, o.issues[a.issueKey!], 'raised here')),
      meeting: e.status === 'planned' ? { id: e.id, at: e.at } : null,
      next: lead?.next ?? (open ? `${open} to raise.` : null),
    };
  }

  if (ref.type === 'board' && ref.id === 'backlog') {
    return { ...base, badge: '', kind: 'Backlog', title: 'In no sprint', tone: 'neutral', state: `${o.backlog.length} of yours, open`, links: o.backlog.map((v) => issueLink(o, v)), icon: 'backlog' };
  }

  if (ref.type === 'board' && ref.id === 'unplaced') {
    return { ...base, badge: '', kind: 'Your own', title: 'In no sprint, for no issue', tone: 'neutral', state: `${o.unplaced.length} task${o.unplaced.length === 1 ? '' : 's'}`, links: o.unplaced.map((t) => taskLink(o, t)), icon: 'task' };
  }

  if (ref.type === 'board') {
    const facts: Fact[] = [
      { k: 'Jira', v: o.jiraUrl ?? 'not set' },
      { k: 'Capacity', v: o.capacity === null ? 'not set' : pts(o.capacity) },
      { k: 'Velocity', v: o.velocity.average === null ? 'no closed sprints yet' : `${o.velocity.average} a sprint` },
      ...o.velocity.sprints.slice(-5).map((s) => ({ k: s.name, v: `${pts(s.done)} done` })),
      { k: 'Last read', v: o.lastPull ? `${formatDateTime(o.lastPull.at)}, for ${o.lastPull.me ?? 'unknown'}` : 'never' },
    ];
    return { ...base, badge: '', kind: 'Board', title: o.title, tone: 'neutral', state: o.subtitle, facts, settings: true };
  }
  return null;
}
