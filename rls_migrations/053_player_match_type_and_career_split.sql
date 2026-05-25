-- Migration 053 — player_match.match_type + player_career split + sync RPC
-- Phase 0D of venue_league_hq_SCOPE.md.
--
-- Three pieces:
--   1. player_match gets its own match_type column (mirrors matches.match_type)
--      + BEFORE INSERT trigger that auto-derives it from the parent match row.
--      This closes a latent bug: existing writers don't know about match_type,
--      so without the trigger they'd silently mis-tag every future competitive
--      player_match row as 'casual'.
--   2. player_career gains 12 new columns: casual_* and competitive_* splits of
--      games/goals/wins/losses/draws/motm. total_* columns stay (they become
--      the sum of casual + competitive).
--   3. sync_player_career(p_player_id) RPC — recomputes one player's career row
--      from their player_match history. Idempotent. Called explicitly for now;
--      Phase 2 will hook it to triggers on player_match insert/update.
--
-- Current state per pre-snapshot:
--   player_match: 266 rows (all match_type → 'casual' via DEFAULT + trigger)
--   player_career: 0 rows (table is currently completely unused —
--     BUGS.md #2 understated; even total_bib_count isn't being written).
--   players: 41 rows
--
-- Phase 0D does NOT seed player_career for every player. That's a Phase 2
-- task. We only land the schema + RPC so the data model is ready.

-- ---------------------------------------------------------------------------
-- 1. player_match.match_type — column + propagation trigger
-- ---------------------------------------------------------------------------

ALTER TABLE public.player_match
  ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'casual';

ALTER TABLE public.player_match
  DROP CONSTRAINT IF EXISTS player_match_match_type_check;

ALTER TABLE public.player_match
  ADD CONSTRAINT player_match_match_type_check
  CHECK (match_type IN ('casual', 'competitive'));

CREATE INDEX IF NOT EXISTS idx_player_match_player_type
  ON public.player_match (player_id, match_type);

-- Trigger: derive match_type from the parent match row on INSERT/UPDATE.
-- Writers don't need to know about match_type — this propagates it automatically.
-- If the parent match doesn't exist yet (shouldn't happen but guard anyway),
-- fall back to whatever the caller passed in (or the DEFAULT).
CREATE OR REPLACE FUNCTION public.player_match_propagate_match_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_match_type text;
BEGIN
  SELECT m.match_type INTO v_match_type
  FROM public.matches m
  WHERE m.id = NEW.match_id;

  IF v_match_type IS NOT NULL THEN
    NEW.match_type := v_match_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS player_match_propagate_match_type_trg ON public.player_match;
CREATE TRIGGER player_match_propagate_match_type_trg
  BEFORE INSERT OR UPDATE OF match_id ON public.player_match
  FOR EACH ROW
  EXECUTE FUNCTION public.player_match_propagate_match_type();

-- Backfill existing 266 rows so their match_type matches their parent match.
-- All current matches are 'casual', so this is a no-op verification, but it
-- catches any drift if a match was later set 'competitive' before this runs.
UPDATE public.player_match pm
SET match_type = m.match_type
FROM public.matches m
WHERE pm.match_id = m.id
  AND pm.match_type IS DISTINCT FROM m.match_type;

-- ---------------------------------------------------------------------------
-- 2. player_career split: casual_* / competitive_* / total_* columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.player_career
  ADD COLUMN IF NOT EXISTS casual_games        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS casual_goals        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS casual_wins         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS casual_losses       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS casual_draws        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS casual_motm         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS competitive_games   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS competitive_goals   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS competitive_wins    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS competitive_losses  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS competitive_draws   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS competitive_motm    integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3. sync_player_career RPC — recompute one player's career row
-- ---------------------------------------------------------------------------
-- Aggregates from player_match. UPSERTs into player_career.
-- SECURITY DEFINER so it can read player_match across RLS boundaries.
-- Caller is service role only for now (Phase 0 doesn't trigger this from
-- client code). REVOKE from anon/authenticated.

DROP FUNCTION IF EXISTS public.sync_player_career(text);

CREATE OR REPLACE FUNCTION public.sync_player_career(p_player_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_casual_games      integer;
  v_casual_goals      integer;
  v_casual_wins       integer;
  v_casual_losses     integer;
  v_casual_draws      integer;
  v_casual_motm       integer;
  v_comp_games        integer;
  v_comp_goals        integer;
  v_comp_wins         integer;
  v_comp_losses       integer;
  v_comp_draws        integer;
  v_comp_motm         integer;
  v_total_teams       integer;
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='player_id_required';
  END IF;

  SELECT
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'casual'      AND attended), 0),
    COALESCE(SUM(goals)  FILTER (WHERE match_type = 'casual'      AND attended), 0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'casual'      AND attended AND result = 'w'), 0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'casual'      AND attended AND result = 'l'), 0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'casual'      AND attended AND result = 'd'), 0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'casual'      AND attended AND was_motm),    0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'competitive' AND attended), 0),
    COALESCE(SUM(goals)  FILTER (WHERE match_type = 'competitive' AND attended), 0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'competitive' AND attended AND result = 'w'), 0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'competitive' AND attended AND result = 'l'), 0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'competitive' AND attended AND result = 'd'), 0),
    COALESCE(COUNT(*) FILTER (WHERE match_type = 'competitive' AND attended AND was_motm),    0),
    COALESCE(COUNT(DISTINCT team_id), 0)
  INTO
    v_casual_games, v_casual_goals, v_casual_wins, v_casual_losses, v_casual_draws, v_casual_motm,
    v_comp_games,   v_comp_goals,   v_comp_wins,   v_comp_losses,   v_comp_draws,   v_comp_motm,
    v_total_teams
  FROM public.player_match
  WHERE player_id = p_player_id;

  INSERT INTO public.player_career (
    player_id,
    total_teams,
    total_games, total_wins, total_losses, total_draws, total_goals, total_motm,
    casual_games, casual_goals, casual_wins, casual_losses, casual_draws, casual_motm,
    competitive_games, competitive_goals, competitive_wins, competitive_losses, competitive_draws, competitive_motm,
    updated_at
  )
  VALUES (
    p_player_id,
    v_total_teams,
    v_casual_games + v_comp_games,
    v_casual_wins  + v_comp_wins,
    v_casual_losses + v_comp_losses,
    v_casual_draws + v_comp_draws,
    v_casual_goals + v_comp_goals,
    v_casual_motm  + v_comp_motm,
    v_casual_games, v_casual_goals, v_casual_wins, v_casual_losses, v_casual_draws, v_casual_motm,
    v_comp_games,   v_comp_goals,   v_comp_wins,   v_comp_losses,   v_comp_draws,   v_comp_motm,
    now()
  )
  ON CONFLICT (player_id) DO UPDATE SET
    total_teams        = EXCLUDED.total_teams,
    total_games        = EXCLUDED.total_games,
    total_wins         = EXCLUDED.total_wins,
    total_losses       = EXCLUDED.total_losses,
    total_draws        = EXCLUDED.total_draws,
    total_goals        = EXCLUDED.total_goals,
    total_motm         = EXCLUDED.total_motm,
    casual_games       = EXCLUDED.casual_games,
    casual_goals       = EXCLUDED.casual_goals,
    casual_wins        = EXCLUDED.casual_wins,
    casual_losses      = EXCLUDED.casual_losses,
    casual_draws       = EXCLUDED.casual_draws,
    casual_motm        = EXCLUDED.casual_motm,
    competitive_games  = EXCLUDED.competitive_games,
    competitive_goals  = EXCLUDED.competitive_goals,
    competitive_wins   = EXCLUDED.competitive_wins,
    competitive_losses = EXCLUDED.competitive_losses,
    competitive_draws  = EXCLUDED.competitive_draws,
    competitive_motm   = EXCLUDED.competitive_motm,
    updated_at         = now();

  RETURN jsonb_build_object(
    'ok',                true,
    'player_id',         p_player_id,
    'total_teams',       v_total_teams,
    'casual_games',      v_casual_games,
    'competitive_games', v_comp_games
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_player_career(text) FROM anon;
REVOKE ALL ON FUNCTION public.sync_player_career(text) FROM authenticated;
-- service_role retains EXECUTE by default; admin-triggered sync (Phase 2) will
-- come via a wrapping admin RPC that uses adminToken auth.
