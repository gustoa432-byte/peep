-- Version cursor for incremental world sync (TZ §3.7).
-- Full snapshot only on join; later polls ask for rows with cursor > after.

alter table peep_worlds
  add column if not exists edit_cursor integer not null default 0;

alter table peep_edits
  add column if not exists cursor integer not null default 0;

create index if not exists peep_edits_cursor_idx
  on peep_edits (world_id, cursor);
