-- Migration 033 — ai_briefings table for Ask the Gaffer AI agent layer
-- Spec: GAFFER.md (Architecture → Storage)
--
-- Every Gaffer output is stored here with its context_snapshot, so any claim
-- the LLM made is traceable to the exact data it was given. RLS:
--   - admins read their own team's briefings
--   - players read only briefings where audience='player' AND player_id matches
--   - service role full access (edge function inserts)

CREATE TABLE IF NOT EXISTS public.ai_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('admin','player','hq')),
  surface text NOT NULL CHECK (surface IN (
    'team_summary',
    'payment_summary',
    'attendance_risk',
    'matchday_briefing',
    'post_match_summary',
    'opposition_intel',
    'hq_weekly_digest',
    'qa'
  )),
  match_id text REFERENCES public.matches(id) ON DELETE SET NULL,
  player_id text REFERENCES public.players(id) ON DELETE SET NULL,
  content text NOT NULL,
  context_snapshot jsonb NOT NULL,
  prompt_key text NOT NULL,
  model text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_pence numeric(10,4) NOT NULL DEFAULT 0,
  question text,                       -- only populated for surface='qa'
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_briefings_team_surface_idx
  ON public.ai_briefings (team_id, surface, generated_at DESC);

CREATE INDEX IF NOT EXISTS ai_briefings_team_match_idx
  ON public.ai_briefings (team_id, match_id)
  WHERE match_id IS NOT NULL;

ALTER TABLE public.ai_briefings ENABLE ROW LEVEL SECURITY;

-- Admin read policy: gated by team_admins membership
DROP POLICY IF EXISTS ai_briefings_admin_read ON public.ai_briefings;
CREATE POLICY ai_briefings_admin_read ON public.ai_briefings
  FOR SELECT
  TO authenticated
  USING (
    audience = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.team_admins ta
      WHERE ta.team_id = ai_briefings.team_id
        AND ta.user_id = auth.uid()
    )
  );

-- Player read policy: only their own team's player-audience briefings
DROP POLICY IF EXISTS ai_briefings_player_read ON public.ai_briefings;
CREATE POLICY ai_briefings_player_read ON public.ai_briefings
  FOR SELECT
  TO authenticated
  USING (
    audience = 'player'
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id = ai_briefings.player_id
        AND p.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies — writes happen via service role only
-- (edge function uses SUPABASE_SERVICE_ROLE_KEY, same pattern as notify.js).

REVOKE ALL ON public.ai_briefings FROM anon;
REVOKE ALL ON public.ai_briefings FROM authenticated;
GRANT SELECT ON public.ai_briefings TO authenticated;
