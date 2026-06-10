-- demo-display-goal.sql — fire a LIVE goal on the demo hero match, mid-demo.
-- Run while the reception display is on screen: within ~2 seconds the wall
-- broadcasts, the score punches, and the full GOAL celebration overlay fires
-- (gold GOAL word, scorer, team strip, streak sweep — throttled 1 per 5s).
--
-- RE-RUNNABLE: each run adds one more home goal to the showroom hero fixture
-- (Demo Athletic v Competitive FC) at the current match minute, rotating the
-- scorer. Demo data only. Run demo-display-showroom.sql first.

DO $goal$
DECLARE
  v_fixture uuid := '92e4be46-04e5-4635-96aa-43d98e9a3b5c';  -- showroom hero match
  v_ko      timestamptz;
  v_minute  int;
  v_scorers text[] := ARRAY['p_dc_ath2','p_dc_ath5','p_dc_ath1','p_dc_ath3','p_dc_ath4'];
  v_scorer  text;
  v_goals   int;
BEGIN
  SELECT actual_kickoff_at INTO v_ko FROM fixtures WHERE id = v_fixture AND status = 'in_progress';
  IF v_ko IS NULL THEN
    RAISE EXCEPTION 'hero fixture is not live — run demo-display-showroom.sql first';
  END IF;

  v_minute := LEAST(120, GREATEST(1, floor(extract(epoch FROM (now() - v_ko)) / 60)::int));
  SELECT count(*) INTO v_goals FROM match_events
   WHERE fixture_id = v_fixture AND event_type = 'goal' AND team_id = 'team_dc_athletic';
  v_scorer := v_scorers[1 + (v_goals % array_length(v_scorers, 1))];

  INSERT INTO match_events (fixture_id, event_type, minute, period, player_id, team_id,
                            recorded_by_token, recorded_by_type, local_timestamp)
  VALUES (v_fixture, 'goal', v_minute, CASE WHEN v_minute > 30 THEN '2H' ELSE '1H' END,
          v_scorer, 'team_dc_athletic', 'demo_showroom', 'system', now());

  UPDATE fixtures SET home_score = home_score + 1 WHERE id = v_fixture;

  PERFORM public.notify_venue_change('demo_venue', 'venue_updated');

  RAISE NOTICE 'GOAL — % at %''. Watch the wall.', v_scorer, v_minute;
END
$goal$;
