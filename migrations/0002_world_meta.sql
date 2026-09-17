-- World display name + optional latin island slug (system id stays peep_worlds.id)

ALTER TABLE peep_worlds ADD COLUMN name TEXT;
ALTER TABLE peep_worlds ADD COLUMN slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS peep_worlds_slug_uidx
  ON peep_worlds (slug)
  WHERE slug IS NOT NULL AND slug != '';
