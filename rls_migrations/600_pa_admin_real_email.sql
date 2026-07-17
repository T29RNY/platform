-- 600_pa_admin_real_email.sql
--
-- Point the PA Sports admin/operator login at Pav Somal's REAL email so he can sign in
-- as himself (OTP to his own inbox) when the demo goes to the club. This is the
-- transition the demo build sheet always intended — see PA_SPORTS_DEMO_HANDOFF.md §3
-- ("Pav real admin: when Pav signs in for real …"). His real email was on file all
-- along in clubs.contact_email (pav_somal@yahoo.com) and is the public-page contact.
--
-- WHAT CHANGES: only the email/identity of the EXISTING admin auth account
-- (a5f00000-…-001, "Pav Somal"). Every downstream grant is left untouched:
--   * venue_admins OWNER on both grounds (pa_peugeot + seva_school) — unchanged
--   * member_profiles link (a5040000-…-001 Pav Somal) — unchanged
--   * password (PaSportsDemo1!) — unchanged
--   * email_confirmed_at — already set, left set (Supabase confirm-email is OFF
--     platform-wide, so this is a no-op gate regardless — see the auth reference memo)
-- So this is a pure "where does the login/OTP go" change: from the operator's
-- +pa_admin alias inbox to Pav's own yahoo inbox.
--
-- The operator retains an admin walkthrough via PASSWORD login (pav_somal@yahoo.com /
-- PaSportsDemo1! — password auth needs no OTP), so renaming costs them nothing.
--
-- Reversible: the _down.sql restores the +pa_admin alias exactly.

BEGIN;

UPDATE auth.users
SET email = 'pav_somal@yahoo.com',
    raw_user_meta_data = jsonb_set(
      COALESCE(raw_user_meta_data, '{}'::jsonb), '{email}', '"pav_somal@yahoo.com"'),
    updated_at = now()
WHERE id = 'a5f00000-0000-4000-8000-000000000001';

UPDATE auth.identities
SET identity_data = jsonb_set(identity_data, '{email}', '"pav_somal@yahoo.com"'),
    updated_at = now()
WHERE user_id = 'a5f00000-0000-4000-8000-000000000001'
  AND provider = 'email';

COMMIT;
