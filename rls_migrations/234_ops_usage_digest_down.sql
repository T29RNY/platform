-- 234_ops_usage_digest_down.sql — revert mig 234
DROP FUNCTION IF EXISTS get_ops_usage_digest(date, date, date, date);
