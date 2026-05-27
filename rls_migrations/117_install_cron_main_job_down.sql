-- 117_install_cron_main_job_down.sql
SELECT cron.unschedule('inorout-cron-main');
