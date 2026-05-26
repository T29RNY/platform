-- 112 down — restore the originally seeded dates (2026-06-03 / -10 / -17).

UPDATE seasons
   SET start_date = '2026-06-03', end_date = '2026-07-22'
 WHERE league_id = 'demo_league';

UPDATE fixtures f
   SET scheduled_date = CASE f.week_number
     WHEN 1 THEN '2026-06-03'::date
     WHEN 2 THEN '2026-06-10'::date
     WHEN 3 THEN '2026-06-17'::date
   END
  FROM competitions c, seasons s
 WHERE c.id = f.competition_id AND s.id = c.season_id AND s.league_id = 'demo_league';
