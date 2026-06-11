-- ════════════════════════════════════════════════════════════
-- Migration 249 — get_venue_landing (QR Onboarding slice 3)
-- Public "what's on at this venue" read for the /q/<venue_code> landing.
-- Venue branding + registerable competitions (setup/active) with their
-- ACTIVE (approved) teams + the league_code the register form needs.
-- Never surfaces private/casual teams or pending registrations.
-- Plan: QR_ONBOARDING_SCOPE.md slice 3.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_venue_landing(p_venue_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue jsonb;
  v_comps jsonb;
BEGIN
  IF p_venue_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found');
  END IF;

  SELECT jsonb_build_object(
           'id', v.id, 'name', v.name, 'logo_url', v.logo_url,
           'primary_colour', v.primary_colour, 'secondary_colour', v.secondary_colour)
    INTO v_venue
    FROM venues v WHERE v.id = p_venue_id;

  IF v_venue IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'not_found', 'venue_id', p_venue_id);
  END IF;

  SELECT COALESCE(jsonb_agg(comp ORDER BY comp->>'name'), '[]'::jsonb)
    INTO v_comps
  FROM (
    SELECT jsonb_build_object(
             'competition_id', c.id,
             'name',           c.name,
             'status',         c.status,
             'type',           c.type,
             'format',         c.format,
             'league_code',    l.league_code,
             'league_name',    l.name,
             'teams', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'team_id',          t.id,
                        'name',             t.name,
                        'primary_colour',   t.primary_colour,
                        'secondary_colour', t.secondary_colour) ORDER BY t.name)
               FROM competition_teams ct
               JOIN teams t ON t.id = ct.team_id
               WHERE ct.competition_id = c.id AND ct.status = 'active'
             ), '[]'::jsonb)
           ) AS comp
    FROM competitions c
    JOIN seasons s ON s.id = c.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE l.venue_id = p_venue_id
      AND l.active   = true
      AND c.status IN ('setup','active')
  ) sub;

  RETURN jsonb_build_object(
    'ok',           true,
    'status',       'ok',
    'venue',        v_venue,
    'competitions', v_comps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_venue_landing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_venue_landing(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
