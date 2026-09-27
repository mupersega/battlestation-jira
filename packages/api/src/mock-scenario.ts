/**
 * The mock scenario: a sprint in the middle of things, so every view can be
 * judged with real weight in it rather than empty. All of it is invented:
 * the team, the people, the issues and the dates describe nothing real.
 *
 * The scenario pretends today is MOCK_TODAY, a Wednesday. On that day:
 *
 *   Sprints 38 to 40  closed, which gives a velocity
 *   Sprint 41         active, three working days left, more planned than
 *                     capacity and behind a straight line; one issue in
 *                     review for over a week, one blocked by another team,
 *                     one flagged, one with no estimate
 *   Sprint 42         starts on Monday, partly planned
 *   Sprint 43         future, no dates yet
 *   Backlog           an issue left behind in a closed sprint, and one past
 *                     its due date
 *
 * Beside them sit your own tasks, one in hand and one blocked, and your
 * meetings: the review and retro on Friday, planning on Monday, a one-to-one
 * tomorrow, and a refinement session not yet booked.
 *
 * Keep this current. When a feature is added, add what it needs here and
 * look at it in the mock before calling it done.
 */

import { Battlestation, type IssueLinkView, type IssueSnapshot, type SprintSnapshot, type Store } from "@battlestation/domain";

export const MOCK_TODAY = "2027-03-10";

/** A moment on a calendar date, in the machine's own time zone. */
function at(date: string, hour = 10): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0);
}

export const mockClock = { now: () => at(MOCK_TODAY, 9) };

const SITE = "https://example.atlassian.net";
const stamp = (date: string, hour = 10) => `${date}T${String(hour).padStart(2, "0")}:00:00.000+1000`;

const sprint = (id: string, state: SprintSnapshot["state"], startDate: string | null, endDate: string | null, goal = ""): SprintSnapshot => ({
  id,
  name: `Payments Sprint ${id}`,
  state,
  startDate,
  endDate,
  completeDate: state === "closed" ? endDate : null,
  goal,
  boardId: "12",
  fetchedAt: stamp(MOCK_TODAY, 8),
});

const EPICS = {
  checkout: { key: "PAY-100", summary: "Checkout rebuild", type: "Epic" },
  account: { key: "PAY-200", summary: "Account settings", type: "Epic" },
  watch: { key: "PAY-300", summary: "Payment observability", type: "Epic" },
};

type Plan = Partial<IssueSnapshot> & { key: string; summary: string };

function make(p: Plan): IssueSnapshot {
  const done = p.statusCategory === "done";
  return {
    url: `${SITE}/browse/${p.key}`,
    type: "Story",
    subtask: false,
    status: done ? "Done" : p.statusCategory === "doing" ? "In Progress" : "To Do",
    statusCategory: "todo",
    priority: "Medium",
    points: 3,
    assignee: "Alex Rivera",
    assignedToMe: true,
    reporter: "Sam Okafor",
    sprintIds: [],
    parent: null,
    labels: [],
    description: "",
    created: stamp("2027-01-11"),
    updated: stamp("2027-03-01"),
    resolved: null,
    due: null,
    started: null,
    flagged: false,
    links: [],
    comments: [],
    fetchedAt: stamp(MOCK_TODAY, 8),
    ...p,
  };
}

const blockedBy = (key: string, summary: string): IssueLinkView => ({ key, summary, statusCategory: "todo", direction: "blocked_by", label: "is blocked by" });

function issues(): IssueSnapshot[] {
  const closedWork = (key: string, summary: string, sprintId: string, points: number, started: string, resolved: string, parent = EPICS.checkout): Plan => ({
    key,
    summary,
    sprintIds: [sprintId],
    statusCategory: "done",
    points,
    started: stamp(started),
    resolved: stamp(resolved, 16),
    updated: stamp(resolved, 16),
    parent,
  });
  const plans: Plan[] = [
    // Sprint 38: 14 points done.
    closedWork("PAY-101", "Checkout page skeleton", "38", 5, "2027-01-18", "2027-01-21"),
    closedWork("PAY-102", "Address form with validation", "38", 5, "2027-01-20", "2027-01-26"),
    closedWork("PAY-103", "Shipping options from the rates service", "38", 3, "2027-01-25", "2027-01-28"),
    closedWork("PAY-301", "Payment error dashboard", "38", 1, "2027-01-28", "2027-01-29", EPICS.watch),
    // Sprint 39: 17 points done.
    closedWork("PAY-104", "Card entry component", "39", 8, "2027-02-01", "2027-02-08"),
    closedWork("PAY-105", "Saved cards list", "39", 5, "2027-02-04", "2027-02-10"),
    closedWork("PAY-106", "Terms checkbox and copy", "39", 1, "2027-02-10", "2027-02-10"),
    closedWork("PAY-302", "Trace ids through the payment calls", "39", 3, "2027-02-09", "2027-02-12", EPICS.watch),
    // Sprint 40: 15 points done, one left behind.
    closedWork("PAY-107", "Order summary panel", "40", 5, "2027-02-15", "2027-02-19"),
    closedWork("PAY-108", "3-D Secure challenge flow", "40", 8, "2027-02-16", "2027-02-25"),
    closedWork("PAY-109", "Empty basket state", "40", 2, "2027-02-24", "2027-02-26"),
    {
      key: "PAY-110",
      summary: "Remove the legacy cart endpoints",
      sprintIds: ["40"],
      points: 3,
      parent: EPICS.checkout,
      type: "Task",
      description: "The old cart endpoints are still called by the mobile app's previous version. Remove them once usage is at zero.",
      comments: [{ author: "Sam Okafor", at: stamp("2027-02-26", 15), body: "Mobile still has 4% on the old version. Leave this until next month." }],
    },

    // Sprint 41, active.
    {
      key: "PAY-141",
      summary: "Card form: inline validation messages",
      sprintIds: ["41"],
      statusCategory: "doing",
      status: "In Review",
      points: 5,
      started: stamp("2027-03-01", 11),
      updated: stamp("2027-03-09", 17),
      parent: EPICS.checkout,
      description:
        "Show what is wrong with a card field as soon as the field loses focus, not only on submit.\n\nDone means:\n- expiry, number and security code each say what is wrong in their own words\n- messages are read out by screen readers\n- no message before the field has been touched",
      comments: [
        { author: "Priya Nair", at: stamp("2027-03-05", 14), body: "Two review comments on the expiry parser. Otherwise looks good." },
        { author: "Alex Rivera", at: stamp("2027-03-09", 17), body: "Pushed fixes for both." },
      ],
    },
    { key: "PAY-142", summary: "Apple Pay button on the payment step", sprintIds: ["41"], statusCategory: "done", points: 3, started: stamp("2027-03-01"), resolved: stamp("2027-03-03", 16), parent: EPICS.checkout },
    { key: "PAY-143", summary: "Retry on a declined payment", sprintIds: ["41"], statusCategory: "done", points: 5, started: stamp("2027-03-03"), resolved: stamp("2027-03-08", 15), parent: EPICS.checkout },
    {
      key: "PAY-144",
      summary: "Order totals: round tax per line, not per order",
      sprintIds: ["41"],
      points: 3,
      parent: EPICS.checkout,
      type: "Bug",
      priority: "High",
      links: [blockedBy("TAX-88", "Tax service returns amounts in cents")],
      description: "Totals are a cent out on some multi-line orders because tax is rounded once for the whole order.",
    },
    { key: "PAY-145", summary: "Checkout analytics events", sprintIds: ["41"], points: 2, parent: EPICS.watch },
    {
      key: "PAY-146",
      summary: "Refactor the price formatter",
      sprintIds: ["41"],
      statusCategory: "doing",
      points: null,
      type: "Task",
      started: stamp("2027-03-09", 13),
      updated: stamp("2027-03-09", 13),
      description: "Three formatters do the same job. Make one.",
    },
    {
      key: "PAY-147",
      summary: "Session timeout warning on the payment step",
      sprintIds: ["41"],
      points: 2,
      flagged: true,
      updated: stamp("2027-03-09", 16),
      parent: EPICS.checkout,
      comments: [{ author: "Sam Okafor", at: stamp("2027-03-09", 16), body: "Flagging: the timeout length is not agreed with security yet." }],
    },

    // Sprint 42, starting Monday.
    { key: "PAY-201", summary: "Account settings page shell", sprintIds: ["42"], points: 5, parent: EPICS.account },
    { key: "PAY-202", summary: "Notification preferences", sprintIds: ["42"], points: 3, parent: EPICS.account, due: "2027-03-19", updated: stamp("2027-03-09", 12) },
    { key: "PAY-203", summary: "Change email address, with confirmation", sprintIds: ["42"], points: null, parent: EPICS.account, created: stamp("2027-03-09", 15), updated: stamp("2027-03-09", 15) },

    // Backlog.
    { key: "PAY-303", summary: "Alert when payment calls time out", points: 2, parent: EPICS.watch, due: "2027-03-08", type: "Task" },
    { key: "PAY-204", summary: "Profile photo upload", points: 5, parent: EPICS.account },
  ];
  return plans.map(make);
}

export function seedScenario(store: Store): void {
  let now = at("2027-01-11");
  const app = new Battlestation({ store, clock: { now: () => now } });
  const on = (date: string, hour = 10) => {
    now = at(date, hour);
  };
  const who = "mock";

  app.updateSettings(who, { title: "Payments squad", subtitle: "Checkout and accounts", capacityPoints: 16, jira: { baseUrl: SITE, boardId: "12" }, taskTypes: ["build", "fix", "review", "research", "write"] });

  on(MOCK_TODAY, 8);
  app.recordPull("pull", {
    me: "Alex Rivera",
    at: stamp(MOCK_TODAY, 8),
    sprints: [
      sprint("38", "closed", "2027-01-18", "2027-01-29"),
      sprint("39", "closed", "2027-02-01", "2027-02-12"),
      sprint("40", "closed", "2027-02-15", "2027-02-26"),
      sprint("41", "active", "2027-03-01", "2027-03-12", "Customers can pay by card and wallet, and recover from a decline"),
      sprint("42", "future", "2027-03-15", "2027-03-26", "Account settings, first cut"),
      sprint("43", "future", null, null),
    ],
    issues: issues(),
  });
  // Everything had been looked at before the last day or so.
  app.markSeen(who, issues().filter((i) => !["PAY-147", "PAY-202", "PAY-203"].includes(i.key)).map((i) => i.key));
  app.noteIssue(who, { key: "PAY-144", note: "Ask the tax team for a date. If it slips past Friday, carry this over and say so at the review." });

  // Your own tasks.
  on("2027-03-02");
  const parser = app.upsertTask(who, { title: "Fix the expiry date parser", issueKey: "PAY-141", type: "fix" });
  app.setTaskStatus(who, { id: parser.id, status: "doing" });
  on("2027-03-04");
  app.setTaskStatus(who, { id: parser.id, status: "done" });
  on("2027-03-09", 17);
  const review = app.upsertTask(who, { title: "Answer the review comments", issueKey: "PAY-141", type: "review" });
  app.setTaskStatus(who, { id: review.id, status: "doing" });
  app.upsertTask(who, { title: "Write down the rounding rules for review", issueKey: "PAY-144", type: "write", description: "One page: per-line rounding, which currencies, and what the tax service is expected to return." });
  app.upsertTask(who, { title: "Pair with QA on the regression pass", sprintId: "41", type: "review" });
  on("2027-03-05");
  app.upsertTask(who, { title: "Write up what we learned from the retry work", type: "write" });
  const flaky = app.upsertTask(who, { title: "Find out why the checkout end-to-end test is flaky", type: "research" });
  app.setTaskStatus(who, { id: flaky.id, status: "blocked", reason: "Needs access to the CI logs." });

  // Meetings.
  on("2027-02-26");
  const retro40 = app.upsertEvent(who, { title: "Sprint 40 retro", kind: "retro", at: "2027-02-26T15:00:00+10:00" });
  app.upsertEvent(who, { id: retro40.id, status: "done" });
  on("2027-03-08");
  const review41 = app.upsertEvent(who, { title: "Sprint 41 review", kind: "review", at: "2027-03-12T14:00:00+10:00" });
  app.addAgendaItem(who, { eventId: review41.id, text: "Demo retry on a declined payment", issueKey: "PAY-143" });
  app.addAgendaItem(who, { eventId: review41.id, text: "Order totals are blocked on the tax service", issueKey: "PAY-144" });
  app.upsertEvent(who, { title: "Sprint 41 retro", kind: "retro", at: "2027-03-12T15:00:00+10:00" });
  const planning = app.upsertEvent(who, { title: "Sprint 42 planning", kind: "planning", at: "2027-03-15T10:00:00+10:00" });
  app.addAgendaItem(who, { eventId: planning.id, text: "I am out on Friday the 19th: plan for nine days" });
  app.addAgendaItem(who, { eventId: planning.id, text: "Estimate the email change", issueKey: "PAY-203" });
  const one = app.upsertEvent(who, { title: "One-to-one with Sam", kind: "one_on_one", at: "2027-03-11T11:00:00+10:00" });
  app.addAgendaItem(who, { eventId: one.id, text: "The timeout length on the payment step needs a decision from security", issueKey: "PAY-147" });
  app.upsertEvent(who, { title: "Refinement: account settings", kind: "refinement", at: null });
}
