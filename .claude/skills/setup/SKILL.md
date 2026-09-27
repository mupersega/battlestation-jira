---
name: setup
description: Set up Battlestation for Jira on this computer, from a fresh clone to the first pull from Jira and a check of what it read. Use when asked to set up, install, prime or connect this repository, or when the first pull fails.
---

# Set up Battlestation for Jira on this computer

Walk the person through `SETUP.md` in the repository root, doing the steps you can and checking each one before moving on. Read `SETUP.md` first; it is the reference, and this skill says how to go through it with them.

## Rules

- **Never handle the token.** Do not ask for it, do not accept it if pasted, do not write it into `.env`, and do not print `.env`. If they paste one into the conversation, tell them to revoke it and make a new one. Create `.env` from `.env.example` with the address filled in if they give it, and let them add the credentials in an editor.
- **Ask before anything leaves the computer.** The pull reads from their Jira; confirm the address and the board with them before the first one.
- **Company rules first.** Before installing, ask whether their employer allows a local tool to keep copies of Jira issues on this computer. If they are unsure, stop there and say what to check.
- **Only ever read from Jira.** The pull is read-only by design. Do not add anything that writes to Jira.
- **Do not commit** `.env`, the data folder, or anything from their Jira to the repository.

## Steps

1. **Check the ground.** Run `node --version` (24 or later) and `git --version`. Confirm the working directory is the repository root (it has `SETUP.md` and `package.json` named `battlestation-jira`).
2. **Install and build.** Run `npm install`, `npm run build:web`, `npm test`. If `npm install` fails on the `node` package or on certificates, use the Troubleshooting table in `SETUP.md`.
3. **Show the mock.** Run `npm run mock` in the background and tell them to open http://localhost:4758. Stop it once they have seen it.
4. **Token.** Ask whether their Jira is Cloud (`atlassian.net`) or Data Center, and give them the matching instructions from `SETUP.md` step 3.
5. **`.env`.** Copy `.env.example` to `.env`. Fill in `JIRA_BASE_URL` if they give you the address (it must start with `https://`, with no path unless their Jira lives under one). Ask them to add the email and API token, or the personal access token, themselves, and to tell you when it is saved.
6. **Board.** Ask for the board's address or id (`SETUP.md` step 5). Confirm it with them, then run `npm run pull -- --board <id>`. Read the output back to them in plain words.
7. **Check what it read.** Start `npm start` in the background. Use `curl -s http://localhost:4757/api/overview` to check, and tell them what you find:
   - how many issues are theirs, and how many have no points: if all of them have none, the points field was not found; look through `/rest/api/2/field` or `/rest/api/3/field` with them in the browser, then set it with `npm run pull` after setting `pointsField` (the MCP tool `update_settings` with `points_field`),
   - which sprint is active, and its start and end days: if they are a day off, ask for the team's time zone and set it on the settings screen,
   - a few issues' statuses against what Jira shows.
   Then have them open http://localhost:4757 and set their capacity on the settings screen (select the name at the top left).
8. **Agent access (optional).** Offer to register the MCP server with the command in `SETUP.md` step 7, using the absolute path of the repository.
9. **Finish.** Say what is running and where, what they checked, and anything that did not come out right. If a status, field or date was wrong, write down exactly what Jira showed and what the app showed, so it can be fixed in the code.

## When the pull fails

Match the message against the Troubleshooting table in `SETUP.md`. For a 401, have them re-check the credentials in `.env` without showing them to you. For certificate errors, ask IT for the company root certificate and set `NODE_EXTRA_CA_CERTS` in `.env`. Do not turn off TLS checking.
