-- What is yours: settings, tasks, meetings and their agendas, notes on issues.
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT NOT NULL
);

CREATE TABLE task (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'blocked', 'done', 'dropped')),
  blocked_by TEXT NOT NULL DEFAULT '',
  issue_key TEXT,
  sprint_id TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  started_on TEXT,
  done_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE event (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  at TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned', 'done', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agenda_item (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event (id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'answered', 'dropped')),
  issue_key TEXT
);

CREATE TABLE issue_note (
  key TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  seen_updated TEXT,
  updated_at TEXT NOT NULL
);

-- Copies of what Jira says, kept whole as JSON: the shape is ours, and it
-- is replaced on every pull.
CREATE TABLE issue (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL
);

CREATE TABLE sprint (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL
);

CREATE TABLE last_pull (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT NOT NULL
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
