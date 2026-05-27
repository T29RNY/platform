-- 118_unstick_tuesday_schedules.sql
-- Data fix for two teams whose schedule rows never rolled over (because
-- the cron that does the rollover was orphaned — see migration 117).
--
-- Both teams' schedule rows still hold 2026-05-26 20:00 UTC (last week).
-- Footy Tuesdays additionally had its opens_day/opens_time set wrong
-- (Monday 20:00 instead of the intended Wednesday 10:00).
--
-- The kickoff = '2026-05-26 20:00+00' guard makes this a no-op if
-- re-run after a normal rollover has already happened.

-- Footy Tuesdays: correct opens config AND advance 7 days
UPDATE schedule SET
  opens_day         = 'Wednesday',
  opens_time        = '10:00',
  game_date_time    = game_date_time + interval '7 days',
  lineup_locked     = false,
  active_match_id   = null,
  game_is_live      = false,
  is_cancelled      = false,
  cancel_reason     = null,
  voting_open       = false,
  voting_closes_at  = null,
  auto_open_pending = true
WHERE team_id = 'team_KPaoX8oJYMQ'
  AND game_date_time = '2026-05-26 20:00:00+00';

-- Finbars Tuesdays: advance 7 days (opens config kept as configured)
UPDATE schedule SET
  game_date_time    = game_date_time + interval '7 days',
  lineup_locked     = false,
  active_match_id   = null,
  game_is_live      = false,
  is_cancelled      = false,
  cancel_reason     = null,
  voting_open       = false,
  voting_closes_at  = null,
  auto_open_pending = true
WHERE team_id = 'team_L8IgrPslNJ8'
  AND game_date_time = '2026-05-26 20:00:00+00';
