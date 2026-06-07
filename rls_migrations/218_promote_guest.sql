-- 218: PERSISTENT GUESTS S3 — promotion to permanent member (both routes).
--
-- Route 1 (admin): admin_promote_guest(p_admin_token, p_guest_id) — admin taps
--   "Make permanent" in the squad. Flips is_guest=false, guest_of=NULL on the
--   SAME row (token, status, stats, player_match history all preserved). The
--   player then counts in the reliability table + POTM automatically (existing
--   is_guest=false filters). resolve_admin_caller → Vice-Captain parity.
--
-- Route 2 (self-claim): link_player_to_user gains a GATED promote-on-link branch.
--   A guest is sent their own unique token link (/p/<guest_token>); when they
--   sign in, link_player_to_user fires on THAT token (which uniquely identifies
--   their row — no name matching) and, because the row is a guest, promotes it to
--   a permanent member while linking the account. Gated to is_guest=true so a
--   regular player's normal first-link is byte-for-byte unchanged.
--
-- PURE function definition (1 new + 1 REPLACE) — NO row mutation on apply.

-- ── admin_promote_guest (NEW) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_promote_guest(p_admin_token text, p_guest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_team_id     text;
  v_actor_type  text;
  v_actor_ident text;
  v_result      jsonb;
BEGIN
  IF p_admin_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  SELECT r.team_id, r.actor_type, r.actor_ident
    INTO v_team_id, v_actor_type, v_actor_ident
    FROM resolve_admin_caller(p_admin_token) r;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_admin_token';
  END IF;

  -- Must be a guest on the caller's team.
  IF NOT EXISTS (
    SELECT 1
      FROM players g
      JOIN team_players tp ON tp.player_id = g.id
     WHERE g.id       = p_guest_id
       AND g.is_guest = true
       AND tp.team_id = v_team_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_found';
  END IF;

  -- Promote on the same row: history + stats + token preserved.
  UPDATE players SET
    is_guest = false,
    guest_of = NULL
  WHERE id = p_guest_id;

  INSERT INTO audit_events (
    team_id, actor_type, actor_user_id, actor_identifier,
    action, entity_type, entity_id, metadata
  ) VALUES (
    v_team_id, v_actor_type, auth.uid(),
    v_actor_ident,
    'guest_promoted', 'player', p_guest_id,
    jsonb_build_object('route', 'admin')
  );

  SELECT jsonb_build_object(
    'id',             p.id,
    'name',           p.name,
    'nickname',       p.nickname,
    'status',         p.status,
    'type',           p.type,
    'priority',       p.priority,
    'paid',           p.paid,
    'owes',           p.owes,
    'self_paid',      p.self_paid,
    'paid_by',        p.paid_by,
    'pay_count',      p.pay_count,
    'goals',          p.goals,
    'motm',           p.motm,
    'attended',       p.attended,
    'total',          p.total,
    'w',              p.w,
    'l',              p.l,
    'd',              p.d,
    'bib_count',      p.bib_count,
    'late_dropouts',  p.late_dropouts,
    'injured',        p.injured,
    'injured_since',  p.injured_since,
    'is_guest',       p.is_guest,
    'guest_of',       p.guest_of,
    'note',           p.note,
    'disabled',       p.disabled,
    'disable_reason', p.disable_reason,
    'team',           p.team
  )
  INTO v_result
  FROM players p
  WHERE p.id = p_guest_id;

  PERFORM notify_team_change(v_team_id, 'player_updated');

  RETURN v_result;

EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_promote_guest(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_promote_guest(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_promote_guest(text, text) TO authenticated;

-- ── link_player_to_user (REPLACE — add gated promote-on-link) ────────────────
-- Live mig-129 body preserved byte-for-byte except: (a) the initial SELECT now
-- also reads is_guest into v_was_guest; (b) a gated promote UPDATE after the
-- user_id link; (c) the audit metadata records promoted_from_guest.
CREATE OR REPLACE FUNCTION public.link_player_to_user(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_player_id      text;
  v_existing_user  uuid;
  v_user_id        uuid;
  v_team_id        text;
  v_was_guest      boolean;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;

  SELECT id, user_id, is_guest INTO v_player_id, v_existing_user, v_was_guest
    FROM players WHERE token = p_token;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invalid_token';
  END IF;

  IF v_existing_user IS NOT NULL AND v_existing_user <> v_user_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='user_already_linked';
  END IF;

  UPDATE players SET user_id = v_user_id WHERE id = v_player_id;

  -- PERSISTENT GUESTS S3 (218): claiming via a guest's own token link promotes
  -- that guest to a permanent member (same row → history carries over). Gated to
  -- is_guest=true so a regular player's normal first-link is unaffected.
  IF v_was_guest THEN
    UPDATE players SET is_guest = false, guest_of = NULL WHERE id = v_player_id;
  END IF;

  SELECT team_id INTO v_team_id FROM team_players
    WHERE player_id = v_player_id
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_team_id IS NOT NULL THEN
    INSERT INTO audit_events (
      team_id, actor_type, actor_user_id, actor_identifier,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_team_id, 'player', v_user_id,
      'player_token:' || md5(p_token),
      'player_account_linked', 'player', v_player_id,
      jsonb_build_object('linked_user_id', v_user_id,
                         'promoted_from_guest', COALESCE(v_was_guest, false))
    );

    PERFORM notify_team_change(v_team_id, 'player_updated');
  END IF;

  RETURN jsonb_build_object('ok', true, 'player_id', v_player_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
