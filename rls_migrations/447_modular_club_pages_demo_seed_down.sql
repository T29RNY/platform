-- Down for 447 — remove the Phase 4 demo seed only (leaves clubs/teams/fixtures intact).
DELETE FROM public.club_posts    WHERE club_id='club_demo' AND slug='cup-run-continues';
DELETE FROM public.club_sponsors WHERE club_id='club_demo' AND name IN ('Northgate Motors','Eastside Print Co.');
DELETE FROM public.club_pages    WHERE club_id IN ('club_demo','club_demo_box');
