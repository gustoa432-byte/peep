create table if not exists peep_worlds (
  id text primary key,
  seed integer not null,
  created_at timestamptz not null default now()
);

create table if not exists peep_edits (
  world_id text not null references peep_worlds(id) on delete cascade,
  x smallint not null,
  y smallint not null,
  z smallint not null,
  block smallint not null,
  primary key (world_id, x, y, z)
);

create table if not exists peep_presence (
  world_id text not null references peep_worlds(id) on delete cascade,
  player_id text not null,
  x real not null default 0,
  y real not null default 0,
  z real not null default 0,
  yaw real not null default 0,
  pitch real not null default 0,
  last_seen timestamptz not null default now(),
  primary key (world_id, player_id)
);

create index if not exists peep_presence_seen_idx
  on peep_presence (world_id, last_seen);
