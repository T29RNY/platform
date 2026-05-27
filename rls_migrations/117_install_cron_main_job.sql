-- 117_install_cron_main_job.sql
-- Wires the orphaned /api/cron endpoint to pg_cron.
--
-- /api/cron contains autoOpenGameJob (opens next week's match at the
-- configured opens_day/opens_time) and advanceGameDateJob (rolls the
-- schedule row forward 7 days after kickoff + 3h). Both had NEVER run
-- in production because no scheduler called the endpoint — the 6
-- existing pg_cron jobs all target /api/notify.
--
-- Schedule mirrors the existing 15-minute notify jobs. Bearer secret
-- is hardcoded for consistency with the other 6 jobs; moving all 7 to
-- a vault setting is tracked as tech debt in BUGS.md.

SELECT cron.schedule(
  'inorout-cron-main',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://www.in-or-out.com/api/cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer Liverp00l123?!!*'
      ),
      body    := '{}'::jsonb
    );
  $$
);
