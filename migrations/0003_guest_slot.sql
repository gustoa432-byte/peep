-- Strict 1-slot Friday invite: atomic guest claim per world

ALTER TABLE peep_worlds ADD COLUMN guest_id TEXT;
