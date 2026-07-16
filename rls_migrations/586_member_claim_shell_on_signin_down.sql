-- 586_member_claim_shell_on_signin_down.sql
--
-- Teardown for 586. Purely additive migration — the function is new (no prior
-- version to restore), so dropping it returns the DB to its pre-586 state exactly.
-- Rows already claimed by it are NOT reverted: member_profiles.auth_user_id links a
-- real person to their real record, and un-linking would strand the family again
-- (the very bug 586 fixes). Any specific bad claim is undone by nulling that one
-- row's auth_user_id, not by this teardown.

DROP FUNCTION IF EXISTS public.member_claim_shell_on_signin();
