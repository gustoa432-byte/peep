-- Stage 4: creator, generation (reset), edit author, DB rate limit, funnel events.

alter table peep_worlds
  add column if not exists creator_id text;

alter table peep_worlds
  add column if not exists generation integer not null default 0;

alter table peep_edits
  add column if not exists author_id text;

create table if not exists peep_rate (
  player_id text primary key,
  window_start timestamptz not null,
  count integer not null
);

create table if not exists peep_events (
  id serial primary key,
  at timestamptz not null default now(),
  name text not null,
  world_id text,
  player_id text
);

create index if not exists peep_events_name_at_idx
  on peep_events (name, at);

create index if not exists peep_events_world_player_idx
  on peep_events (world_id, player_id, name);
