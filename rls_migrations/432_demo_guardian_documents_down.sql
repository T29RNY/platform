-- 432 down — remove the Guardian Documents demo seed.
DELETE FROM public.consent_acceptances
 WHERE id IN ('e4000000-0000-4000-8000-00000000432a','e4000000-0000-4000-8000-00000000432b');
DELETE FROM public.policy_documents
 WHERE id IN ('d4000000-0000-4000-8000-00000000432a',
              'd4000000-0000-4000-8000-00000000432b',
              'd4000000-0000-4000-8000-00000000432c');
UPDATE public.clubs SET id_mandate = false WHERE id = 'club_demo';
