-- 397 DOWN
DROP FUNCTION IF EXISTS public.get_club_league_public(text);
DROP FUNCTION IF EXISTS public.venue_update_club_league(text, uuid, text, text, boolean, text);
-- restore the mig-394 5-arg signature
CREATE OR REPLACE FUNCTION public.venue_update_club_league(
  p_venue_token text, p_league_id uuid, p_name text DEFAULT NULL,
  p_season_label text DEFAULT NULL, p_archived boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_caller record; v_venue text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE='P0001'; END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_leagues WHERE id=p_league_id AND venue_id=v_venue) THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE='P0001'; END IF;
  UPDATE public.club_leagues SET
    name=COALESCE(NULLIF(btrim(p_name),''),name),
    season_label=COALESCE(NULLIF(btrim(p_season_label),''),season_label),
    archived_at=CASE WHEN p_archived IS NULL THEN archived_at WHEN p_archived THEN COALESCE(archived_at,now()) ELSE NULL END
  WHERE id=p_league_id AND venue_id=v_venue;
  RETURN jsonb_build_object('ok',true,'league_id',p_league_id);
END; $function$;
GRANT EXECUTE ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean) TO anon, authenticated;
DROP INDEX IF EXISTS public.uq_club_leagues_embed;
ALTER TABLE public.club_leagues DROP COLUMN IF EXISTS embed_code;
