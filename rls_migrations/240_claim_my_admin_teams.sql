-- 240_claim_my_admin_teams.sql
-- Account-claim for superadmin-created squad shells (mig 239). When the organiser signs
-- into the casual app with the email the platform admin set as the squad's admin_email,
-- this links them as the account-admin so the squad appears in their My Squads.
--
-- WRITE RPC, authenticated only. Ephemeral-verified (claimed=1 + player/team_players/
-- team_admins/audit all =1 + idempotent on 2nd call, rolled back, leak 0).
--
-- Match is by the OAuth/OTP-VERIFIED email (auth.email()) — the user provably owns it.
-- "Unclaimed" = no active team_admins, so this can NEVER hijack a squad that already has an
-- owner; it only adopts the empty shells superadmin_create_team makes. Idempotent: a team
-- already claimed (or where the user is already a member) is skipped. Mirrors create_team's
-- admin-player + team_players + team_admins linkage, so player_get_teams[_by_token] surfaces
-- the squad (both resolve membership via players.user_id).

CREATE OR REPLACE FUNCTION claim_my_admin_teams()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text := lower(trim(coalesce(auth.email(), '')));
  v_name    text;
  v_claimed jsonb := '[]'::jsonb;
  r         record;
  v_pid     text;
  v_ptoken  text;
BEGIN
  IF v_uid IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('claimed', '[]'::jsonb);
  END IF;
  v_name := split_part(v_email, '@', 1);

  FOR r IN
    SELECT t.id, t.name FROM teams t
    WHERE lower(trim(t.admin_email)) = v_email
      AND NOT EXISTS (SELECT 1 FROM team_admins ta WHERE ta.team_id = t.id AND ta.revoked_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM team_players tp JOIN players p ON p.id = tp.player_id
                        WHERE tp.team_id = t.id AND p.user_id = v_uid)
  LOOP
    v_pid    := generate_url_safe_token('p_', 8);
    v_ptoken := generate_url_safe_token('p_', 14);
    INSERT INTO players (
      id, name, token, type, disabled, priority, status, paid, owes, goals, motm,
      attended, total, bib_count, team, w, l, d, pay_count, late_dropouts, note, self_paid, user_id
    ) VALUES (
      v_pid, v_name, v_ptoken, 'regular', false, false, 'none', false, 0, 0, 0,
      0, 0, 0, null, 0, 0, 0, 0, 0, '', false, v_uid
    );
    INSERT INTO team_players (team_id, player_id) VALUES (r.id, v_pid);
    INSERT INTO team_admins (team_id, user_id, role, granted_by)
    VALUES (r.id, v_uid, 'team_admin', null) ON CONFLICT DO NOTHING;
    INSERT INTO audit_events (team_id, actor_type, actor_user_id, actor_identifier, action, entity_type, entity_id, metadata)
    VALUES (r.id, 'team_admin', v_uid, v_email, 'admin_claimed_by_email', 'team', r.id, jsonb_build_object('via', 'claim_by_email'));
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object('team_id', r.id, 'name', r.name));
  END LOOP;

  RETURN jsonb_build_object('claimed', v_claimed);
END;
$$;

REVOKE ALL ON FUNCTION claim_my_admin_teams() FROM anon;
GRANT EXECUTE ON FUNCTION claim_my_admin_teams() TO authenticated;
