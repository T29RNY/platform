-- ════════════════════════════════════════════════════════════════════════════
-- 081 — RPC sweep cleanup
-- ════════════════════════════════════════════════════════════════════════════
-- Four targeted fixes following the post-mig-080 audit:
--
--   (1) submit_potm_vote — add notify_team_change so anon /p/ clients
--       see the running tally tick in real time (broadcast channel).
--       Without it, votes record correctly but the count only refreshes
--       on full reload for unauthenticated clients.
--
--   (2) admin_upsert_schedule — drop the stale 13-arg overload. The
--       14-arg version (with p_game_is_live, added later) is the only
--       one the JS wrapper calls. The 13-arg version is a footgun:
--       any caller that omits p_game_is_live silently routes to the
--       old body that doesn't update game_is_live. Also fails the
--       skills/rpc-security-sweep.md gate (overload_count must be 1).
--
--   (3-6) Drop four genuinely-dead RPCs — defined in migrations but
--         with zero callers in apps/ or packages/:
--             player_create_cash_payment_entry  (mig 011 — superseded by
--                                                 set_player_paid, body
--                                                 was just a passthrough)
--             unregister_push_subscription      (mig 011 — never wired)
--             admin_set_player_note             (mig 012 — no UI surface)
--             join_team_as_returning_player     (mig 015 — deprecated
--                                                 onboarding path; the
--                                                 active flow uses
--                                                 player_join_team)
--
-- All four were confirmed zero-callers via grep across apps/inorout/src
-- and packages/ (snake_case and camelCase variants). The down-migration
-- restores them verbatim from the live definitions captured before drop.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── (1) submit_potm_vote — add broadcast ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_potm_vote(p_token text, p_match_id text, p_team_id text, p_nominee_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id text;
  v_existing  uuid;
BEGIN
  SELECT id INTO v_player_id FROM players WHERE token = p_token;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  SELECT id INTO v_existing FROM potm_votes
  WHERE match_id = p_match_id AND voter_id = v_player_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already_voted');
  END IF;

  INSERT INTO potm_votes (match_id, team_id, voter_id, nominee_id)
  VALUES (p_match_id, p_team_id, v_player_id, p_nominee_id);

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    p_team_id, 'player', auth.uid(),
    'player_token:' || md5(p_token),
    'potm_vote_cast_self', 'player', v_player_id,
    jsonb_build_object(
      'match_id',    p_match_id,
      'nominee_id',  p_nominee_id
    )
  );

  PERFORM notify_team_change(p_team_id, 'potm_vote_cast');

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

-- ─── (2) Drop stale admin_upsert_schedule 13-arg overload ──────────────────
DROP FUNCTION IF EXISTS public.admin_upsert_schedule(
  text, text, text, text, text, integer, integer, boolean,
  text, text, integer, jsonb, text
);

-- ─── (3-6) Drop the four dead RPCs ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.player_create_cash_payment_entry(text);
DROP FUNCTION IF EXISTS public.unregister_push_subscription(text);
DROP FUNCTION IF EXISTS public.admin_set_player_note(text, text, text);
DROP FUNCTION IF EXISTS public.join_team_as_returning_player(text, uuid);

SELECT pg_notify('pgrst', 'reload schema');
