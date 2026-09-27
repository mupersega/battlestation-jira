/**
 * The Battlestation MCP server. Every tool is a thin call into the domain
 * service; no logic lives here. Registration order is the tools/list order;
 * keep it stable.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { JiraError, connectionFromEnv, pullFromJira, type FetchLike } from "@battlestation/jira";
import { Battlestation, DomainError, EVENT_KINDS, TASK_STATUSES, currentSprintId, focusSprint, type IssueView, type Overview } from "@battlestation/domain";

const INSTRUCTIONS = `Battlestation: one person's sprint work. Their Jira issues and their board's sprints are copied here, read-only, by a one-way pull; next to them sit their own tasks, meetings with agendas, and private notes on issues, none of which are ever sent to Jira.

Start with get_today: the active sprint and its points, what is in hand, what wants attention, and meetings coming up. Issues are addressed by key (ABC-123), sprints by Jira's id, tasks by id or T-n, meetings by id or E-n. Statuses such as stale or behind are worked out every time, never stored. Every change is audited under your client name.

Three levels, never mixed. An issue is Jira's and stays as Jira says; to change one, change it in Jira and pull again. A task is the person's own breakdown of the work, under an issue or on its own. A meeting is theirs, with points to raise that can name an issue.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MUTATING = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const json = (value: unknown) => text(JSON.stringify(value, null, 2));
const fail = (message: string) => ({ content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

function guard<R>(fn: () => R): R | ReturnType<typeof fail> {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DomainError) return fail(err.message);
    throw err;
  }
}

const pts = (n: number) => `${n} pt${n === 1 ? "" : "s"}`;

function issueLine(v: IssueView): string {
  const i = v.issue;
  const bits = [i.status, i.points === null ? "no estimate" : pts(i.points), v.blockedBy.length ? `blocked by ${v.blockedBy.map((b) => b.key).join(", ")}` : "", i.flagged ? "flagged" : "", v.stale ? `stale, ${v.daysInProgress} working days` : "", i.due ? `due ${i.due}` : ""].filter(Boolean);
  return `- ${i.key} ${i.summary} (${bits.join(", ")})${v.fresh ? " [new to you]" : ""}`;
}

export function renderToday(o: Overview): string {
  const lines: string[] = [`# ${o.title}: ${o.today}`, ""];
  const s = focusSprint(o);
  if (s) {
    const p = s.points;
    lines.push(`## ${s.sprint.name} (${s.phase}${s.sprint.startDate ? `, ${s.sprint.startDate} to ${s.sprint.endDate}` : ""})`);
    if (s.sprint.goal) lines.push(`Goal: ${s.sprint.goal}`);
    lines.push(
      `Your points: ${p.done} done, ${p.doing} in progress, ${p.todo} to do, of ${p.committed}${p.unestimated ? `; ${p.unestimated} unestimated` : ""}.${o.capacity !== null ? ` Capacity ${o.capacity}.` : ""}${s.daysLeft !== null ? ` ${s.daysLeft} working days left.` : ""}${s.expected !== null ? ` A straight line says ${s.expected} done by now.` : ""}`,
    );
    for (const v of s.issues) lines.push(issueLine(v));
    lines.push("");
  } else lines.push("No sprints have been read. Run pull_jira.", "");
  if (o.velocity.average !== null) lines.push(`Velocity: ${o.velocity.average} points a sprint, over the last ${Math.min(3, o.velocity.sprints.length)} closed.`, "");
  const work = o.signals.filter((g) => g.level === "work");
  const needs = o.signals.filter((g) => g.level !== "work");
  lines.push("## In hand");
  if (work.length) for (const g of work) lines.push(`- ${o.refs[`${g.ref.type}:${g.ref.id}`] ?? ""} ${g.subject}: ${g.text}`);
  else lines.push("(nothing in progress)");
  lines.push("", "## Needs attention");
  if (needs.length) for (const g of needs) lines.push(`- [${g.level}] ${o.refs[`${g.ref.type}:${g.ref.id}`] ?? ""} ${g.subject}: ${g.text}. ${g.next}`);
  else lines.push("(nothing)");
  if (o.inbox.length) lines.push("", `## New to you (${o.inbox.length})`, ...o.inbox.slice(0, 15).map(issueLine));
  lines.push("", "## Meetings");
  if (o.events.length) for (const e of o.events) lines.push(`- E-${e.number} ${e.title} (${e.kind}) ${e.at ? `at ${e.at}` : "no date yet"}${e.agenda.length ? `, ${e.agenda.filter((a) => a.status === "open").length} of ${e.agenda.length} points open` : ""}`);
  else lines.push("(none planned)");
  lines.push("", o.lastPull ? `Last read from Jira: ${o.lastPull.at}, for ${o.lastPull.me ?? "unknown"}.` : "Never read from Jira.");
  return lines.join("\n");
}

export interface ServerOptions {
  app: Battlestation;
  version: string;
  /** Where the Jira credentials are read from. Replaced in tests. */
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
}

export function buildServer({ app, version, env = process.env, fetch }: ServerOptions): McpServer {
  const server = new McpServer(
    { name: "battlestation", version },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: INSTRUCTIONS,
      cacheHints: { "tools/list": { ttlMs: 3_600_000, cacheScope: "private" } },
    },
  );

  // Who made a change, for the record: the client's name when the request carries it.
  const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
  const actorOf = (ctx: unknown): string => {
    const meta = (ctx as { mcpReq?: { _meta?: Record<string, unknown> } } | undefined)?.mcpReq?._meta;
    const info = meta?.[CLIENT_INFO_META_KEY] as { name?: string } | undefined;
    return info?.name ? `mcp:${info.name}` : "mcp";
  };

  // ------------------------------------------------------------ The picture

  server.registerTool(
    "get_today",
    {
      description: "What is going on: the active sprint with your points and issues, velocity, what is in hand, what needs attention, what is new to you, and meetings. Call this first.",
      inputSchema: z.object({ format: z.enum(["text", "json"]).optional().describe("text (default) or json") }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const o = app.getOverview();
      return a.format === "json" ? json({ today: o.today, sprint: focusSprint(o), signals: o.signals, inbox: o.inbox.map((v) => v.issue.key), events: o.events, velocity: o.velocity }) : text(renderToday(o));
    },
  );

  server.registerTool(
    "get_overview",
    { description: "Everything at once, as the screen draws it: sprints, issues, backlog, tasks, meetings, signals and where each thing is in its life. Large.", inputSchema: z.object({}), annotations: READ_ONLY },
    async () => json(app.getOverview()),
  );

  server.registerTool(
    "list_issues",
    {
      description: "Your issues as one line each. Filter by where they are (active, next, backlog, or a sprint id) and by status category.",
      inputSchema: z.object({
        where: z.string().optional().describe("active, next, backlog, or a sprint id; all when left out"),
        status: z.enum(["todo", "doing", "done"]).optional(),
        include_others: z.boolean().optional().describe("include issues read that are not assigned to you"),
      }),
      annotations: READ_ONLY,
    },
    async (a) => {
      const o = app.getOverview();
      let list = Object.values(o.issues).filter((v) => a.include_others || v.issue.assignedToMe);
      if (a.where === "backlog") list = o.backlog;
      else if (a.where) {
        const id = a.where === "active" ? o.activeSprintId : a.where === "next" ? (o.sprints.find((s) => s.phase === "future")?.sprint.id ?? null) : a.where;
        list = list.filter((v) => currentSprintId(v.issue) === id);
      }
      if (a.status) list = list.filter((v) => v.issue.statusCategory === a.status);
      return text(list.length ? list.map(issueLine).join("\n") : "(none)");
    },
  );

  server.registerTool(
    "get_issue",
    { description: "One issue as last read from Jira, with your note, what blocks it, and your tasks under it.", inputSchema: z.object({ key: z.string() }), annotations: READ_ONLY },
    async (a) => guard(() => json(app.getIssue(a.key))),
  );

  server.registerTool(
    "list_sprints",
    { description: "The sprints read from Jira, with your points in each.", inputSchema: z.object({}), annotations: READ_ONLY },
    async () =>
      json(
        app.getOverview().sprints.map((s) => ({ id: s.sprint.id, name: s.sprint.name, state: s.phase, start: s.sprint.startDate, end: s.sprint.endDate, goal: s.sprint.goal, points: s.points, daysLeft: s.daysLeft, behind: s.behind, over: s.over })),
      ),
  );

  // --------------------------------------------------------------- Jira

  server.registerTool(
    "pull_jira",
    {
      description: "Read your issues and your board's sprints from Jira again, one way. Nothing is written to Jira. Needs the connection in the server's environment (JIRA_BASE_URL with JIRA_EMAIL and JIRA_API_TOKEN, or JIRA_PAT).",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (_a, ctx) => {
      try {
        const connection = connectionFromEnv(env, app.getSettings().jira.baseUrl);
        const r = await pullFromJira(app, { connection, fetch, actor: actorOf(ctx) });
        return text(`Read for ${r.me}: ${r.added.length} new, ${r.changed.length} changed, ${r.released.length} no longer yours, ${r.sprints} sprints.`);
      } catch (err) {
        if (err instanceof JiraError || err instanceof DomainError) return fail(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    "mark_seen",
    {
      description: "Mark issues as seen as they are now; one that changes in Jira afterwards is new again. Give keys, or all to mark everything new as seen.",
      inputSchema: z.object({ keys: z.array(z.string()).optional(), all: z.boolean().optional() }),
      annotations: MUTATING,
    },
    async (a, ctx) => guard(() => json(app.markSeen(actorOf(ctx), a.all ? app.getOverview().inbox.map((v) => v.issue.key) : (a.keys ?? [])))),
  );

  server.registerTool(
    "note_issue",
    { description: "Keep a private note on an issue. It stays here and is never sent to Jira. An empty note clears it.", inputSchema: z.object({ key: z.string(), note: z.string() }), annotations: MUTATING },
    async (a, ctx) => guard(() => json(app.noteIssue(actorOf(ctx), a))),
  );

  // --------------------------------------------------------------- Tasks

  server.registerTool(
    "list_tasks",
    { description: "Your own tasks, in order, with their status and the issue or sprint they sit under.", inputSchema: z.object({}), annotations: READ_ONLY },
    async () => json(app.listTasks()),
  );

  server.registerTool(
    "upsert_task",
    {
      description: "Make a task (no id) or change one. A task can serve a Jira issue (issue_key), which puts it in that issue's sprint; or sit in a sprint on its own; or neither yet.",
      inputSchema: z.object({
        id: z.string().optional().describe("id or T-n; leave out to make a new task"),
        title: z.string().optional(),
        description: z.string().optional(),
        type: z.string().optional().describe("one of the task types in the settings"),
        issue_key: z.string().nullable().optional(),
        sprint_id: z.string().nullable().optional(),
        order: z.number().int().optional(),
      }),
      annotations: MUTATING,
    },
    async (a, ctx) => guard(() => json(app.upsertTask(actorOf(ctx), { id: a.id, title: a.title, description: a.description, type: a.type, issueKey: a.issue_key, sprintId: a.sprint_id, order: a.order }))),
  );

  server.registerTool(
    "set_task_status",
    {
      description: "Move a task: todo, doing, blocked (with a reason), done, dropped. Starting records the start date and finishing the finish date.",
      inputSchema: z.object({ id: z.string(), status: z.enum(TASK_STATUSES as [string, ...string[]]), reason: z.string().optional(), on: isoDate.optional() }),
      annotations: MUTATING,
    },
    async (a, ctx) => guard(() => json(app.setTaskStatus(actorOf(ctx), { id: a.id, status: a.status as never, reason: a.reason, on: a.on }))),
  );

  // ------------------------------------------------------------ Meetings

  server.registerTool(
    "list_events",
    { description: "Your meetings, soonest first, with their agendas. Past and cancelled ones only when asked.", inputSchema: z.object({ include_closed: z.boolean().optional() }), annotations: READ_ONLY },
    async (a) => json(app.listEvents(a.include_closed ?? false)),
  );

  server.registerTool(
    "upsert_event",
    {
      description: `Make a meeting (no id) or change one. kind is one of ${EVENT_KINDS.join(", ")}. at is ISO 8601 with offset, or null for one agreed but not booked. Set status done once it has happened.`,
      inputSchema: z.object({
        id: z.string().optional(),
        title: z.string().optional(),
        kind: z.enum(EVENT_KINDS as [string, ...string[]]).optional(),
        at: z.string().nullable().optional(),
        status: z.enum(["planned", "done", "cancelled"]).optional(),
        notes: z.string().optional(),
      }),
      annotations: MUTATING,
    },
    async (a, ctx) => guard(() => json(app.upsertEvent(actorOf(ctx), { ...a, kind: a.kind as never }))),
  );

  server.registerTool(
    "add_agenda_item",
    { description: "Add a point to raise at a meeting, optionally about an issue.", inputSchema: z.object({ event_id: z.string(), text: z.string(), issue_key: z.string().optional() }), annotations: MUTATING },
    async (a, ctx) => guard(() => json(app.addAgendaItem(actorOf(ctx), { eventId: a.event_id, text: a.text, issueKey: a.issue_key }))),
  );

  server.registerTool(
    "update_agenda_item",
    {
      description: "Record the answer to an agenda point, reword it, reorder it, or drop it.",
      inputSchema: z.object({ id: z.string(), text: z.string().optional(), answer: z.string().nullable().optional(), status: z.enum(["open", "answered", "dropped"]).optional(), order: z.number().int().optional() }),
      annotations: MUTATING,
    },
    async (a, ctx) => guard(() => json(app.updateAgendaItem(actorOf(ctx), a))),
  );

  // ------------------------------------------------------------ Settings

  server.registerTool(
    "get_settings",
    { description: "The settings: title, Jira address, board and query, capacity in points, when in-progress counts as stale, task types. Never credentials.", inputSchema: z.object({}), annotations: READ_ONLY },
    async () => json(app.getSettings()),
  );

  server.registerTool(
    "update_settings",
    {
      description: "Change settings. Only what is given changes.",
      inputSchema: z.object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        jira_base_url: z.string().nullable().optional(),
        board_id: z.string().nullable().optional(),
        jql: z.string().optional().describe("which issues are read; empty for your own, open or recently resolved"),
        points_field: z.string().nullable().optional(),
        sprint_field: z.string().nullable().optional(),
        capacity_points: z.number().nullable().optional(),
        stale_after_days: z.number().int().optional(),
        task_types: z.array(z.string()).optional(),
      }),
      annotations: MUTATING,
    },
    async (a, ctx) =>
      guard(() =>
        json(
          app.updateSettings(actorOf(ctx), {
            title: a.title,
            subtitle: a.subtitle,
            jira: { baseUrl: a.jira_base_url, boardId: a.board_id, jql: a.jql, pointsField: a.points_field, sprintField: a.sprint_field },
            capacityPoints: a.capacity_points,
            staleAfterDays: a.stale_after_days,
            taskTypes: a.task_types,
          }),
        ),
      ),
  );

  // -------------------------------------------------------------- Record

  server.registerTool(
    "list_audit",
    { description: "The latest changes, newest first, with who or what made each.", inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional() }), annotations: READ_ONLY },
    async (a) => json(app.listAudit(a.limit ?? 50)),
  );

  server.registerTool(
    "export_json",
    { description: "Everything stored, as one JSON document.", inputSchema: z.object({}), annotations: READ_ONLY },
    async () => json(app.snapshot()),
  );

  server.registerResource(
    "today",
    "battlestation://today",
    { title: "Today", description: "The same view as get_today, as a document.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: renderToday(app.getOverview()) }] }),
  );

  return server;
}

