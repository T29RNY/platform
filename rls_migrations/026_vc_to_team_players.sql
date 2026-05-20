-- Move is_vice_captain from players to team_players
ALTER TABLE team_players
ADD COLUMN IF NOT EXISTS is_vice_captain bool NOT NULL DEFAULT false;

UPDATE team_players tp
SET is_vice_captain = p.is_vice_captain
FROM players p
WHERE p.id = tp.player_id;

DROP VIEW IF EXISTS players_public;
ALTER TABLE players DROP COLUMN IF EXISTS is_vice_captain;

-- Recreate players_public
CREATE OR REPLACE VIEW players_public AS
SELECT
  p.id, p.name, p.nickname, p.status, p.type, p.priority,
  p.disabled, p.injured, p.is_guest, p.guest_of,
  p.team, p.bib_count, p.note, p.token,
  COALESCE(tp.is_vice_captain, false) AS is_vice_captain
FROM players p
LEFT JOIN team_players tp ON tp.player_id = p.id;
