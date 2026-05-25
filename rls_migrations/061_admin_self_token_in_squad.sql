-- ════════════════════════════════════════════════════════════════════════════
-- 061 — Expose admin's own player token in get_team_state_by_admin_token
-- ════════════════════════════════════════════════════════════════════════════
-- Before 061, the admin team-state RPC stripped all credentials from squad
-- rows (token, user_id excluded — per the source comment "all player columns
-- except credentials"). This left admins unable to identify their own
-- player record from their admin PWA, because the client-side resolver at
-- App.jsx:465-471 tries to match by user_id which isn't in the payload.
--
-- Symptom on team_KPaoX8oJYMQ: rockybram (team_admin) on /admin/<token>
-- tapped "out" on My View; UI showed optimistic flip; DB never updated;
-- no error, no toast, no RPC call ever made. Because me.token was undefined,
-- the `if (me?.token)` guard at PlayerView.jsx:264 short-circuited every
-- player-self write (status, pay, +1 guest, injury, POTM, push subscription,
-- leave squad, etc.). All admin-route player-self actions silently no-op.
--
-- Carve a single exception: for the squad row whose user_id matches the
-- caller's auth.uid(), include token. Every other row gets NULL.
--
-- Security: the admin already proves themselves with the admin_token (URL)
-- AND an auth session (auth.uid). This exposes nothing they couldn't get
-- from their own /p/<their_token> route. If auth is missing, NULL is
-- returned for every row — no leak. Verified with role-impersonation:
--   no JWT     → all tokens NULL
--   JWT=admin  → only admin's row has token; others NULL
--
-- CREATE OR REPLACE; no signature change. Other body unchanged.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_team_state_by_admin_token(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id    text;
  v_team       jsonb;
  v_squad      jsonb;
  v_schedule   jsonb;
  v_matches    jsonb;
  v_bib_hist   jsonb;
  v_settings   jsonb;
  v_cover_pool jsonb;
  v_lckey      text;
BEGIN
  IF p_admin_token IS NULL THEN RETURN NULL; END IF;

  SELECT
    t.id,
    jsonb_build_object(
      'id',                  t.id,
      'name',                t.name,
      'join_code',           t.join_code,
      'onboarding_complete', t.onboarding_complete,
      'admin_email',         t.admin_email,
      'live_channel_key',    t.live_channel_key,
      'created_at',          t.created_at
    )
  INTO v_team_id, v_team
  FROM teams t
  WHERE t.admin_token = p_admin_token;

  IF v_team_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',              p.id,
        'name',            p.name,
        'nickname',        p.nickname,
        'status',          p.status,
        'type',            p.type,
        'priority',        p.priority,
        'paid',            p.paid,
        'owes',            p.owes,
        'self_paid',       p.self_paid,
        'paid_by',         p.paid_by,
        'pay_count',       p.pay_count,
        'goals',           p.goals,
        'motm',            p.motm,
        'attended',        p.attended,
        'total',           p.total,
        'w',               p.w,
        'l',               p.l,
        'd',               p.d,
        'bib_count',       p.bib_count,
        'late_dropouts',   p.late_dropouts,
        'injured',         p.injured,
        'injured_since',   p.injured_since,
        'is_guest',        p.is_guest,
        'guest_of',        p.guest_of,
        'note',            p.note,
        'is_vice_captain', tp.is_vice_captain,
        'disabled',        p.disabled,
        'disable_reason',  p.disable_reason,
        'admin_locked_in', p.admin_locked_in,
        'team',            p.team,
        -- 061: expose admin's own token (auth.uid match), null for others
        'token',           CASE
                             WHEN p.user_id IS NOT NULL
                              AND p.user_id = auth.uid()
                             THEN p.token
                             ELSE NULL
                           END
      )
    ),
    '[]'::jsonb
  )
  INTO v_squad
  FROM team_players tp
  JOIN players p ON p.id = tp.player_id
  WHERE tp.team_id = v_team_id;

  SELECT to_jsonb(s.*)
  INTO   v_schedule
  FROM   schedule s
  WHERE  s.team_id = v_team_id
  AND    s.active  = true
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                    m.id,
        'team_id',               m.team_id,
        'match_date',            m.match_date,
        'score_a',               m.score_a,
        'score_b',               m.score_b,
        'score_type',            m.score_type,
        'last_goal_scorer',      m.last_goal_scorer,
        'scorers',               m.scorers,
        'motm',                  m.motm,
        'bib_holder',            m.bib_holder,
        'team_a',                m.team_a,
        'team_b',                m.team_b,
        'teams_draft',           m.teams_draft,
        'winner',                m.winner,
        'cancelled',             m.cancelled,
        'cancel_reason',         m.cancel_reason,
        'voting_open',           m.voting_open,
        'voting_closes_at',      m.voting_closes_at,
        'vote_count',            m.vote_count,
        'total_voters',          m.total_voters,
        'was_admin_decided',     m.was_admin_decided,
        'admin_decision_pending',m.admin_decision_pending,
        'tied_candidates',       m.tied_candidates,
        'payments',              m.payments,
        'created_at',            m.created_at,
        'team_switches',         m.team_switches
      )
      ORDER BY m.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM matches m
  WHERE m.team_id = v_team_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'team_id',    bh.team_id,
        'player_id',  bh.player_id,
        'name',       bh.name,
        'match_date', bh.match_date,
        'returned',   bh.returned
      )
      ORDER BY bh.match_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_bib_hist
  FROM bib_history bh
  WHERE bh.team_id = v_team_id;

  SELECT jsonb_build_object('group_name', s.group_name)
  INTO   v_settings
  FROM   settings s
  WHERE  s.team_id = v_team_id
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',      cp.id,
        'team_id', cp.team_id,
        'name',    cp.name,
        'played',  cp.played,
        'owes',    cp.owes
      )
    ),
    '[]'::jsonb
  )
  INTO v_cover_pool
  FROM cover_pool cp
  WHERE cp.team_id = v_team_id;

  SELECT t.live_channel_key
  INTO   v_lckey
  FROM   teams t
  WHERE  t.id = v_team_id;

  RETURN jsonb_build_object(
    'team',             v_team,
    'squad',            v_squad,
    'schedule',         v_schedule,
    'matches',          v_matches,
    'bib_history',      v_bib_hist,
    'settings',         v_settings,
    'cover_pool',       v_cover_pool,
    'live_channel_key', v_lckey
  );
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
