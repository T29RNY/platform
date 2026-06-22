-- 388_club_admin_set_branding_tagline_hero.sql
-- Extend club_admin_set_branding so clubs can set the tournament's tagline (the hero
-- subheading) and a custom hero background image — not just colours/logo. The old
-- signature REPLACED the whole branding jsonb with 3 keys (which would wipe hero_url),
-- so it must be dropped and rebuilt with all keys. The management form is the source of
-- truth (it pre-loads existing values), so a full rebuild is safe and lets fields be cleared.
-- Auth + audit identical to mig 327. SECURITY DEFINER, pinned search_path, authenticated-only.

DROP FUNCTION IF EXISTS public.club_admin_set_branding(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.club_admin_set_branding(
  p_tournament_event_id uuid,
  p_primary_colour      text DEFAULT NULL,
  p_secondary_colour    text DEFAULT NULL,
  p_custom_logo_url     text DEFAULT NULL,
  p_tagline             text DEFAULT NULL,
  p_hero_url            text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile_id uuid;
  v_club_id    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM member_profiles WHERE auth_user_id = v_uid LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  SELECT club_id INTO v_club_id FROM tournament_events WHERE id = p_tournament_event_id LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_team_managers ctm
    JOIN club_teams ct ON ct.id = ctm.team_id
    WHERE ctm.member_profile_id = v_profile_id
      AND ct.club_id = v_club_id
      AND ctm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournament_events
     SET branding = jsonb_strip_nulls(jsonb_build_object(
           'primary_colour',   NULLIF(btrim(COALESCE(p_primary_colour, '')), ''),
           'secondary_colour', NULLIF(btrim(COALESCE(p_secondary_colour, '')), ''),
           'custom_logo_url',  NULLIF(btrim(COALESCE(p_custom_logo_url, '')), ''),
           'tagline',          NULLIF(btrim(COALESCE(p_tagline, '')), ''),
           'hero_url',         NULLIF(btrim(COALESCE(p_hero_url, '')), '')
         ))
   WHERE id = p_tournament_event_id;

  INSERT INTO audit_events (team_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  VALUES ('_system', v_uid, 'club_admin', 'tournament_branding_updated',
          'tournament_event', p_tournament_event_id::text,
          jsonb_build_object('tournament_event_id', p_tournament_event_id));

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.club_admin_set_branding(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_admin_set_branding(uuid, text, text, text, text, text) TO authenticated;
