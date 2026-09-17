-- Per-user settings JSON + browser↔Telegram account link.
CREATE TABLE IF NOT EXISTS peep_user_settings (
  player_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS peep_account_links (
  browser_player_id TEXT PRIMARY KEY,
  tg_player_id TEXT NOT NULL UNIQUE,
  linked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS peep_link_challenges (
  token TEXT PRIMARY KEY,
  browser_player_id TEXT NOT NULL,
  tg_player_id TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
);

CREATE INDEX IF NOT EXISTS peep_link_challenges_browser_idx
  ON peep_link_challenges (browser_player_id);
