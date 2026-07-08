-- =============================================================================
-- Migration 509: PA Sports demo — multi-role test logins
-- =============================================================================
-- Five +alias logins on the operator's inbox, each attached to a REAL seeded
-- person so every persona walks live data. Password login + email-OTP both work
-- (consumer app = email code, NOT Google — Google resolves to the real identity).
--
--   +pa_admin  → venue owner (Pav's admin view)     · profile Pav Somal
--   +pa_coach  → U7 Dortmund coach                   · profile Nihal
--   +pa_parent → guardian of Arjan Sandhu (U7)       · profile Harpreet Sandhu
--   +pa_player → PA Sports Mens player               · profile Sonny Athwal
--   +pa_staff  → venue staff + Welfare Officer        · profile Jas
--
-- Password for all: PaSportsDemo1!
-- auth ids: a5f00000 range. venue_admins: a5ad0000 range.
-- Paired teardown: 509_pa_sports_test_logins_down.sql
-- =============================================================================

DO $auth$
DECLARE
  u record;
  users constant jsonb := '[
    {"uid":"a5f00000-0000-4000-8000-000000000001","email":"tarnysingh+pa_admin@gmail.com","name":"Pav Somal","pid":"a5040000-0000-4000-8000-000000000001"},
    {"uid":"a5f00000-0000-4000-8000-000000000002","email":"tarnysingh+pa_coach@gmail.com","name":"Nihal (Coach)","pid":"a5040000-0000-4000-8000-000000000007"},
    {"uid":"a5f00000-0000-4000-8000-000000000003","email":"tarnysingh+pa_parent@gmail.com","name":"Harpreet Sandhu","pid":"a5019000-0000-4000-8000-000000000001"},
    {"uid":"a5f00000-0000-4000-8000-000000000004","email":"tarnysingh+pa_player@gmail.com","name":"Sonny Athwal","pid":"a5030000-0000-4000-8000-000000000001"},
    {"uid":"a5f00000-0000-4000-8000-000000000005","email":"tarnysingh+pa_staff@gmail.com","name":"Jas (Welfare)","pid":"a5040000-0000-4000-8000-000000000006"}
  ]'::jsonb;
BEGIN
  FOR u IN SELECT * FROM jsonb_to_recordset(users) AS x(uid uuid, email text, name text, pid uuid) LOOP
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', u.uid, 'authenticated', 'authenticated',
      u.email, crypt('PaSportsDemo1!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', u.name, 'email', u.email, 'email_verified', true),
      now(), now(), '', '', '', '', '', '', '', ''
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(), u.uid, u.uid::text, 'email',
      jsonb_build_object('sub', u.uid::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
      now(), now(), now()
    ) ON CONFLICT DO NOTHING;

    -- Attach the login to its real seeded person
    UPDATE member_profiles SET auth_user_id = u.uid WHERE id = u.pid AND auth_user_id IS NULL;
  END LOOP;
END $auth$;

-- ─── Operator (venue_admins) rows for admin + staff ──────────────────────────
INSERT INTO venue_admins (id, venue_id, user_id, email, role, status)
VALUES
  ('a5ad0000-0000-4000-8000-000000000001', 'pa_peugeot',  'a5f00000-0000-4000-8000-000000000001', 'tarnysingh+pa_admin@gmail.com', 'owner', 'active'),
  ('a5ad0000-0000-4000-8000-000000000002', 'seva_school', 'a5f00000-0000-4000-8000-000000000001', 'tarnysingh+pa_admin@gmail.com', 'owner', 'active'),
  ('a5ad0000-0000-4000-8000-000000000003', 'pa_peugeot',  'a5f00000-0000-4000-8000-000000000005', 'tarnysingh+pa_staff@gmail.com', 'staff', 'active'),
  ('a5ad0000-0000-4000-8000-000000000004', 'seva_school', 'a5f00000-0000-4000-8000-000000000005', 'tarnysingh+pa_staff@gmail.com', 'staff', 'active')
ON CONFLICT (id) DO NOTHING;

-- ─── Verification ────────────────────────────────────────────────────────────
SELECT
 (SELECT count(*) FROM auth.users      WHERE id::text LIKE 'a5f0%')                       AS users,        -- 5
 (SELECT count(*) FROM auth.identities WHERE user_id::text LIKE 'a5f0%')                  AS identities,   -- 5
 (SELECT count(*) FROM member_profiles WHERE auth_user_id::text LIKE 'a5f0%')             AS linked,       -- 5
 (SELECT count(*) FROM venue_admins    WHERE id::text LIKE 'a5ad%')                       AS venue_admins; -- 4
