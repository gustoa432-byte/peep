-- Peepland SQLite schema (VPS / local.db)

CREATE TABLE IF NOT EXISTS peep_worlds (
  id TEXT PRIMARY KEY,
  seed INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  creator_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  edit_cursor INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS peep_edits (
  world_id TEXT NOT NULL REFERENCES peep_worlds(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  block INTEGER NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  author_id TEXT,
  PRIMARY KEY (world_id, x, y, z)
);

CREATE INDEX IF NOT EXISTS peep_edits_cursor_idx
  ON peep_edits (world_id, cursor);

CREATE TABLE IF NOT EXISTS peep_presence (
  world_id TEXT NOT NULL REFERENCES peep_worlds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  z REAL NOT NULL DEFAULT 0,
  yaw REAL NOT NULL DEFAULT 0,
  pitch REAL NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (world_id, player_id)
);

CREATE INDEX IF NOT EXISTS peep_presence_seen_idx
  ON peep_presence (world_id, last_seen);

CREATE TABLE IF NOT EXISTS peep_rate (
  player_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS peep_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  name TEXT NOT NULL,
  world_id TEXT,
  player_id TEXT
);

CREATE INDEX IF NOT EXISTS peep_events_name_at_idx
  ON peep_events (name, at);

CREATE INDEX IF NOT EXISTS peep_events_world_player_idx
  ON peep_events (world_id, player_id, name);

CREATE TABLE IF NOT EXISTS peep_tg_saves (
  tg_user_id TEXT PRIMARY KEY,
  world_id TEXT,
  seed INTEGER,
  edits TEXT NOT NULL DEFAULT '[]',
  inventory TEXT NOT NULL DEFAULT '{}',
  guest_permissions TEXT NOT NULL DEFAULT '{"locked":false,"buildAllowed":false,"banned":[]}',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS peep_tg_saves_world_id_idx
  ON peep_tg_saves (world_id);

CREATE TABLE IF NOT EXISTS webrtc_peers (
  room TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (room, peer_id)
);

CREATE TABLE IF NOT EXISTS webrtc_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  to_peer TEXT NOT NULL,
  from_peer TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS webrtc_signals_inbox
  ON webrtc_signals (room, to_peer, id);
