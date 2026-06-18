-- DOWN 363: remove the deep demo feature seed (classes/PT/grading/fight records/
-- room hire/packages + combat clubs). Child→parent order. Prefix-scoped to the
-- demo ids minted by 363/364 so it never touches real or older-demo data.
DELETE FROM public.venue_charges                 WHERE id::text LIKE 'c4000000%';
DELETE FROM public.venue_appointments            WHERE id::text LIKE 'a7000000%';
DELETE FROM public.venue_trainer_availability     WHERE id::text LIKE '7b000000%';
DELETE FROM public.venue_trainers                 WHERE id::text LIKE '7a000000%';
DELETE FROM public.venue_room_hires               WHERE id::text LIKE '40000000%';
DELETE FROM public.venue_member_package_balances  WHERE id::text LIKE '9b000000%';
DELETE FROM public.venue_class_packages           WHERE id::text LIKE '9a000000%';
DELETE FROM public.venue_class_bookings           WHERE id::text LIKE 'b0000000%';
DELETE FROM public.venue_class_sessions           WHERE id::text LIKE 'e5000000%';
DELETE FROM public.venue_class_series             WHERE id::text LIKE 'c5000000%';
DELETE FROM public.venue_class_types              WHERE id::text LIKE 'c7000000%';
DELETE FROM public.venue_spaces                   WHERE id::text LIKE '5b000000%';
DELETE FROM public.member_grades                  WHERE id::text LIKE '63000000%';
DELETE FROM public.venue_grades                   WHERE id::text LIKE '62000000%';
DELETE FROM public.venue_grading_schemes          WHERE id::text LIKE '61000000%';
DELETE FROM public.member_bouts                   WHERE id::text LIKE 'b7000000%';
DELETE FROM public.venue_memberships              WHERE id::text LIKE 'ab000000%';
DELETE FROM public.club_cohorts                   WHERE id::text LIKE 'cb000000%';
DELETE FROM public.clubs                          WHERE id IN ('club_demo_box','club_demo_ma');
