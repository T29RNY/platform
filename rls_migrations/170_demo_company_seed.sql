-- 170_demo_company_seed.sql
-- League Mode Phase 6 (HQ Dashboard) Cycle 6.1 — demo company testbed.
--
-- /hq is unloadable with zero companies (the live DB had 0). Seeds a fully-namespaced,
-- removable demo company so the operator can sign in and exercise the HQ dashboard:
--   company        company_demo  ("Demo Sports Group", subscription active)
--   venues         demo_venue (region North; existing) linked + venue_demo_south (region South, new)
--   company_admin  tarnysingh@gmail.com → super_admin
--   incidents      one 'warning' + one 'critical' open on demo_venue (drives amber/red
--                  health + the hq_resolve_incident flow)
--
-- Mirrors the mig-154 democomp seed conventions (resolve tarny via auth.users by email,
-- namespaced ids, idempotent guard). Idempotent: bails if company_demo already exists.
-- TO PULL THE DATA OUT (any time): run 170_demo_company_seed_down.sql.

DO $seed$
DECLARE
  v_tarny uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'company_demo') THEN
    RAISE NOTICE 'company_demo already seeded; mig 170 skipping'; RETURN;
  END IF;

  SELECT id INTO v_tarny FROM auth.users WHERE email = 'tarnysingh@gmail.com';
  IF v_tarny IS NULL THEN
    RAISE EXCEPTION 'tarny auth user not found — cannot seed company admin';
  END IF;

  INSERT INTO companies (id, name, slug, sport, subscription_status, active, contact_email)
  VALUES ('company_demo','Demo Sports Group','demo-sports-group','football','active', true,
          'tarnysingh@gmail.com');

  -- Link the existing demo_venue + tag its region.
  UPDATE venues SET company_id = 'company_demo', region = 'North' WHERE id = 'demo_venue';

  -- Second venue (own region) so the health grid shows a real multi-venue rollup.
  INSERT INTO venues (id, name, company_id, region, subscription_status, active, contact_email, city)
  VALUES ('venue_demo_south','Demo Arena South','company_demo','South','active', true,
          'tarnysingh@gmail.com','London');

  -- HQ admin: tarny as super_admin of the demo company.
  INSERT INTO company_admins (company_id, user_id, role, granted_by)
  VALUES ('company_demo', v_tarny, 'super_admin', v_tarny)
  ON CONFLICT (company_id, user_id) DO NOTHING;

  -- Open incidents on demo_venue → drives amber/red health + the resolve flow.
  INSERT INTO incidents (venue_id, description, severity, reported_by) VALUES
    ('demo_venue','Floodlight fault on pitch 2 — half the pitch dim','warning',  v_tarny),
    ('demo_venue','Changing-room flood — pitch unplayable, fixtures at risk','critical', v_tarny);
END
$seed$;
