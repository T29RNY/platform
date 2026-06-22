-- down for 384: unassign + remove demo officials. (get_tournament_public referee_name
-- column is harmless if left; to fully revert the function, re-apply migration 381.)
UPDATE fixtures SET official_id = NULL WHERE official_id IN (
  '70000000-0000-4000-8000-000000000601','70000000-0000-4000-8000-000000000602','70000000-0000-4000-8000-000000000603');
DELETE FROM match_officials WHERE id IN (
  '70000000-0000-4000-8000-000000000601','70000000-0000-4000-8000-000000000602','70000000-0000-4000-8000-000000000603');
