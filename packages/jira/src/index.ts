/**
 * One-way pull from Jira: your issues and your board's sprints are read and
 * kept here as copies. Nothing is ever written to Jira; every request is a
 * GET. Works with Jira Cloud (email and API token) and Jira Data Center
 * (personal access token).
 *
 * Credentials come from the environment and are only ever put in the
 * Authorization header. They are never stored, logged or put in an error.
 */

import {
  isIssueKey,
  richTextToPlain,
  statusCategoryOf,
  todayISO,
  type Battlestation,
  type IssueComment,
  type IssueLinkView,
  type IssueSnapshot,
  type PullResult,
  type SprintSnapshot,
  type SprintState,
  type StatusCategory,
} from "@battlestation/domain";

export type Deployment = "cloud" | "datacenter";

export interface JiraConnection {
  baseUrl: string;
  deployment: Deployment;
  auth: { email: string; token: string } | { pat: string };
}

export type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; redirect: "error"; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string> }>;

/** A request Jira refused, or a Jira that could not be reached. The message never holds a credential. */
export class JiraError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "JiraError";
  }
}

/**
 * The connection, from the environment:
 *
 *   JIRA_BASE_URL    the site, such as https://example.atlassian.net
 *   JIRA_EMAIL       with JIRA_API_TOKEN, for Jira Cloud
 *   JIRA_API_TOKEN
 *   JIRA_PAT         a personal access token, for Jira Data Center
 *   JIRA_DEPLOYMENT  cloud or datacenter, when it cannot be told from the above
 *
 * The address comes from the same place as the credentials and nowhere
 * else, so that nothing which can change the settings can send the token
 * somewhere of its choosing.
 */
export function connectionFromEnv(env: NodeJS.ProcessEnv): JiraConnection {
  const raw = env.JIRA_BASE_URL?.trim() ?? "";
  if (!raw) throw new JiraError("No Jira address. Set JIRA_BASE_URL in .env.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JiraError("JIRA_BASE_URL is not an address.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new JiraError("The Jira address must start with https://, so that the token is not sent in the clear.");
  if (url.username || url.password) throw new JiraError("Put the credentials in JIRA_EMAIL and JIRA_API_TOKEN, or JIRA_PAT, not in the address.");
  const baseUrl = (url.origin + url.pathname).replace(/\/+$/, "");
  const pat = env.JIRA_PAT?.trim();
  const email = env.JIRA_EMAIL?.trim();
  const token = env.JIRA_API_TOKEN?.trim();
  const said = env.JIRA_DEPLOYMENT?.trim().toLowerCase();
  if (said && said !== "cloud" && said !== "datacenter") throw new JiraError("JIRA_DEPLOYMENT must be cloud or datacenter.");
  if (pat) return { baseUrl, deployment: said === "cloud" ? "cloud" : "datacenter", auth: { pat } };
  if (email && token) return { baseUrl, deployment: said === "datacenter" ? "datacenter" : "cloud", auth: { email, token } };
  throw new JiraError("No Jira credentials. Set JIRA_EMAIL and JIRA_API_TOKEN (Cloud), or JIRA_PAT (Data Center), in .env.");
}

type Json = Record<string, any>;

const RETRIES = 4;

/** A small reading client. It knows the handful of endpoints the pull needs, and nothing that writes. */
export class JiraClient {
  private readonly api: string;

  constructor(
    readonly connection: JiraConnection,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.api = connection.deployment === "cloud" ? "/rest/api/3" : "/rest/api/2";
  }

  private headers(): Record<string, string> {
    const a = this.connection.auth;
    const authorization = "pat" in a ? `Bearer ${a.pat}` : `Basic ${Buffer.from(`${a.email}:${a.token}`).toString("base64")}`;
    return { Accept: "application/json", Authorization: authorization };
  }

  /** GET a path with query parameters. Waits and tries again when Jira says too many requests. */
  async get<T = Json>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    const url = `${this.connection.baseUrl}${path}${q.size ? `?${q}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetchImpl(url, { method: "GET", headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        throw new JiraError(`Could not reach Jira at ${this.connection.baseUrl}: ${(err as Error).message}`);
      }
      if (res.status === 429 && attempt < RETRIES) {
        const after = Number(res.headers.get("Retry-After"));
        await this.sleep(Math.max(Number.isFinite(after) ? after * 1000 : 0, 2000 * 2 ** attempt) * (0.7 + Math.random() * 0.6));
        continue;
      }
      if (res.status === 401) throw new JiraError("Jira did not accept the credentials (401). Check the email and token, or the personal access token.", 401);
      if (res.status === 403) throw new JiraError(`Jira refused access to ${path} (403).`, 403);
      if (res.status < 200 || res.status >= 300) {
        let detail = "";
        try {
          const body = (await res.json()) as Json;
          detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join(" ");
        } catch {
          // Not JSON: say only the status.
        }
        throw new JiraError(`Jira answered ${res.status} for ${path}${detail ? `: ${detail}` : ""}`, res.status);
      }
      return (await res.json()) as T;
    }
  }

  myself(): Promise<Json> {
    return this.get(`${this.api}/myself`);
  }

  fields(): Promise<Json[]> {
    return this.get<Json[]>(`${this.api}/field`);
  }

  /** Every status, by id, with its category. Used to tell from an issue's history when it went into progress. */
  async statusCategories(): Promise<Map<string, StatusCategory>> {
    const list = await this.get<Json[]>(`${this.api}/status`).catch(() => [] as Json[]);
    return new Map(list.map((s) => [String(s.id), categoryOf(s.statusCategory)]));
  }

  async boardEstimationField(boardId: string): Promise<string | null> {
    const config = await this.get(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/configuration`).catch(() => null);
    return config?.estimation?.field?.fieldId ?? null;
  }

  async sprints(boardId: string): Promise<Json[]> {
    const out: Json[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.get(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`, { startAt, maxResults: 50 });
      const values: Json[] = page.values ?? [];
      out.push(...values);
      if (page.isLast !== false || values.length === 0) return out;
      startAt += values.length;
    }
  }

  /** Every issue a query finds. Cloud pages by token; Data Center by position. */
  async search(jql: string, fields: string[], changelog: boolean): Promise<Json[]> {
    const out: Json[] = [];
    const common = { jql, fields: fields.join(","), expand: changelog ? "changelog" : undefined, maxResults: 100 };
    if (this.connection.deployment === "cloud") {
      for (let token: string | undefined; ; ) {
        const page = await this.get(`${this.api}/search/jql`, { ...common, nextPageToken: token });
        out.push(...(page.issues ?? []));
        token = page.nextPageToken;
        if (!token || page.isLast === true || (page.issues ?? []).length === 0) return out;
      }
    }
    for (let startAt = 0; ; ) {
      const page = await this.get(`${this.api}/search`, { ...common, startAt });
      const issues: Json[] = page.issues ?? [];
      out.push(...issues);
      startAt += issues.length;
      if (issues.length === 0 || (typeof page.total === "number" && startAt >= page.total)) return out;
    }
  }

  /** An issue's whole history, oldest first. Cloud only; Data Center gives it with the search. */
  async changelog(key: string): Promise<Json[]> {
    const out: Json[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.get(`${this.api}/issue/${encodeURIComponent(key)}/changelog`, { startAt, maxResults: 100 });
      const values: Json[] = page.values ?? [];
      out.push(...values);
      if (page.isLast !== false || values.length === 0) return out;
      startAt += values.length;
    }
  }
}

/** A status category object in our words. Its key where known; its colour where not. */
function categoryOf(cat: Json | undefined): StatusCategory {
  if (!cat) return "todo";
  if (cat.key === "done" || cat.key === "indeterminate" || cat.key === "new") return statusCategoryOf(cat.key);
  if (cat.colorName === "green") return "done";
  if (cat.colorName === "yellow") return "doing";
  return "todo";
}

/** A local calendar date for a Jira timestamp. */
function localDate(value: unknown): string | null {
  if (typeof value !== "string" || !value || value === "<null>") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : todayISO(d);
}

function sprintState(value: unknown): SprintState {
  const s = String(value ?? "").toLowerCase();
  return s === "active" ? "active" : s === "closed" ? "closed" : "future";
}

/**
 * A sprint as the issue's sprint field gives it. Cloud gives an object;
 * older Data Center gives a string such as
 * "com.atlassian.greenhopper.service.sprint.Sprint@1a2b[id=12,rapidViewId=7,state=ACTIVE,name=Sprint 12,startDate=...]".
 */
export function parseSprintValue(value: unknown, fetchedAt: string): SprintSnapshot | null {
  let v: Json | null = null;
  if (value && typeof value === "object") v = value as Json;
  else if (typeof value === "string") {
    const inside = /\[(.*)\]\s*$/.exec(value)?.[1];
    if (!inside) return null;
    v = {};
    // Values can hold commas (a name, a goal), so split only where the next key starts.
    for (const m of inside.matchAll(/(\w+)=(.*?)(?=,\w+=|$)/g)) v[m[1]] = m[2];
    v.boardId = v.boardId ?? v.rapidViewId;
  }
  if (!v || v.id === undefined || v.id === null) return null;
  return {
    id: String(v.id),
    name: String(v.name ?? `Sprint ${v.id}`),
    state: sprintState(v.state),
    startDate: localDate(v.startDate),
    endDate: localDate(v.endDate),
    completeDate: localDate(v.completeDate),
    goal: v.goal && v.goal !== "<null>" ? String(v.goal) : "",
    boardId: v.boardId !== undefined && v.boardId !== null && v.boardId !== "<null>" ? String(v.boardId) : v.originBoardId !== undefined ? String(v.originBoardId) : null,
    fetchedAt,
  };
}

/** Who a user is, for telling your issues from others'. Cloud has account ids; Data Center has names and keys. */
function sameUser(a: Json | null | undefined, b: Json): boolean {
  if (!a) return false;
  if (a.accountId && b.accountId) return a.accountId === b.accountId;
  return (!!a.key && a.key === b.key) || (!!a.name && a.name === b.name);
}

export interface FieldIds {
  points: string | null;
  sprint: string | null;
  flagged: string | null;
  epicLink: string | null;
}

/** The custom fields the pull needs, found in Jira's field list unless the settings name them. */
export function findFields(fields: Json[], given: { points: string | null; sprint: string | null }, boardPoints: string | null): FieldIds {
  const byCustom = (type: string) => fields.find((f) => f.schema?.custom === type)?.id ?? null;
  const byName = (...names: string[]) => fields.find((f) => names.some((n) => String(f.name).toLowerCase() === n.toLowerCase()))?.id ?? null;
  return {
    points: given.points ?? boardPoints ?? byName("Story point estimate", "Story Points"),
    sprint: given.sprint ?? byCustom("com.pyxis.greenhopper.jira:gh-sprint") ?? byName("Sprint"),
    flagged: byName("Flagged"),
    epicLink: byCustom("com.pyxis.greenhopper.jira:gh-epic-link") ?? byName("Epic Link"),
  };
}

const BLOCKS = /block/i;

function linksOf(raw: Json[] | undefined): IssueLinkView[] {
  return (raw ?? []).flatMap((l): IssueLinkView[] => {
    const other = l.outwardIssue ?? l.inwardIssue;
    if (!other?.key) return [];
    const outward = !!l.outwardIssue;
    const blocking = BLOCKS.test(String(l.type?.name ?? ""));
    return [
      {
        key: other.key,
        summary: String(other.fields?.summary ?? ""),
        statusCategory: categoryOf(other.fields?.status?.statusCategory),
        direction: blocking ? (outward ? "blocks" : "blocked_by") : "other",
        label: String((outward ? l.type?.outward : l.type?.inward) ?? l.type?.name ?? "relates to"),
      },
    ];
  });
}

const COMMENTS_KEPT = 5;

function commentsOf(raw: Json | undefined): IssueComment[] {
  const list: Json[] = raw?.comments ?? [];
  return list.slice(-COMMENTS_KEPT).map((c) => ({ author: String(c.author?.displayName ?? c.author?.name ?? "someone"), at: String(c.created ?? ""), body: richTextToPlain(c.body) }));
}

/** When an issue first went into progress, from its history: the earliest move to a status in the "doing" category. */
export function firstStarted(histories: Json[], categories: Map<string, StatusCategory>, currentStatusName: string | null): string | null {
  const moves = histories
    .flatMap((h) => (h.items ?? []).filter((i: Json) => i.field === "status" || i.fieldId === "status").map((i: Json) => ({ at: String(h.created), to: String(i.to ?? ""), toName: String(i.toString ?? "") })))
    .sort((a, b) => a.at.localeCompare(b.at));
  const into = moves.find((m) => {
    const known = categories.get(m.to);
    if (known) return known === "doing";
    return /progress/i.test(m.toName) || (currentStatusName !== null && m.toName === currentStatusName);
  });
  return into?.at ?? null;
}

export interface PullOptions {
  connection: JiraConnection;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Who is recorded as having made the change. */
  actor?: string;
  now?: () => Date;
}

/** Issues are read from this far back once resolved, so the last few sprints have their done work. */
const DEFAULT_JQL = "assignee = currentUser() AND (resolution = Unresolved OR resolved >= -42d) ORDER BY updated DESC";

/**
 * Read your issues and your board's sprints from Jira and keep them. The
 * query and board come from the settings; the credentials from the options.
 */
export async function pullFromJira(app: Battlestation, options: PullOptions): Promise<PullResult & { me: string }> {
  const client = new JiraClient(options.connection, options.fetch, options.sleep);
  const settings = app.getSettings();
  const fetchedAt = (options.now?.() ?? new Date()).toISOString();
  const cloud = options.connection.deployment === "cloud";

  const me = await client.myself();
  const boardId = settings.jira.boardId;
  const [allFields, categories, boardPoints] = await Promise.all([client.fields(), client.statusCategories(), boardId ? client.boardEstimationField(boardId) : Promise.resolve(null)]);
  const ids = findFields(allFields, { points: settings.jira.pointsField, sprint: settings.jira.sprintField }, boardPoints);

  const wanted = ["summary", "status", "issuetype", "priority", "assignee", "reporter", "labels", "created", "updated", "resolutiondate", "duedate", "parent", "issuelinks", "comment", "description"];
  for (const f of [ids.points, ids.sprint, ids.flagged, ids.epicLink]) if (f) wanted.push(f);
  const raw = await client.search(settings.jira.jql.trim() || DEFAULT_JQL, wanted, true);

  const sprints = new Map<string, SprintSnapshot>();
  if (boardId) for (const s of await client.sprints(boardId)) {
    const parsed = parseSprintValue(s, fetchedAt);
    if (parsed) sprints.set(parsed.id, parsed);
  }

  const issues: IssueSnapshot[] = [];
  const epicKeys = new Set<string>();
  for (const r of raw) {
    const f: Json = r.fields ?? {};
    const sprintValues: unknown[] = ids.sprint && Array.isArray(f[ids.sprint]) ? f[ids.sprint] : [];
    const inSprints = sprintValues.map((v) => parseSprintValue(v, fetchedAt)).filter((s): s is SprintSnapshot => s !== null);
    // Sprints named on issues are kept too, when no board is set or the board does not list them.
    for (const s of inSprints) if (!sprints.has(s.id)) sprints.set(s.id, s);
    const ordered = [...inSprints].sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || Number(a.id) - Number(b.id));
    const statusCategory = categoryOf(f.status?.statusCategory);

    let histories: Json[] = r.changelog?.histories ?? [];
    let started = firstStarted(histories, categories, statusCategory === "doing" ? (f.status?.name ?? null) : null);
    const truncated = typeof r.changelog?.total === "number" && r.changelog.total > histories.length;
    if (!started && cloud && truncated && statusCategory !== "todo") {
      histories = await client.changelog(r.key);
      started = firstStarted(histories, categories, statusCategory === "doing" ? (f.status?.name ?? null) : null);
    }

    let parent: IssueSnapshot["parent"] = null;
    if (f.parent?.key) parent = { key: f.parent.key, summary: String(f.parent.fields?.summary ?? f.parent.key), type: String(f.parent.fields?.issuetype?.name ?? "Parent") };
    else if (ids.epicLink && typeof f[ids.epicLink] === "string") {
      parent = { key: f[ids.epicLink], summary: f[ids.epicLink], type: "Epic" };
      epicKeys.add(f[ids.epicLink]);
    }

    const points = ids.points ? f[ids.points] : null;
    const flagValue = ids.flagged ? f[ids.flagged] : null;
    const flagged = Array.isArray(flagValue) ? flagValue.length > 0 : !!flagValue;
    issues.push({
      key: r.key,
      url: `${options.connection.baseUrl}/browse/${r.key}`,
      summary: String(f.summary ?? ""),
      type: String(f.issuetype?.name ?? "Issue"),
      subtask: !!f.issuetype?.subtask,
      status: String(f.status?.name ?? ""),
      statusCategory,
      priority: f.priority?.name ?? null,
      points: typeof points === "number" ? points : null,
      assignee: f.assignee?.displayName ?? f.assignee?.name ?? null,
      assignedToMe: sameUser(f.assignee, me),
      reporter: f.reporter?.displayName ?? f.reporter?.name ?? null,
      sprintIds: ordered.map((s) => s.id),
      parent,
      labels: Array.isArray(f.labels) ? f.labels.map(String) : [],
      description: richTextToPlain(f.description),
      created: String(f.created ?? ""),
      updated: String(f.updated ?? ""),
      resolved: f.resolutiondate ?? null,
      due: typeof f.duedate === "string" ? f.duedate : null,
      started,
      flagged,
      links: linksOf(f.issuelinks),
      comments: commentsOf(f.comment),
      fetchedAt,
    });
  }

  // On Data Center an epic is named by key only; read the names of those not already here.
  const missing = [...epicKeys].filter((k) => isIssueKey(k) && !issues.some((i) => i.key === k));
  if (missing.length) {
    const found = await client.search(`key in (${missing.join(",")})`, ["summary", "issuetype"], false).catch(() => []);
    const names = new Map(found.map((e) => [e.key as string, { summary: String(e.fields?.summary ?? e.key), type: String(e.fields?.issuetype?.name ?? "Epic") }]));
    for (const i of issues) if (i.parent && names.has(i.parent.key)) i.parent = { key: i.parent.key, ...names.get(i.parent.key)! };
  }
  for (const i of issues) {
    if (!i.parent || i.parent.summary !== i.parent.key) continue;
    const here = issues.find((x) => x.key === i.parent!.key);
    if (here) i.parent = { key: here.key, summary: here.summary, type: here.type };
  }

  const who = String(me.displayName ?? me.name ?? me.accountId ?? "you");
  if (settings.jira.baseUrl !== options.connection.baseUrl) app.updateSettings(options.actor ?? "pull", { jira: { baseUrl: options.connection.baseUrl } });
  const result = app.recordPull(options.actor ?? "pull", { issues, sprints: [...sprints.values()], me: who, at: fetchedAt });
  return { ...result, me: who };
}
