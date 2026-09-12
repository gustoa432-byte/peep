-- Telegram Mini App personal world snapshots (delta edits + inventory).

create table if not exists peep_tg_saves (
  tg_user_id text primary key,
  world_id text,
  seed integer,
  edits jsonb not null default '[]'::jsonb,
  inventory jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists peep_tg_saves_world_id_idx
  on peep_tg_saves (world_id);
