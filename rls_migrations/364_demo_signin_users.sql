-- 364: TWO cross-role demo SIGN-IN users covering every auth-based user type.
-- Mirrors the live auth.users / auth.identities shape (empty-string token cols GoTrue
-- requires; instance_id all-zeros; bcrypt password via pgcrypto). Idempotent.
--   User 1  demo@in-or-out.com  / DemoBoss1!  → platform superadmin + HQ company admin
--           + venue OWNER + squad admin + casual player + competitive player + club
--           member of BOTH combat clubs (fight record + grading via multi-context).
--   User 2  family@in-or-out.com / DemoFam2!  → plain member (paused) + GUARDIAN of a
--           junior + venue STAFF (booking caps only) + plain casual player.
-- uids d0…0001/0002 ; their member_profiles 0d…0011/0012 ; child 0d…0013.

-- ── auth.users ───────────────────────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) VALUES
  ('00000000-0000-0000-0000-000000000000','d0000000-0000-4000-8000-000000000001','authenticated','authenticated',
   'demo@in-or-out.com', crypt('DemoBoss1!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"name":"Alex Demo","email":"demo@in-or-out.com","email_verified":true}'::jsonb, now(), now(),
   '','','','','','','',''),
  ('00000000-0000-0000-0000-000000000000','d0000000-0000-4000-8000-000000000002','authenticated','authenticated',
   'family@in-or-out.com', crypt('DemoFam2!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"name":"Sam Carter","email":"family@in-or-out.com","email_verified":true}'::jsonb, now(), now(),
   '','','','','','','','')
ON CONFLICT DO NOTHING;

-- ── auth.identities (email provider) ─────────────────────────────────────────
INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at) VALUES
  (gen_random_uuid(),'d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','email',
   '{"sub":"d0000000-0000-4000-8000-000000000001","email":"demo@in-or-out.com","email_verified":true,"phone_verified":false}'::jsonb, now(), now(), now()),
  (gen_random_uuid(),'d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','email',
   '{"sub":"d0000000-0000-4000-8000-000000000002","email":"family@in-or-out.com","email_verified":true,"phone_verified":false}'::jsonb, now(), now(), now())
ON CONFLICT DO NOTHING;

-- ── member_profiles (Alex adult, Sam adult, Charlie junior w/ safeguarding) ──
INSERT INTO public.member_profiles
  (id, auth_user_id, first_name, last_name, email, phone, dob, gender,
   ec1_name, ec1_relationship, ec1_phone, consent_emergency_treatment, may_leave_unaccompanied,
   photo_consent, medical_conditions, allergies) VALUES
  ('0d000000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000001','Alex','Demo','demo@in-or-out.com','07700900201','1990-02-15','other',
   NULL,NULL,NULL,true,true,'{"website":true,"social":true,"press":false,"marketing":false}'::jsonb,NULL,NULL),
  ('0d000000-0000-4000-8000-000000000012','d0000000-0000-4000-8000-000000000002','Sam','Carter','family@in-or-out.com','07700900202','1985-07-09','other',
   NULL,NULL,NULL,true,true,'{"website":false,"social":false,"press":false,"marketing":false}'::jsonb,NULL,NULL),
  ('0d000000-0000-4000-8000-000000000013',NULL,'Charlie','Carter',NULL,NULL,'2014-05-20','male',
   'Sam Carter','Parent','07700900202',true,false,'{"website":true,"social":false,"press":false,"marketing":false}'::jsonb,'Asthma (mild)','Peanuts')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.member_guardians (id, child_profile_id, guardian_profile_id, relationship, is_primary, can_collect, invite_state, accepted_at) VALUES
  ('d6000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000013','0d000000-0000-4000-8000-000000000012','Parent',true,true,'accepted', now()-interval '120 days')
ON CONFLICT (id) DO NOTHING;

-- ── operator / admin role links (User 1) ─────────────────────────────────────
INSERT INTO public.platform_admins (user_id, note) VALUES
  ('d0000000-0000-4000-8000-000000000001','Demo power-user — seeded mig 364') ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.company_admins (company_id, user_id, role) VALUES
  ('company_demo','d0000000-0000-4000-8000-000000000001','super_admin') ON CONFLICT (company_id, user_id) DO NOTHING;

INSERT INTO public.venue_admins (id, venue_id, user_id, email, role, status, caps_grant) VALUES
  ('da000000-0000-4000-8000-000000000001','demo_venue','d0000000-0000-4000-8000-000000000001','demo@in-or-out.com','owner','active','{}'),
  ('da000000-0000-4000-8000-000000000002','demo_venue','d0000000-0000-4000-8000-000000000002','family@in-or-out.com','staff','active','{booking_settings}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_admins (id, team_id, user_id, role) VALUES
  ('da000000-0000-4000-8000-000000000003','team_demo','d0000000-0000-4000-8000-000000000001','team_admin')
ON CONFLICT (id) DO NOTHING;

-- ── casual / competitive player links ────────────────────────────────────────
INSERT INTO public.players (id, name, type, token, user_id, date_of_birth, status, attended, total, motm, goals, w, l, d) VALUES
  ('p_demo_alex','Alex Demo','regular','p_demo_alex_token','d0000000-0000-4000-8000-000000000001','1990-02-15','in',18,20,3,12,11,6,3),
  ('p_dc_alex','Alex Demo','regular','p_dc_alex_token','d0000000-0000-4000-8000-000000000001','1990-02-15','none',9,12,1,5,5,4,3),
  ('p_demo_sam','Sam Carter','regular','p_demo_sam_token','d0000000-0000-4000-8000-000000000002','1985-07-09','in',10,20,0,2,4,7,9)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_players (team_id, player_id) VALUES
  ('team_demo','p_demo_alex'),('team_dc_fc','p_dc_alex'),('team_demo','p_demo_sam')
ON CONFLICT (team_id, player_id) DO NOTHING;

-- multi-context nav ON for the demo squad so Alex's squad+clubs experience is fully lit
UPDATE public.teams SET multi_context_nav=true WHERE id='team_demo';

-- ── club memberships for the demo users ──────────────────────────────────────
INSERT INTO public.venue_memberships
  (id, venue_id, member_profile_id, club_id, cohort_id, tier_id, period, amount_pence, status, started_at, renews_at) VALUES
  -- Alex: BOTH combat clubs (boxing + martial arts) → fight record AND grading via multi-context
  ('ab000000-0000-4000-8000-000000000010','demo_venue','0d000000-0000-4000-8000-000000000011','club_demo_box','cb000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002','monthly',3000,'active',CURRENT_DATE-180,CURRENT_DATE+12),
  ('ab000000-0000-4000-8000-000000000011','demo_venue','0d000000-0000-4000-8000-000000000011','club_demo_ma','cb000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000002','annual',36000,'active',CURRENT_DATE-365,CURRENT_DATE+30),
  -- Sam: plain boxing member, PAUSED (shows the paused membership state)
  ('ab000000-0000-4000-8000-000000000012','demo_venue','0d000000-0000-4000-8000-000000000012','club_demo_box','cb000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002','monthly',3000,'paused',CURRENT_DATE-200,CURRENT_DATE+20),
  -- Charlie: junior boxing
  ('ab000000-0000-4000-8000-000000000013','demo_venue','0d000000-0000-4000-8000-000000000013','club_demo_box','cb000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000003','monthly',1500,'active',CURRENT_DATE-100,CURRENT_DATE+10)
ON CONFLICT (id) DO NOTHING;

-- ── Alex's class bookings, package balance, PT appt ──────────────────────────
INSERT INTO public.venue_class_bookings
  (id, session_id, member_profile_id, status, payment_status, payment_method, booked_at) VALUES
  ('b0000000-0000-4000-8000-000000000021','e5000000-0000-4000-8000-000000000007','0d000000-0000-4000-8000-000000000011','confirmed','waived','door', now()-interval '1 day'),
  ('b0000000-0000-4000-8000-000000000022','e5000000-0000-4000-8000-000000000004','0d000000-0000-4000-8000-000000000011','confirmed','paid','prepay', now()-interval '2 days'),
  -- Charlie booked (by guardian) into Junior Boxing today
  ('b0000000-0000-4000-8000-000000000023','e5000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000013','confirmed','waived','door', now()-interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_member_package_balances (id, member_profile_id, package_id, venue_id, sessions_remaining, purchased_at, expires_at) VALUES
  ('9b000000-0000-4000-8000-000000000004','0d000000-0000-4000-8000-000000000011','9a000000-0000-4000-8000-000000000001','demo_venue',5, now()-interval '15 days', now()+interval '75 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_appointments
  (id, venue_id, trainer_id, member_profile_id, starts_at, ends_at, status, price_pence, payment_mode) VALUES
  ('a7000000-0000-4000-8000-000000000005','demo_venue','7a000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000011',
    date_trunc('day',now())+interval '5 days'+interval '9 hours', date_trunc('day',now())+interval '5 days'+interval '10 hours','confirmed',3000,'door')
ON CONFLICT (id) DO NOTHING;

-- ── Alex's fight record (boxing) + Charlie's junior sparring ─────────────────
INSERT INTO public.member_bouts
  (id, member_profile_id, club_id, bout_date, opponent_name, event_name, result, method, rounds, is_sparring, recorded_by, recorded_by_actor_type) VALUES
  ('b7000000-0000-4000-8000-000000000015','0d000000-0000-4000-8000-000000000011','club_demo_box',CURRENT_DATE-220,'T. Walsh','City Open','win','TKO',2,false,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000016','0d000000-0000-4000-8000-000000000011','club_demo_box',CURRENT_DATE-130,'G. Park','Regional Box Cup','win','Decision',3,false,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000017','0d000000-0000-4000-8000-000000000011','club_demo_box',CURRENT_DATE-45,'H. Bauer','National Series','loss','Decision',3,false,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000018','0d000000-0000-4000-8000-000000000011','club_demo_box',CURRENT_DATE-8,'Sparring partner','Gym session','draw',NULL,3,true,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000019','0d000000-0000-4000-8000-000000000013','club_demo_box',CURRENT_DATE-12,'Sparring partner','Junior session','draw',NULL,2,true,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000020','0d000000-0000-4000-8000-000000000013','club_demo_box',CURRENT_DATE-2,'Sparring partner','Junior session','win',NULL,2,true,'Demo Coach','venue_admin')
ON CONFLICT (id) DO NOTHING;

-- ── Alex's grading history (martial arts, adult scheme) ──────────────────────
INSERT INTO public.member_grades (id, member_profile_id, scheme_id, grade_id, stripes, note, awarded_at, awarded_by, awarded_by_actor_type) VALUES
  ('63000000-0000-4000-8000-000000000008','0d000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000003',0,'Green belt', now()-interval '120 days','Demo Coach','venue_admin'),
  ('63000000-0000-4000-8000-000000000009','0d000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000004',2,'Blue belt, two stripes', now()-interval '20 days','Demo Coach','venue_admin')
ON CONFLICT (id) DO NOTHING;

-- ── charges for Alex's paid items ────────────────────────────────────────────
INSERT INTO public.venue_charges (id, venue_id, source_type, source_id, amount_due_pence, status, due_date) VALUES
  ('c4000000-0000-4000-8000-000000000016','demo_venue','class','b0000000-0000-4000-8000-000000000022',800,'paid',CURRENT_DATE+1),
  ('c4000000-0000-4000-8000-000000000017','demo_venue','membership','ab000000-0000-4000-8000-000000000010',3000,'paid',CURRENT_DATE-3),
  ('c4000000-0000-4000-8000-000000000018','demo_venue','pt','a7000000-0000-4000-8000-000000000005',3000,'unpaid',CURRENT_DATE+5)
ON CONFLICT (id) DO NOTHING;
