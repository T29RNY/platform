-- 184_phase11_cup_bracket_schema.sql
-- LEAGUE MODE — Phase 11 (cups & knockouts), Cycle 11.1: bracket persistence.
--
-- Before this, a cup competition only ever persisted ROUND 1 (venue_generate_fixtures
-- inserts the engine's round-1 fixtures; the engine's `bracket` placeholder for rounds
-- 2..final was computed client-side and thrown away). cup_rounds existed but was empty
-- and referenced by nothing. Nothing modelled "winner of tie X advances to slot Y of
-- round N+1", so winners could never advance.
--
-- This adds the persisted bracket tree for SINGLE-ELIMINATION cups:
--   * cup_rounds   — one row per round (reuses the existing table; was empty).
--   * cup_ties     — one row per match-slot in the bracket, with explicit feeder edges
--                    (which two slots of the previous round feed this tie) so 11.2's
--                    advancement is a pure lookup. Byes are a round-1 tie with away_team
--                    NULL and winner preset to the seed (no fixture).
--   * fixtures.cup_tie_id — links a played fixture back to its bracket slot.
--
-- RPC-only access (RLS on, anon/auth revoked) — every read/write goes through a
-- SECURITY DEFINER RPC (venue/player/display), same pattern as venue_charges (mig 180).
-- Group-stage→knockout is a later cycle; this models single-elimination only.

CREATE TABLE IF NOT EXISTS public.cup_ties (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id    uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number      int  NOT NULL,
  slot_index        int  NOT NULL,                                  -- 0-based position within the round
  round_name        text,                                           -- 'Final','Semi-final',… (display)
  fixture_id        uuid REFERENCES public.fixtures(id) ON DELETE SET NULL,  -- NULL for bye / not-yet-created ties
  home_team_id      text REFERENCES public.teams(id) ON DELETE SET NULL,
  away_team_id      text REFERENCES public.teams(id) ON DELETE SET NULL,
  home_source       text,                                           -- 'seed' | 'bye' | 'winner'
  away_source       text,                                           -- 'seed' | 'bye' | 'winner'
  home_feeder_slot  int,                                            -- slot_index in (round_number-1) feeding the home side
  away_feeder_slot  int,                                            -- slot_index in (round_number-1) feeding the away side
  winner_team_id    text REFERENCES public.teams(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'pending',                -- pending | ready | decided
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, round_number, slot_index)
);

CREATE INDEX IF NOT EXISTS cup_ties_competition_idx ON public.cup_ties (competition_id);
CREATE INDEX IF NOT EXISTS cup_ties_fixture_idx     ON public.cup_ties (fixture_id);

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS cup_tie_id uuid REFERENCES public.cup_ties(id) ON DELETE SET NULL;

ALTER TABLE public.cup_ties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cup_ties FROM anon, authenticated;
