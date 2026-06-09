-- 239_superadmin_create_team_down.sql — revert mig 239
DROP FUNCTION IF EXISTS superadmin_create_team(text, text, text, text, integer, text, numeric);
