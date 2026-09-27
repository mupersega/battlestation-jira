# Setting up on a new computer

From a fresh clone to your own sprints on the screen. About fifteen minutes, most of it waiting for installs.

If you use Claude Code, open it in the cloned folder and ask it to set this computer up: the `setup` skill in `.claude/skills/setup` walks through the same steps with you.

## Before you start

- **Is this allowed here?** The app keeps copies of your Jira issues and their comments on this computer, unencrypted, and uses an API token or personal access token to read them. On a work computer, check that your employer's rules allow a local tool to do that, and where its data may live.
- **Node 24 or later** (`node --version`). Git.
- **Network:** `npm install` fetches packages from the npm registry, including a copy of Node 24.21 that the repository pins for the Angular build. On a network that blocks or inspects traffic, see Troubleshooting.

## 1. Install and build

```
git clone https://github.com/mupersega/battlestation-jira.git
cd battlestation-jira
npm install
npm run build:web
npm test
```

All tests should pass.

## 2. See it working, with invented data

```
npm run mock
```

Open http://localhost:4758. A yellow banner says it is invented. Stop it with Ctrl+C when you have seen enough.

## 3. Get a token

- **Jira Cloud** (the address ends in `atlassian.net`): make an API token at https://id.atlassian.com/manage-profile/security/api-tokens. You will need it with the email you log in with.
- **Jira Data Center** (your company hosts Jira itself): in Jira, open your profile, then Personal Access Tokens, and make one.

Give it a name you will recognise, and an expiry if your company requires one.

## 4. Fill in `.env`

Copy `.env.example` to `.env` in the repository folder and fill it in yourself, in an editor:

```
JIRA_BASE_URL=https://your-site.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=...
```

or, for Data Center:

```
JIRA_BASE_URL=https://jira.your-company.com
JIRA_PAT=...
```

`.env` is ignored by git and never leaves this computer. Do not paste the token into a chat, a ticket or a commit. The address must start with `https://`.

Leave `BATTLESTATION_DATA_DIR` empty to keep the data in `~/.battlestation-jira`, or point it at a folder your employer allows.

## 5. The first pull

Find your board's id: open your team's board in Jira and look at the address. It is the number after `/boards/` (Cloud) or after `rapidView=` (Data Center).

```
npm run pull -- --board <id>
```

It says who it read for and how many issues and sprints came in. The board is remembered; afterwards `npm run pull` alone is enough, or the Pull button on the screen.

By default it reads the issues assigned to you that are open, or were resolved in the last six weeks. To read something else:

```
npm run pull -- --jql "project = ABC AND assignee = currentUser()"
```

## 6. Look, and check what it read

```
npm start
```

Open http://localhost:4757. Select the name at the top left for the settings: set your capacity in points, and your team's time zone if it is not this computer's.

Then check three things. This is the first time it has met your Jira, so they matter:

1. **Story points.** Issues you know are estimated show their points. If every issue says "not estimated", your site names the field differently: find its id (in Jira, Settings, Issues, Custom fields; the id is in the address when you edit it, `customfield_12345`) and set it through the MCP tool `update_settings` (`points_field`), or ask an agent to.
2. **Sprints.** The active sprint is the one your board has open, with the right start and end days. If the days are one off, set the team's time zone in the settings.
3. **Statuses.** Issues in progress in Jira are in progress here, and done ones are done. If a status lands in the wrong place, note which, and raise it.

## 7. Let an agent use it (optional)

```
claude mcp add --scope user battlestation-jira -- node --env-file=<repo>/.env --no-warnings=ExperimentalWarning <repo>/packages/mcp/dist/src/index.js
```

Replace `<repo>` with the full path to the repository folder. Then ask the agent for `get_today`.

## Keeping it up to date

```
git pull
npm install
npm run build:web
```

Restart `npm start` afterwards. Your data is outside the repository and is kept.

## Troubleshooting

| What you see | What it means |
|---|---|
| `No Jira address. Set JIRA_BASE_URL in .env.` | `.env` is missing or not in the repository folder. |
| `Jira did not accept the credentials (401)` | Wrong email or token, or the token has expired. On Cloud, the email must be the one you log in with. |
| `Jira refused access ... (403)` | The token works but your account cannot see that board or project. |
| `Jira answered 400 ...` | Usually the JQL. Try it in Jira's issue search first. |
| `Could not reach Jira ...` with a certificate error | Your network inspects TLS. Ask IT for the company root certificate as a `.pem` file and add `NODE_EXTRA_CA_CERTS=<path to it>` to `.env`. |
| `Could not reach Jira ...` with a redirect error | The address in `.env` redirects somewhere, often from `http` to `https` or to a login page. Use the address Jira shows in the browser after you are logged in, without a path. |
| `npm install` fails fetching `node` | The network blocks the pinned Node download. Install Node 24.15 or later yourself, then remove `"node"` from `devDependencies` in `package.json` on that computer only. |
| The page says the server is not answering | `npm start` is not running, or is on another port (`BATTLESTATION_PORT`). |
