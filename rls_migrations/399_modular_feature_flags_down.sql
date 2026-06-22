-- Down — Migration 399 (modular feature flags, Phase 1 foundation).
DROP FUNCTION IF EXISTS public.get_venue_feature_flags(text);
DROP FUNCTION IF EXISTS public._venue_feature_enabled(text, text);
DROP FUNCTION IF EXISTS public._club_feature_enabled(text, text);
DROP TABLE IF EXISTS public.club_features;
DROP TABLE IF EXISTS public.venue_features;
-- NOTE: the guarded CREATE OR REPLACE write-RPC blocks added later in 399 are NOT
-- reverted here — dropping the guard helpers above makes those guards raise
-- 'undefined_function'; restore the pre-399 RPC bodies from their prior migrations
-- if a full rollback of the server-layer gate is required.
