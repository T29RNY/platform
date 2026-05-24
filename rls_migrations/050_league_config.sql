-- Migration 050 — league_config table + get_league_config RPC
-- Phase 0A of venue_league_hq_SCOPE.md.
--
-- Single source of truth for per-league configuration: generic labels
-- (game/squad/fixture/availability/standings/appearances/potg), match
-- duration + halves + sin-bin, card types, points-per-result, tiebreaker
-- order, teamsheet requirement. Plus `sport` and `format` to support
-- multi-sport hosting from day one (decided 2026-05-25).
--
-- Multi-sport posture:
--   - `sport text DEFAULT 'football'` — every entity self-identifies its sport
--   - `format text DEFAULT '5-a-side'` — open text, no CHECK; accepts
--     football '5-a-side'/'7-a-side'/'11-a-side', cricket 'T20'/'ODI',
--     basketball '5v5', netball '7v7', hockey '11v11', etc.
--   - `card_types text[]` — already sport-flexible (cricket = '{}', hockey =
--     '{green,yellow,red}', basketball = '{foul}', football = '{yellow,red}')
--   - Existing football-named columns on matches/player_match/players stay
--     exactly as they are. See DECISIONS.md entry for full rationale.
--
-- FK forward-reference: `league_id` is `text NULL` with NO FK constraint
-- because the `leagues` table doesn't exist yet (Phase 1). The constraint
-- `FOREIGN KEY (league_id) REFERENCES leagues(id)` will be added in the
-- Phase 1 migration that creates `leagues`. Until then, the only row is
-- the platform-default (league_id IS NULL) seeded at the bottom of this
-- migration.
--
-- RLS: enabled, no public policies. Reads via SECURITY DEFINER RPC only.
-- Writes happen via future admin RPC (Phase 2+) or service role.

CREATE TABLE IF NOT EXISTS public.league_config (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id               text NULL,
  sport                   text NOT NULL DEFAULT 'football',
  format                  text NOT NULL DEFAULT '5-a-side',
  game_label              text NOT NULL DEFAULT 'Game',
  squad_label             text NOT NULL DEFAULT 'Squad',
  fixture_label           text NOT NULL DEFAULT 'Fixture',
  availability_label      text NOT NULL DEFAULT 'Availability',
  standings_label         text NOT NULL DEFAULT 'Standings',
  appearances_label       text NOT NULL DEFAULT 'Appearances',
  potg_label              text NOT NULL DEFAULT 'Player of the Game',
  match_duration_mins     integer NOT NULL DEFAULT 40,
  has_halves              boolean NOT NULL DEFAULT false,
  half_duration_mins      integer NULL,
  has_sin_bin             boolean NOT NULL DEFAULT false,
  sin_bin_mins            integer NULL,
  card_types              text[] NOT NULL DEFAULT ARRAY['yellow','red']::text[],
  points_win              integer NOT NULL DEFAULT 3,
  points_draw             integer NOT NULL DEFAULT 1,
  points_loss             integer NOT NULL DEFAULT 0,
  tiebreaker_order        text[] NOT NULL DEFAULT ARRAY['goal_difference','goals_scored','head_to_head','playoff']::text[],
  teamsheet_required      boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS league_config_league_id_idx
  ON public.league_config (league_id);

ALTER TABLE public.league_config ENABLE ROW LEVEL SECURITY;

-- No public policies. Reads only via get_league_config RPC.
-- Writes via future admin RPCs (Phase 2+) or service role.

REVOKE ALL ON public.league_config FROM anon;
REVOKE ALL ON public.league_config FROM authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_league_config(p_league_id text DEFAULT NULL) RETURNS jsonb
--
-- Returns the row matching p_league_id, or the platform-default row
-- (where league_id IS NULL) if p_league_id is NULL or no league match.
-- SECURITY DEFINER so anon and authenticated can both read without
-- needing direct table grants.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_league_config(text);

CREATE OR REPLACE FUNCTION public.get_league_config(p_league_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.league_config%ROWTYPE;
BEGIN
  -- Try the specific league first
  IF p_league_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.league_config WHERE league_id = p_league_id LIMIT 1;
    IF FOUND THEN
      RETURN to_jsonb(v_row);
    END IF;
  END IF;

  -- Fall back to the platform-default row (league_id IS NULL)
  SELECT * INTO v_row FROM public.league_config WHERE league_id IS NULL LIMIT 1;
  IF FOUND THEN
    RETURN to_jsonb(v_row);
  END IF;

  -- No rows at all (should never happen post-migration) — return null
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_league_config(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_league_config(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed the platform-default row. Idempotent — only inserts if no NULL row
-- exists yet, so re-running this migration is safe.
-- ---------------------------------------------------------------------------

INSERT INTO public.league_config (league_id)
SELECT NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.league_config WHERE league_id IS NULL
);
