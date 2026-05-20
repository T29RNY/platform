-- Add team_switches to matches
-- Records mid-game player swaps: [{ player_id, from: 'A'|'B' }]
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS team_switches jsonb DEFAULT NULL;
