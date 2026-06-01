-- mig 191 — Phase 11.4a group-stage schema (additive only).
-- Group→knockout cups: a single competition with format='group_stage' owns both phases.
-- Group membership + draw seed live on competition_teams; group-stage fixtures are tagged
-- with group_label (knockout fixtures stay NULL); competitions.config holds the cup settings.

ALTER TABLE public.competition_teams
  ADD COLUMN IF NOT EXISTS group_label text NULL,
  ADD COLUMN IF NOT EXISTS seed int NULL;

ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS group_label text NULL;

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.competition_teams.group_label IS 'Phase 11.4: group-stage group (e.g. A/B/C); NULL for non-group comps';
COMMENT ON COLUMN public.competition_teams.seed IS 'Phase 11.4: draw seed order (snake draw + deterministic standings tiebreak)';
COMMENT ON COLUMN public.fixtures.group_label IS 'Phase 11.4: group-stage fixture group; NULL for league/knockout fixtures';
COMMENT ON COLUMN public.competitions.config IS 'Phase 11.4: cup settings jsonb {num_groups, qualifiers_per_group, knockout_seeded}';
