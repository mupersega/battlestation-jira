/**
 * What is stored. Two kinds of thing live here: copies of what Jira says
 * (issues and sprints, in jira.ts), and what is yours alone: your own tasks,
 * your meetings with their agendas, your private notes on issues, and the
 * settings. Nothing derived is stored; statuses are worked out every time.
 */

import type { ISODate, ISODateTime } from "./dates.js";
import type { IssueSnapshot, SprintSnapshot } from "./jira.js";

// ---------------------------------------------------------------------------
// Your own work

export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "dropped";

export const TASK_STATUSES: ReadonlyArray<TaskStatus> = ["todo", "doing", "blocked", "done", "dropped"];

/** The kinds of task in use until the settings say otherwise. */
export const DEFAULT_TASK_TYPES: ReadonlyArray<string> = ["build", "fix", "review", "research", "write"];

/**
 * A piece of work that is yours: smaller than an issue, or not in Jira at
 * all. It can serve an issue, sit in a sprint, or be neither yet.
 */
export interface Task {
  id: string;
  /** Your own reference, shown as T-12. */
  number: number;
  title: string;
  /** One of the task types in settings. */
  type: string;
  /** What has to be done and how to tell it is done. */
  description: string;
  status: TaskStatus;
  /** Why it cannot move, while blocked. */
  blockedBy: string;
  /** The Jira issue it serves, by key. */
  issueKey: string | null;
  /** The sprint it is planned for. Follows the issue when there is one. */
  sprintId: string | null;
  order: number;
  startedOn: ISODate | null;
  doneOn: ISODate | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Meetings

export type EventKind = "planning" | "refinement" | "review" | "retro" | "one_on_one" | "meeting" | "deadline";

export const EVENT_KINDS: ReadonlyArray<EventKind> = ["planning", "refinement", "review", "retro", "one_on_one", "meeting", "deadline"];

export type EventStatus = "planned" | "done" | "cancelled";

export interface Event {
  id: string;
  /** Your own reference, shown as E-2. */
  number: number;
  kind: EventKind;
  title: string;
  /** When it happens. Null for one that is agreed but not yet booked. */
  at: ISODateTime | null;
  status: EventStatus;
  notes: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type AgendaItemStatus = "open" | "answered" | "dropped";

export interface AgendaItem {
  id: string;
  eventId: string;
  order: number;
  text: string;
  answer: string | null;
  status: AgendaItemStatus;
  /** An issue the point is about, by key. */
  issueKey: string | null;
}

// ---------------------------------------------------------------------------
// Your notes on Jira issues

/**
 * What you have to say about an issue, kept here and never sent to Jira: a
 * private note, and when you last looked at it. An issue that has changed
 * in Jira since you last looked is new to you again.
 */
export interface IssueNote {
  key: string;
  note: string;
  /** The issue's own updated time when you marked it seen. */
  seenUpdated: ISODateTime | null;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Settings

export interface JiraSettings {
  /** The site, such as https://example.atlassian.net. Credentials are never stored here. */
  baseUrl: string | null;
  /** The board whose sprints are read. */
  boardId: string | null;
  /**
   * Which issues are read. Left empty, the pull reads what is assigned to
   * you, open or resolved in the last few weeks.
   */
  jql: string;
  /** The custom field that holds story points, such as customfield_10016. Found by name when not set. */
  pointsField: string | null;
  /** The custom field that holds the sprint. Found by name when not set. */
  sprintField: string | null;
  /** The team's time zone, for turning sprint start and end times into days. The machine's when not set. */
  timeZone: string | null;
}

export interface Settings {
  /** What the top left of the screen says. */
  title: string;
  /** Said beside it: a team, a project. */
  subtitle: string;
  jira: JiraSettings;
  /** Story points you plan to take on in a sprint. Null until you say. */
  capacityPoints: number | null;
  /** An issue in progress for more working days than this is called out. */
  staleAfterDays: number;
  taskTypes: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  title: "Battlestation",
  subtitle: "",
  jira: { baseUrl: null, boardId: null, jql: "", pointsField: null, sprintField: null, timeZone: null },
  capacityPoints: null,
  staleAfterDays: 4,
  taskTypes: [...DEFAULT_TASK_TYPES],
};

// ---------------------------------------------------------------------------
// The record of changes

export interface AuditEntry {
  id: number;
  at: ISODateTime;
  /** Who or what made the change: "mcp:<client name>", "bridge", "pull". */
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
}

export interface PullRecord {
  at: ISODateTime;
  /** Who the pull was run for, as Jira names them. */
  me: string | null;
  issues: number;
  sprints: number;
}

/** Everything stored, for the JSON export. */
export interface Snapshot {
  exportedAt: ISODateTime;
  settings: Settings;
  tasks: Task[];
  events: Event[];
  agendaItems: AgendaItem[];
  notes: IssueNote[];
  issues: IssueSnapshot[];
  sprints: SprintSnapshot[];
  lastPull: PullRecord | null;
}

export type Numbered = "task" | "event";

/** Where everything is kept. The domain never touches storage except through this. */
export interface Store {
  transaction<T>(fn: () => T): T;
  nextNumber(kind: Numbered): number;

  getSettings(): Settings;
  saveSettings(s: Settings): void;

  listTasks(): Task[];
  getTask(id: string): Task | null;
  saveTask(t: Task): void;

  listEvents(): Event[];
  getEvent(id: string): Event | null;
  saveEvent(e: Event): void;
  listAgendaItems(eventId: string): AgendaItem[];
  getAgendaItem(id: string): AgendaItem | null;
  saveAgendaItem(a: AgendaItem): void;

  listNotes(): IssueNote[];
  getNote(key: string): IssueNote | null;
  saveNote(n: IssueNote): void;

  listIssues(): IssueSnapshot[];
  getIssue(key: string): IssueSnapshot | null;
  saveIssue(i: IssueSnapshot): void;
  listSprints(): SprintSnapshot[];
  getSprint(id: string): SprintSnapshot | null;
  saveSprint(s: SprintSnapshot): void;
  getLastPull(): PullRecord | null;
  saveLastPull(p: PullRecord): void;

  recordAudit(entry: Omit<AuditEntry, "id">): void;
  listAudit(limit: number): AuditEntry[];

  snapshot(): Snapshot;
}
