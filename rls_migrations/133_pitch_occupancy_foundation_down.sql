-- Down migration for 133 — drop the pitch_occupancy foundation.
-- Strict revert of the up. btree_gist is left installed: it is a shared
-- extension and dropping it could break any future object that comes to
-- depend on it; CREATE EXTENSION IF NOT EXISTS in the up is idempotent.

DROP TABLE IF EXISTS public.pitch_occupancy;
