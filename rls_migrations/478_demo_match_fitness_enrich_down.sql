-- 478 DOWN: remove the enrichment sessions (also covered by 477_down's cs_mf_% sweep). The
-- m_demo_* matches are pre-existing demo data and are NOT removed here.
DELETE FROM match_health_sessions WHERE client_session_id IN (
  'cs_mf_alex_16','cs_mf_alex_17','cs_mf_alex_18','cs_mf_alex_19','cs_mf_alex_20','cs_mf_alex_21',
  'cs_mf_dave_21','cs_mf_mike_21'
);
SELECT pg_notify('pgrst','reload schema');
