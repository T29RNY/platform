-- 114_phase2_venue_list_active_teams.sql
--
-- Phase 2 (League Mode) — Cycle 2.8 wizard helper read RPC.
--
--   venue_list_active_teams(p_venue_token)
--     Returns every competitive team that has been registered into
--     ANY competition under the caller's venue (status IN
--     active|pending). Used by the season-setup wizard's team
--     picker, which needs to surface teams across all comps in the
--     venue — wider than venue_get_state's competition-scoped
--     `teams` directory.
--
-- Returns: jsonb array of
--   { team_id, name, primary_colour, secondary_colour,
--     competition_count, last_active_at }

CREATE OR REPLACE FUNCTION public.venue_list_active_teams(p_venue_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller record;
  v_venue_id text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue_id := v_caller.venue_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', t.id,
    'name', t.name,
    'primary_colour', t.primary_colour,
    'secondary_colour', t.secondary_colour,
    'competition_count', t.comp_count,
    'last_active_at', t.last_seen
  ) ORDER BY t.name), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT te.id, te.name, te.primary_colour, te.secondary_colour,
           count(DISTINCT ct.competition_id) AS comp_count,
           max(ct.registered_at) AS last_seen
    FROM teams te
    JOIN competition_teams ct ON ct.team_id = te.id
    JOIN competitions c ON c.id = ct.competition_id
    JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE l.venue_id = v_venue_id
      AND ct.status IN ('active','pending')
      AND te.team_type = 'competitive'
    GROUP BY te.id, te.name, te.primary_colour, te.secondary_colour
  ) t;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_list_active_teams(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.venue_list_active_teams(text) TO anon, authenticated;
