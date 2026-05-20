-- Drop the old create_team function with p_price int
-- that remained after migration 029 changed it to
-- numeric(10,2). PostgreSQL kept both as overloads
-- causing "could not choose best candidate" error.
DROP FUNCTION IF EXISTS create_team(
  text, text, text, text, int, text, text,
  int, boolean, text[], text, text, int
);
