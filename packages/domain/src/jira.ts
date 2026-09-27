/**
 * What is kept of Jira: copies of issues and sprints as they were when last
 * read, for reading here. Jira stays the record; nothing here is written
 * back to it. The shapes are ours, not Jira's: the pull turns Jira's answers
 * into these, so the rest of the app never sees Jira's field names.
 */

import type { ISODate, ISODateTime } from "./dates.js";

/** Jira's three status categories, in our words. */
export type StatusCategory = "todo" | "doing" | "done";

export type SprintState = "future" | "active" | "closed";

export interface SprintSnapshot {
  /** Jira's sprint id, as a string. */
  id: string;
  name: string;
  state: SprintState;
  /** Local calendar dates. Null for a future sprint that has not been given dates. */
  startDate: ISODate | null;
  endDate: ISODate | null;
  /** When it was closed, if it has been. */
  completeDate: ISODate | null;
  goal: string;
  boardId: string | null;
  fetchedAt: ISODateTime;
}

export type LinkDirection = "blocks" | "blocked_by" | "other";

export interface IssueLinkView {
  key: string;
  summary: string;
  statusCategory: StatusCategory;
  direction: LinkDirection;
  /** The link's own wording, such as "is blocked by" or "relates to". */
  label: string;
}

export interface IssueComment {
  author: string;
  at: ISODateTime;
  body: string;
}

export interface IssueSnapshot {
  key: string;
  /** The issue's address in Jira, for opening it there. */
  url: string;
  summary: string;
  /** Story, Bug, Task, Sub-task, Epic, or whatever the project calls them. */
  type: string;
  subtask: boolean;
  /** The status as Jira names it, such as "In Review". */
  status: string;
  statusCategory: StatusCategory;
  priority: string | null;
  /** Story points, when the issue is estimated. */
  points: number | null;
  assignee: string | null;
  /** True when it is assigned to the person the pull was run for. */
  assignedToMe: boolean;
  reporter: string | null;
  /** The sprints it has been in, oldest first. The last one is where it is now. */
  sprintIds: string[];
  /** The epic or parent it sits under. */
  parent: { key: string; summary: string; type: string } | null;
  labels: string[];
  /** The description as plain text. */
  description: string;
  created: ISODateTime;
  updated: ISODateTime;
  resolved: ISODateTime | null;
  due: ISODate | null;
  /** When it first moved into progress, from its history, if that could be read. */
  started: ISODateTime | null;
  flagged: boolean;
  links: IssueLinkView[];
  /** The latest comments, oldest first. */
  comments: IssueComment[];
  fetchedAt: ISODateTime;
}

/** The sprint an issue is in now: the last one it has been put in. */
export function currentSprintId(issue: IssueSnapshot): string | null {
  return issue.sprintIds.at(-1) ?? null;
}

/** An issue key such as ABC-123. */
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export function isIssueKey(value: string): boolean {
  return ISSUE_KEY.test(value);
}

/** Jira's status category keys ("new", "indeterminate", "done") in our words. */
export function statusCategoryOf(key: string | null | undefined): StatusCategory {
  if (key === "done") return "done";
  if (key === "indeterminate") return "doing";
  return "todo";
}

type AdfNode = { type?: string; text?: string; content?: AdfNode[]; attrs?: Record<string, unknown> };

/**
 * Jira Cloud gives rich text as a document tree (Atlassian Document Format).
 * This keeps its words and its shape: paragraphs become lines, list items
 * get a mark, headings stay on their own line, mentions and links keep
 * their visible text. Anything unknown gives up its text and nothing else.
 * Plain strings (Data Center's wiki text) pass through as they are.
 */
export function richTextToPlain(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object") return "";
  const lines: string[] = [];
  const inline = (nodes: AdfNode[] | undefined): string =>
    (nodes ?? [])
      .map((n) => {
        switch (n.type) {
          case "text":
            return n.text ?? "";
          case "hardBreak":
            return "\n";
          case "mention":
          case "emoji":
          case "status":
            return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
          case "inlineCard":
            return String(n.attrs?.url ?? "");
          case "date":
            return typeof n.attrs?.timestamp === "string" ? new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10) : "";
          default:
            return inline(n.content);
        }
      })
      .join("");
  const block = (node: AdfNode, marker = ""): void => {
    switch (node.type) {
      case "doc":
        for (const c of node.content ?? []) block(c);
        return;
      case "paragraph":
      case "heading":
        lines.push(marker + inline(node.content));
        return;
      case "bulletList":
        for (const item of node.content ?? []) block(item, "- ");
        return;
      case "orderedList":
        (node.content ?? []).forEach((item, i) => block(item, `${i + 1}. `));
        return;
      case "listItem": {
        const [first, ...rest] = node.content ?? [];
        if (first) block(first, marker);
        for (const c of rest) block(c, "  ");
        return;
      }
      case "codeBlock":
        lines.push(inline(node.content));
        return;
      case "blockquote":
      case "panel":
      case "expand":
        for (const c of node.content ?? []) block(c, "> ");
        return;
      case "rule":
        lines.push("");
        return;
      case "table":
      case "tableRow":
        for (const c of node.content ?? []) block(c);
        return;
      case "tableCell":
      case "tableHeader":
        for (const c of node.content ?? []) block(c);
        return;
      case "mediaSingle":
      case "mediaGroup":
        return;
      default:
        if (node.content) lines.push(marker + inline(node.content));
    }
  };
  block(value as AdfNode);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
