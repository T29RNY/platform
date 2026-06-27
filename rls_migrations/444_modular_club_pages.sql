-- 444: Modular Platform Epic B — Phase 1 (data foundation, no UI / no RPC).
-- The public club page ("Pitchero destroyer"). This migration only lays the
-- database shelves; Phase 2 adds the anon public-read RPC (mig 445) and Phase 3
-- the club-manager write RPCs (mig 446). Design brief: CLUB_PAGE_DESIGN_BRIEF.md.
-- Decisions: DECISIONS.md s213 ("Modular Platform Epic B"). Plan of record:
-- MODULAR_PLATFORM_HANDOFF.md (Epic B, Phase 1).
--
-- Three new tables + one new public storage bucket:
--   club_pages    (1:1 with clubs — slug, published flag, branding, sections config)
--   club_sponsors (mirror of tournament_sponsors mig 327, FK -> clubs)
--   club_posts    (news/blog; club_announcements is internal-only, unsuitable)
--   club-media    (public bucket; club-scoped write paths via the club-admin chain)
--
-- All three tables: RLS on, REVOKE ALL from anon/authenticated, NO policy ->
-- zero direct client access. Every read/write goes through SECURITY DEFINER RPCs
-- in Phases 2/3. Same locked-down pattern as tournament_sponsors (mig 327).
--
-- FK note: clubs.id is TEXT, so every club FK column here is text.
-- Club-admin chain (for the storage policy + Phase 3 RPCs), per DECISIONS s213:
--   auth.uid() -> member_profiles.auth_user_id
--              -> club_team_managers.member_profile_id (is_active = true)
--              -> club_teams.club_id

-- ─── 1. club_pages — the page record, one row per club ────────────────────────
CREATE TABLE IF NOT EXISTS public.club_pages (
  club_id           text        PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  slug              text        NOT NULL UNIQUE,
  published         boolean     NOT NULL DEFAULT false,
  primary_colour    text        DEFAULT NULL,   -- hex, validated server-side in Phase 3
  secondary_colour  text        DEFAULT NULL,
  accent_colour     text        DEFAULT NULL,
  crest_url         text        DEFAULT NULL,
  hero_url          text        DEFAULT NULL,
  tagline           text        DEFAULT NULL,
  about             text        DEFAULT NULL,
  socials           jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- {facebook,instagram,x,youtube,tiktok,website}
  sections          jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{key,enabled,order}]
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_pages_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$')
);
ALTER TABLE public.club_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_pages FROM anon, authenticated;

-- ─── 2. club_sponsors — mirror of tournament_sponsors (mig 327), FK -> clubs ───
CREATE TABLE IF NOT EXISTS public.club_sponsors (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  logo_url       text        DEFAULT NULL,
  website_url    text        DEFAULT NULL,
  display_order  int         NOT NULL DEFAULT 0,
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_sponsors_club_idx
  ON public.club_sponsors (club_id, active);
ALTER TABLE public.club_sponsors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_sponsors FROM anon, authenticated;

-- ─── 3. club_posts — news / blog ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_posts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            text        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  slug               text        NOT NULL,
  title              text        NOT NULL,
  body               text        DEFAULT NULL,
  hero_url           text        DEFAULT NULL,
  author_name        text        DEFAULT NULL,
  author_profile_id  uuid        DEFAULT NULL REFERENCES public.member_profiles(id) ON DELETE SET NULL,
  status             text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at       timestamptz DEFAULT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, slug)
);
CREATE INDEX IF NOT EXISTS club_posts_club_status_idx
  ON public.club_posts (club_id, status, published_at DESC);
ALTER TABLE public.club_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_posts FROM anon, authenticated;

-- ─── 4. club-media storage bucket + club-scoped write policies ─────────────────
-- READ: bucket is PUBLIC; objects served via /object/public/ — no SELECT policy.
-- WRITE: authenticated club managers only, scoped so the object path's first
--        folder is a club they actively manage (<club_id>/...). Mirrors the
--        venue-media bucket (mig 246) but via the club-admin chain. The
--        public_web feature gate + audit live in the Phase 3 write RPCs that
--        persist the URL; the bucket policy enforces auth + path scope only,
--        matching the venue-media precedent.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('club-media', 'club-media', true, 5242880,
        ARRAY['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "club_media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'club-media'
    AND EXISTS (
      SELECT 1
      FROM public.club_team_managers ctm
      JOIN public.club_teams ct      ON ct.id = ctm.team_id
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
      WHERE mp.auth_user_id = auth.uid()
        AND ctm.is_active = true
        AND ct.club_id = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "club_media_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'club-media'
    AND EXISTS (
      SELECT 1
      FROM public.club_team_managers ctm
      JOIN public.club_teams ct      ON ct.id = ctm.team_id
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
      WHERE mp.auth_user_id = auth.uid()
        AND ctm.is_active = true
        AND ct.club_id = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'club-media'
    AND EXISTS (
      SELECT 1
      FROM public.club_team_managers ctm
      JOIN public.club_teams ct      ON ct.id = ctm.team_id
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
      WHERE mp.auth_user_id = auth.uid()
        AND ctm.is_active = true
        AND ct.club_id = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "club_media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'club-media'
    AND EXISTS (
      SELECT 1
      FROM public.club_team_managers ctm
      JOIN public.club_teams ct      ON ct.id = ctm.team_id
      JOIN public.member_profiles mp ON mp.id = ctm.member_profile_id
      WHERE mp.auth_user_id = auth.uid()
        AND ctm.is_active = true
        AND ct.club_id = (storage.foldername(name))[1]
    )
  );
