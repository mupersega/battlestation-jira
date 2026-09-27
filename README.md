# Battlestation for Jira

A bridge for your own sprint work. Your Jira issues and your board's sprints are laid out in time across the whole screen, with what is in progress, what needs you, what is new, and your meetings around the edges. Beside Jira's issues sit things that are yours alone: your own tasks, your meetings with their agendas, and private notes on issues. None of those are ever sent to Jira.

It is for one person at their own computer. It runs locally, keeps its data in a folder on that computer, and only ever reads from Jira.

Agent-first: every capability is a tool on an MCP server, so an agent can do anything the screen can. The web app is a second client of the same service.

## What it shows

- **Sprints** as bands in time, with your points in each (done, in progress, to do, against your capacity), a straight line to judge the active one against, and your velocity from the last three closed sprints.
- **Issues** where their work is: done where it happened, in progress up to today, still to do across what is left of the sprint. Blocked, flagged, stale and late issues say so.
- **In hand**: issues in progress and your own tasks you have started.
- **Needs you**: conditions worked out from what Jira says and what you have recorded, worst first. Each goes by itself once the thing is dealt with; there is nothing to dismiss.
- **New to you**: issues that are new, or changed in Jira since you last marked them seen.
- **Meetings** with agendas. A point can name an issue.

Every thing on the screen shows where it is in its life, and can be selected to see all of it.

## Run

Requires Node 24 or later. The Angular build needs Node 24.15 or later, so the repository pins its own Node as a dev dependency; npm scripts use it automatically and the system Node is left alone.

```
npm install
npm run build:web        # everything, including the web app
npm run mock             # the app in the middle of an invented sprint: http://localhost:4758
npm start                # your own data: http://localhost:4757
npm run pull             # read your issues and sprints from Jira, one way
npm run start:mcp        # the MCP server on stdio (an agent's client starts this itself)
npm test                 # Node packages
npm run test -w web      # the web app
```

Start with `npm run mock`. It builds a throwaway database from `packages/api/src/mock-scenario.ts` every time it starts, pretends today is the scenario's date, and says so in a banner. It never touches your data.

## Connecting to Jira

1. Copy `.env.example` to `.env` and fill it in. For Jira Cloud that is your site address, your email and an API token. For Jira Data Center it is the site address and a personal access token. `.env` is git-ignored; the credentials are only read when a pull runs, and are never stored in the database or shown on screen.
2. Find your board's id: it is the number in the board's address in Jira (`.../boards/12`).
3. Run the first pull with it: `npm run pull -- --board 12`. The board is remembered.
4. `npm start`, and open http://localhost:4757. The Pull button on the screen reads again whenever you like.

By default the pull reads the issues assigned to you that are open, or were resolved in the last six weeks. To read something else, give it a JQL query: `npm run pull -- --jql "project = ABC AND assignee = currentUser()"`. It is remembered too. Both can also be changed on the screen by selecting the name at the top left.

The Jira address is only ever taken from `.env`, next to the credentials, so that nothing that can change the settings can send your token elsewhere.

Story points and sprints are found in Jira's own field list; if yours are named unusually, set their field ids with the MCP tool `update_settings` (`points_field`, `sprint_field`).

What the pull does, exactly: GET requests only, to the current user, the field list, the status list, the board's configuration and sprints, and the issue search (with each issue's history, to find when it went into progress). It retries politely when Jira says too many requests. On Jira Cloud it uses the enhanced search (`/rest/api/3/search/jql`); on Data Center, `/rest/api/2/search`.

This has been tested against recorded sample responses, not yet against a live Jira. The status categories and the field names it looks for are the common ones, and are worth checking against your own site on the first pull.

## Register the MCP server

```
claude mcp add --scope user battlestation-jira --env BATTLESTATION_DATA_DIR=<data dir> -- node --env-file=<repo>/.env --no-warnings=ExperimentalWarning <repo>/packages/mcp/dist/src/index.js
```

Start with the `get_today` tool.

## Where things are kept

`BATTLESTATION_DATA_DIR` (default `~/.battlestation-jira`) holds `battlestation.sqlite` and `export/battlestation.json`, a readable copy of everything written after every change. Nothing about your work is kept in this repository.

Both files hold copies of your issues and their comments, in plain form. On a work computer, keep them where your employer allows their data to be, and back them up only to somewhere that is allowed too.

## Layout

- `packages/domain`: the entities, the copies of Jira issues and sprints, the overview (sprints, points, signals, life cycles) and the application service. No I/O.
- `packages/data`: SQLite store on Node's built-in `node:sqlite`, plain-SQL migrations, the JSON export.
- `packages/jira`: the one-way pull. Reads only.
- `packages/mcp`: the MCP server (stdio) over the application service.
- `packages/api`: the local HTTP layer over the same service; also serves the built web app.
- `packages/design`: design tokens and the CSS generated from them, and the mask library (the painted, metal and hex shapes). Every visual value lives in `src/tokens.mjs`; change it there and rebuild. The shapes are made by `masks/make.py`.
- `apps/web`: the Angular app.

## Principles

- Jira is the record for issues and sprints. What is kept here is a copy for reading, replaced on every pull. To change an issue, change it in Jira.
- Three levels, never mixed: an issue is Jira's, a task is your own breakdown of the work, a meeting is yours.
- Stored fields are facts; statuses such as stale, behind or over capacity are worked out every time, never stored.
- Every change is recorded with who or what made it.
- The local server answers only to this machine. It accepts a change only as JSON from its own pages (same host and port), refuses any request that names another host, and cannot be framed by another page.
