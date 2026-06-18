-- 363: DEEP DEMO DATA for the new feature surfaces (classes, packages, room hire,
-- PT, grading, fight records) anchored to demo_venue + two NEW combat clubs.
-- Idempotent (ON CONFLICT (id) DO NOTHING); never touches the football/casual demo.
-- The 2 cross-role demo SIGN-IN users + their personal data land in mig 364.
--
-- ID prefixes (all unused by prior demo seeds — see audit s151):
--   clubs   club_demo_box / club_demo_ma     cohorts cb…   spaces 5b…
--   class_types c7…  series c5…  sessions e5…  bookings b0…  charges c4…
--   packages 9a…  balances 9b…  room_hires 40…  trainers 7a…  availability 7b…
--   appointments a7…  grading_schemes 61…  grades 62…  member_grades 63…  bouts b7…
--   combat memberships ab…
-- Instructor for all classes = demo_venue owner admin 12b18c95-…  (active).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. TWO NEW COMBAT CLUBS (light up the gym/boxing vertical discipline gating)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.clubs (id, name, short_name, discipline, founded_year) VALUES
  ('club_demo_box','Demo Boxing Club','DBC','boxing',2015),
  ('club_demo_ma','Demo Martial Arts','DMA','martial_arts',2011)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.club_cohorts (id, club_id, name, min_age, max_age) VALUES
  ('cb000000-0000-4000-8000-000000000001','club_demo_box','Adults',16,NULL),
  ('cb000000-0000-4000-8000-000000000002','club_demo_box','Juniors',8,17),
  ('cb000000-0000-4000-8000-000000000003','club_demo_ma','Adults',16,NULL),
  ('cb000000-0000-4000-8000-000000000004','club_demo_ma','Juniors',6,17)
ON CONFLICT (id) DO NOTHING;

-- Enroll EXISTING demo members into the combat clubs (customer_id nullable → link by
-- member_profile_id). Tiers reuse demo tiers 0a…02 (Full Adult) / 0a…03 (Junior).
INSERT INTO public.venue_memberships
  (id, venue_id, member_profile_id, club_id, cohort_id, tier_id, period, amount_pence, status, started_at, renews_at) VALUES
  -- Boxing club
  ('ab000000-0000-4000-8000-000000000001','demo_venue','0d000000-0000-4000-8000-000000000002','club_demo_box','cb000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002','monthly',3000,'active',CURRENT_DATE-120,CURRENT_DATE+15),
  ('ab000000-0000-4000-8000-000000000002','demo_venue','0d000000-0000-4000-8000-000000000004','club_demo_box','cb000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002','monthly',3000,'active',CURRENT_DATE-90,CURRENT_DATE+9),
  ('ab000000-0000-4000-8000-000000000003','demo_venue','0d000000-0000-4000-8000-000000000007','club_demo_box','cb000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002','monthly',3000,'active',CURRENT_DATE-60,CURRENT_DATE+22),
  ('ab000000-0000-4000-8000-000000000004','demo_venue','0d000000-0000-4000-8000-000000000008','club_demo_box','cb000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002','monthly',3000,'active',CURRENT_DATE-30,CURRENT_DATE+1),
  ('ab000000-0000-4000-8000-000000000005','demo_venue','0d000000-0000-4000-8000-000000000006','club_demo_box','cb000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000003','monthly',1500,'active',CURRENT_DATE-45,CURRENT_DATE+12),
  -- Martial arts club
  ('ab000000-0000-4000-8000-000000000006','demo_venue','0d000000-0000-4000-8000-000000000001','club_demo_ma','cb000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000002','annual',36000,'active',CURRENT_DATE-300,CURRENT_DATE+65),
  ('ab000000-0000-4000-8000-000000000007','demo_venue','0d000000-0000-4000-8000-000000000003','club_demo_ma','cb000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000002','monthly',3200,'active',CURRENT_DATE-200,CURRENT_DATE+20),
  ('ab000000-0000-4000-8000-000000000008','demo_venue','0d000000-0000-4000-8000-000000000005','club_demo_ma','cb000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000002','annual',36000,'active',CURRENT_DATE-400,CURRENT_DATE+5),
  ('ab000000-0000-4000-8000-000000000009','demo_venue','0d000000-0000-4000-8000-000000000006','club_demo_ma','cb000000-0000-4000-8000-000000000004','0a000000-0000-4000-8000-000000000003','monthly',1500,'active',CURRENT_DATE-150,CURRENT_DATE+18)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SPACES (Facilities → Spaces; prerequisite for classes + room hire)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_spaces (id, venue_id, name, description, capacity, space_type, is_enquiry_only, enquiry_contact_name, enquiry_contact_email) VALUES
  ('5b000000-0000-4000-8000-000000000001','demo_venue','Studio 1','Mirror-walled fitness studio',20,'studio',false,NULL,NULL),
  ('5b000000-0000-4000-8000-000000000002','demo_venue','Main Hall','Sprung-floor sports hall',40,'hall',false,NULL,NULL),
  ('5b000000-0000-4000-8000-000000000003','demo_venue','Mat Room','Matted combat / dojo space',24,'room',false,NULL,NULL),
  ('5b000000-0000-4000-8000-000000000004','demo_venue','Function Room','Premium function space for hire',60,'room',true,'Demo Events Team','events@demo.test')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CLASS TYPES + SERIES (open/free, members-only, paid, sparring)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_class_types
  (id, venue_id, space_id, name, description, category, duration_minutes, default_capacity, members_only, is_sparring, first_session_free) VALUES
  ('c7000000-0000-4000-8000-000000000001','demo_venue','5b000000-0000-4000-8000-000000000001','Vinyasa Yoga','Flowing all-levels yoga','yoga',60,16,true,false,false),
  ('c7000000-0000-4000-8000-000000000002','demo_venue','5b000000-0000-4000-8000-000000000003','Junior Boxing','Open to all — first session free','martial_arts',60,20,false,false,true),
  ('c7000000-0000-4000-8000-000000000003','demo_venue','5b000000-0000-4000-8000-000000000001','Spin Class','High-intensity indoor cycling','fitness',45,12,true,false,false),
  ('c7000000-0000-4000-8000-000000000004','demo_venue','5b000000-0000-4000-8000-000000000003','Open Sparring','Supervised open-mat sparring','martial_arts',60,16,true,true,false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_class_series
  (id, class_type_id, instructor_id, day_of_week, start_time, series_start, price_pence, payment_mode) VALUES
  ('c5000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','12b18c95-2508-450b-9118-34d98877bff6',1,'18:00',CURRENT_DATE-30,800,'prepay'),
  ('c5000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002','12b18c95-2508-450b-9118-34d98877bff6',3,'17:00',CURRENT_DATE-30,0,'door'),
  ('c5000000-0000-4000-8000-000000000003','c7000000-0000-4000-8000-000000000003','12b18c95-2508-450b-9118-34d98877bff6',5,'07:00',CURRENT_DATE-30,1000,'prepay'),
  ('c5000000-0000-4000-8000-000000000004','c7000000-0000-4000-8000-000000000004','12b18c95-2508-450b-9118-34d98877bff6',6,'11:00',CURRENT_DATE-30,0,'door')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SESSIONS (past completed, today, upcoming) — times relative to now()
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_class_sessions
  (id, venue_id, class_type_id, series_id, instructor_id, space_id, starts_at, ends_at, capacity, status, price_pence, payment_mode, completed_at) VALUES
  -- Junior Boxing: 2 days ago (completed), today, +7d
  ('e5000000-0000-4000-8000-000000000001','demo_venue','c7000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000002','12b18c95-2508-450b-9118-34d98877bff6','5b000000-0000-4000-8000-000000000003',
    date_trunc('day',now())-interval '2 days'+interval '17 hours', date_trunc('day',now())-interval '2 days'+interval '18 hours',20,'completed',0,'door', date_trunc('day',now())-interval '2 days'+interval '18 hours'),
  ('e5000000-0000-4000-8000-000000000002','demo_venue','c7000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000002','12b18c95-2508-450b-9118-34d98877bff6','5b000000-0000-4000-8000-000000000003',
    date_trunc('day',now())+interval '17 hours', date_trunc('day',now())+interval '18 hours',20,'scheduled',0,'door',NULL),
  ('e5000000-0000-4000-8000-000000000003','demo_venue','c7000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000002','12b18c95-2508-450b-9118-34d98877bff6','5b000000-0000-4000-8000-000000000003',
    date_trunc('day',now())+interval '7 days'+interval '17 hours', date_trunc('day',now())+interval '7 days'+interval '18 hours',20,'scheduled',0,'door',NULL),
  -- Vinyasa Yoga: +1d, +8d (members-only, paid prepay 800)
  ('e5000000-0000-4000-8000-000000000004','demo_venue','c7000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','12b18c95-2508-450b-9118-34d98877bff6','5b000000-0000-4000-8000-000000000001',
    date_trunc('day',now())+interval '1 day'+interval '18 hours', date_trunc('day',now())+interval '1 day'+interval '19 hours',16,'scheduled',800,'prepay',NULL),
  ('e5000000-0000-4000-8000-000000000005','demo_venue','c7000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','12b18c95-2508-450b-9118-34d98877bff6','5b000000-0000-4000-8000-000000000001',
    date_trunc('day',now())+interval '8 days'+interval '18 hours', date_trunc('day',now())+interval '8 days'+interval '19 hours',16,'scheduled',800,'prepay',NULL),
  -- Spin: +3d (paid 1000)
  ('e5000000-0000-4000-8000-000000000006','demo_venue','c7000000-0000-4000-8000-000000000003','c5000000-0000-4000-8000-000000000003','12b18c95-2508-450b-9118-34d98877bff6','5b000000-0000-4000-8000-000000000001',
    date_trunc('day',now())+interval '3 days'+interval '7 hours', date_trunc('day',now())+interval '3 days'+interval '7 hours 45 minutes',12,'scheduled',1000,'prepay',NULL),
  -- Open Sparring: +4d
  ('e5000000-0000-4000-8000-000000000007','demo_venue','c7000000-0000-4000-8000-000000000004','c5000000-0000-4000-8000-000000000004','12b18c95-2508-450b-9118-34d98877bff6','5b000000-0000-4000-8000-000000000003',
    date_trunc('day',now())+interval '4 days'+interval '11 hours', date_trunc('day',now())+interval '4 days'+interval '12 hours',16,'scheduled',0,'door',NULL)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BOOKINGS — every state (confirmed, waitlist, offered, no_show, checked-in),
--    mixed ages on Junior Boxing so the age roster is populated.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_class_bookings
  (id, session_id, member_profile_id, status, payment_status, payment_method, waitlist_position, checked_in_at, booked_at) VALUES
  -- Junior Boxing PAST (completed): Leo(13) + Marcus checked-in, Daniel no-show
  ('b0000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000006','confirmed','waived','door',NULL, date_trunc('day',now())-interval '2 days'+interval '17 hours', now()-interval '5 days'),
  ('b0000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000008','confirmed','waived','door',NULL, date_trunc('day',now())-interval '2 days'+interval '17 hours', now()-interval '5 days'),
  ('b0000000-0000-4000-8000-000000000003','e5000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000002','no_show','waived','door',NULL,NULL, now()-interval '5 days'),
  -- Junior Boxing TODAY: Leo + Daniel + Marcus confirmed, Tom waitlist, Grace offered
  ('b0000000-0000-4000-8000-000000000004','e5000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000006','confirmed','waived','door',NULL,NULL, now()-interval '2 days'),
  ('b0000000-0000-4000-8000-000000000005','e5000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000002','confirmed','waived','door',NULL,NULL, now()-interval '2 days'),
  ('b0000000-0000-4000-8000-000000000006','e5000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000008','confirmed','waived','door',NULL,NULL, now()-interval '1 day'),
  ('b0000000-0000-4000-8000-000000000007','e5000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000004','waitlist','pending','not_yet',1,NULL, now()-interval '1 day'),
  -- Junior Boxing +7d: Leo + Daniel
  ('b0000000-0000-4000-8000-000000000009','e5000000-0000-4000-8000-000000000003','0d000000-0000-4000-8000-000000000006','confirmed','waived','door',NULL,NULL, now()-interval '6 hours'),
  ('b0000000-0000-4000-8000-000000000010','e5000000-0000-4000-8000-000000000003','0d000000-0000-4000-8000-000000000002','confirmed','waived','door',NULL,NULL, now()-interval '6 hours'),
  -- Yoga +1d (paid prepay): Sarah paid, Priya paid, Grace pending
  ('b0000000-0000-4000-8000-000000000011','e5000000-0000-4000-8000-000000000004','0d000000-0000-4000-8000-000000000001','confirmed','paid','prepay',NULL,NULL, now()-interval '3 days'),
  ('b0000000-0000-4000-8000-000000000012','e5000000-0000-4000-8000-000000000004','0d000000-0000-4000-8000-000000000003','confirmed','paid','prepay',NULL,NULL, now()-interval '3 days'),
  ('b0000000-0000-4000-8000-000000000013','e5000000-0000-4000-8000-000000000004','0d000000-0000-4000-8000-000000000007','confirmed','pending','not_yet',NULL,NULL, now()-interval '2 days'),
  -- Yoga +8d: Sarah
  ('b0000000-0000-4000-8000-000000000014','e5000000-0000-4000-8000-000000000005','0d000000-0000-4000-8000-000000000001','confirmed','pending','not_yet',NULL,NULL, now()-interval '1 day'),
  -- Spin +3d (paid): Tom paid, Daniel paid, Grace pending
  ('b0000000-0000-4000-8000-000000000015','e5000000-0000-4000-8000-000000000006','0d000000-0000-4000-8000-000000000004','confirmed','paid','prepay',NULL,NULL, now()-interval '2 days'),
  ('b0000000-0000-4000-8000-000000000016','e5000000-0000-4000-8000-000000000006','0d000000-0000-4000-8000-000000000002','confirmed','paid','prepay',NULL,NULL, now()-interval '2 days'),
  ('b0000000-0000-4000-8000-000000000017','e5000000-0000-4000-8000-000000000006','0d000000-0000-4000-8000-000000000007','confirmed','pending','not_yet',NULL,NULL, now()-interval '1 day'),
  -- Sparring +4d: Daniel, Marcus, Tom
  ('b0000000-0000-4000-8000-000000000018','e5000000-0000-4000-8000-000000000007','0d000000-0000-4000-8000-000000000002','confirmed','waived','door',NULL,NULL, now()-interval '2 days'),
  ('b0000000-0000-4000-8000-000000000019','e5000000-0000-4000-8000-000000000007','0d000000-0000-4000-8000-000000000008','confirmed','waived','door',NULL,NULL, now()-interval '2 days'),
  ('b0000000-0000-4000-8000-000000000020','e5000000-0000-4000-8000-000000000007','0d000000-0000-4000-8000-000000000004','confirmed','waived','door',NULL,NULL, now()-interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CLASS PACKAGES + member balances
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_class_packages (id, venue_id, name, session_count, price_pence, valid_days) VALUES
  ('9a000000-0000-4000-8000-000000000001','demo_venue','10-Class Pass',10,8000,90),
  ('9a000000-0000-4000-8000-000000000002','demo_venue','5-Class Yoga Pass',5,3500,60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_member_package_balances (id, member_profile_id, package_id, venue_id, sessions_remaining, purchased_at, expires_at) VALUES
  ('9b000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000001','demo_venue',7, now()-interval '10 days', now()+interval '80 days'),
  ('9b000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000007','9a000000-0000-4000-8000-000000000002','demo_venue',3, now()-interval '20 days', now()+interval '40 days'),
  ('9b000000-0000-4000-8000-000000000003','0d000000-0000-4000-8000-000000000004','9a000000-0000-4000-8000-000000000001','demo_venue',10, now()-interval '2 days', now()+interval '88 days')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ROOM HIRES (confirmed w/ held deposit + pending non-member enquiry)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_room_hires
  (id, venue_id, space_id, booker_type, member_profile_id, booker_name, booker_email, booker_phone, starts_at, ends_at, purpose, attendee_count, status, price_pence, deposit_pence, deposit_status) VALUES
  ('40000000-0000-4000-8000-000000000001','demo_venue','5b000000-0000-4000-8000-000000000002','member','0d000000-0000-4000-8000-000000000001',NULL,NULL,NULL,
    date_trunc('day',now())+interval '5 days'+interval '19 hours', date_trunc('day',now())+interval '5 days'+interval '21 hours','Birthday party',25,'confirmed',5000,2000,'held'),
  ('40000000-0000-4000-8000-000000000002','demo_venue','5b000000-0000-4000-8000-000000000004','non_member',NULL,'Acme Corp','events@acme.test','07700900123',
    date_trunc('day',now())+interval '12 days'+interval '9 hours', date_trunc('day',now())+interval '12 days'+interval '17 hours','Corporate away day',30,'requested',NULL,NULL,'none')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. PERSONAL TRAINING — trainers, availability, appointments
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_trainers (id, venue_id, admin_id, display_name, bio, default_session_minutes, price_pence, cancel_cutoff_hours, members_only, active) VALUES
  ('7a000000-0000-4000-8000-000000000001','demo_venue',NULL,'Coach Mike','Strength & conditioning specialist',60,3000,24,false,true),
  ('7a000000-0000-4000-8000-000000000002','demo_venue',NULL,'Coach Lara','Boxing & pad-work coach',60,4000,24,true,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_trainer_availability (id, trainer_id, day_of_week, start_time, end_time, slot_minutes, series_start) VALUES
  ('7b000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001',1,'09:00','12:00',60,CURRENT_DATE-30),
  ('7b000000-0000-4000-8000-000000000002','7a000000-0000-4000-8000-000000000001',3,'09:00','12:00',60,CURRENT_DATE-30),
  ('7b000000-0000-4000-8000-000000000003','7a000000-0000-4000-8000-000000000002',5,'16:00','19:00',60,CURRENT_DATE-30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_appointments
  (id, venue_id, trainer_id, member_profile_id, starts_at, ends_at, status, price_pence, payment_mode, checked_in_at) VALUES
  ('a7000000-0000-4000-8000-000000000001','demo_venue','7a000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000002',
    date_trunc('day',now())+interval '2 days'+interval '10 hours', date_trunc('day',now())+interval '2 days'+interval '11 hours','confirmed',3000,'door',NULL),
  ('a7000000-0000-4000-8000-000000000002','demo_venue','7a000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000007',
    date_trunc('day',now())-interval '3 days'+interval '10 hours', date_trunc('day',now())-interval '3 days'+interval '11 hours','completed',3000,'door', date_trunc('day',now())-interval '3 days'+interval '10 hours'),
  ('a7000000-0000-4000-8000-000000000003','demo_venue','7a000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000004',
    date_trunc('day',now())-interval '1 day'+interval '16 hours', date_trunc('day',now())-interval '1 day'+interval '17 hours','no_show',4000,'door',NULL),
  ('a7000000-0000-4000-8000-000000000004','demo_venue','7a000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000001',
    date_trunc('day',now())+interval '6 days'+interval '16 hours', date_trunc('day',now())+interval '6 days'+interval '17 hours','confirmed',4000,'door',NULL)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. GRADING (martial arts club) — belt ladders + member award history
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_grading_schemes (id, club_id, discipline, name, age_band) VALUES
  ('61000000-0000-4000-8000-000000000001','club_demo_ma','martial_arts','Adult Belt System','adults'),
  ('61000000-0000-4000-8000-000000000002','club_demo_ma','martial_arts','Junior Belt System','juniors')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.venue_grades (id, scheme_id, name, rank_order, colour_hex, max_stripes) VALUES
  -- Adults
  ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','White',1,'#EEEEEE',0),
  ('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','Yellow',2,'#FFD93B',0),
  ('62000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001','Green',3,'#3BB54A',0),
  ('62000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000001','Blue',4,'#2D6CDF',0),
  ('62000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000001','Red',5,'#E23B3B',0),
  ('62000000-0000-4000-8000-000000000006','61000000-0000-4000-8000-000000000001','Black',6,'#111111',9),
  -- Juniors (tag belts via stripes)
  ('62000000-0000-4000-8000-000000000007','61000000-0000-4000-8000-000000000002','White',1,'#EEEEEE',4),
  ('62000000-0000-4000-8000-000000000008','61000000-0000-4000-8000-000000000002','Yellow',2,'#FFD93B',4),
  ('62000000-0000-4000-8000-000000000009','61000000-0000-4000-8000-000000000002','Orange',3,'#F08A24',4),
  ('62000000-0000-4000-8000-000000000010','61000000-0000-4000-8000-000000000002','Green',4,'#3BB54A',4)
ON CONFLICT (id) DO NOTHING;

-- Award history: Sarah's progression White→Yellow→Green→Blue; others current grade.
INSERT INTO public.member_grades (id, member_profile_id, scheme_id, grade_id, stripes, note, awarded_at, awarded_by, awarded_by_actor_type) VALUES
  ('63000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',0,'Beginner grading', now()-interval '300 days','Demo Coach','venue_admin'),
  ('63000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002',0,NULL, now()-interval '230 days','Demo Coach','venue_admin'),
  ('63000000-0000-4000-8000-000000000003','0d000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000003',0,NULL, now()-interval '140 days','Demo Coach','venue_admin'),
  ('63000000-0000-4000-8000-000000000004','0d000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000004',1,'Strong technical grading', now()-interval '40 days','Demo Coach','venue_admin'),
  ('63000000-0000-4000-8000-000000000005','0d000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000003',0,NULL, now()-interval '70 days','Demo Coach','venue_admin'),
  ('63000000-0000-4000-8000-000000000006','0d000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000005',1,'One stripe toward black', now()-interval '25 days','Demo Coach','venue_admin'),
  ('63000000-0000-4000-8000-000000000007','0d000000-0000-4000-8000-000000000006','61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000008',2,'Junior yellow, two tags', now()-interval '15 days','Demo Coach','venue_admin')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. FIGHT RECORDS (boxing club) — wins/losses/draws + sparring (excluded from W-L-D)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.member_bouts
  (id, member_profile_id, club_id, bout_date, opponent_name, event_name, result, method, rounds, is_sparring, note, recorded_by, recorded_by_actor_type) VALUES
  -- Daniel
  ('b7000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000002','club_demo_box',CURRENT_DATE-200,'J. Carter','City Open','win','TKO',2,false,NULL,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000002','0d000000-0000-4000-8000-000000000002','club_demo_box',CURRENT_DATE-120,'R. Singh','Regional Box Cup','loss','Decision',3,false,NULL,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000003','0d000000-0000-4000-8000-000000000002','club_demo_box',CURRENT_DATE-40,'M. Doyle','Club Show','win','Decision',3,false,NULL,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000004','0d000000-0000-4000-8000-000000000002','club_demo_box',CURRENT_DATE-10,'Sparring partner','Gym session','draw',NULL,3,true,'Sparring round', 'Demo Coach','venue_admin'),
  -- Tom
  ('b7000000-0000-4000-8000-000000000005','0d000000-0000-4000-8000-000000000004','club_demo_box',CURRENT_DATE-150,'A. Khan','City Open','win','Points',3,false,NULL,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000006','0d000000-0000-4000-8000-000000000004','club_demo_box',CURRENT_DATE-60,'L. Owens','Regional Box Cup','draw','Decision',3,false,NULL,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000007','0d000000-0000-4000-8000-000000000004','club_demo_box',CURRENT_DATE-7,'Sparring partner','Gym session','no_contest',NULL,2,true,NULL,'Demo Coach','venue_admin'),
  -- Grace
  ('b7000000-0000-4000-8000-000000000008','0d000000-0000-4000-8000-000000000007','club_demo_box',CURRENT_DATE-90,'P. Adams','City Open','win','RSC',1,false,NULL,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000009','0d000000-0000-4000-8000-000000000007','club_demo_box',CURRENT_DATE-30,'N. Brooks','Regional Box Cup','loss','Points',3,false,NULL,'Demo Coach','venue_admin'),
  -- Marcus
  ('b7000000-0000-4000-8000-000000000010','0d000000-0000-4000-8000-000000000008','club_demo_box',CURRENT_DATE-100,'D. Reilly','City Open','loss','TKO',2,false,NULL,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000011','0d000000-0000-4000-8000-000000000008','club_demo_box',CURRENT_DATE-50,'S. Frost','Club Show','no_contest','Head clash',1,false,NULL,'Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000012','0d000000-0000-4000-8000-000000000008','club_demo_box',CURRENT_DATE-5,'Sparring partner','Gym session','win',NULL,3,true,NULL,'Demo Coach','venue_admin'),
  -- Leo (junior) — sparring only
  ('b7000000-0000-4000-8000-000000000013','0d000000-0000-4000-8000-000000000006','club_demo_box',CURRENT_DATE-14,'Sparring partner','Junior session','draw',NULL,2,true,'Controlled sparring','Demo Coach','venue_admin'),
  ('b7000000-0000-4000-8000-000000000014','0d000000-0000-4000-8000-000000000006','club_demo_box',CURRENT_DATE-3,'Sparring partner','Junior session','win',NULL,2,true,NULL,'Demo Coach','venue_admin')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. CHARGES (so Payments + HQ analytics show class/package/pt/room-hire/membership revenue)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.venue_charges (id, venue_id, source_type, source_id, amount_due_pence, status, due_date) VALUES
  -- class bookings (paid prepay vs pending)
  ('c4000000-0000-4000-8000-000000000001','demo_venue','class','b0000000-0000-4000-8000-000000000011',800,'paid',CURRENT_DATE+1),
  ('c4000000-0000-4000-8000-000000000002','demo_venue','class','b0000000-0000-4000-8000-000000000012',800,'paid',CURRENT_DATE+1),
  ('c4000000-0000-4000-8000-000000000003','demo_venue','class','b0000000-0000-4000-8000-000000000013',800,'unpaid',CURRENT_DATE+1),
  ('c4000000-0000-4000-8000-000000000004','demo_venue','class','b0000000-0000-4000-8000-000000000015',1000,'paid',CURRENT_DATE+3),
  ('c4000000-0000-4000-8000-000000000005','demo_venue','class','b0000000-0000-4000-8000-000000000016',1000,'paid',CURRENT_DATE+3),
  ('c4000000-0000-4000-8000-000000000006','demo_venue','class','b0000000-0000-4000-8000-000000000017',1000,'unpaid',CURRENT_DATE+3),
  -- package purchases
  ('c4000000-0000-4000-8000-000000000007','demo_venue','class_package','9b000000-0000-4000-8000-000000000001',8000,'paid',CURRENT_DATE-10),
  ('c4000000-0000-4000-8000-000000000008','demo_venue','class_package','9b000000-0000-4000-8000-000000000002',3500,'paid',CURRENT_DATE-20),
  ('c4000000-0000-4000-8000-000000000009','demo_venue','class_package','9b000000-0000-4000-8000-000000000003',8000,'paid',CURRENT_DATE-2),
  -- PT appointments
  ('c4000000-0000-4000-8000-000000000010','demo_venue','pt','a7000000-0000-4000-8000-000000000001',3000,'unpaid',CURRENT_DATE+2),
  ('c4000000-0000-4000-8000-000000000011','demo_venue','pt','a7000000-0000-4000-8000-000000000002',3000,'paid',CURRENT_DATE-3),
  ('c4000000-0000-4000-8000-000000000012','demo_venue','pt','a7000000-0000-4000-8000-000000000003',4000,'unpaid',CURRENT_DATE-1),
  -- room hire (confirmed)
  ('c4000000-0000-4000-8000-000000000013','demo_venue','room_hire','40000000-0000-4000-8000-000000000001',5000,'paid',CURRENT_DATE+5),
  -- combat memberships (subscription revenue)
  ('c4000000-0000-4000-8000-000000000014','demo_venue','membership','ab000000-0000-4000-8000-000000000001',3000,'paid',CURRENT_DATE-5),
  ('c4000000-0000-4000-8000-000000000015','demo_venue','membership','ab000000-0000-4000-8000-000000000006',3000,'unpaid',CURRENT_DATE+2)
ON CONFLICT (id) DO NOTHING;
