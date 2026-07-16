-- 587 DOWN — stop auto-creating a club_pages row with every club.

DROP TRIGGER IF EXISTS ensure_club_page ON public.clubs;
DROP FUNCTION IF EXISTS public.tg_ensure_club_page();
DROP FUNCTION IF EXISTS public._ensure_club_page(text, text);

-- Backfilled rows are deliberately NOT deleted. By the time anyone reverts this,
-- an operator may have branded and published one of them (DF Sports is the whole
-- point of the backfill) — dropping those rows would destroy real work and take
-- a live public page offline. An unwanted blank page is inert (published=false);
-- delete it by hand if it genuinely needs to go:
--   DELETE FROM club_pages WHERE club_id = '<club>' AND published = false;
