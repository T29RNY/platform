-- DOWN 364: remove the two demo sign-in users + every cross-role link + their data.
-- Run BEFORE 363_down (it removes feature rows the demo members reference that
-- 363_down's prefix sweep also covers). Child→parent order.
DELETE FROM public.venue_charges      WHERE id::text LIKE 'c4000000-0000-4000-8000-00000000001%';
DELETE FROM public.member_grades      WHERE id IN ('63000000-0000-4000-8000-000000000008','63000000-0000-4000-8000-000000000009');
DELETE FROM public.member_bouts       WHERE id::text LIKE 'b7000000-0000-4000-8000-00000000001%' AND id::text >= 'b7000000-0000-4000-8000-000000000015';
DELETE FROM public.venue_appointments WHERE id='a7000000-0000-4000-8000-000000000005';
DELETE FROM public.venue_member_package_balances WHERE id='9b000000-0000-4000-8000-000000000004';
DELETE FROM public.venue_class_bookings WHERE id IN ('b0000000-0000-4000-8000-000000000021','b0000000-0000-4000-8000-000000000022','b0000000-0000-4000-8000-000000000023');
DELETE FROM public.venue_memberships  WHERE id IN ('ab000000-0000-4000-8000-000000000010','ab000000-0000-4000-8000-000000000011','ab000000-0000-4000-8000-000000000012','ab000000-0000-4000-8000-000000000013');
DELETE FROM public.team_players       WHERE player_id IN ('p_demo_alex','p_dc_alex','p_demo_sam');
DELETE FROM public.players            WHERE id IN ('p_demo_alex','p_dc_alex','p_demo_sam');
DELETE FROM public.team_admins        WHERE id='da000000-0000-4000-8000-000000000003';
DELETE FROM public.venue_admins       WHERE id IN ('da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002');
DELETE FROM public.company_admins     WHERE company_id='company_demo' AND user_id='d0000000-0000-4000-8000-000000000001';
DELETE FROM public.platform_admins    WHERE user_id='d0000000-0000-4000-8000-000000000001';
DELETE FROM public.member_guardians   WHERE id='d6000000-0000-4000-8000-000000000001';
DELETE FROM public.member_profiles    WHERE id IN ('0d000000-0000-4000-8000-000000000011','0d000000-0000-4000-8000-000000000012','0d000000-0000-4000-8000-000000000013');
DELETE FROM auth.identities           WHERE user_id IN ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002');
DELETE FROM auth.users                WHERE id IN ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002');
-- restore the squad multi-context flag toggled in the up-migration
UPDATE public.teams SET multi_context_nav=false WHERE id='team_demo';
