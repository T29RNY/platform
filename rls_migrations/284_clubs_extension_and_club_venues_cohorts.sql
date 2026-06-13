-- Migration 284 — Extend clubs + create club_venues + club_cohorts
-- Membership V2 Phase 1: club-as-owner structural layer.
-- clubs extended with nullable/defaulted columns — zero impact on league-only clubs.
-- club_venues: M:N club ↔ venue (one club can span many venues; one venue can host many clubs).
-- club_cohorts: age-group / squad hooks (Phase 10 attendance + Phase 12 staff visibility).

-- ─── EXTEND clubs ────────────────────────────────────────────────────────────
-- All new columns nullable or defaulted — a league-only club simply has nulls here.

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS contact_name        text,
  ADD COLUMN IF NOT EXISTS contact_email       text,
  ADD COLUMN IF NOT EXISTS id_mandate          boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS safeguarding_config jsonb       NOT NULL DEFAULT '{}'::jsonb;

-- ─── CLUB VENUES ─────────────────────────────────────────────────────────────
-- M:N mapping: a club operates at one or many venues; a venue hosts one or many clubs.
-- Phase 1 single-site clubs have exactly one row here.

CREATE TABLE IF NOT EXISTS public.club_venues (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  venue_id   text        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_club_venue UNIQUE (club_id, venue_id)
);

ALTER TABLE public.club_venues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_venues FROM anon, authenticated;

-- ─── CLUB COHORTS ────────────────────────────────────────────────────────────
-- Age-group / squad groupings within a club.
-- Referenced by venue_memberships.cohort_id (mig 285) and Phase 10 attendance.

CREATE TABLE IF NOT EXISTS public.club_cohorts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  min_age     integer,
  max_age     integer,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.club_cohorts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_cohorts FROM anon, authenticated;
