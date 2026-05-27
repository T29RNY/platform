-- 118_unstick_tuesday_schedules_down.sql
-- Reverts the 7-day advance and the Footy opens config change.
-- Idempotent guard: only acts on rows where game_date_time is the
-- post-fix value (2026-06-02 20:00 UTC).

UPDATE schedule SET
  opens_day         = 'Monday',
  opens_time        = '20:00',
  game_date_time    = game_date_time - interval '7 days',
  is_cancelled      = true,
  auto_open_pending = true
WHERE team_id = 'team_KPaoX8oJYMQ'
  AND game_date_time = '2026-06-02 20:00:00+00';

UPDATE schedule SET
  game_date_time    = game_date_time - interval '7 days',
  auto_open_pending = true
WHERE team_id = 'team_L8IgrPslNJ8'
  AND game_date_time = '2026-06-02 20:00:00+00';
