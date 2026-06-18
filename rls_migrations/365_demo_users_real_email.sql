-- 365: repoint the two demo sign-in users to plus-addresses of a REAL inbox
-- (tarny@lettrack.co.uk, Google Workspace → +aliases deliver to the one inbox) so
-- consumer-app email-OTP sign-in works (the consumer app is OTP/Google only, no
-- password). UPDATE in place — same fixed UUIDs, so every role link, membership,
-- booking, fight record etc. stays intact. Password (venue/HQ) unchanged.
--   Alex Demo   d0…0001 → tarny+demo@lettrack.co.uk    / DemoBoss1!
--   Sam Carter  d0…0002 → tarny+family@lettrack.co.uk  / DemoFam2!

UPDATE auth.users
   SET email='tarny+demo@lettrack.co.uk',
       raw_user_meta_data = jsonb_set(raw_user_meta_data,'{email}','"tarny+demo@lettrack.co.uk"')
 WHERE id='d0000000-0000-4000-8000-000000000001';
UPDATE auth.users
   SET email='tarny+family@lettrack.co.uk',
       raw_user_meta_data = jsonb_set(raw_user_meta_data,'{email}','"tarny+family@lettrack.co.uk"')
 WHERE id='d0000000-0000-4000-8000-000000000002';

UPDATE auth.identities
   SET identity_data = jsonb_set(identity_data,'{email}','"tarny+demo@lettrack.co.uk"')
 WHERE user_id='d0000000-0000-4000-8000-000000000001' AND provider='email';
UPDATE auth.identities
   SET identity_data = jsonb_set(identity_data,'{email}','"tarny+family@lettrack.co.uk"')
 WHERE user_id='d0000000-0000-4000-8000-000000000002' AND provider='email';

UPDATE public.member_profiles SET email='tarny+demo@lettrack.co.uk'   WHERE id='0d000000-0000-4000-8000-000000000011';
UPDATE public.member_profiles SET email='tarny+family@lettrack.co.uk' WHERE id='0d000000-0000-4000-8000-000000000012';
