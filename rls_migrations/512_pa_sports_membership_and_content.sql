-- =============================================================================
-- Migration 512: PA Sports demo — memberships/fees + shop + sponsors + content
-- =============================================================================
-- Fills the blanks the reference demo club has but PA Sports lacked:
--   • 2 membership tiers (Junior / Adult) + a subscription for every player
--   • Payment charges per membership (last month paid + current mix paid/unpaid)
--   • Club shop (merchandise), sponsors, events, club documents, a news post
-- Kids' subs are payable-by-guardian. All placeholders.
-- tier ids a5f1…, membership ids a5f2…. Set/loop based, idempotent.
-- Paired teardown: 512_pa_sports_membership_and_content_down.sql
-- =============================================================================

DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM club_teams WHERE club_id='club_pa_sports') THEN
    RAISE EXCEPTION 'PA Sports teams not found — apply migs 505–507 first';
  END IF;
END $guard$;

-- ─── 1. Membership tiers ─────────────────────────────────────────────────────
INSERT INTO venue_membership_tiers (id, venue_id, name, benefits, audience, pricing_model, active)
VALUES
  ('a5f10000-0000-4000-8000-000000000001', 'pa_peugeot', 'Junior Membership',
   '{"perks":["Weekly coached training","Matchday selection","Club kit discount"]}'::jsonb, 'junior', 'recurring', true),
  ('a5f10000-0000-4000-8000-000000000002', 'pa_peugeot', 'Adult Membership',
   '{"perks":["Weekly training","League matchday selection","Club social events"]}'::jsonb, 'adult', 'recurring', true)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. A subscription + charge history for every player ─────────────────────
DO $subs$
DECLARE
  r record;
  i int := 0;
  m_id uuid;
  amt int;
  cur_status text;
BEGIN
  FOR r IN
    SELECT ctm.member_profile_id AS pid, t.cohort_id AS cohort, c.category AS cat, mg.guardian_profile_id AS gpid
    FROM club_team_members ctm
    JOIN club_teams t   ON t.id = ctm.team_id AND t.club_id='club_pa_sports'
    JOIN club_cohorts c ON c.id = t.cohort_id
    LEFT JOIN member_guardians mg ON mg.child_profile_id = ctm.member_profile_id
    WHERE ctm.is_active
    ORDER BY ctm.member_profile_id
  LOOP
    i := i + 1;
    m_id := ('a5f20000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    amt  := CASE WHEN r.cat='youth' THEN 2000 ELSE 1500 END;  -- £20 junior / £15 adult

    INSERT INTO venue_memberships (id, venue_id, member_profile_id, payer_profile_id, club_id, cohort_id, tier_id, period, amount_pence, status, started_at, renews_at)
    VALUES (m_id, 'pa_peugeot', r.pid, r.gpid, 'club_pa_sports', r.cohort,
            (CASE WHEN r.cat='youth' THEN 'a5f10000-0000-4000-8000-000000000001' ELSE 'a5f10000-0000-4000-8000-000000000002' END)::uuid,
            'monthly', amt,
            CASE WHEN i % 11 = 0 THEN 'paused' ELSE 'active' END,
            current_date - 60, current_date + 1)
    ON CONFLICT (id) DO NOTHING;

    -- this month's sub — mostly paid, some unpaid/partial (so the finance screen has action)
    -- (one charge per membership: venue_charges is unique on source_type+source_id)
    cur_status := CASE WHEN i % 5 = 0 THEN 'unpaid' WHEN i % 7 = 0 THEN 'partial' ELSE 'paid' END;
    INSERT INTO venue_charges (venue_id, source_type, source_id, amount_due_pence, status, due_date)
    VALUES ('pa_peugeot', 'membership', m_id::text, amt, cur_status, current_date + 5)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $subs$;

-- ─── 3. Club shop ────────────────────────────────────────────────────────────
INSERT INTO club_merchandise (club_id, venue_id, name, description, category, price_pence, stock_qty, active)
VALUES
  ('club_pa_sports', 'pa_peugeot', 'Home Shirt 2025/26', 'Orange home shirt with club crest. Junior & adult sizes.', 'kit', 2500, 40, true),
  ('club_pa_sports', 'pa_peugeot', 'Away Bibs', 'Club bibs worn for away fixtures.', 'accessories', 800, 30, true),
  ('club_pa_sports', 'pa_peugeot', 'Training Top', 'Navy training top with gold crest.', 'kit', 2200, 25, true),
  ('club_pa_sports', 'pa_peugeot', 'Club Water Bottle', 'PA Sports branded 750ml bottle.', 'accessories', 600, 50, true),
  ('club_pa_sports', 'pa_peugeot', 'Kit Bag', 'Holdall with embroidered crest.', 'accessories', 1800, 20, true)
ON CONFLICT DO NOTHING;

-- ─── 4. Sponsors ─────────────────────────────────────────────────────────────
INSERT INTO club_sponsors (club_id, name, website_url, tier, display_order, active)
VALUES
  ('club_pa_sports', 'Sunbeam Motors',        'https://example.com/sunbeam',  'headline',  1, true),
  ('club_pa_sports', 'Coventry Balti House',  'https://example.com/balti',    'match',     2, true),
  ('club_pa_sports', 'Singh & Co Solicitors', 'https://example.com/singhco',  'supporter', 3, true)
ON CONFLICT DO NOTHING;

-- ─── 5. Events ───────────────────────────────────────────────────────────────
INSERT INTO club_events (club_id, title, event_date, blurb, display_order)
VALUES
  ('club_pa_sports', 'End of Season Presentation Day', current_date + 45, 'Trophies, medals and a BBQ for all teams and families at PA Peugeot Ground.', 1),
  ('club_pa_sports', 'Club Quiz Night',                current_date + 20, 'Fundraiser quiz night — teams of 6, £5 per head. All welcome.', 2),
  ('club_pa_sports', 'Summer 5-a-side Tournament',     current_date + 70, 'Annual club tournament across all age groups. Food and ice cream on the day.', 3)
ON CONFLICT DO NOTHING;

-- ─── 6. Club documents (shared) ──────────────────────────────────────────────
INSERT INTO club_documents (club_id, title, url, doc_type, size_label, display_order)
VALUES
  ('club_pa_sports', 'Fixture List 2025/26', 'https://example.com/pa-sports/fixtures.pdf', 'pdf', '120 KB', 1),
  ('club_pa_sports', 'Club Welcome Pack',    'https://example.com/pa-sports/welcome.pdf',  'pdf', '2.1 MB', 2),
  ('club_pa_sports', 'Club Constitution',    'https://example.com/pa-sports/constitution.pdf', 'pdf', '340 KB', 3),
  ('club_pa_sports', 'Kit Order Form',       'https://example.com/pa-sports/kit-order.pdf', 'pdf', '95 KB', 4)
ON CONFLICT DO NOTHING;

-- ─── 7. News post ────────────────────────────────────────────────────────────
INSERT INTO club_posts (club_id, slug, title, body, author_name, status, published_at)
VALUES
  ('club_pa_sports', 'mens-open-season-with-a-win', 'Mens open the season with a win',
   'A strong start for the PA Sports Mens as they beat Coventry Sphinx 3-1 at PA Peugeot Ground. Player of the Match went to Sonny Athwal. Next up: a trip to Foleshill Rangers.',
   'PA Sports', 'published', now() - interval '10 days')
ON CONFLICT DO NOTHING;

-- ─── Verification ────────────────────────────────────────────────────────────
SELECT
 (SELECT count(*) FROM venue_membership_tiers WHERE venue_id='pa_peugeot') AS tiers,           -- 2
 (SELECT count(*) FROM venue_memberships WHERE club_id='club_pa_sports') AS memberships,        -- 34
 (SELECT count(*) FROM venue_charges WHERE source_type='membership' AND source_id IN (SELECT id::text FROM venue_memberships WHERE club_id='club_pa_sports')) AS charges, -- 68
 (SELECT count(*) FROM venue_charges c WHERE c.status='unpaid' AND c.source_id IN (SELECT id::text FROM venue_memberships WHERE club_id='club_pa_sports')) AS unpaid,
 (SELECT count(*) FROM club_merchandise WHERE club_id='club_pa_sports') AS merch,               -- 5
 (SELECT count(*) FROM club_sponsors WHERE club_id='club_pa_sports') AS sponsors,               -- 3
 (SELECT count(*) FROM club_events WHERE club_id='club_pa_sports') AS events,                   -- 3
 (SELECT count(*) FROM club_documents WHERE club_id='club_pa_sports') AS docs,                  -- 4
 (SELECT count(*) FROM club_posts WHERE club_id='club_pa_sports') AS posts;                     -- 1
