-- 236_superadmin_health_down.sql — revert mig 236
DROP FUNCTION IF EXISTS superadmin_health(date, date);
