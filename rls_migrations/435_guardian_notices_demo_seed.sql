-- Migration 435 — demo seed for the Guardian "Club notices" screen.
-- Charlie (U12 Falcons, club_demo) otherwise sees only the single club-wide welcome notice.
-- Add one team-audience notice for U12 Falcons so the demo shows two tone-coloured cards
-- (club-wide = info, team = amber) with a coach sender (resolves to the Falcons manager,
-- Daniel Okafor, via the team-manager fallback in guardian_list_child_notices).
-- Additive + idempotent (fixed id + ON CONFLICT DO NOTHING). created_by NULL = no composer
-- auth row; sender resolves to the team's active manager.

INSERT INTO public.club_announcements (
  id, club_id, venue_id, created_by, title, body, audience, cohort_id, team_id, status, sent_at, created_at
) VALUES (
  'f6435000-0000-4000-8000-000000000435',
  'club_demo',
  (SELECT venue_id FROM public.club_venues WHERE club_id = 'club_demo' ORDER BY created_at LIMIT 1),
  NULL,
  'U12 Falcons — Training moved to 6pm Thursday',
  'Quick one ahead of the weekend: this Thursday''s session moves to 6:00pm (not 5:30) as the 3G pitch is in use earlier. Same place, shin pads and water as always. We''ll do a short team talk about Saturday''s fixture at the end.',
  'team',
  NULL,
  'c0000000-0000-4000-8000-000000000002',
  'sent',
  now() - interval '2 hours',
  now() - interval '2 hours'
)
ON CONFLICT (id) DO NOTHING;
