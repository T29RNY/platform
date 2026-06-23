-- Down migration 401 — restore the venue_id= membership gates, drop the scope helpers.
-- Reverses each predicate swap (helper-call form → original EXISTS), exactly-once
-- asserted, then drops the now-unreferenced helpers.

DO $mig$
DECLARE
  v_def text; v_new text; v_n int; v_job jsonb;
  v_jobs jsonb := jsonb_build_array(
    jsonb_build_object('fn','member_book_appointment',
      'pat','SELECT public\._member_entitled_at_venue\(v_profile\.id, v_tr\.venue_id\) INTO v_member;',
      'rep','SELECT EXISTS (SELECT 1 FROM public.venue_memberships WHERE member_profile_id = v_profile.id AND venue_id = v_tr.venue_id AND status IN (''active'',''ending'')) INTO v_member;'),
    jsonb_build_object('fn','member_book_class_session',
      'pat','IF NOT public\._member_entitled_at_venue\(v_profile\.id, v_sess\.venue_id\) THEN',
      'rep','IF NOT EXISTS (SELECT 1 FROM public.venue_memberships WHERE member_profile_id = v_profile.id AND venue_id = v_sess.venue_id AND status IN (''active'',''ending'')) THEN'),
    jsonb_build_object('fn','member_purchase_class_package',
      'pat','IF NOT public\._member_entitled_at_venue\(v_profile_id, v_pkg\.venue_id\) THEN',
      'rep','IF NOT EXISTS (SELECT 1 FROM public.venue_memberships WHERE member_profile_id = v_profile_id AND venue_id = v_pkg.venue_id AND status IN (''active'',''ending'')) THEN'),
    jsonb_build_object('fn','member_join_club_team',
      'pat','IF NOT public\._member_entitled_at_venue\(v_target, v_venue_id\) THEN',
      'rep','IF NOT EXISTS (SELECT 1 FROM public.venue_memberships m WHERE m.member_profile_id = v_target AND m.venue_id = v_venue_id AND m.status IN (''active'',''ending'')) THEN'),
    jsonb_build_object('fn','member_list_trainers',
      'pat','SELECT public\._member_entitled_at_venue\(v_profile, p_venue_id\) INTO v_member;',
      'rep','SELECT EXISTS (SELECT 1 FROM public.venue_memberships WHERE member_profile_id = v_profile AND venue_id = p_venue_id AND status IN (''active'',''ending'')) INTO v_member;'),
    jsonb_build_object('fn','member_get_venue_membership_pass',
      'pat','AND public\._membership_covers_venue\(club_id, venue_id, v_venue_id\)',
      'rep','AND venue_id = v_venue_id')
  );
BEGIN
  FOR v_job IN SELECT * FROM jsonb_array_elements(v_jobs) LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname = (v_job->>'fn') ORDER BY p.oid LIMIT 1;
    v_n := (SELECT count(*) FROM regexp_matches(v_def, (v_job->>'pat'), 'g'));
    IF v_n <> 1 THEN RAISE EXCEPTION 'mig401_down: % expected 1 match, found %', (v_job->>'fn'), v_n; END IF;
    v_new := regexp_replace(v_def, (v_job->>'pat'), (v_job->>'rep'), '');
    EXECUTE v_new;
  END LOOP;
END
$mig$;

DROP FUNCTION IF EXISTS public._member_entitled_at_venue(uuid, text);
DROP FUNCTION IF EXISTS public._membership_covers_venue(text, text, text);
