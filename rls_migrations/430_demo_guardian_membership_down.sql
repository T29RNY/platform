-- 430 DOWN — remove the Charlie Carter demo membership + fees.
DELETE FROM public.venue_payments WHERE id = 'c0000000-0000-4000-8000-000000000430'::uuid;
DELETE FROM public.venue_charges  WHERE id IN ('b0000000-0000-4000-8000-000000000430'::uuid, 'b0000000-0000-4000-8000-000000000431'::uuid);
DELETE FROM public.venue_memberships WHERE id = 'a0000000-0000-4000-8000-000000000430'::uuid;
