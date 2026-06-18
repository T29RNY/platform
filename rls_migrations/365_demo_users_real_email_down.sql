-- DOWN 365: revert the demo users to the original @in-or-out.com emails.
UPDATE auth.users
   SET email='demo@in-or-out.com',
       raw_user_meta_data = jsonb_set(raw_user_meta_data,'{email}','"demo@in-or-out.com"')
 WHERE id='d0000000-0000-4000-8000-000000000001';
UPDATE auth.users
   SET email='family@in-or-out.com',
       raw_user_meta_data = jsonb_set(raw_user_meta_data,'{email}','"family@in-or-out.com"')
 WHERE id='d0000000-0000-4000-8000-000000000002';
UPDATE auth.identities SET identity_data = jsonb_set(identity_data,'{email}','"demo@in-or-out.com"')
 WHERE user_id='d0000000-0000-4000-8000-000000000001' AND provider='email';
UPDATE auth.identities SET identity_data = jsonb_set(identity_data,'{email}','"family@in-or-out.com"')
 WHERE user_id='d0000000-0000-4000-8000-000000000002' AND provider='email';
UPDATE public.member_profiles SET email='demo@in-or-out.com'   WHERE id='0d000000-0000-4000-8000-000000000011';
UPDATE public.member_profiles SET email='family@in-or-out.com' WHERE id='0d000000-0000-4000-8000-000000000012';
