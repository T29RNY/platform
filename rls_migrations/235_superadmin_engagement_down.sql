-- 235_superadmin_engagement_down.sql — revert mig 235
DROP FUNCTION IF EXISTS superadmin_engagement(date, date);
