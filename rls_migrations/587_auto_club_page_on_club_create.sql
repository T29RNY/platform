-- 587: every club is born with a club_pages row.
--
-- WHY: a club had to have its public page created by hand, and the operator had
-- to invent a slug. DF Sports Coaching (created 2026-07-16) has no page at all,
-- so /c/<slug> does not exist for it — which blocks the free-trial flow that
-- hangs off the public page. Demo Martial Arts is in the same state.
--
-- SHAPE: an AFTER INSERT trigger on clubs, because there is NO chokepoint —
-- three independent RPCs insert a club (club_create 286:49,
-- self_serve_create_club 518:135, superadmin_create_club 578:138) and a future
-- fourth would forget. No client-side insert exists (all writes go via those
-- RPCs, per the RLS contract).
--
-- DARK BY CONSTRUCTION: club_pages.published DEFAULTS false, so an auto-created
-- page is inert — it is not reachable at /c/<slug> until an operator publishes
-- it. This migration makes no club public.
--
-- NOTE (deliberate): the page-write RPCs (446/448/515) are gated on
-- _club_feature_enabled(club_id,'public_web'); this trigger bypasses that gate.
-- Accepted: club_features has 0 rows and the function COALESCEs a missing row to
-- true, so there is no behaviour difference today, and an unpublished row is
-- inert regardless.
--
-- NOTE: clubs is always INSERTed BEFORE its club_venues link (518/578 both order
-- venue → owner → club → link), so this trigger fires when the club has NO venue.
-- It therefore depends on NEW.id and NEW.name ONLY. Do not add a venue lookup.
--
-- PAIRS WITH: the seed-replay fix in 447 + 505 (same commit). Those seeds insert
-- their BRANDED page with ON CONFLICT (club_id) DO NOTHING. Without that fix this
-- trigger's blank row would land first on a fresh replay and the branded insert
-- would be silently skipped — PA Sports and the demo clubs would rebuild with no
-- colours, no tagline and published=false. Cannot affect the live DB (those clubs
-- already exist, so the trigger never fires for them) — it only bites a rebuild.

-- ── the worker: idempotent, collision-safe page creation ─────────────────────
-- Shared by the trigger and the backfill so the slug rules live in ONE place.
CREATE OR REPLACE FUNCTION public._ensure_club_page(p_club_id text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_base text;
  v_slug text;
  i      int;
BEGIN
  -- No-op when a page already exists. The seeds create their own BRANDED pages;
  -- this must never fight them, and re-running the backfill must be safe.
  IF EXISTS (SELECT 1 FROM public.club_pages WHERE club_id = p_club_id) THEN
    RETURN;
  END IF;

  -- Slugify. btrim + the empty-string guard are load-bearing: club_pages carries
  -- CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'), so a leading/trailing
  -- hyphen is rejected — a club named "FC!" slugifies to 'fc-' and would violate.
  v_base := regexp_replace(lower(COALESCE(p_name, '')), '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  v_base := left(v_base, 60);
  -- left() can re-expose a trailing hyphen mid-word ('a-very-long-name-' → …'-').
  v_base := btrim(v_base, '-');
  IF v_base = '' THEN
    v_base := 'club';
  END IF;

  -- Bare slug first (df-sports-coaching), random suffix only on collision.
  -- Idiom: 489_self_serve_create_tournament.sql:225-250, except that one ALWAYS
  -- suffixes; a club page is operator-facing so the clean slug is worth trying.
  FOR i IN 1..5 LOOP
    v_slug := CASE WHEN i = 1
                   THEN v_base
                   ELSE v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6)
              END;
    BEGIN
      INSERT INTO public.club_pages (club_id, slug) VALUES (p_club_id, v_slug);
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Could be the slug OR the club_id PK (a concurrent creator won the race).
      -- If the page now exists, that race is a success, not a failure.
      IF EXISTS (SELECT 1 FROM public.club_pages WHERE club_id = p_club_id) THEN
        RETURN;
      END IF;
      -- else: slug taken — loop and try a suffixed one.
    END;
  END LOOP;

  -- Exhausted (5 md5-random suffixes colliding is effectively impossible).
  -- Deliberately does NOT raise: this trigger runs inside the club INSERT, and
  -- failing to name a page must never abort creating the club. Worst case the
  -- club has no page row — which is exactly today's status quo, and the club-page
  -- editor (venue_set_club_page, 515:146) upserts one on first save anyway.
END;
$function$;

REVOKE ALL ON FUNCTION public._ensure_club_page(text, text) FROM PUBLIC, anon, authenticated;

-- ── the trigger ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ensure_club_page()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public._ensure_club_page(NEW.id, NEW.name);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_ensure_club_page() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ensure_club_page ON public.clubs;
CREATE TRIGGER ensure_club_page
  AFTER INSERT ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.tg_ensure_club_page();

-- ── one-time backfill (a trigger is not retroactive) ─────────────────────────
-- Expect exactly 2 rows today: club_df_sports_coaching, club_demo_ma.
-- Both land unpublished/unbranded — the operator still brands + publishes.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.id, c.name
    FROM public.clubs c
    WHERE NOT EXISTS (SELECT 1 FROM public.club_pages p WHERE p.club_id = c.id)
    ORDER BY c.id
  LOOP
    PERFORM public._ensure_club_page(r.id, r.name);
  END LOOP;
END
$do$;
