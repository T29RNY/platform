-- 450 DOWN — reverse Epic C / C1.
-- Drops the new ingest RPC and restores venue_update_club_league to its mig-397
-- 6-arg signature (without p_fa_source_url). Leaves the dormant FA columns +
-- index (mig 394) and any ingested club_fixtures rows in place — data is not
-- destroyed on a function rollback.

DROP FUNCTION IF EXISTS public.fa_ingest_upsert_fixtures(uuid, jsonb);

-- Restore the 6-arg venue_update_club_league (mig 397) — drop the 7-arg first.
DROP FUNCTION IF EXISTS public.venue_update_club_league(text, uuid, text, text, boolean, text, text);
CREATE OR REPLACE FUNCTION public.venue_update_club_league(
  p_venue_token text, p_league_id uuid, p_name text DEFAULT NULL,
  p_season_label text DEFAULT NULL, p_archived boolean DEFAULT NULL,
  p_fa_embed_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_caller record;
  v_venue  text;
BEGIN
  SELECT * INTO v_caller FROM public.resolve_venue_caller(p_venue_token);
  IF v_caller IS NULL OR v_caller.venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_token' USING ERRCODE = 'P0001';
  END IF;
  v_venue := v_caller.venue_id;
  IF NOT public._venue_has_cap(v_caller.role, v_caller.caps_grant, v_caller.caps_deny, 'manage_memberships') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.club_leagues WHERE id = p_league_id AND venue_id = v_venue) THEN
    RAISE EXCEPTION 'league_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.club_leagues SET
    name          = COALESCE(NULLIF(btrim(p_name), ''), name),
    season_label  = COALESCE(NULLIF(btrim(p_season_label), ''), season_label),
    archived_at   = CASE WHEN p_archived IS NULL THEN archived_at
                         WHEN p_archived THEN COALESCE(archived_at, now())
                         ELSE NULL END,
    fa_embed_code = CASE WHEN p_fa_embed_code IS NULL THEN fa_embed_code
                         WHEN btrim(p_fa_embed_code) = '' THEN NULL
                         ELSE p_fa_embed_code END
  WHERE id = p_league_id AND venue_id = v_venue;

  INSERT INTO public.audit_events
    (team_id, actor_user_id, actor_type, actor_identifier, action, entity_type, entity_id, metadata)
  VALUES (v_venue, auth.uid(), v_caller.actor_type, v_caller.actor_ident,
          'club_league_updated', 'club_league', p_league_id::text,
          jsonb_build_object('archived', p_archived, 'fa_snippet_set', p_fa_embed_code IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'league_id', p_league_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_update_club_league(text, uuid, text, text, boolean, text) TO anon, authenticated;
