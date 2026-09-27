import { test } from "node:test";
import assert from "node:assert/strict";
import { currentSprintId, isIssueKey, richTextToPlain, statusCategoryOf, workingDaysBetween } from "../src/index.js";
import { issue } from "./memory-store.js";

test("rich text from Jira Cloud keeps its words and its shape", () => {
  const doc = {
    type: "doc",
    version: 1,
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Done means" }] },
      { type: "paragraph", content: [{ type: "text", text: "Ask " }, { type: "mention", attrs: { id: "x", text: "@Sam" } }, { type: "text", text: " first." }, { type: "hardBreak" }, { type: "text", text: "Then ship." }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
        ],
      },
      { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] }] },
      { type: "paragraph", content: [{ type: "inlineCard", attrs: { url: "https://example.com/x" } }] },
      { type: "mediaSingle", content: [{ type: "media", attrs: {} }] },
      { type: "someFutureNode", content: [{ type: "text", text: "still read" }] },
    ],
  };
  assert.equal(richTextToPlain(doc), "Done means\nAsk @Sam first.\nThen ship.\n- one\n- two\n1. first\nhttps://example.com/x\nstill read");
});

test("plain text passes through, and nothing is nothing", () => {
  assert.equal(richTextToPlain("  h1. Wiki text  "), "h1. Wiki text");
  assert.equal(richTextToPlain(null), "");
  assert.equal(richTextToPlain(undefined), "");
  assert.equal(richTextToPlain(42), "");
});

test("status categories in our words", () => {
  assert.equal(statusCategoryOf("new"), "todo");
  assert.equal(statusCategoryOf("indeterminate"), "doing");
  assert.equal(statusCategoryOf("done"), "done");
  assert.equal(statusCategoryOf(undefined), "todo");
});

test("issue keys, and the sprint an issue is in now", () => {
  assert.ok(isIssueKey("ABC-12"));
  assert.ok(isIssueKey("A_B2-1"));
  assert.ok(!isIssueKey("abc-12"));
  assert.ok(!isIssueKey("ABC12"));
  assert.equal(currentSprintId(issue("A-1", { sprintIds: ["3", "4"] })), "4");
  assert.equal(currentSprintId(issue("A-1")), null);
});

test("working days count both ends and skip weekends", () => {
  assert.equal(workingDaysBetween("2026-10-05", "2026-10-16"), 10);
  assert.equal(workingDaysBetween("2026-10-10", "2026-10-11"), 0);
  assert.equal(workingDaysBetween("2026-10-16", "2026-10-05"), 0);
});
