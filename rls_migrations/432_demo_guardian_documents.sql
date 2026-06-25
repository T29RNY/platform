-- 432 — Demo seed for the Guardian Documents screen (Charlie Carter).
--
-- Additive + idempotent. Gives Charlie (member_profiles …013, guardian Sam …012) a
-- realistic Documents manifest at Finbar's FC (club_demo):
--   • 2 SIGNED consents  (Photo & media, Code of conduct) — pre-accepted on behalf of Charlie
--   • 1 DUE consent      (Summer 7s tournament) — needs signature
--   • 1 DUE upload        (Proof of age) — club_demo.id_mandate flipped true
--   • 1 DUE review        (Medical & emergency contact) — no member_record_reviews row
-- → "3 need action".
--
-- NB flipping club_demo.id_mandate = true means other Finbar's FC members surface on the
-- venue laptop ID-submissions list. Intended for the demo (a grassroots club requiring
-- proof of age); harmless — the list is operator-only.

-- Proof-of-age requirement on Finbar's FC.
UPDATE public.clubs SET id_mandate = true WHERE id = 'club_demo';

-- Three current policy documents for club_demo.
INSERT INTO public.policy_documents (id, club_id, title, body, version, is_current, created_by)
VALUES
  ('d4000000-0000-4000-8000-00000000432a', 'club_demo', 'Photo & media consent',
   'I give permission for the club to take and use photographs and video of my child for team sheets, the club website and social channels, in line with the club safeguarding policy.',
   1, true, 'd0000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-00000000432b', 'club_demo', 'Player & parent code of conduct',
   'I agree to support positive, respectful behaviour on and off the pitch, in line with the FA Respect code for players, parents and spectators.',
   1, true, 'd0000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-00000000432c', 'club_demo', 'Tournament consent — Summer 7s',
   'I consent to my child travelling to and taking part in the Summer 7s tournament, including club-arranged transport and first-aid cover on the day.',
   1, true, 'd0000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- Charlie has already signed the first two (Sam signed on his behalf).
INSERT INTO public.consent_acceptances
  (id, document_id, member_profile_id, signed_on_behalf_of, typed_signature, accepted_at, ip_address, user_agent, auth_user_id)
VALUES
  ('e4000000-0000-4000-8000-00000000432a', 'd4000000-0000-4000-8000-00000000432a',
   '0d000000-0000-4000-8000-000000000013', '0d000000-0000-4000-8000-000000000012',
   'Sam Carter', now() - interval '40 days', '203.0.113.10', 'demo-seed', 'd0000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-00000000432b', 'd4000000-0000-4000-8000-00000000432b',
   '0d000000-0000-4000-8000-000000000013', '0d000000-0000-4000-8000-000000000012',
   'Sam Carter', now() - interval '40 days', '203.0.113.10', 'demo-seed', 'd0000000-0000-4000-8000-000000000002')
ON CONFLICT (document_id, member_profile_id) DO NOTHING;
