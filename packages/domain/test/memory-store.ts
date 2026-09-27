/** A Store held in memory, for tests of the domain alone. */

import {
  DEFAULT_SETTINGS,
  type AgendaItem,
  type AuditEntry,
  type Event,
  type IssueNote,
  type IssueSnapshot,
  type Numbered,
  type PullRecord,
  type Settings,
  type Snapshot,
  type SprintSnapshot,
  type Store,
  type Task,
} from "../src/index.js";

export class MemoryStore implements Store {
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  tasks = new Map<string, Task>();
  events = new Map<string, Event>();
  agenda = new Map<string, AgendaItem>();
  notes = new Map<string, IssueNote>();
  issues = new Map<string, IssueSnapshot>();
  sprints = new Map<string, SprintSnapshot>();
  lastPull: PullRecord | null = null;
  audit: AuditEntry[] = [];

  transaction<T>(fn: () => T): T {
    const saved = structuredClone({ settings: this.settings, lastPull: this.lastPull, audit: this.audit, tasks: [...this.tasks], events: [...this.events], agenda: [...this.agenda], notes: [...this.notes], issues: [...this.issues], sprints: [...this.sprints] });
    try {
      return fn();
    } catch (err) {
      this.settings = saved.settings;
      this.tasks = new Map(saved.tasks);
      this.events = new Map(saved.events);
      this.agenda = new Map(saved.agenda);
      this.notes = new Map(saved.notes);
      this.issues = new Map(saved.issues);
      this.sprints = new Map(saved.sprints);
      this.lastPull = saved.lastPull;
      this.audit = saved.audit;
      throw err;
    }
  }

  nextNumber(kind: Numbered): number {
    const list = kind === "task" ? [...this.tasks.values()] : [...this.events.values()];
    return Math.max(0, ...list.map((x) => x.number)) + 1;
  }

  getSettings = () => structuredClone(this.settings);
  saveSettings = (s: Settings) => void (this.settings = structuredClone(s));
  listTasks = () => [...this.tasks.values()].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  getTask = (id: string) => this.tasks.get(id) ?? null;
  saveTask = (t: Task) => void this.tasks.set(t.id, { ...t });
  listEvents = () => [...this.events.values()];
  getEvent = (id: string) => this.events.get(id) ?? null;
  saveEvent = (e: Event) => void this.events.set(e.id, { ...e });
  listAgendaItems = (eventId: string) => [...this.agenda.values()].filter((a) => a.eventId === eventId).sort((a, b) => a.order - b.order);
  getAgendaItem = (id: string) => this.agenda.get(id) ?? null;
  saveAgendaItem = (a: AgendaItem) => void this.agenda.set(a.id, { ...a });
  listNotes = () => [...this.notes.values()];
  getNote = (key: string) => this.notes.get(key) ?? null;
  saveNote = (n: IssueNote) => void this.notes.set(n.key, { ...n });
  listIssues = () => [...this.issues.values()];
  getIssue = (key: string) => this.issues.get(key) ?? null;
  saveIssue = (i: IssueSnapshot) => void this.issues.set(i.key, structuredClone(i));
  listSprints = () => [...this.sprints.values()];
  getSprint = (id: string) => this.sprints.get(id) ?? null;
  saveSprint = (s: SprintSnapshot) => void this.sprints.set(s.id, { ...s });
  getLastPull = () => this.lastPull;
  saveLastPull = (p: PullRecord) => void (this.lastPull = p);
  recordAudit = (e: Omit<AuditEntry, "id">) => void this.audit.push({ ...e, id: this.audit.length + 1 });
  listAudit = (limit: number) => [...this.audit].reverse().slice(0, limit);

  snapshot(): Snapshot {
    return {
      exportedAt: "",
      settings: this.getSettings(),
      tasks: this.listTasks(),
      events: this.listEvents(),
      agendaItems: [...this.agenda.values()],
      notes: this.listNotes(),
      issues: this.listIssues(),
      sprints: this.listSprints(),
      lastPull: this.lastPull,
    };
  }
}

/** An issue with everything filled in, for tests to change what they need. */
export function issue(key: string, over: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return {
    key,
    url: `https://example.atlassian.net/browse/${key}`,
    summary: `Summary of ${key}`,
    type: "Story",
    subtask: false,
    status: "To Do",
    statusCategory: "todo",
    priority: "Medium",
    points: 3,
    assignee: "Me",
    assignedToMe: true,
    reporter: "Someone",
    sprintIds: [],
    parent: null,
    labels: [],
    description: "",
    created: "2026-10-01T09:00:00.000+10:00",
    updated: "2026-10-01T09:00:00.000+10:00",
    resolved: null,
    due: null,
    started: null,
    flagged: false,
    links: [],
    comments: [],
    fetchedAt: "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

export function sprint(id: string, over: Partial<SprintSnapshot> = {}): SprintSnapshot {
  return { id, name: `Team Sprint ${id}`, state: "future", startDate: null, endDate: null, completeDate: null, goal: "", boardId: "7", fetchedAt: "2026-10-20T00:00:00.000Z", ...over };
}
