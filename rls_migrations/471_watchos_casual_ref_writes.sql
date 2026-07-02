-- Migration 471 — watchOS companion: Phase 5, casual ref writes (DECISIONS.md #11)
--
-- Casual matches don't have a second `teams.id` row (league fixtures do —
-- home_team_id/away_team_id) — a casual match is ONE team's squad split into
-- scrimmage sides A/B (`player_match.team_assignment`). So `match_events`
-- (hard NOT NULL FK to `fixtures`) cannot be reused as-is; this migration adds
-- a parallel `casual_match_events` table shaped for the casual model instead.
--
-- Auth: token-based, exactly like the league ref RPCs (`_ref_resolve_fixture`)
-- — `matches.ref_token` was minted for exactly this by mig 369 and drives
-- nothing until now. GRANT EXECUTE TO anon, same as `ref_*` functions.
--
-- Card/own-goal stats land in `player_match` at ONE moment — the ref's own
-- "confirm full time" tap on the watch — derived by COUNTing the event log,
-- not incremented tap-by-tap. Two reasons:
--   1. `player_match` rows for a casual match don't exist until the ADMIN's
--      existing end-of-match confirm RPC runs (`013_rpcs_admin_match_schedule`
--      Stage 3) — so there's nowhere to increment into until the ref's own
--      full-time RPC creates them first, using `matches.teams_draft` (the
--      pre-confirm roster; `team_a`/`team_b` are NULL until the admin
--      confirms) to know each player's side.
--   2. Deriving via COUNT() means "undo" is just deleting the mis-tapped log
--      row — no incremental counter to drift or decrement wrong.
-- The existing admin confirm RPC's `ON CONFLICT (match_id, player_id) DO
-- UPDATE` only ever touches attended/team_assignment/result/was_motm/
-- had_bibs — never yellow_cards/red_cards/own_goals — so it cannot clobber
-- what this migration's RPC writes. Two independent writers, disjoint column
-- sets, no collision.
--
-- `yellow_cards`/`red_cards`/`own_goals` on `player_match` (Phase 3 columns)
-- are currently unwritten by any RPC — this is their first-ever writer, zero
-- regression risk on existing behaviour. Goals stay exactly as they are
-- today (admin-entered scorers at confirm) — this migration never touches
-- `player_match.goals` or `matches.score_a/score_b`; the live goal/own-goal
-- events here are for the watch's live match-log display only.
--
-- All write RPCs: SECURITY DEFINER, search_path pinned, audit_events insert
-- (Hard Rule #9). No realtime broadcast wiring yet (Hard Rule #10) — no
-- client subscriber exists for a casual-event reason until the watch/frontend
-- surface is built; adding one now would be a dangling publisher.
-- Consumers: the watchOS companion app (Hard Rule #14) — recorded in RPCS.md.

-- ─── 1. Schema ────────────────────────────────────────────────────────────

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS ref_started_at timestamptz;

CREATE TABLE IF NOT EXISTS public.casual_match_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           text NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  team_assignment    text NOT NULL CHECK (team_assignment IN ('A','B')),
  player_id          text REFERENCES public.players(id) ON DELETE SET NULL,
  event_type         text NOT NULL,              -- goal|own_goal|yellow_card|red_card|substitution|sin_bin|period_change|kickoff
  minute             integer NOT NULL,
  period             text NOT NULL,               -- open text, mirrors match_events
  sub_player_on_id   text REFERENCES public.players(id) ON DELETE SET NULL,
  sub_player_off_id  text REFERENCES public.players(id) ON DELETE SET NULL,
  duration           integer,                     -- sin-bin minutes; NULL for other event types
  recorded_by_ref_token text NOT NULL,
  client_event_id    uuid NOT NULL UNIQUE,         -- offline-replay idempotency (no legacy rows to migrate)
  synced_at          timestamptz,
  local_timestamp    timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS casual_match_events_match_id_idx ON public.casual_match_events (match_id);
CREATE INDEX IF NOT EXISTS casual_match_events_player_id_idx ON public.casual_match_events (player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS casual_match_events_sub_on_idx ON public.casual_match_events (sub_player_on_id) WHERE sub_player_on_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS casual_match_events_sub_off_idx ON public.casual_match_events (sub_player_off_id) WHERE sub_player_off_id IS NOT NULL;
ALTER TABLE public.casual_match_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.casual_match_events FROM anon, authenticated;

-- ─── 2. Helper — resolve + guard a live casual match by ref_token ─────────

CREATE OR REPLACE FUNCTION public._casual_ref_resolve_match(p_ref_token text)
RETURNS public.matches
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches;
BEGIN
  IF p_ref_token IS NULL THEN RAISE EXCEPTION 'missing_ref_token' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_match FROM public.matches WHERE ref_token = p_ref_token;
  IF v_match.id IS NULL THEN RAISE EXCEPTION 'invalid_ref_token' USING ERRCODE='P0001'; END IF;
  IF v_match.winner IS NOT NULL THEN RAISE EXCEPTION 'match_already_resulted' USING ERRCODE='P0001'; END IF;
  RETURN v_match;
END;
$function$;
REVOKE ALL ON FUNCTION public._casual_ref_resolve_match(text) FROM PUBLIC, anon, authenticated;

-- ─── 3. RPC: start match (mirrors ref_start_match) ────────────────────────

CREATE OR REPLACE FUNCTION public.casual_ref_start_match(
  p_ref_token text, p_client_event_id uuid, p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches; v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  v_match := public._casual_ref_resolve_match(p_ref_token);
  UPDATE public.matches SET ref_started_at = COALESCE(ref_started_at, p_local_timestamp) WHERE id = v_match.id;
  INSERT INTO public.casual_match_events (match_id,team_assignment,event_type,minute,period,recorded_by_ref_token,local_timestamp,synced_at,client_event_id)
  VALUES (v_match.id,'A','kickoff',0,'1H',p_ref_token,p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_match.team_id,'referee',p_ref_token,'casual_ref_start_match','match',v_match.id,
      jsonb_build_object('client_event_id',p_client_event_id));
  END IF;
  RETURN jsonb_build_object('ok',true,'match_id',v_match.id,'event_id',v_event_id,'duplicate',v_event_id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.casual_ref_start_match(text,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casual_ref_start_match(text,uuid,timestamptz) TO anon, authenticated;

-- ─── 4. Helper — which side (A/B) is a player on, pre-confirm ─────────────
-- Reads matches.teams_draft (the pre-confirm roster; team_a/team_b are NULL
-- until the admin's existing confirm RPC promotes teams_draft → team_a/b).

CREATE OR REPLACE FUNCTION public._casual_ref_player_side(p_match public.matches, p_player_id text)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_match.teams_draft -> 'a' @> to_jsonb(p_player_id::text) THEN 'A'
    WHEN p_match.teams_draft -> 'b' @> to_jsonb(p_player_id::text) THEN 'B'
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public._casual_ref_player_side(public.matches,text) FROM PUBLIC, anon, authenticated;

-- ─── 5. RPC: record goal / own goal (log only — player_match.goals is       ┐
--        untouched, admin confirm stays the sole source of truth for it) ──┘

CREATE OR REPLACE FUNCTION public.casual_ref_record_goal(
  p_ref_token text, p_player_id text, p_minute integer, p_period text,
  p_client_event_id uuid, p_own_goal boolean DEFAULT false, p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches; v_side text; v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  v_match := public._casual_ref_resolve_match(p_ref_token);
  IF v_match.ref_started_at IS NULL THEN RAISE EXCEPTION 'match_not_started' USING ERRCODE='P0001'; END IF;
  v_side := public._casual_ref_player_side(v_match, p_player_id);
  IF v_side IS NULL THEN RAISE EXCEPTION 'player_not_in_match' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.casual_match_events (match_id,team_assignment,player_id,event_type,minute,period,recorded_by_ref_token,local_timestamp,synced_at,client_event_id)
  VALUES (v_match.id,v_side,p_player_id, CASE WHEN p_own_goal THEN 'own_goal' ELSE 'goal' END, p_minute,p_period,p_ref_token,p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_match.team_id,'referee',p_ref_token, CASE WHEN p_own_goal THEN 'casual_ref_record_own_goal' ELSE 'casual_ref_record_goal' END,'casual_match_event',v_event_id::text,
      jsonb_build_object('match_id',v_match.id,'player_id',p_player_id,'minute',p_minute,'period',p_period,'client_event_id',p_client_event_id,'own_goal',p_own_goal));
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'team_assignment',v_side,'duplicate',v_event_id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.casual_ref_record_goal(text,text,integer,text,uuid,boolean,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casual_ref_record_goal(text,text,integer,text,uuid,boolean,timestamptz) TO anon, authenticated;

-- ─── 6. RPC: record card (log only; counted into player_match at full-time) ─

CREATE OR REPLACE FUNCTION public.casual_ref_record_card(
  p_ref_token text, p_player_id text, p_minute integer, p_period text,
  p_colour text, p_client_event_id uuid, p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches; v_side text; v_event_type text; v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_colour NOT IN ('yellow','red') THEN RAISE EXCEPTION 'invalid_card_colour' USING ERRCODE='P0001', DETAIL=p_colour; END IF;
  v_match := public._casual_ref_resolve_match(p_ref_token);
  IF v_match.ref_started_at IS NULL THEN RAISE EXCEPTION 'match_not_started' USING ERRCODE='P0001'; END IF;
  v_side := public._casual_ref_player_side(v_match, p_player_id);
  IF v_side IS NULL THEN RAISE EXCEPTION 'player_not_in_match' USING ERRCODE='P0001'; END IF;
  v_event_type := p_colour || '_card';
  INSERT INTO public.casual_match_events (match_id,team_assignment,player_id,event_type,minute,period,recorded_by_ref_token,local_timestamp,synced_at,client_event_id)
  VALUES (v_match.id,v_side,p_player_id,v_event_type,p_minute,p_period,p_ref_token,p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_match.team_id,'referee',p_ref_token,'casual_ref_record_card','casual_match_event',v_event_id::text,
      jsonb_build_object('match_id',v_match.id,'player_id',p_player_id,'colour',p_colour,'minute',p_minute,'period',p_period,'client_event_id',p_client_event_id));
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'team_assignment',v_side,'duplicate',v_event_id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.casual_ref_record_card(text,text,integer,text,text,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casual_ref_record_card(text,text,integer,text,text,uuid,timestamptz) TO anon, authenticated;

-- ─── 7. RPC: record substitution (log only — no player_match aggregate) ───

CREATE OR REPLACE FUNCTION public.casual_ref_record_substitution(
  p_ref_token text, p_on_player_id text, p_off_player_id text,
  p_minute integer, p_period text, p_client_event_id uuid, p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches; v_on_side text; v_off_side text; v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_on_player_id IS NULL OR p_off_player_id IS NULL THEN RAISE EXCEPTION 'missing_substitution_players' USING ERRCODE='P0001'; END IF;
  v_match := public._casual_ref_resolve_match(p_ref_token);
  IF v_match.ref_started_at IS NULL THEN RAISE EXCEPTION 'match_not_started' USING ERRCODE='P0001'; END IF;
  v_on_side := public._casual_ref_player_side(v_match, p_on_player_id);
  v_off_side := public._casual_ref_player_side(v_match, p_off_player_id);
  IF v_on_side IS NULL OR v_off_side IS NULL OR v_on_side <> v_off_side THEN RAISE EXCEPTION 'substitution_side_mismatch' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.casual_match_events (match_id,team_assignment,event_type,minute,period,sub_player_on_id,sub_player_off_id,recorded_by_ref_token,local_timestamp,synced_at,client_event_id)
  VALUES (v_match.id,v_on_side,'substitution',p_minute,p_period,p_on_player_id,p_off_player_id,p_ref_token,p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_match.team_id,'referee',p_ref_token,'casual_ref_record_substitution','casual_match_event',v_event_id::text,
      jsonb_build_object('match_id',v_match.id,'on_player_id',p_on_player_id,'off_player_id',p_off_player_id,'minute',p_minute,'period',p_period,'client_event_id',p_client_event_id));
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'team_assignment',v_on_side,'duplicate',v_event_id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.casual_ref_record_substitution(text,text,text,integer,text,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casual_ref_record_substitution(text,text,text,integer,text,uuid,timestamptz) TO anon, authenticated;

-- ─── 8. RPC: record sin bin (log only — no player_match aggregate exists) ─

CREATE OR REPLACE FUNCTION public.casual_ref_record_sin_bin(
  p_ref_token text, p_player_id text, p_minute integer, p_period text,
  p_duration_minutes integer, p_client_event_id uuid, p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches; v_side text; v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN RAISE EXCEPTION 'invalid_sin_bin_duration' USING ERRCODE='P0001'; END IF;
  v_match := public._casual_ref_resolve_match(p_ref_token);
  IF v_match.ref_started_at IS NULL THEN RAISE EXCEPTION 'match_not_started' USING ERRCODE='P0001'; END IF;
  v_side := public._casual_ref_player_side(v_match, p_player_id);
  IF v_side IS NULL THEN RAISE EXCEPTION 'player_not_in_match' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.casual_match_events (match_id,team_assignment,player_id,event_type,minute,period,duration,recorded_by_ref_token,local_timestamp,synced_at,client_event_id)
  VALUES (v_match.id,v_side,p_player_id,'sin_bin',p_minute,p_period,p_duration_minutes,p_ref_token,p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_match.team_id,'referee',p_ref_token,'casual_ref_record_sin_bin','casual_match_event',v_event_id::text,
      jsonb_build_object('match_id',v_match.id,'player_id',p_player_id,'minute',p_minute,'period',p_period,'duration',p_duration_minutes,'client_event_id',p_client_event_id));
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'team_assignment',v_side,'duplicate',v_event_id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.casual_ref_record_sin_bin(text,text,integer,text,integer,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casual_ref_record_sin_bin(text,text,integer,text,integer,uuid,timestamptz) TO anon, authenticated;

-- ─── 9. RPC: set period (mirrors ref_set_period) ──────────────────────────

CREATE OR REPLACE FUNCTION public.casual_ref_set_period(
  p_ref_token text, p_period text, p_client_event_id uuid, p_local_timestamp timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches; v_event_id uuid;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  IF p_period NOT IN ('HT','2H') THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='P0001', DETAIL=p_period; END IF;
  v_match := public._casual_ref_resolve_match(p_ref_token);
  IF v_match.ref_started_at IS NULL THEN RAISE EXCEPTION 'match_not_started' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.casual_match_events (match_id,team_assignment,event_type,minute,period,recorded_by_ref_token,local_timestamp,synced_at,client_event_id)
  VALUES (v_match.id,'A','period_change',0,p_period,p_ref_token,p_local_timestamp,now(),p_client_event_id)
  ON CONFLICT (client_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
    VALUES (v_match.team_id,'referee',p_ref_token,'casual_ref_set_period','match',v_match.id,
      jsonb_build_object('period',p_period,'client_event_id',p_client_event_id));
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',v_event_id,'period',p_period,'duplicate',v_event_id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.casual_ref_set_period(text,text,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casual_ref_set_period(text,text,uuid,timestamptz) TO anon, authenticated;

-- ─── 10. RPC: undo (mirrors ref_undo_event — plain delete, no aggregate to  ┐
--         reverse since cards are derived by COUNT() at full-time, not    ─┘
--         incremented tap-by-tap)

CREATE OR REPLACE FUNCTION public.casual_ref_undo_event(p_ref_token text, p_client_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches; v_event public.casual_match_events;
BEGIN
  IF p_client_event_id IS NULL THEN RAISE EXCEPTION 'missing_client_event_id' USING ERRCODE='P0001'; END IF;
  v_match := public._casual_ref_resolve_match(p_ref_token);
  SELECT * INTO v_event FROM public.casual_match_events WHERE match_id = v_match.id AND client_event_id = p_client_event_id;
  IF v_event.id IS NULL THEN RETURN jsonb_build_object('ok',true,'noop',true); END IF;
  DELETE FROM public.casual_match_events WHERE id = v_event.id;
  INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
  VALUES (v_match.team_id,'referee',p_ref_token,'casual_ref_undo_event','casual_match_event',v_event.id::text,
    jsonb_build_object('match_id',v_match.id,'event_type',v_event.event_type,'player_id',v_event.player_id,'minute',v_event.minute,'period',v_event.period,'client_event_id',p_client_event_id));
  RETURN jsonb_build_object('ok',true,'removed_event_id',v_event.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.casual_ref_undo_event(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casual_ref_undo_event(text,uuid) TO anon, authenticated;

-- ─── 11. RPC: confirm full time — derive cards/own-goals into player_match ─
-- The ONLY writer of player_match.yellow_cards/red_cards/own_goals. Creates
-- the player_match rows early (from teams_draft) if the admin hasn't
-- confirmed the result yet; the admin's existing confirm RPC later upserts
-- goals/result/motm on top without touching these three columns (verified
-- against rls_migrations/013_rpcs_admin_match_schedule.sql Stage 3's
-- ON CONFLICT DO UPDATE column list). Idempotent — safe to call more than
-- once (recomputes via COUNT(), never increments).

CREATE OR REPLACE FUNCTION public.casual_ref_confirm_full_time(p_ref_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_match public.matches; v_pid text; v_side text;
BEGIN
  v_match := public._casual_ref_resolve_match(p_ref_token);
  IF v_match.ref_started_at IS NULL THEN RAISE EXCEPTION 'match_not_started' USING ERRCODE='P0001'; END IF;

  FOR v_pid IN
    SELECT DISTINCT player_id FROM public.casual_match_events
     WHERE match_id = v_match.id AND player_id IS NOT NULL
  LOOP
    v_side := public._casual_ref_player_side(v_match, v_pid);
    CONTINUE WHEN v_side IS NULL;
    INSERT INTO public.player_match (id, team_id, match_id, player_id, attended, team_assignment,
                                      yellow_cards, red_cards, own_goals)
    SELECT gen_random_uuid(), v_match.team_id, v_match.id, v_pid, true, v_side,
           COUNT(*) FILTER (WHERE event_type = 'yellow_card'),
           COUNT(*) FILTER (WHERE event_type = 'red_card'),
           COUNT(*) FILTER (WHERE event_type = 'own_goal')
      FROM public.casual_match_events
     WHERE match_id = v_match.id AND player_id = v_pid
    ON CONFLICT (match_id, player_id) DO UPDATE SET
      yellow_cards = EXCLUDED.yellow_cards,
      red_cards    = EXCLUDED.red_cards,
      own_goals    = EXCLUDED.own_goals;
  END LOOP;

  INSERT INTO public.audit_events (team_id,actor_type,actor_identifier,action,entity_type,entity_id,metadata)
  VALUES (v_match.team_id,'referee',p_ref_token,'casual_ref_confirm_full_time','match',v_match.id,'{}'::jsonb);

  RETURN jsonb_build_object('ok',true,'match_id',v_match.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.casual_ref_confirm_full_time(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.casual_ref_confirm_full_time(text) TO anon, authenticated;
