-- 470: Gaffer action-flow foundation (PR-C of GAFFER_ACTION_FLOW_HANDOFF.md)
--
-- First agent-initiated write surface. Three pieces:
--   1. gaffer_actions — intent-tracking table. Records what Gaffer proposed
--      (nudge_key/action_key/proposed_args) before dispatch, links forward
--      to the real audit_events row the target action writes via
--      metadata->>'gaffer_action_id' (Locked Decision #6 — no new
--      audit_events column, no new actor_type value; the underlying action
--      keeps its existing actor_type, e.g. 'team_admin', and audit_events'
--      existing jsonb metadata column carries the link).
--   2. ai_agent_access.act_enabled — the real per-team canary flag, the
--      binary act/no-act gate resolve_agent_caller's previously-hardcoded
--      agent.phase literal was standing in for (Locked Decision #5).
--   3. gaffer_propose_action / gaffer_confirm_action — the closed-registry
--      write dispatcher, split in two because inserting the pending
--      gaffer_actions row is itself a write and there is no client INSERT
--      policy (Locked Decision #6) — everything happens inside SECURITY
--      DEFINER functions:
--        - gaffer_propose_action: called when "Do it for you" is tapped.
--          Re-validates current squad state server-side, inserts the
--          pending row, returns a server-computed preview (never trusts
--          client-cached numbers for the preview text either).
--        - gaffer_confirm_action: called when "Yes, do it" is tapped.
--          Re-validates again (state can have changed between propose and
--          confirm), dispatches via a hardcoded CASE (never a dynamic
--          RPC/action name), marks the row resolved, writes audit_events.
--
-- Architecture note resolved at this audit step (KEY AUDIT FACTS flagged it
-- as open): the existing no-response chase mechanism (AdminView
-- chaseNoResponders -> POST /api/notify) is a Vercel serverless function
-- using webpush/APNs libraries Postgres has no access to — it is NOT a SQL
-- RPC, so gaffer_confirm_action cannot literally "call" it. Both new RPCs
-- are therefore the authorization+audit+idempotency gate only: they
-- re-validate the current no-response list and the 120-min cooldown
-- server-side. Only after gaffer_confirm_action returns success does the
-- client fire the same /api/notify POST chaseNoResponders() already sends
-- today (unchanged) — so the audit/phase-gate/idempotency checks are never
-- bypassable by a client that skips the dispatcher (Locked Decision #2).
--
-- audit_events.actor_type CHECK constraint confirmed (this audit step, per
-- KEY AUDIT FACTS instruction not to assume): fixed enum, no 'gaffer'/
-- 'agent' value exists or is added here. Every audit_events insert below
-- uses the caller's own existing actor_type ('team_admin'/'vice_captain'),
-- exactly as every other admin_* RPC does — the CHECK constraint is
-- untouched by this migration.

-- ── 1. gaffer_actions ────────────────────────────────────────────────────
CREATE TABLE public.gaffer_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES teams(id),
  nudge_key text NULL,              -- e.g. 'noresp:3'; NULL if chat-originated
  source text NOT NULL CHECK (source IN ('nudge','chat')),
  action_key text NOT NULL,         -- e.g. 'casual.chase_no_response'
  proposed_args jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_args jsonb NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL
);

ALTER TABLE public.gaffer_actions ENABLE ROW LEVEL SECURITY;

-- Mirrors audit_events' own team_admins-of-team_id SELECT-only policy shape.
CREATE POLICY team_admins_select_gaffer_actions ON public.gaffer_actions
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM team_admins ta
    WHERE ta.team_id = gaffer_actions.team_id
      AND ta.user_id = auth.uid()
      AND ta.revoked_at IS NULL
  ));

-- No client INSERT/UPDATE/DELETE policy — all writes happen inside
-- gaffer_propose_action / gaffer_confirm_action (SECURITY DEFINER).
-- REVOKE FROM PUBLIC/anon and strip write grants from authenticated to
-- counter the project's ALTER DEFAULT PRIVILEGES auto-grant (called out in
-- migration 454's own comments — do not skip).
REVOKE ALL ON public.gaffer_actions FROM PUBLIC;
REVOKE ALL ON public.gaffer_actions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.gaffer_actions FROM authenticated;
GRANT SELECT ON public.gaffer_actions TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.gaffer_actions TO service_role;

-- ── 2. ai_agent_access.act_enabled ──────────────────────────────────────
ALTER TABLE public.ai_agent_access
  ADD COLUMN act_enabled boolean NOT NULL DEFAULT false;

-- ── 3. resolve_agent_caller — surface the real act_enabled flag ─────────
-- Additive only: 'phase' stays exactly as-is (some future consumer may
-- still read it); 'act_enabled' is the new binary gate this epic's UI/RPCs
-- actually check. Signature unchanged, safe as CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.resolve_agent_caller(p_credential jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cred         jsonb := COALESCE(p_credential, '{}'::jsonb);
  v_uid          uuid  := auth.uid();
  v_token        text  := v_cred->>'token';
  v_venue_token  text  := v_cred->>'venue_token';
  v_invite       text  := v_cred->>'invite_code';
  v_company_hint text  := v_cred->>'company_id';
  v_active_hint  text  := v_cred->>'active_role';
  v_resolved     boolean := false;
  v_auth_model   text    := 'anonymous';
  v_kind         text;
  v_actor_ident  text;
  v_user_id      uuid;
  v_display      text;
  v_team_ids     text[] := '{}';
  v_venue_ids    text[] := '{}';
  v_league_ids   text[] := '{}';
  v_club_ids     text[] := '{}';
  v_company_id   text;
  v_roles        text[] := '{}';
  v_caps_grant   text[] := '{}';
  v_caps_deny    text[] := '{}';
  v_active_role  text;
  v_primary_type text;
  v_primary_id   text;
  v_enabled      boolean := false;
  v_act_enabled  boolean := false;
  v_domains      text[]  := '{}';
  v_cap_pence    integer := 0;
  v_used_pence   integer := 0;
  v_inv          jsonb;
  v_pl_id        text;
  r              record;
  v_access       record;
BEGIN
  IF v_invite IS NOT NULL THEN
    v_inv := public.resolve_invite_link(v_invite);
    IF (v_inv->>'status') IS DISTINCT FROM 'not_found' THEN
      v_resolved    := true;
      v_auth_model  := 'invite';
      v_kind        := 'invite';
      v_actor_ident := 'invite:' || md5(v_invite);
    END IF;
  ELSIF v_token IS NOT NULL THEN
    SELECT * INTO r FROM public.resolve_admin_caller(v_token) LIMIT 1;
    IF FOUND THEN
      v_resolved    := true;
      v_team_ids    := ARRAY[r.team_id];
      v_actor_ident := r.actor_ident;
      IF r.actor_type = 'team_admin' THEN
        v_auth_model := 'casual_admin';  v_kind := 'admin_token'; v_roles := ARRAY['team_admin'];
      ELSE
        v_auth_model := 'casual_player'; v_kind := 'player_token'; v_roles := ARRAY['player', r.actor_type];
      END IF;
      SELECT t.name INTO v_display FROM teams t WHERE t.id = r.team_id;
    ELSE
      SELECT pl.id, pl.user_id, pl.name INTO v_pl_id, v_user_id, v_display
        FROM players pl WHERE pl.token = v_token LIMIT 1;
      IF FOUND THEN
        v_resolved    := true;
        v_auth_model  := 'casual_player';
        v_kind        := 'player_token';
        v_actor_ident := 'player:' || v_pl_id;
        v_roles       := ARRAY['player'];
        SELECT COALESCE(array_agg(DISTINCT tp.team_id), '{}') INTO v_team_ids
          FROM team_players tp WHERE tp.player_id = v_pl_id;
      END IF;
    END IF;
  ELSIF v_venue_token IS NOT NULL THEN
    SELECT * INTO r FROM public.resolve_venue_caller(v_venue_token) LIMIT 1;
    IF FOUND THEN
      v_resolved    := true;
      v_auth_model  := 'venue';
      v_kind        := 'venue_token';
      v_actor_ident := r.actor_ident;
      v_roles       := ARRAY['operator'];
      v_caps_grant  := COALESCE(r.caps_grant, '{}');
      v_caps_deny   := COALESCE(r.caps_deny, '{}');
      IF r.venue_id IS NOT NULL THEN v_venue_ids := ARRAY[r.venue_id]; END IF;
      SELECT v.name, v.company_id INTO v_display, v_company_id FROM venues v WHERE v.id = r.venue_id;
    ELSE
      SELECT * INTO r FROM public.resolve_league_caller(v_venue_token) LIMIT 1;
      IF FOUND THEN
        v_resolved    := true;
        v_auth_model  := 'league';
        v_kind        := 'league_token';
        v_actor_ident := r.actor_ident;
        v_roles       := ARRAY['league_admin'];
        IF r.league_id IS NOT NULL THEN v_league_ids := ARRAY[r.league_id]; END IF;
        IF r.venue_id  IS NOT NULL THEN v_venue_ids  := ARRAY[r.venue_id];  END IF;
      END IF;
    END IF;
  ELSIF v_uid IS NOT NULL THEN
    v_auth_model := 'signed_in';
    v_kind       := 'auth_uid';
    v_user_id    := v_uid;
    SELECT COALESCE(array_agg(DISTINCT tp.team_id), '{}') INTO v_team_ids
      FROM players pl JOIN team_players tp ON tp.player_id = pl.id
      WHERE pl.user_id = v_uid;
    SELECT COALESCE(array_agg(DISTINCT va.venue_id), '{}') INTO v_venue_ids
      FROM venue_admins va
      WHERE va.user_id = v_uid AND va.status = 'active' AND va.revoked_at IS NULL;
    SELECT COALESCE(array_agg(DISTINCT g), '{}') INTO v_caps_grant
      FROM venue_admins va CROSS JOIN LATERAL unnest(va.caps_grant) g
      WHERE va.user_id = v_uid AND va.status = 'active' AND va.revoked_at IS NULL;
    SELECT COALESCE(array_agg(DISTINCT d), '{}') INTO v_caps_deny
      FROM venue_admins va CROSS JOIN LATERAL unnest(va.caps_deny) d
      WHERE va.user_id = v_uid AND va.status = 'active' AND va.revoked_at IS NULL;
    IF v_company_hint IS NOT NULL
       AND EXISTS (SELECT 1 FROM company_admins ca WHERE ca.user_id = v_uid AND ca.company_id = v_company_hint)
    THEN
      v_company_id := v_company_hint;
    END IF;
    IF v_company_id IS NULL THEN
      SELECT ca.company_id INTO v_company_id
        FROM company_admins ca WHERE ca.user_id = v_uid ORDER BY ca.company_id LIMIT 1;
    END IF;
    IF array_length(v_team_ids, 1)  >= 1 THEN v_roles := array_append(v_roles, 'player');   END IF;
    IF array_length(v_venue_ids, 1) >= 1 THEN v_roles := array_append(v_roles, 'operator'); END IF;
    IF EXISTS (SELECT 1 FROM company_admins ca WHERE ca.user_id = v_uid)
      THEN v_roles := array_append(v_roles, 'company_admin'); END IF;
    IF public.is_platform_admin() THEN v_roles := array_append(v_roles, 'platform_admin'); END IF;
    IF v_active_hint IS NOT NULL AND v_active_hint = ANY(v_roles) THEN
      v_roles       := ARRAY[v_active_hint];
      v_active_role := v_active_hint;
    END IF;
    v_resolved := (array_length(v_team_ids,1) >= 1
                OR array_length(v_venue_ids,1) >= 1
                OR v_company_id IS NOT NULL);
    SELECT u.email INTO v_display FROM auth.users u WHERE u.id = v_uid;
  END IF;

  IF array_length(v_team_ids, 1) >= 1 THEN
    SELECT COALESCE(array_agg(DISTINCT t.club_id), '{}') INTO v_club_ids
      FROM teams t WHERE t.id = ANY(v_team_ids) AND t.club_id IS NOT NULL;
  END IF;

  IF    array_length(v_team_ids, 1)  >= 1 THEN v_primary_type := 'team';    v_primary_id := v_team_ids[1];
  ELSIF array_length(v_venue_ids, 1) >= 1 THEN v_primary_type := 'venue';   v_primary_id := v_venue_ids[1];
  ELSIF v_company_id IS NOT NULL          THEN v_primary_type := 'company'; v_primary_id := v_company_id;
  END IF;

  IF v_resolved AND v_auth_model NOT IN ('invite','anonymous') AND v_primary_id IS NOT NULL THEN
    SELECT a.enabled, a.domains, a.daily_cap_pence, a.act_enabled INTO v_access
      FROM public.ai_agent_access a
      WHERE (a.scope_type = v_primary_type AND a.scope_id = v_primary_id)
         OR (a.scope_type = 'global' AND a.scope_id = '*')
      ORDER BY (a.scope_type = 'global')
      LIMIT 1;
    IF FOUND AND v_access.enabled THEN
      v_domains     := v_access.domains;
      v_cap_pence   := v_access.daily_cap_pence;
      v_act_enabled := COALESCE(v_access.act_enabled, false);
      IF v_primary_type = 'team' THEN
        SELECT COALESCE(SUM(b.cost_pence), 0)::integer INTO v_used_pence
          FROM ai_briefings b
          WHERE b.team_id = ANY(v_team_ids)
            AND (b.generated_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date;
      END IF;
      v_enabled := NOT (v_cap_pence > 0 AND v_used_pence >= v_cap_pence);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'resolved',   v_resolved,
    'auth_model', v_auth_model,
    'principal', jsonb_build_object(
      'kind',         v_kind,
      'actor_ident',  v_actor_ident,
      'user_id',      v_user_id,
      'display_name', v_display
    ),
    'scope', jsonb_build_object(
      'team_ids',   to_jsonb(v_team_ids),
      'venue_ids',  to_jsonb(v_venue_ids),
      'company_id', v_company_id,
      'league_ids', to_jsonb(v_league_ids),
      'club_ids',   to_jsonb(v_club_ids)
    ),
    'roles',        to_jsonb(v_roles),
    'active_role',  v_active_role,
    'capabilities', jsonb_build_object('grant', to_jsonb(v_caps_grant), 'deny', to_jsonb(v_caps_deny)),
    'agent', jsonb_build_object(
      'enabled',          v_enabled,
      'act_enabled',      v_act_enabled AND v_enabled,
      'domains',          to_jsonb(v_domains),
      'daily_cap_pence',  v_cap_pence,
      'used_today_pence', v_used_pence,
      'phase',            1
    )
  );
END;
$function$;

-- ── 4. gaffer_propose_action ────────────────────────────────────────────
-- Called when "Do it for you" is tapped. Inserts the pending gaffer_actions
-- row (the only way one gets created — no client INSERT policy) and
-- returns a server-computed preview. Only 'casual.chase_no_response' is a
-- known key this PR; anything else is rejected before any row is written.
CREATE OR REPLACE FUNCTION public.gaffer_propose_action(
  p_admin_token text,
  p_action_key text,
  p_nudge_key text DEFAULT NULL,
  p_source text DEFAULT 'nudge'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type  text;
  v_actor_ident text;
  v_team_id     text;
  v_act_enabled boolean;
  v_action_id   uuid;
  v_players     jsonb;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;
  IF v_actor_type NOT IN ('team_admin', 'vice_captain') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authorised';
  END IF;

  SELECT act_enabled INTO v_act_enabled
    FROM ai_agent_access
    WHERE scope_type = 'team' AND scope_id = v_team_id;
  IF NOT COALESCE(v_act_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='act_not_enabled';
  END IF;

  IF p_source NOT IN ('nudge', 'chat') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_source';
  END IF;

  -- Hardcoded allow-list — never a dynamic action_key from the client/LLM
  -- (Locked Decision #1). Only this one key has a real write path (KEY
  -- AUDIT FACTS); PR-D adds the other two as additive branches here.
  IF p_action_key = 'casual.chase_no_response' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pl.id, 'name', COALESCE(pl.nickname, pl.name))), '[]'::jsonb)
      INTO v_players
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND pl.status = 'none'
        AND NOT pl.disabled
        AND NOT pl.injured
        AND NOT pl.is_guest;
  ELSE
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unknown_action_key';
  END IF;

  INSERT INTO gaffer_actions (team_id, nudge_key, source, action_key, proposed_args)
  VALUES (v_team_id, p_nudge_key, p_source, p_action_key, jsonb_build_object('players', v_players))
  RETURNING id INTO v_action_id;

  RETURN jsonb_build_object(
    'gaffer_action_id', v_action_id,
    'action_key', p_action_key,
    'preview', jsonb_build_object('players', v_players)
  );
END;
$function$;

-- ── 5. gaffer_confirm_action ────────────────────────────────────────────
-- Called when "Yes, do it" is tapped. Re-validates again (state can have
-- changed between propose and confirm), dispatches via a hardcoded CASE,
-- marks the row resolved, writes audit_events. Idempotent: a second
-- confirm-tap on an already-resolved row is a no-op error.
CREATE OR REPLACE FUNCTION public.gaffer_confirm_action(
  p_admin_token text,
  p_gaffer_action_id uuid,
  p_action_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_type   text;
  v_actor_ident  text;
  v_team_id      text;
  v_act_enabled  boolean;
  v_action       gaffer_actions;
  v_no_resp_ids  text[];
  v_game_date    date;
  v_recent_count int;
  v_result       jsonb;
BEGIN
  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;
  IF v_actor_type NOT IN ('team_admin', 'vice_captain') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authorised';
  END IF;

  SELECT act_enabled INTO v_act_enabled
    FROM ai_agent_access
    WHERE scope_type = 'team' AND scope_id = v_team_id;
  IF NOT COALESCE(v_act_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='act_not_enabled';
  END IF;

  SELECT * INTO v_action FROM gaffer_actions
    WHERE id = p_gaffer_action_id AND team_id = v_team_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='gaffer_action_not_found';
  END IF;
  IF v_action.action_key IS DISTINCT FROM p_action_key THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='action_key_mismatch';
  END IF;
  IF v_action.status <> 'pending' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='gaffer_action_already_resolved';
  END IF;

  IF p_action_key = 'casual.chase_no_response' THEN
    -- Re-validate current state server-side — never trust the client's/
    -- LLM's cached nudge numbers, and state may have changed since propose.
    SELECT COALESCE(array_agg(pl.id), '{}') INTO v_no_resp_ids
      FROM team_players tp
      JOIN players pl ON pl.id = tp.player_id
      WHERE tp.team_id = v_team_id
        AND pl.status = 'none'
        AND NOT pl.disabled
        AND NOT pl.injured
        AND NOT pl.is_guest;

    -- Neither condition below is permanent (the no-response list can grow
    -- back, the cooldown expires) — deliberately do NOT mark the row
    -- 'failed' here. A RAISE EXCEPTION unwinds this whole call, so any
    -- UPDATE issued right before it never persists anyway (ephemeral-verify
    -- caught this as dead code); leaving status='pending' also correctly
    -- allows the admin to retry once the condition clears, rather than the
    -- row being permanently stuck as a failure for something transient.
    IF array_length(v_no_resp_ids, 1) IS NULL OR array_length(v_no_resp_ids, 1) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_responders_to_chase';
    END IF;

    SELECT s.game_date_time::date INTO v_game_date
      FROM schedule s WHERE s.team_id = v_team_id AND s.active = true
      LIMIT 1;
    IF v_game_date IS NULL THEN v_game_date := current_date; END IF;

    SELECT count(*) INTO v_recent_count
      FROM notification_log
      WHERE team_id = v_team_id AND type = 'chaseNoResp' AND game_date = v_game_date
        AND sent_at >= now() - interval '120 minutes';
    IF v_recent_count > 0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='chase_rate_limited';
    END IF;

    UPDATE gaffer_actions SET
      status = 'confirmed',
      confirmed_args = jsonb_build_object('player_ids', to_jsonb(v_no_resp_ids)),
      resolved_at = now()
    WHERE id = p_gaffer_action_id;

    INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier,
                              action, entity_type, entity_id, metadata)
    VALUES (v_team_id, v_actor_type, auth.uid(), v_actor_ident,
            'gaffer_chase_no_response_confirmed', 'gaffer_action', p_gaffer_action_id::text,
            jsonb_build_object('gaffer_action_id', p_gaffer_action_id, 'player_ids', to_jsonb(v_no_resp_ids), 'game_date', v_game_date));

    v_result := jsonb_build_object(
      'ok', true,
      'action_key', p_action_key,
      'player_ids', to_jsonb(v_no_resp_ids),
      'game_date', v_game_date
    );
  ELSE
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unknown_action_key';
  END IF;

  RETURN v_result;
END;
$function$;

-- Admin-token callers may arrive as anon (matches every other admin_* RPC —
-- e.g. admin_settle_player, migration 461 — the token itself is the
-- credential check inside the function body, not the Postgres role).
REVOKE ALL ON FUNCTION public.gaffer_propose_action(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gaffer_propose_action(text, text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.gaffer_confirm_action(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gaffer_confirm_action(text, uuid, text) TO anon, authenticated;
