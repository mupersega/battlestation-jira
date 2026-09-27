/**
 * The application service: every operation the Battlestation can perform,
 * over a Store. The MCP server and the screen are both thin clients of this
 * class, so neither has logic the other lacks. Every change is audited, and
 * a move that is not allowed throws DomainError.
 */

import { randomUUID } from "node:crypto";
import { assertISODate, todayISO, type ISODate, type ISODateTime } from "./dates.js";
import { DomainError } from "./errors.js";
import { currentSprintId, isIssueKey, type IssueSnapshot, type SprintSnapshot } from "./jira.js";
import { deriveOverview, type IssueView, type Overview } from "./overview.js";
import {
  EVENT_KINDS,
  TASK_STATUSES,
  type AgendaItem,
  type AgendaItemStatus,
  type Event,
  type EventKind,
  type EventStatus,
  type IssueNote,
  type PullRecord,
  type Settings,
  type Snapshot,
  type Store,
  type Task,
  type TaskStatus,
} from "./types.js";

export { DomainError };

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A partial change to the settings. Omitted fields are kept. */
export interface SettingsPatch {
  title?: string;
  subtitle?: string;
  jira?: Partial<Settings["jira"]>;
  capacityPoints?: number | null;
  staleAfterDays?: number;
  taskTypes?: string[];
}

/** What a pull brought in. */
export interface PullResult {
  added: string[];
  changed: string[];
  /** Issues that were yours and are no longer assigned to you. */
  released: string[];
  sprints: number;
}

export function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

export interface BattlestationOptions {
  store: Store;
  clock?: Clock;
  /** Called after every successful change, for the JSON export. */
  onWrite?: (snapshot: Snapshot) => void;
}

export class Battlestation {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly onWrite?: (snapshot: Snapshot) => void;

  constructor(options: BattlestationOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.onWrite = options.onWrite;
  }

  today(): ISODate {
    return todayISO(this.clock.now());
  }

  private stamp(): ISODateTime {
    return this.clock.now().toISOString();
  }

  private mutate<T>(actor: string, action: string, targetType: string, fn: () => { id: string; result: T; detail?: string }): T {
    const out = this.store.transaction(() => {
      const r = fn();
      this.store.recordAudit({ at: this.stamp(), actor, action, targetType, targetId: r.id, detail: r.detail ?? "" });
      return r.result;
    });
    this.onWrite?.(this.store.snapshot());
    return out;
  }

  // -------------------------------------------------------------------------
  // Settings

  getSettings(): Settings {
    return this.store.getSettings();
  }

  updateSettings(actor: string, patch: SettingsPatch): Settings {
    const current = this.store.getSettings();
    if (patch.capacityPoints !== undefined && patch.capacityPoints !== null && !(patch.capacityPoints > 0)) throw new DomainError("capacityPoints must be more than zero, or null.");
    if (patch.staleAfterDays !== undefined && !(Number.isInteger(patch.staleAfterDays) && patch.staleAfterDays > 0)) throw new DomainError("staleAfterDays must be a whole number more than zero.");
    if (patch.taskTypes !== undefined) {
      const types = patch.taskTypes.map((t) => t.trim()).filter(Boolean);
      if (types.length === 0) throw new DomainError("There must be at least one task type.");
      patch = { ...patch, taskTypes: [...new Set(types)] };
    }
    if (patch.jira?.baseUrl) {
      let url: URL;
      try {
        url = new URL(patch.jira.baseUrl);
      } catch {
        throw new DomainError(`Not an address: ${patch.jira.baseUrl}`);
      }
      if (url.protocol !== "https:" && url.hostname !== "localhost") throw new DomainError("The Jira address must start with https://.");
      patch = { ...patch, jira: { ...patch.jira, baseUrl: url.origin + url.pathname.replace(/\/+$/, "") } };
    }
    return this.mutate(actor, "update_settings", "settings", () => {
      const next: Settings = {
        ...current,
        ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && k !== "jira")),
        jira: { ...current.jira, ...Object.fromEntries(Object.entries(patch.jira ?? {}).filter(([, v]) => v !== undefined)) },
      };
      this.store.saveSettings(next);
      return { id: "settings", result: next, detail: Object.keys(patch).join(", ") };
    });
  }

  // -------------------------------------------------------------------------
  // The whole picture

  getOverview(): Overview {
    return deriveOverview({
      today: this.today(),
      settings: this.store.getSettings(),
      issues: this.store.listIssues(),
      sprints: this.store.listSprints(),
      notes: this.store.listNotes(),
      tasks: this.store.listTasks(),
      events: this.store.listEvents(),
      agendaByEvent: (id) => this.store.listAgendaItems(id),
      lastPull: this.store.getLastPull(),
    });
  }

  getIssue(key: string): IssueView {
    const view = this.getOverview().issues[key.trim().toUpperCase()];
    if (!view) throw new DomainError(`No issue ${key} has been read from Jira.`);
    return view;
  }

  listSprints(): SprintSnapshot[] {
    return this.store.listSprints();
  }

  // -------------------------------------------------------------------------
  // Your own tasks

  listTasks(): Task[] {
    return this.store.listTasks();
  }

  requireTask(id: string): Task {
    const t = this.store.getTask(id) ?? this.store.listTasks().find((x) => `T-${x.number}` === id.toUpperCase());
    if (!t) throw new DomainError(`No task ${id}.`);
    return t;
  }

  private requireSprint(id: string): SprintSnapshot {
    const s = this.store.getSprint(id);
    if (!s) throw new DomainError(`No sprint ${id} has been read from Jira.`);
    return s;
  }

  /**
   * Make a task (no id) or change one (with id). A task can serve a Jira
   * issue, sit in a sprint, or be neither until it is known where it goes.
   * A task that serves an issue follows it into the issue's sprint.
   */
  upsertTask(actor: string, input: { id?: string; title?: string; description?: string; type?: string; issueKey?: string | null; sprintId?: string | null; order?: number }): Task {
    if (input.type !== undefined) {
      const types = this.store.getSettings().taskTypes;
      if (!types.includes(input.type)) throw new DomainError(`"${input.type}" is not one of the task types: ${types.join(", ")}. Add it in the settings if it should be.`);
    }
    const issueKey = input.issueKey === undefined || input.issueKey === null ? input.issueKey : input.issueKey.trim().toUpperCase();
    if (issueKey && !isIssueKey(issueKey)) throw new DomainError(`Not an issue key: ${input.issueKey}`);
    if (input.sprintId) this.requireSprint(input.sprintId);
    return this.mutate(actor, "upsert_task", "task", () => {
      const existing = input.id ? this.requireTask(input.id) : null;
      if (!existing && !input.title?.trim()) throw new DomainError("A new task needs a title.");
      const key = issueKey === undefined ? (existing?.issueKey ?? null) : issueKey;
      const issue = key ? this.store.getIssue(key) : null;
      const sprintId = issue ? currentSprintId(issue) : input.sprintId === undefined ? (existing?.sprintId ?? null) : input.sprintId;
      const now = this.stamp();
      const siblings = this.store.listTasks().filter((t) => t.issueKey === key && t.sprintId === sprintId && t.id !== existing?.id);
      const task: Task = {
        id: existing?.id ?? shortId(),
        number: existing?.number ?? this.store.nextNumber("task"),
        title: input.title?.trim() || existing!.title,
        type: input.type ?? existing?.type ?? this.store.getSettings().taskTypes[0] ?? "task",
        description: input.description ?? existing?.description ?? "",
        status: existing?.status ?? "todo",
        blockedBy: existing?.blockedBy ?? "",
        issueKey: key,
        sprintId,
        order: input.order ?? existing?.order ?? siblings.length + 1,
        startedOn: existing?.startedOn ?? null,
        doneOn: existing?.doneOn ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.store.saveTask(task);
      return { id: task.id, result: task, detail: task.title };
    });
  }

  /** Move a task. Starting it records the start date; finishing it records the finish; blocking it needs the reason. */
  setTaskStatus(actor: string, input: { id: string; status: TaskStatus; reason?: string; on?: ISODate }): Task {
    const existing = this.requireTask(input.id);
    if (!TASK_STATUSES.includes(input.status)) throw new DomainError(`status must be one of ${TASK_STATUSES.join(", ")}.`);
    const on = input.on ?? this.today();
    assertISODate(on, "on");
    if (input.status === "blocked" && !input.reason?.trim()) throw new DomainError("Say what is blocking it, so it can be unblocked.");
    return this.mutate(actor, "set_task_status", "task", () => {
      const task: Task = {
        ...existing,
        status: input.status,
        blockedBy: input.status === "blocked" ? input.reason!.trim() : "",
        startedOn: input.status === "todo" ? null : (existing.startedOn ?? (input.status === "doing" || input.status === "done" ? on : null)),
        doneOn: input.status === "done" ? on : null,
        updatedAt: this.stamp(),
      };
      this.store.saveTask(task);
      return { id: task.id, result: task, detail: `${existing.status} -> ${task.status}` };
    });
  }

  // -------------------------------------------------------------------------
  // Meetings

  listEvents(includeClosed = false): Array<Event & { agenda: AgendaItem[] }> {
    return this.store
      .listEvents()
      .filter((e) => includeClosed || e.status === "planned")
      .map((e) => ({ ...e, agenda: this.store.listAgendaItems(e.id) }));
  }

  getEvent(id: string): (Event & { agenda: AgendaItem[] }) | null {
    const e = this.store.getEvent(id) ?? this.store.listEvents().find((x) => `E-${x.number}` === id.toUpperCase()) ?? null;
    return e ? { ...e, agenda: this.store.listAgendaItems(e.id) } : null;
  }

  upsertEvent(actor: string, input: { id?: string; title?: string; kind?: EventKind; at?: ISODateTime | null; status?: EventStatus; notes?: string }): Event {
    if (typeof input.at === "string" && Number.isNaN(Date.parse(input.at))) throw new DomainError(`at is not an ISO date-time: ${input.at}`);
    if (input.kind !== undefined && !EVENT_KINDS.includes(input.kind)) throw new DomainError(`kind must be one of ${EVENT_KINDS.join(", ")}.`);
    return this.mutate(actor, "upsert_event", "event", () => {
      const existing = input.id ? this.getEvent(input.id) : null;
      if (input.id && !existing) throw new DomainError(`No meeting ${input.id}.`);
      if (!existing && !input.title?.trim()) throw new DomainError("A new meeting needs a title.");
      const now = this.stamp();
      const e: Event = {
        id: existing?.id ?? shortId(),
        number: existing?.number ?? this.store.nextNumber("event"),
        kind: input.kind ?? existing?.kind ?? "meeting",
        title: input.title?.trim() || existing!.title,
        at: input.at === undefined ? (existing?.at ?? null) : input.at,
        status: input.status ?? existing?.status ?? "planned",
        notes: input.notes ?? existing?.notes ?? "",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.store.saveEvent(e);
      return { id: e.id, result: e, detail: e.title };
    });
  }

  addAgendaItem(actor: string, input: { eventId: string; text: string; issueKey?: string | null }): AgendaItem {
    const text = input.text.trim();
    if (!text) throw new DomainError("Write the point first.");
    const issueKey = input.issueKey ? input.issueKey.trim().toUpperCase() : null;
    if (issueKey && !isIssueKey(issueKey)) throw new DomainError(`Not an issue key: ${input.issueKey}`);
    return this.mutate(actor, "add_agenda_item", "agenda_item", () => {
      const e = this.getEvent(input.eventId);
      if (!e) throw new DomainError(`No meeting ${input.eventId}.`);
      const item: AgendaItem = { id: shortId(), eventId: e.id, order: e.agenda.length + 1, text, answer: null, status: "open", issueKey };
      this.store.saveAgendaItem(item);
      return { id: item.id, result: item, detail: text.slice(0, 80) };
    });
  }

  updateAgendaItem(actor: string, input: { id: string; text?: string; answer?: string | null; status?: AgendaItemStatus; order?: number }): AgendaItem {
    return this.mutate(actor, "update_agenda_item", "agenda_item", () => {
      const existing = this.store.getAgendaItem(input.id);
      if (!existing) throw new DomainError(`No agenda item ${input.id}.`);
      const answer = input.answer === undefined ? existing.answer : input.answer;
      const status = input.status ?? (input.answer ? "answered" : existing.status);
      const item: AgendaItem = { ...existing, text: input.text?.trim() || existing.text, answer, status, order: input.order ?? existing.order };
      this.store.saveAgendaItem(item);
      return { id: item.id, result: item };
    });
  }

  // -------------------------------------------------------------------------
  // Your notes on Jira issues

  private requireIssue(key: string): IssueSnapshot {
    const i = this.store.getIssue(key.trim().toUpperCase());
    if (!i) throw new DomainError(`No issue ${key} has been read from Jira.`);
    return i;
  }

  /** Keep a private note on an issue. It stays here and is never sent to Jira. */
  noteIssue(actor: string, input: { key: string; note: string }): IssueNote {
    const issue = this.requireIssue(input.key);
    return this.mutate(actor, "note_issue", "issue", () => {
      const existing = this.store.getNote(issue.key);
      const n: IssueNote = { key: issue.key, note: input.note.trim(), seenUpdated: existing?.seenUpdated ?? null, updatedAt: this.stamp() };
      this.store.saveNote(n);
      return { id: issue.key, result: n };
    });
  }

  /** Mark issues as seen as they are now. One that changes in Jira afterwards is new to you again. */
  markSeen(actor: string, keys: string[]): string[] {
    const issues = keys.map((k) => this.requireIssue(k));
    if (issues.length === 0) return [];
    return this.mutate(actor, "mark_seen", "issue", () => {
      for (const i of issues) {
        const existing = this.store.getNote(i.key);
        this.store.saveNote({ key: i.key, note: existing?.note ?? "", seenUpdated: i.updated, updatedAt: this.stamp() });
      }
      return { id: issues.map((i) => i.key).join(","), result: issues.map((i) => i.key), detail: `${issues.length} seen` };
    });
  }

  // -------------------------------------------------------------------------
  // Pulling from Jira

  /**
   * Keep what a pull read. Issues and sprints are replaced by their newer
   * copies. An issue that was yours and did not come back in this pull is
   * kept, marked as no longer assigned to you: it may have been reassigned,
   * or fallen outside the query, and either way it is not yours to plan.
   */
  recordPull(actor: string, input: { issues: IssueSnapshot[]; sprints: SprintSnapshot[]; me: string | null; at?: ISODateTime }): PullResult {
    return this.mutate(actor, "pull", "jira", () => {
      const before = new Map(this.store.listIssues().map((i) => [i.key, i]));
      const result: PullResult = { added: [], changed: [], released: [], sprints: input.sprints.length };
      const seen = new Set<string>();
      for (const s of input.sprints) this.store.saveSprint(s);
      for (const i of input.issues) {
        seen.add(i.key);
        const old = before.get(i.key);
        if (!old) result.added.push(i.key);
        else if (old.updated !== i.updated || old.assignedToMe !== i.assignedToMe) result.changed.push(i.key);
        this.store.saveIssue(i);
        // Tasks under the issue follow it when it moves sprint.
        const sprintId = currentSprintId(i);
        for (const t of this.store.listTasks().filter((x) => x.issueKey === i.key && x.sprintId !== sprintId)) this.store.saveTask({ ...t, sprintId, updatedAt: this.stamp() });
      }
      for (const old of before.values()) {
        if (seen.has(old.key) || !old.assignedToMe) continue;
        this.store.saveIssue({ ...old, assignedToMe: false });
        result.released.push(old.key);
      }
      const record: PullRecord = { at: input.at ?? this.stamp(), me: input.me, issues: input.issues.length, sprints: input.sprints.length };
      this.store.saveLastPull(record);
      return { id: "jira", result, detail: `${result.added.length} new, ${result.changed.length} changed, ${result.released.length} released` };
    });
  }

  // -------------------------------------------------------------------------
  // The record

  listAudit(limit = 50) {
    return this.store.listAudit(limit);
  }

  snapshot(): Snapshot {
    return this.store.snapshot();
  }
}
