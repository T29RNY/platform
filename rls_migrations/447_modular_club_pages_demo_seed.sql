-- 447: Modular Platform Epic B — Phase 4 demo seed (NO schema, NO RPC).
-- Publishes two public club pages so /c/<slug> is live for the operator's
-- device-walk and the Phase 4 Playwright smoke has real targets:
--   • /c/finbars-fc  → club_demo     (rich: teams, league, fixtures, sponsors, news)
--   • /c/demo-boxing → club_demo_box (the THIN club: crest + 3 colours only — the
--                       primary empty-state design target)
-- Demo data only (precedent: migs 363–365). Idempotent + fully reversed by the
-- _down. The read RPC is mig 445; the conditional-module read-extension is P5 (448).

-- Mig 587 gives every club a BLANK, unpublished club_pages row the moment the
-- club is INSERTed. On a fresh replay those blank rows land BEFORE these branded
-- seeds, so the ON CONFLICT DO NOTHING clauses below would silently skip the
-- branding and both demo clubs would rebuild colourless and unpublished.
-- Clearing the trigger's untouched blank rows first restores these seeds' original
-- semantics. NOT a DO UPDATE: these seeds set published=true, and a DO UPDATE
-- would re-publish a page on any replay where it had been deliberately taken
-- down. The DELETE can only match the trigger's own blank row — never a branded
-- or published one — so replaying against a live DB stays a no-op.
DELETE FROM public.club_pages
 WHERE club_id IN ('club_demo', 'club_demo_box')
   AND published = false
   AND primary_colour IS NULL;

-- ── rich club: Finbar's FC ───────────────────────────────────────────────────
INSERT INTO public.club_pages
  (club_id, slug, published, primary_colour, secondary_colour, accent_colour,
   tagline, about, socials, sections)
VALUES (
  'club_demo', 'finbars-fc', true,
  '#8A2433', '#2A1018', '#D8455F',
  'Community football in East London',
  'A grassroots club at the heart of the community — football for every age and ability, from our youth foundation to the First XI. Run by volunteers, powered by In or Out.',
  '{"website":"https://www.finbarsfc.co.uk","instagram":"https://instagram.com/finbarsfc","facebook":"https://facebook.com/finbarsfc"}'::jsonb,
  '[]'::jsonb
)
ON CONFLICT (club_id) DO NOTHING;

-- ── thin club: Demo Boxing Club (zero-config empty state) ────────────────────
INSERT INTO public.club_pages
  (club_id, slug, published, primary_colour, secondary_colour, accent_colour,
   tagline, about, socials, sections)
VALUES (
  'club_demo_box', 'demo-boxing', true,
  '#C8202A', '#2A1010', '#FF3024',
  'New boxing club — everyone welcome',
  'A brand-new boxing gym just getting started. First session is free.',
  '{}'::jsonb,
  '[]'::jsonb
)
ON CONFLICT (club_id) DO NOTHING;

-- ── two sponsors for the rich club (flat — tier arrives with P5) ─────────────
INSERT INTO public.club_sponsors (club_id, name, website_url, display_order, active)
SELECT 'club_demo', 'Northgate Motors', 'https://example.com/northgate', 0, true
WHERE NOT EXISTS (SELECT 1 FROM public.club_sponsors WHERE club_id='club_demo' AND name='Northgate Motors');

INSERT INTO public.club_sponsors (club_id, name, website_url, display_order, active)
SELECT 'club_demo', 'Eastside Print Co.', 'https://example.com/eastside', 1, true
WHERE NOT EXISTS (SELECT 1 FROM public.club_sponsors WHERE club_id='club_demo' AND name='Eastside Print Co.');

-- ── one published news post for the rich club ────────────────────────────────
INSERT INTO public.club_posts
  (club_id, slug, title, body, author_name, status, published_at)
VALUES (
  'club_demo', 'cup-run-continues',
  'Cup run continues after late winner',
  'A 90th-minute strike sent Finbar''s through to the next round in front of a packed Rec Ground. Two goals from the front line and a battling clean sheet in the second half capped a memorable afternoon for the First XI. Next up: a home tie under the lights.',
  'Club Reporter', 'published', now() - interval '2 days'
)
ON CONFLICT (club_id, slug) DO NOTHING;
