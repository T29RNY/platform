-- 269_membership_foundation_multisport_capability.sql
--
-- Phase 1 of the Venue Membership programme — SECURE FOUNDATION.
-- Lays the multi-sport substrate and the capability key that later phases
-- ride on. Additive + backfilled only; no RPCs (those begin Phase 2).
--
-- (1) Multi-sport-per-venue as SELF-IDENTIFIED TEXT (`venues.sports text[]`).
--     This deliberately does NOT build the session-84-REJECTED global `sports`
--     lookup table. It extends the session-40 posture (`sport text DEFAULT
--     'football'` self-identification) from one-sport-per-venue to a venue's
--     text[] of offered sports. No lookup table, no FKs, no sport-level
--     metadata (membership only needs sport as a tag/scope) — so the session-84
--     re-open trigger ("a sport needs metadata league_config can't express") is
--     not hit. See DECISIONS.md "MULTI-SPORT VENUES".
--
-- (2) `playing_areas.sport text` (nullable; NULL = inherits the venue's primary
--     `sport`) so a pitch/court can be scoped to a sport.
--
-- (3) Register `manage_memberships` in the `venue_admins` caps CHECK so the
--     membership write RPCs (Phase 3) can be capability-gated. Default via
--     `_venue_has_cap`: owner + manager yes, staff only if explicitly granted.

-- 1. venues.sports — the set of sports a venue offers (self-identified text).
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS sports text[] NOT NULL DEFAULT ARRAY['football']::text[];

-- Backfill so each venue's offered set contains its primary sport. Idempotent:
-- only appends the primary sport when missing (safe to re-run; never clobbers a
-- later-seeded multi-sport list).
UPDATE public.venues
   SET sports = array_append(sports, sport)
 WHERE NOT (sport = ANY(sports));

-- 2. playing_areas.sport — which sport this pitch/court is for (NULL = inherit).
ALTER TABLE public.playing_areas
  ADD COLUMN IF NOT EXISTS sport text;

-- 3. Register the manage_memberships capability in the venue_admins caps CHECK.
ALTER TABLE public.venue_admins DROP CONSTRAINT IF EXISTS venue_admins_caps_known;
ALTER TABLE public.venue_admins ADD CONSTRAINT venue_admins_caps_known CHECK (
  caps_grant <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships']::text[]
  AND caps_deny <@ ARRAY['reverse_money','booking_settings','manage_facility','staff_directory','manage_logins','manage_memberships']::text[]
);
