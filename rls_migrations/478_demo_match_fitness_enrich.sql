-- 478: DEMO SEED enrichment — more of Alex's own history (fills the trend graph) + a Top-Runner
-- result card on m_demo_21. Applied to live via the demo-drive session; captured here for source↔live
-- sync (HR#11). Demo-only (team_demo); all rows use the `cs_mf_` prefix so 477_down already clears
-- them. Idempotent.

DO $e$
DECLARE
  v_alex uuid := 'd0000000-0000-4000-8000-000000000001';
  v_dave uuid := 'd0d00000-0000-4000-8000-000000000002';
  v_mike uuid := 'd0d00000-0000-4000-8000-000000000003';
BEGIN
  -- Alex own sessions across Mar–May (descending HR → full trend + baseline + fittest hero)
  INSERT INTO match_health_sessions
    (user_id, match_context, match_ref, client_session_id, distance_meters, active_energy_kcal, avg_hr, max_hr, source, started_at, ended_at) VALUES
    (v_alex,'casual','m_demo_16','cs_mf_alex_16',5200,480,160,178,'watch_app',          '2026-03-31 20:00+00','2026-03-31 21:00+00'),
    (v_alex,'casual','m_demo_17','cs_mf_alex_17',5400,490,158,176,'watch_app',          '2026-04-07 20:00+00','2026-04-07 21:00+00'),
    (v_alex,'casual','m_demo_18','cs_mf_alex_18',5600,500,155,174,'watch_app',          '2026-04-14 20:00+00','2026-04-14 21:00+00'),
    (v_alex,'casual','m_demo_19','cs_mf_alex_19',5800,505,153,172,'apple_health_manual','2026-04-21 20:00+00','2026-04-21 21:00+00'),
    (v_alex,'casual','m_demo_20','cs_mf_alex_20',6000,510,150,171,'watch_app',          '2026-04-28 20:00+00','2026-04-28 21:00+00'),
    (v_alex,'casual','m_demo_21','cs_mf_alex_21',6200,520,148,170,'watch_app',          '2026-05-05 20:00+00','2026-05-05 21:00+00')
  ON CONFLICT (user_id, client_session_id) DO NOTHING;

  -- Two consenting teammates on m_demo_21 → Top Runner result card (Dave leads on distance)
  INSERT INTO match_health_sessions
    (user_id, match_context, match_ref, client_session_id, distance_meters, active_energy_kcal, avg_hr, max_hr, source, started_at, ended_at) VALUES
    (v_dave,'casual','m_demo_21','cs_mf_dave_21',6900,610,150,173,'watch_app','2026-05-05 20:00+00','2026-05-05 21:00+00'),
    (v_mike,'casual','m_demo_21','cs_mf_mike_21',5500,470,146,165,'watch_app','2026-05-05 20:00+00','2026-05-05 21:00+00')
  ON CONFLICT (user_id, client_session_id) DO NOTHING;

  INSERT INTO match_health_routes (session_id, track)
  SELECT id, '{"points":[[51.5,-0.12],[51.5009,-0.1215],[51.5013,-0.1201],[51.5006,-0.1189]]}'::jsonb
    FROM match_health_sessions WHERE client_session_id = 'cs_mf_alex_21'
  ON CONFLICT (session_id) DO NOTHING;
END $e$;
SELECT pg_notify('pgrst','reload schema');
