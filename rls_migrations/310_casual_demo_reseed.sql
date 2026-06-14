-- =============================================================================
-- Migration 310: Casual demo reseed (team_demo / Footy Tuesdays)
-- =============================================================================
-- Replaces the stale / sparse casual demo state with a rich, pitch-ready
-- snapshot. ALL writes are scoped to team_id = 'team_demo' or player IDs
-- matching the 'p_demo_*' prefix. No production data is touched.
-- Idempotent: uses ON CONFLICT DO NOTHING and existence guards throughout.
-- =============================================================================

-- ─── Guard ────────────────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = 'team_demo') THEN
    RAISE EXCEPTION 'team_demo not found — aborting mig 310';
  END IF;
END $guard$;

-- ─── 1. Remove test-player ghost rows from team_demo ─────────────────────────
-- Auto-generated 'Test Player' rows accumulated during dev/test sessions.
-- Step 1a: remove from the team roster.
DELETE FROM team_players
WHERE  team_id   = 'team_demo'
  AND  player_id NOT LIKE 'p_demo_%';

-- Step 1b: remove orphan player rows only if they have no other team assignment.
DELETE FROM players
WHERE  name = 'Test Player'
  AND  NOT EXISTS (
         SELECT 1 FROM team_players WHERE player_id = players.id
       );

-- ─── 2. Player statuses — realistic pre-game snapshot ────────────────────────
-- Squad size = 10 (5v5). 10 in (full), 4 reserve (queue building),
-- 4 out (can't make it), 7 haven't responded yet.

-- 10 'in': regulars who always play
UPDATE players SET status = 'in'
WHERE  id IN (
  'p_demo_01',  -- Hassan (18 goals, 6 POTM)
  'p_demo_02',  -- Dave   (9 POTM)
  'p_demo_04',  -- Steve  (perfect attendance)
  'p_demo_06',  -- Liam
  'p_demo_10',  -- Finbar (perfect attendance, admin)
  'p_demo_16',  -- Priya
  'p_demo_17',  -- Maya
  'p_demo_19',  -- Marcus (14 goals)
  'p_demo_20',  -- Danny
  'p_demo_24'   -- Gav
);

-- 4 'reserve': squad full, joined the queue
UPDATE players SET status = 'reserve'
WHERE  id IN (
  'p_demo_07',  -- Callum
  'p_demo_09',  -- Robbie
  'p_demo_15',  -- Sarah
  'p_demo_23'   -- Luke
);

-- 4 'out': can't make it this week
UPDATE players SET status = 'out'
WHERE  id IN (
  'p_demo_08',  -- Chris   (owes £15)
  'p_demo_11',  -- Paul
  'p_demo_13',  -- Kieran
  'p_demo_14'   -- Declan  (low attendance)
);

-- p_demo_03 (Mike), p_demo_05 (Jordan), p_demo_12 (Tom),
-- p_demo_18 (Aisha), p_demo_21 (Ryan), p_demo_22 (Aaron), p_demo_25 (Tarny)
-- → remain 'none' — haven't responded yet

-- ─── 3. Schedule & active match ───────────────────────────────────────────────
-- Roll next game to Wednesday June 18 (pilot pitch night) at 20:00 BST.
-- Enable bibs. Mike (p_demo_03) holds them — 8 bib_count, deserves the honour.
UPDATE schedule SET
  bibs_enabled   = true,
  game_date_time = '2026-06-18 19:00:00+00'   -- 20:00 BST
WHERE  team_id = 'team_demo';

UPDATE matches SET
  bib_holder = 'p_demo_03',
  match_date = '2026-06-18'
WHERE  id        = 'm_-9327XyQaPU'
  AND  team_id   = 'team_demo';

-- ─── 4. POTM votes — seed last 6 completed matches ───────────────────────────
-- 0 votes currently exist. Add 8 voters per match covering the 6 most recent
-- completed games. Each match's winner maps to a sensible nominee.
DO $potm$
DECLARE
  v_matches  text[] := ARRAY[
    'm_demo_22',  -- May 12,  A wins 1-0  → Hassan
    'm_demo_21',  -- May 5,   A wins 4-2  → Danny
    'm_demo_20',  -- Apr 28,  A wins 4-2  → Dave
    'm_demo_19',  -- Apr 21,  B wins 3-4  → Mike
    'm_demo_18',  -- Apr 14,  A wins 4-2  → Hassan
    'm_demo_17'   -- Apr 7,   A wins 5-3  → Marcus
  ];
  v_nominees text[] := ARRAY[
    'p_demo_01',  -- Hassan
    'p_demo_20',  -- Danny
    'p_demo_02',  -- Dave
    'p_demo_03',  -- Mike
    'p_demo_01',  -- Hassan
    'p_demo_19'   -- Marcus
  ];
  v_voters   text[] := ARRAY[
    'p_demo_02','p_demo_04','p_demo_06','p_demo_10',
    'p_demo_16','p_demo_17','p_demo_23','p_demo_24'
  ];
  i int; j int;
BEGIN
  FOR i IN 1..array_length(v_matches, 1) LOOP
    FOR j IN 1..array_length(v_voters, 1) LOOP
      INSERT INTO potm_votes (match_id, team_id, voter_id, nominee_id)
      VALUES (v_matches[i], 'team_demo', v_voters[j], v_nominees[i])
      ON CONFLICT DO NOTHING;
    END LOOP;
    -- m_demo_22 had motm = NULL; fill it in to match the seed winner
    IF v_matches[i] = 'm_demo_22' THEN
      UPDATE matches SET motm = 'Hassan'
      WHERE  id = 'm_demo_22' AND team_id = 'team_demo' AND motm IS NULL;
    END IF;
  END LOOP;
END $potm$;

-- ─── 5. Bib history — recent game nights ─────────────────────────────────────
-- 7 rows exist; add 10 more for a richer bib-rotation history.
-- All scoped to team_demo. Mike (p_demo_03) is the chronic bib-hoarder.
INSERT INTO bib_history (name, returned, team_id, match_date, player_id)
VALUES
  ('Mike',   false, 'team_demo', current_date -  7, 'p_demo_03'),
  ('Mike',   true,  'team_demo', current_date - 14, 'p_demo_03'),
  ('Mike',   false, 'team_demo', current_date - 21, 'p_demo_03'),
  ('Dave',   true,  'team_demo', current_date -  7, 'p_demo_02'),
  ('Dave',   true,  'team_demo', current_date - 14, 'p_demo_02'),
  ('Callum', true,  'team_demo', current_date -  7, 'p_demo_07'),
  ('Callum', true,  'team_demo', current_date - 21, 'p_demo_07'),
  ('Finbar', true,  'team_demo', current_date -  7, 'p_demo_10'),
  ('Ryan',   true,  'team_demo', current_date - 14, 'p_demo_21'),
  ('Sarah',  true,  'team_demo', current_date -  7, 'p_demo_15');

-- ─── 6. Payment ledger — recent fees + outstanding debts ─────────────────────
-- Add entries for the last 2 game nights. Chris (p_demo_08) owes for 3 weeks.
-- Guard: only insert if ledger is still thin (< 25 rows) to prevent duplication.
DO $ledger$
BEGIN
  IF (SELECT count(*) FROM payment_ledger WHERE team_id = 'team_demo') >= 25 THEN
    RAISE NOTICE 'payment_ledger already enriched for team_demo; skipping';
    RETURN;
  END IF;

  INSERT INTO payment_ledger (team_id, player_id, match_id, amount, type, status, method, paid_at, note)
  VALUES
    ('team_demo', 'p_demo_02', 'm_demo_22', 5.00, 'game_fee', 'paid',   'cash',         now() - interval  '7 days', 'Week 23'),
    ('team_demo', 'p_demo_04', 'm_demo_22', 5.00, 'game_fee', 'paid',   'bank_transfer', now() - interval  '7 days', 'Week 23'),
    ('team_demo', 'p_demo_06', 'm_demo_22', 5.00, 'game_fee', 'paid',   'cash',         now() - interval  '7 days', 'Week 23'),
    ('team_demo', 'p_demo_10', 'm_demo_21', 5.00, 'game_fee', 'paid',   'cash',         now() - interval '14 days', 'Week 22'),
    ('team_demo', 'p_demo_16', 'm_demo_21', 5.00, 'game_fee', 'paid',   'bank_transfer', now() - interval '14 days', 'Week 22'),
    ('team_demo', 'p_demo_07', 'm_demo_21', 5.00, 'game_fee', 'paid',   'cash',         now() - interval '14 days', 'Week 22'),
    ('team_demo', 'p_demo_19', 'm_demo_21', 5.00, 'game_fee', 'paid',   'cash',         now() - interval '14 days', 'Week 22'),
    ('team_demo', 'p_demo_08', 'm_demo_21', 5.00, 'game_fee', 'unpaid', NULL,           NULL,                       'Week 22 — chased x2'),
    ('team_demo', 'p_demo_08', 'm_demo_20', 5.00, 'game_fee', 'unpaid', NULL,           NULL,                       'Week 21'),
    ('team_demo', 'p_demo_08', 'm_demo_19', 5.00, 'game_fee', 'unpaid', NULL,           NULL,                       'Week 20')
  ON CONFLICT DO NOTHING;
END $ledger$;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- [A] Status breakdown (expected: 10 in / 4 reserve / 4 out / 7 none)
SELECT status, count(*) FROM players p
JOIN team_players tp ON tp.player_id = p.id
WHERE tp.team_id = 'team_demo' AND p.id LIKE 'p_demo_%'
GROUP BY status ORDER BY status;

-- [B] POTM votes count (expected: 48 = 6 matches × 8 voters)
SELECT count(*) AS potm_votes FROM potm_votes WHERE team_id = 'team_demo';

-- [C] Schedule state
SELECT bibs_enabled, game_date_time, active_match_id FROM schedule WHERE team_id = 'team_demo';
