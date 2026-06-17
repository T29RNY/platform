-- Down migration 348 — drop player-token H2H + league-table RPCs
DROP FUNCTION IF EXISTS public.get_head_to_head_raw_by_player_token(text, text, text, text);
DROP FUNCTION IF EXISTS public.get_player_league_table_raw_by_player_token(text, text);
