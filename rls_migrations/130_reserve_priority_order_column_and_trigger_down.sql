-- 130 down — remove trigger, function, and column
DROP TRIGGER IF EXISTS manage_reserve_priority_order_trg ON public.players;
DROP FUNCTION IF EXISTS public.manage_reserve_priority_order();
ALTER TABLE public.team_players DROP COLUMN IF EXISTS reserve_priority_order;
