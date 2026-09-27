/**
 * SQLite implementation of the domain Store. Your own things are kept in
 * columns; copies of Jira issues and sprints are kept whole as JSON, since
 * they are only ever replaced, never edited here. Nothing derived is kept.
 */

import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "@battlestation/domain";
import type {
  AgendaItem,
  AgendaItemStatus,
  AuditEntry,
  Event,
  EventKind,
  EventStatus,
  IssueNote,
  IssueSnapshot,
  Numbered,
  PullRecord,
  Settings,
  Snapshot,
  SprintSnapshot,
  Store,
  Task,
  TaskStatus,
} from "@battlestation/domain";
import { openDatabase } from "./db.js";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const toTask = (r: Row): Task => ({
  id: r.id as string,
  number: Number(r.number),
  title: r.title as string,
  type: r.type as string,
  description: r.description as string,
  status: r.status as TaskStatus,
  blockedBy: r.blocked_by as string,
  issueKey: str(r.issue_key),
  sprintId: str(r.sprint_id),
  order: Number(r.ord),
  startedOn: str(r.started_on),
  doneOn: str(r.done_on),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const toEvent = (r: Row): Event => ({
  id: r.id as string,
  number: Number(r.number),
  kind: r.kind as EventKind,
  title: r.title as string,
  at: str(r.at),
  status: r.status as EventStatus,
  notes: r.notes as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const toAgendaItem = (r: Row): AgendaItem => ({
  id: r.id as string,
  eventId: r.event_id as string,
  order: Number(r.ord),
  text: r.text as string,
  answer: str(r.answer),
  status: r.status as AgendaItemStatus,
  issueKey: str(r.issue_key),
});

const toNote = (r: Row): IssueNote => ({
  key: r.key as string,
  note: r.note as string,
  seenUpdated: str(r.seen_updated),
  updatedAt: r.updated_at as string,
});

const toAudit = (r: Row): AuditEntry => ({
  id: Number(r.id),
  at: r.at as string,
  actor: r.actor as string,
  action: r.action as string,
  targetType: r.target_type as string,
  targetId: r.target_id as string,
  detail: r.detail as string,
});

const body = <T>(r: Row): T => JSON.parse(r.body as string) as T;

const NUMBERED: Record<Numbered, string> = { task: "task", event: "event" };

export class SqliteStore implements Store {
  private depth = 0;

  constructor(private readonly db: DatabaseSync) {}

  static open(file: string): SqliteStore {
    return new SqliteStore(openDatabase(file));
  }

  close(): void {
    this.db.close();
  }

  private all<T>(sql: string, map: (r: Row) => T, ...params: Array<string | number | null>): T[] {
    return (this.db.prepare(sql).all(...params) as Row[]).map(map);
  }

  private one<T>(sql: string, map: (r: Row) => T, ...params: Array<string | number | null>): T | null {
    const r = this.db.prepare(sql).get(...params) as Row | undefined;
    return r ? map(r) : null;
  }

  nextNumber(kind: Numbered): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS next FROM ${NUMBERED[kind]}`).get() as { next: number };
    return Number(row.next);
  }

  // Settings are kept whole, and read over the defaults so that a setting
  // added later has a value in a database made before it.
  getSettings(): Settings {
    const stored = this.one("SELECT body FROM settings WHERE id = 1", (r) => body<Partial<Settings>>(r));
    return { ...DEFAULT_SETTINGS, ...stored, jira: { ...DEFAULT_SETTINGS.jira, ...stored?.jira } };
  }

  saveSettings(s: Settings): void {
    this.db.prepare("INSERT INTO settings (id, body) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body").run(JSON.stringify(s));
  }

  listTasks(): Task[] {
    return this.all("SELECT * FROM task ORDER BY ord, created_at", toTask);
  }

  getTask(id: string): Task | null {
    return this.one("SELECT * FROM task WHERE id = ?", toTask, id);
  }

  saveTask(t: Task): void {
    this.db
      .prepare(
        `INSERT INTO task (id, number, title, type, description, status, blocked_by, issue_key, sprint_id, ord, started_on, done_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET number = excluded.number, title = excluded.title, type = excluded.type, description = excluded.description,
           status = excluded.status, blocked_by = excluded.blocked_by, issue_key = excluded.issue_key, sprint_id = excluded.sprint_id, ord = excluded.ord,
           started_on = excluded.started_on, done_on = excluded.done_on, updated_at = excluded.updated_at`,
      )
      .run(t.id, t.number, t.title, t.type, t.description, t.status, t.blockedBy, t.issueKey, t.sprintId, t.order, t.startedOn, t.doneOn, t.createdAt, t.updatedAt);
  }

  listEvents(): Event[] {
    return this.all("SELECT * FROM event ORDER BY at IS NULL, at, created_at", toEvent);
  }

  getEvent(id: string): Event | null {
    return this.one("SELECT * FROM event WHERE id = ?", toEvent, id);
  }

  saveEvent(e: Event): void {
    this.db
      .prepare(
        `INSERT INTO event (id, number, kind, title, at, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, title = excluded.title, at = excluded.at, status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at`,
      )
      .run(e.id, e.number, e.kind, e.title, e.at, e.status, e.notes, e.createdAt, e.updatedAt);
  }

  listAgendaItems(eventId: string): AgendaItem[] {
    return this.all("SELECT * FROM agenda_item WHERE event_id = ? ORDER BY ord", toAgendaItem, eventId);
  }

  getAgendaItem(id: string): AgendaItem | null {
    return this.one("SELECT * FROM agenda_item WHERE id = ?", toAgendaItem, id);
  }

  saveAgendaItem(a: AgendaItem): void {
    this.db
      .prepare(
        `INSERT INTO agenda_item (id, event_id, ord, text, answer, status, issue_key) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET ord = excluded.ord, text = excluded.text, answer = excluded.answer, status = excluded.status, issue_key = excluded.issue_key`,
      )
      .run(a.id, a.eventId, a.order, a.text, a.answer, a.status, a.issueKey);
  }

  listNotes(): IssueNote[] {
    return this.all("SELECT * FROM issue_note ORDER BY key", toNote);
  }

  getNote(key: string): IssueNote | null {
    return this.one("SELECT * FROM issue_note WHERE key = ?", toNote, key);
  }

  saveNote(n: IssueNote): void {
    this.db
      .prepare(
        `INSERT INTO issue_note (key, note, seen_updated, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET note = excluded.note, seen_updated = excluded.seen_updated, updated_at = excluded.updated_at`,
      )
      .run(n.key, n.note, n.seenUpdated, n.updatedAt);
  }

  listIssues(): IssueSnapshot[] {
    return this.all("SELECT body FROM issue ORDER BY key", (r) => body<IssueSnapshot>(r));
  }

  getIssue(key: string): IssueSnapshot | null {
    return this.one("SELECT body FROM issue WHERE key = ?", (r) => body<IssueSnapshot>(r), key);
  }

  saveIssue(i: IssueSnapshot): void {
    this.db.prepare("INSERT INTO issue (key, body) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET body = excluded.body").run(i.key, JSON.stringify(i));
  }

  listSprints(): SprintSnapshot[] {
    return this.all("SELECT body FROM sprint ORDER BY CAST(id AS INTEGER)", (r) => body<SprintSnapshot>(r));
  }

  getSprint(id: string): SprintSnapshot | null {
    return this.one("SELECT body FROM sprint WHERE id = ?", (r) => body<SprintSnapshot>(r), id);
  }

  saveSprint(s: SprintSnapshot): void {
    this.db.prepare("INSERT INTO sprint (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body").run(s.id, JSON.stringify(s));
  }

  getLastPull(): PullRecord | null {
    return this.one("SELECT body FROM last_pull WHERE id = 1", (r) => body<PullRecord>(r));
  }

  saveLastPull(p: PullRecord): void {
    this.db.prepare("INSERT INTO last_pull (id, body) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body").run(JSON.stringify(p));
  }

  recordAudit(e: Omit<AuditEntry, "id">): void {
    this.db.prepare("INSERT INTO audit (at, actor, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)").run(e.at, e.actor, e.action, e.targetType, e.targetId, e.detail);
  }

  listAudit(limit: number): AuditEntry[] {
    return this.all("SELECT * FROM audit ORDER BY id DESC LIMIT ?", toAudit, Math.max(1, Math.min(limit, 1000)));
  }

  /** Nested calls become savepoints, so a domain operation can call another safely. */
  transaction<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    if (this.depth === 0) this.db.exec("BEGIN");
    else this.db.exec(`SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const out = fn();
      this.depth -= 1;
      if (this.depth === 0) this.db.exec("COMMIT");
      else this.db.exec(`RELEASE ${name}`);
      return out;
    } catch (err) {
      this.depth -= 1;
      if (this.depth === 0) this.db.exec("ROLLBACK");
      else this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  snapshot(): Snapshot {
    return {
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      tasks: this.listTasks(),
      events: this.listEvents(),
      agendaItems: this.all("SELECT * FROM agenda_item ORDER BY event_id, ord", toAgendaItem),
      notes: this.listNotes(),
      issues: this.listIssues(),
      sprints: this.listSprints(),
      lastPull: this.getLastPull(),
    };
  }
}
