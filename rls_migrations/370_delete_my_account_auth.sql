-- 370 — delete_my_account_auth(): authenticated account deletion (no token).
--
-- Companion to delete_my_account(p_token). Keys off auth.uid() so a signed-in
-- user with NO player token (a fresh Sign-in-with-Apple identity, or a
-- club-member-only account) can still delete their account in-app — Apple
-- Guideline 5.1.1(v). Mirrors delete_my_account's player anonymisation, and
-- ADDS: member_profiles PII scrub (its auth_user_id FK is SET NULL, which would
-- otherwise orphan the PII incl. medical fields) + user_profiles removal (its
-- user_id FK is NO ACTION, which would otherwise block the auth.users delete).
-- The auth.users row itself is deleted server-side by api/delete-account.js
-- (service role) after this returns auth_user_id, verifying identity from the
-- caller's own access token.
--
-- Verified: EV 2/2 (member-PII scrub + user_profile delete + return shape;
-- not_authenticated guard) + leak 0; rpc-security PASS (SECURITY DEFINER,
-- search_path public/pg_temp, single overload, anon revoked / authenticated
-- granted). NOTE: photo_consent is NOT NULL → scrubbed to '{}' not NULL.
CREATE OR REPLACE FUNCTION public.delete_my_account_auth()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id    uuid;
  v_player_ids text[];
  v_team_ids   text[];
  v_blocking   text[];
  v_player_id  text;
  v_team_id    text;
  v_row_token  text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='not_authenticated';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::text[])
    INTO v_player_ids FROM players WHERE user_id = v_user_id;

  SELECT COALESCE(array_agg(DISTINCT team_id), ARRAY[]::text[])
    INTO v_team_ids FROM team_players WHERE player_id = ANY(v_player_ids);

  -- last-admin guard (identical to delete_my_account): block if the user is the
  -- only remaining admin of any team.
  SELECT COALESCE(array_agg(t.team_id), ARRAY[]::text[])
    INTO v_blocking
    FROM team_admins t
   WHERE t.user_id = v_user_id AND t.revoked_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM team_admins o
        WHERE o.team_id = t.team_id AND o.user_id <> v_user_id AND o.revoked_at IS NULL);
  IF array_length(v_blocking, 1) > 0 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='last_admin:' || array_to_string(v_blocking, ',');
  END IF;

  -- Anonymise each linked player (mirrors delete_my_account).
  FOREACH v_player_id IN ARRAY v_player_ids LOOP
    FOR v_team_id, v_row_token IN
      SELECT tp.team_id, p.token FROM team_players tp
        JOIN players p ON p.id = tp.player_id WHERE tp.player_id = v_player_id
    LOOP
      INSERT INTO audit_events (
        team_id, actor_type, actor_user_id, actor_identifier,
        action, entity_type, entity_id, metadata
      ) VALUES (
        v_team_id, 'player', v_user_id,
        CASE WHEN v_row_token IS NOT NULL THEN 'player_token:' || md5(v_row_token)
             ELSE 'account_deleted_bulk' END,
        'account_deleted', 'player', v_player_id,
        jsonb_build_object('player_id', v_player_id, 'auth_user_id', v_user_id, 'via', 'auth'));
    END LOOP;

    UPDATE players
       SET name='Deleted player', nickname=NULL, token=NULL, user_id=NULL,
           disabled=true, disable_reason='account_deleted', status='out',
           injured=false, injured_since=NULL, priority=false, admin_locked_in=false,
           note=NULL, paid=false, self_paid=false, paid_by=NULL
     WHERE id = v_player_id;

    DELETE FROM team_players       WHERE player_id = v_player_id;
    DELETE FROM player_career      WHERE player_id = v_player_id;
    DELETE FROM push_subscriptions WHERE player_id = v_player_id;
  END LOOP;

  UPDATE team_admins SET revoked_at = now(), revoked_by = v_user_id
   WHERE user_id = v_user_id AND revoked_at IS NULL;

  -- Scrub member_profiles PII (auth_user_id FK is SET NULL → would orphan PII).
  UPDATE member_profiles
     SET first_name='Deleted member', last_name=NULL, email=NULL, phone=NULL,
         dob=NULL, gender=NULL,
         address_line1=NULL, address_line2=NULL, address_city=NULL, address_postcode=NULL,
         ec1_name=NULL, ec1_relationship=NULL, ec1_phone=NULL,
         ec2_name=NULL, ec2_relationship=NULL, ec2_phone=NULL,
         send_notes=NULL, dietary_notes=NULL, authorised_collectors=NULL,
         medical_conditions=NULL, allergies=NULL, medications=NULL, gp_details=NULL,
         photo_consent='{}'::jsonb, auth_user_id=NULL
   WHERE auth_user_id = v_user_id;

  -- Remove the user's own profile row (display_name/nickname/avatar); also clears
  -- the NO ACTION user_profiles.user_id FK so the auth.users delete can proceed.
  DELETE FROM user_profiles WHERE user_id = v_user_id;

  FOREACH v_team_id IN ARRAY v_team_ids LOOP
    PERFORM notify_team_change(v_team_id, 'player_account_deleted');
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'auth_user_id', v_user_id,
    'team_ids', to_jsonb(v_team_ids)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='internal_error';
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_my_account_auth() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_my_account_auth() TO authenticated;
