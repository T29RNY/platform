-- Down migration for 470_gaffer_action_flow_foundation.sql

DROP FUNCTION IF EXISTS public.gaffer_confirm_action(text, uuid, text);
DROP FUNCTION IF EXISTS public.gaffer_propose_action(text, text, text, text);

-- Restore resolve_agent_caller to its pre-470 body (hardcoded phase:1 only,
-- no act_enabled field — matches migration 454's original definition).
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
    SELECT a.enabled, a.domains, a.daily_cap_pence INTO v_access
      FROM public.ai_agent_access a
      WHERE (a.scope_type = v_primary_type AND a.scope_id = v_primary_id)
         OR (a.scope_type = 'global' AND a.scope_id = '*')
      ORDER BY (a.scope_type = 'global')
      LIMIT 1;
    IF FOUND AND v_access.enabled THEN
      v_domains   := v_access.domains;
      v_cap_pence := v_access.daily_cap_pence;
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
      'domains',          to_jsonb(v_domains),
      'daily_cap_pence',  v_cap_pence,
      'used_today_pence', v_used_pence,
      'phase',            1
    )
  );
END;
$function$;

ALTER TABLE public.ai_agent_access DROP COLUMN IF EXISTS act_enabled;

DROP TABLE IF EXISTS public.gaffer_actions;
