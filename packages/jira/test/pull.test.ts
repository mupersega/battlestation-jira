import { test } from "node:test";
import assert from "node:assert/strict";
import { Battlestation } from "@battlestation/domain";
import { SqliteStore } from "@battlestation/data";
import { JiraError, connectionFromEnv, findFields, firstStarted, parseSprintValue, pullFromJira, type FetchLike, type JiraConnection } from "../src/index.js";

/** A pretend Jira: answers from a table of paths, and remembers every request. */
function fakeJira(routes: Record<string, (q: URLSearchParams) => unknown | { status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ method: string; path: string; query: URLSearchParams; headers: Record<string, string> }> = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, query: u.searchParams, headers: init.headers });
    const route = routes[u.pathname];
    const out = route ? route(u.searchParams) : { status: 404, body: { errorMessages: ["No such thing"] } };
    const full = out && typeof out === "object" && "status" in (out as object) ? (out as { status: number; body?: unknown; headers?: Record<string, string> }) : { status: 200, body: out };
    return {
      status: full.status,
      headers: { get: (n: string) => full.headers?.[n] ?? null },
      json: async () => full.body,
      text: async () => JSON.stringify(full.body),
    };
  };
  return { fetch, calls };
}

const status = (name: string, key: string) => ({ name, statusCategory: { key, colorName: key === "done" ? "green" : key === "indeterminate" ? "yellow" : "blue-gray" } });
const sprintObj = (id: number, state: string, start: string | undefined, end: string | undefined) => ({ id, name: `ABC Sprint ${id}`, state, startDate: start, endDate: end, boardId: 7, goal: "" });

const cloud: JiraConnection = { baseUrl: "https://example.atlassian.net", deployment: "cloud", auth: { email: "me@example.com", token: "secret-token-123" } };

function cloudJira() {
  return fakeJira({
    "/rest/api/3/myself": () => ({ accountId: "acc-me", displayName: "Me Myself" }),
    "/rest/api/3/field": () => [
      { id: "customfield_10020", name: "Sprint", schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
      { id: "customfield_10016", name: "Story point estimate", schema: { custom: "com.pyxis.greenhopper.jira:jsw-story-points" } },
      { id: "customfield_10021", name: "Flagged", schema: {} },
    ],
    "/rest/api/3/status": () => [
      { id: "1", name: "To Do", statusCategory: { key: "new" } },
      { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
      { id: "10001", name: "In Review", statusCategory: { key: "indeterminate" } },
      { id: "10002", name: "Done", statusCategory: { key: "done" } },
    ],
    "/rest/agile/1.0/board/7/configuration": () => ({ estimation: { field: { fieldId: "customfield_10016", displayName: "Story point estimate" } } }),
    "/rest/agile/1.0/board/7/sprint": (q) =>
      q.get("startAt") === "0"
        ? { isLast: false, startAt: 0, maxResults: 50, values: [sprintObj(40, "closed", "2026-09-20T23:00:00.000Z", "2026-10-02T07:00:00.000Z")] }
        : { isLast: true, startAt: 1, maxResults: 50, values: [sprintObj(41, "active", "2026-10-04T23:00:00.000Z", "2026-10-16T07:00:00.000Z"), sprintObj(42, "future", undefined, undefined)] },
    "/rest/api/3/search/jql": (q) => {
      assert.match(q.get("fields") ?? "", /customfield_10016/);
      assert.equal(q.get("expand"), "changelog");
      if (!q.get("nextPageToken"))
        return {
          nextPageToken: "page-2",
          issues: [
            {
              key: "ABC-1",
              fields: {
                summary: "Checkout button",
                status: status("In Review", "indeterminate"),
                issuetype: { name: "Story", subtask: false },
                priority: { name: "High" },
                assignee: { accountId: "acc-me", displayName: "Me Myself" },
                reporter: { accountId: "acc-2", displayName: "Sam" },
                labels: ["web"],
                created: "2026-10-01T09:00:00.000+1000",
                updated: "2026-10-08T09:00:00.000+1000",
                resolutiondate: null,
                duedate: "2026-10-20",
                parent: { key: "ABC-100", fields: { summary: "Checkout", issuetype: { name: "Epic" } } },
                issuelinks: [
                  { type: { name: "Blocks", inward: "is blocked by", outward: "blocks" }, inwardIssue: { key: "OPS-9", fields: { summary: "Open the port", status: status("To Do", "new") } } },
                  { type: { name: "Relates", inward: "relates to", outward: "relates to" }, outwardIssue: { key: "ABC-7", fields: { summary: "Copy", status: status("Done", "done") } } },
                ],
                comment: { comments: [{ author: { displayName: "Sam" }, created: "2026-10-07T10:00:00.000+1000", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nearly" }] }] } }] },
                description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Make it green." }] }] },
                customfield_10016: 3,
                customfield_10020: [sprintObj(40, "closed", "2026-09-20T23:00:00.000Z", "2026-10-02T07:00:00.000Z"), sprintObj(41, "active", "2026-10-04T23:00:00.000Z", "2026-10-16T07:00:00.000Z")],
                customfield_10021: [{ value: "Impediment" }],
              },
              changelog: {
                total: 2,
                histories: [
                  { created: "2026-10-06T09:00:00.000+1000", items: [{ field: "status", fieldId: "status", from: "1", to: "3", fromString: "To Do", toString: "In Progress" }] },
                  { created: "2026-10-08T09:00:00.000+1000", items: [{ field: "status", fieldId: "status", from: "3", to: "10001", fromString: "In Progress", toString: "In Review" }] },
                ],
              },
            },
          ],
        };
      return {
        isLast: true,
        issues: [
          {
            key: "ABC-2",
            fields: {
              summary: "Someone else's",
              status: status("In Progress", "indeterminate"),
              issuetype: { name: "Bug", subtask: false },
              assignee: { accountId: "acc-2", displayName: "Sam" },
              created: "2026-10-01T09:00:00.000+1000",
              updated: "2026-10-02T09:00:00.000+1000",
              customfield_10020: null,
            },
            changelog: { total: 40, histories: [] },
          },
        ],
      };
    },
    "/rest/api/3/issue/ABC-2/changelog": () => ({ isLast: true, values: [{ created: "2026-10-02T09:00:00.000+1000", items: [{ field: "status", to: "3", toString: "In Progress" }] }] }),
  });
}

test("a Cloud pull reads your issues and the board's sprints, and only ever asks", async () => {
  const store = SqliteStore.open(":memory:");
  const app = new Battlestation({ store, clock: { now: () => new Date("2026-10-14T10:00:00+10:00") } });
  app.updateSettings("test", { jira: { boardId: "7" } });
  const jira = cloudJira();
  const r = await pullFromJira(app, { connection: cloud, fetch: jira.fetch, now: () => new Date("2026-10-14T00:00:00Z") });

  assert.deepEqual(r, { added: ["ABC-1", "ABC-2"], changed: [], released: [], sprints: 3, me: "Me Myself" });
  assert.ok(jira.calls.every((c) => c.method === "GET"), "nothing is written to Jira");
  assert.ok(jira.calls.every((c) => c.headers.Authorization === `Basic ${Buffer.from("me@example.com:secret-token-123").toString("base64")}`));

  const one = store.getIssue("ABC-1")!;
  assert.equal(one.url, "https://example.atlassian.net/browse/ABC-1");
  assert.equal(one.statusCategory, "doing");
  assert.equal(one.points, 3);
  assert.deepEqual(one.sprintIds, ["40", "41"]);
  assert.deepEqual(one.parent, { key: "ABC-100", summary: "Checkout", type: "Epic" });
  assert.equal(one.started, "2026-10-06T09:00:00.000+1000", "the first move into progress, not the latest");
  assert.equal(one.flagged, true);
  assert.equal(one.description, "Make it green.");
  assert.equal(one.comments[0].body, "Nearly");
  assert.deepEqual(one.links.map((l) => [l.key, l.direction, l.statusCategory]), [["OPS-9", "blocked_by", "todo"], ["ABC-7", "other", "done"]]);
  assert.equal(one.assignedToMe, true);
  assert.equal(one.due, "2026-10-20");

  const two = store.getIssue("ABC-2")!;
  assert.equal(two.assignedToMe, false);
  assert.equal(two.started, "2026-10-02T09:00:00.000+1000", "a cut-short history is read in full");

  const sprints = store.listSprints();
  assert.deepEqual(sprints.map((s) => [s.id, s.state]), [["40", "closed"], ["41", "active"], ["42", "future"]]);
  assert.equal(sprints[2].startDate, null);
  assert.equal(store.getLastPull()?.me, "Me Myself");
  store.close();
});

test("a Data Center pull pages by position, reads old-style sprints and epic links, and uses a token", async () => {
  const dc: JiraConnection = { baseUrl: "https://jira.example.com", deployment: "datacenter", auth: { pat: "pat-456" } };
  const jira = fakeJira({
    "/rest/api/2/myself": () => ({ name: "me", key: "me", displayName: "Me" }),
    "/rest/api/2/field": () => [
      { id: "customfield_10100", name: "Sprint", schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
      { id: "customfield_10200", name: "Story Points", schema: {} },
      { id: "customfield_10300", name: "Epic Link", schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link" } },
    ],
    "/rest/api/2/status": () => ({ status: 500 }),
    "/rest/api/2/search": (q) => {
      if (q.get("jql")?.startsWith("key in")) return { total: 1, issues: [{ key: "ABC-50", fields: { summary: "Payments epic", issuetype: { name: "Epic" } } }] };
      const at = Number(q.get("startAt"));
      const make = (n: number) => ({
        key: `ABC-${n}`,
        fields: {
          summary: `Issue ${n}`,
          status: status("In Progress", "indeterminate"),
          issuetype: { name: "Task" },
          assignee: { name: "me", key: "me", displayName: "Me" },
          created: "2026-10-01T09:00:00.000+1000",
          updated: "2026-10-02T09:00:00.000+1000",
          description: "h2. Wiki text",
          customfield_10100: ["com.atlassian.greenhopper.service.sprint.Sprint@1a2b[id=12,rapidViewId=7,state=ACTIVE,name=Sprint 12, the big one,startDate=2026-10-05T09:00:00.000+10:00,endDate=2026-10-16T17:00:00.000+10:00,completeDate=<null>,sequence=12,goal=<null>]"],
          customfield_10200: 2,
          customfield_10300: "ABC-50",
        },
        changelog: { histories: [{ created: "2026-10-03T09:00:00.000+1000", items: [{ field: "status", to: "3", toString: "In Progress" }] }] },
      });
      return at === 0 ? { startAt: 0, total: 2, issues: [make(1)] } : { startAt: 1, total: 2, issues: [make(2)] };
    },
  });
  const store = SqliteStore.open(":memory:");
  const app = new Battlestation({ store });
  const r = await pullFromJira(app, { connection: dc, fetch: jira.fetch });
  assert.deepEqual(r.added, ["ABC-1", "ABC-2"]);
  assert.ok(jira.calls.every((c) => c.headers.Authorization === "Bearer pat-456" && c.method === "GET"));
  const one = store.getIssue("ABC-1")!;
  assert.deepEqual(one.sprintIds, ["12"]);
  assert.deepEqual(one.parent, { key: "ABC-50", summary: "Payments epic", type: "Epic" });
  assert.equal(one.points, 2);
  assert.equal(one.description, "h2. Wiki text");
  assert.equal(one.started, "2026-10-03T09:00:00.000+1000", "no status list: a move into a status named 'progress' counts");
  const s = store.getSprint("12")!;
  assert.equal(s.name, "Sprint 12, the big one");
  assert.equal(s.state, "active");
  assert.equal(s.boardId, "7");
  assert.equal(s.goal, "");
  store.close();
});

test("too many requests: wait, then try again; a refusal says why without the credentials", async () => {
  let n = 0;
  const waits: number[] = [];
  const jira = fakeJira({
    "/rest/api/3/myself": () => (++n < 3 ? { status: 429, headers: { "Retry-After": "1" } } : { status: 401 }),
  });
  const app = new Battlestation({ store: SqliteStore.open(":memory:") });
  await assert.rejects(
    pullFromJira(app, { connection: cloud, fetch: jira.fetch, sleep: async (ms) => void waits.push(ms) }),
    (err: unknown) => err instanceof JiraError && err.status === 401 && !err.message.includes("secret-token-123"),
  );
  assert.equal(waits.length, 2);
  assert.ok(waits.every((w) => w >= 1000 * 0.7));
});

test("the connection comes from the environment, and refuses to send a token in the clear", () => {
  assert.deepEqual(connectionFromEnv({ JIRA_BASE_URL: "https://example.atlassian.net/", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t" }), {
    baseUrl: "https://example.atlassian.net",
    deployment: "cloud",
    auth: { email: "a@b.c", token: "t" },
  });
  assert.equal(connectionFromEnv({ JIRA_PAT: "p" }, "https://jira.example.com").deployment, "datacenter");
  assert.throws(() => connectionFromEnv({ JIRA_BASE_URL: "http://jira.example.com", JIRA_PAT: "p" }), /https/);
  assert.throws(() => connectionFromEnv({ JIRA_BASE_URL: "https://x.example.com" }), /credentials/);
  assert.throws(() => connectionFromEnv({}), /No Jira address/);
  assert.throws(() => connectionFromEnv({ JIRA_BASE_URL: "https://x.example.com", JIRA_PAT: "p", JIRA_DEPLOYMENT: "server" }), /cloud or datacenter/);
});

test("fields are found by type, then by name, unless the settings say", () => {
  const fields = [
    { id: "cf_1", name: "Sprint", schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
    { id: "cf_2", name: "Story Points" },
  ];
  assert.deepEqual(findFields(fields, { points: null, sprint: null }, null), { points: "cf_2", sprint: "cf_1", flagged: null, epicLink: null });
  assert.equal(findFields(fields, { points: "cf_9", sprint: null }, "cf_8").points, "cf_9");
  assert.equal(findFields(fields, { points: null, sprint: null }, "cf_8").points, "cf_8");
});

test("sprint values and history, in their odd shapes", () => {
  assert.equal(parseSprintValue("not a sprint", "t"), null);
  assert.equal(parseSprintValue({ name: "no id" }, "t"), null);
  assert.equal(parseSprintValue({ id: 5, state: "FUTURE" }, "t")?.name, "Sprint 5");
  const cats = new Map([["3", "doing" as const]]);
  assert.equal(firstStarted([], cats, null), null);
  assert.equal(
    firstStarted([{ created: "2026-10-09", items: [{ field: "status", to: "3" }] }, { created: "2026-10-02", items: [{ field: "status", to: "3" }] }], cats, null),
    "2026-10-02",
  );
  assert.equal(firstStarted([{ created: "2026-10-02", items: [{ field: "assignee", to: "3" }] }], cats, null), null);
});
