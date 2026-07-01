# SKILL: Ephemeral Verify
## End-to-end RPC verification against an in-transaction throwaway fixture

Triggered when: any cycle adds or modifies an RPC that affects user
state (writes, scoring, standings, lineups, eligibility).
Mode: Supabase MCP execute_sql only. No code edits.
Exit condition: every assertion passes; leak-check returns zero rows.

---

## PURPOSE

Phase 3 Cycle 3.5 established the pattern: prove an RPC chain works
end-to-end against the live DB without leaving any residue. The
mechanism is a single DO block that creates ephemeral data, runs the
RPC flow, asserts state, then forces a transaction rollback via
`RAISE EXCEPTION`.

This pattern is now mandatory for every cycle that ships a new write
RPC, because:
- Unit-style RPC tests don't exist in this codebase.
- The `project_parity_test_policy` memo forbids running against
  production rows (session-45 incident).
- Manual UI testing happens, but it's not deterministic or
  re-runnable on a future cycle's regression sweep.

A clean ephemeral-verify run is the evidence that an RPC works
against the LIVE schema, with the LIVE RLS policies, against the
LIVE function search paths — none of which a build or hygiene check
can confirm.

---

## ⛔ NEVER — ANTI-PATTERNS (read before writing any EV)

These are not style preferences. Each one has caused a real incident.

1. **NEVER run the RPC flow against existing rows.** Not production,
   not the demo seed (`demo_venue`, `team_demo`, `company_demo`,
   `dc_*`, `*_demo_*`). Seed your OWN `_e2e_`-prefixed fixture with
   its own admin token and call the RPCs against THAT. If a rollback
   ever fails, the only casualties are `_e2e_` rows the leak-check
   catches — never shared data. (Session 63: an EV ran against
   `demo_venue` + its real token and a non-rollback variant corrupted
   the demo seed.)

2. **NEVER capture the verdict via committed state.** No temp table you
   `SELECT` after the block, no "results" rows, no `UPDATE` you read
   back. The ONLY sanctioned way to return a verdict is the message of
   the top-level `RAISE EXCEPTION 'ROLLBACK_TESTS_PASSED :: ' || v_summary`
   — it rolls back the whole transaction AND surfaces the summary in
   the MCP error. A temp-table verdict means the block COMMITTED.

3. **NEVER swallow the rollback exception.** The final `RAISE EXCEPTION`
   must reach the top level. A `BEGIN…EXCEPTION WHEN OTHERS` that wraps
   the whole body will catch it and COMMIT. Error-path sub-blocks
   (STEP 3) are fine — they catch a specific inner PERFORM and continue
   — but the outer rollback raise is never inside a catch.

4. **NEVER skip the leak-check (STEP 5).** It is the proof the rollback
   worked. A non-zero `_e2e_%` count = the transaction committed =
   STOP and restore before doing anything else.

If you find yourself wanting the verdict in a readable table instead of
an error string: that itch is the trap. Put the verdict in the
exception message. Parse the string.

---

## STEP 1 — DESIGN THE FIXTURE

Decide the minimum data the RPC needs:

- **Standalone write RPC** (e.g. `set_player_status`) — 1 team, 1
  player.
- **Fixture-scoped RPC** (e.g. `ref_record_goal`) — 1 venue, 1
  league, 1 season, 1 competition, 2 teams, 4+ players, 1 fixture.
- **Standings-aggregating RPC** (e.g. `ref_confirm_full_time`) —
  fixture set with mixed event types, plus a player token to call
  `get_league_standings_for_player`.
- **Cross-team RPC** (e.g. `venue_update_fixture_result`) — full
  league setup as above.

The fixture should be the **smallest** that exercises every assertion
you intend to make.

---

## STEP 2 — TEMPLATE

```sql
DO $verify$
DECLARE
  -- ── Ephemeral IDs (use random UUIDs to avoid collision with prod) ──
  v_venue_id   text := 'v_e2e_'   || replace(gen_random_uuid()::text, '-', '');
  v_league_id  text := 'l_e2e_'   || replace(gen_random_uuid()::text, '-', '');
  v_season_id  uuid := gen_random_uuid();
  v_comp_id    uuid := gen_random_uuid();
  v_team_h     text := 'team_e2e_h_' || replace(gen_random_uuid()::text, '-', '');
  v_team_a     text := 'team_e2e_a_' || replace(gen_random_uuid()::text, '-', '');
  v_p_h1       text := 'p_e2e_h1_'   || replace(gen_random_uuid()::text, '-', '');
  v_p_token_h  text := 'tok_e2e_'    || replace(gen_random_uuid()::text, '-', '');
  v_fixture_id uuid := gen_random_uuid();

  -- ── Client-event UUIDs for idempotent RPCs ──
  v_cid_1 uuid := gen_random_uuid();
  -- (one per RPC call)

  -- ── Assertion state ──
  v_result     jsonb;
  v_summary    text := '';
BEGIN
  ------------------------------------------------------------------
  -- 1. Seed ephemeral fixture (minimum schema for the RPC)
  ------------------------------------------------------------------
  INSERT INTO venues (id, name, sport, venue_admin_token, live_channel_key, active, slug, city)
  VALUES (v_venue_id, 'E2E Venue', 'football',
          'adm_' || v_venue_id, 'chan_' || v_venue_id, true, v_venue_id, 'Test');

  INSERT INTO leagues (id, name, venue_id, sport, format,
                       league_admin_token, display_token, live_channel_key,
                       league_code, squad_mode, standings_visibility, active,
                       short_name, day_of_week, default_kickoff_time)
  VALUES (v_league_id, 'E2E League', v_venue_id, 'football', '5-a-side',
          'adm_' || v_league_id, 'disp_' || v_league_id, 'chan_' || v_league_id,
          'E2E' || substring(v_league_id from 6 for 5),
          'registered', 'public', true, 'E2E', 3, '19:30:00');

  INSERT INTO seasons (id, league_id, name, start_date, end_date, num_weeks, status)
  VALUES (v_season_id, v_league_id, 'E2E S1', current_date - 7, current_date + 7, 4, 'active');

  INSERT INTO competitions (id, season_id, name, type, format, status)
  VALUES (v_comp_id, v_season_id, 'E2E Comp', 'league', 'round_robin', 'active');

  -- ...teams, players, team_players, player_registrations, fixtures as needed...

  ------------------------------------------------------------------
  -- 2. Run the RPC flow
  ------------------------------------------------------------------
  v_result := your_rpc_under_test(...);

  ------------------------------------------------------------------
  -- 3. Assertions — each must raise on failure with PASS/FAIL detail
  ------------------------------------------------------------------
  IF (v_result->>'expected_field')::int <> 42 THEN
    RAISE EXCEPTION 'FAIL assertion-name: got % (expected 42)', v_result;
  END IF;
  v_summary := v_summary || 'PASS assertion-name; ';

  -- ...additional assertions...

  ------------------------------------------------------------------
  -- 4. Force rollback — the RAISE EXCEPTION is intentional. The
  --    transaction rolls back; the message carries the test summary
  --    out via the MCP error response.
  ------------------------------------------------------------------
  RAISE EXCEPTION 'ROLLBACK_TESTS_PASSED :: %', v_summary;
END
$verify$;
```

---

## STEP 3 — ERROR-PATH ASSERTIONS

For RPCs with input validation, wrap each bad-input call in a
sub-BEGIN/EXCEPTION block to catch the expected error and continue:

```sql
BEGIN
  PERFORM your_rpc_under_test(/* bad input */);
  RAISE EXCEPTION 'FAIL: bad input should have thrown';
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'expected_error_code' THEN
    RAISE EXCEPTION 'FAIL wrong error: %', SQLERRM;
  END IF;
END;
v_summary := v_summary || 'PASS bad-input rejected; ';
```

Use this for every error path the RPC raises (missing args, invalid
status, wrong token, range violation, etc.).

---

## STEP 4 — INTERPRET MCP RESULT

A passing run looks like:

```
ERROR:  P0001: ROLLBACK_TESTS_PASSED :: PASS step-1; PASS step-2; ...
```

That error is the intended success signal. The `P0001` is the
user-defined exception code we use for the rollback trigger. The
transaction has been rolled back; nothing persists.

A failing run looks like:

```
ERROR:  P0001: FAIL assertion-name: got X (expected Y)
```

If a FAIL message appears: read it, fix the RPC, re-run.

---

## STEP 5 — LEAK CHECK (mandatory, automatic final step)

The leak check is **not** a separate step you decide to run — it is the
built-in LAST action of every ephemeral-verify. No EV is complete until it
has run and every column returned 0. The moment the DO block returns
(whether it reported PASS or FAIL), run — automatically, without waiting to
be told:

```
bash skills/scripts/check-ev-leak.sh
```

Then execute the output via Supabase MCP execute_sql.
Every column must return 0. Non-zero means the rollback failed —
investigate immediately before doing anything else. (Usually means the
DO block's `BEGIN` catch caught the RAISE EXCEPTION before it rolled
back; restructure the verify so the RAISE EXCEPTION is at the top
level of the function.) STOP and restore before continuing.

Treat a run that stopped BEFORE the leak check as an incomplete EV — its
verdict does not count until the leak check has confirmed zero residue.

---

## STEP 6 — REPORT

Output format:

```
EPHEMERAL VERIFY: [rpc_name]

FIXTURE SEEDED:
  [list of ephemeral IDs created]

RPC FLOW:
  [list of RPC calls made + results]

ASSERTIONS:
  PASS [name]
  PASS [name]
  ...

ERROR-PATH ASSERTIONS:
  PASS [bad-input case]
  ...

ROLLBACK MESSAGE:
  ROLLBACK_TESTS_PASSED :: [summary]

LEAK CHECK:
  venues=0 leagues=0 teams=0 players=0 audit_rows=0 → PASS

OVERALL: PASS / FAIL
```

If OVERALL = FAIL: STOP. Do not commit. Investigate the failure
mode (RPC bug, schema drift, RLS policy mismatch, search_path issue).

---

## WORKED EXAMPLES IN HISTORY

- **Cycle 3.5 verify** — ran `ref_confirm_full_time` against a 9-event
  fixture, asserted score=3-1 + standings W=1/GF=3/GA=1/PTS=3, leak
  check passed. Caught zero issues but provided durable evidence
  the cycle was correct.
- **Cycle 3.6 verify** — ran `venue_update_fixture_result` with bad
  inputs (empty reason, negative scores, bogus token), legitimate
  override 1-1 → 2-3, second override 2-3 → 0-0, standings reflect
  override. Eight assertions, all PASS, no leak.

---

## WHY THIS SKILL EXISTS

Codifies a pattern that's now been hand-written 3+ times across
Phase 3. Phase 5 will write 5+ more RPCs. Reusing this template
shaves ~15 minutes per cycle and prevents subtle errors (forgetting
the random-UUID suffix on IDs, forgetting the leak check, putting
the RAISE EXCEPTION inside a BEGIN/EXCEPTION block that swallows it).

---

## READ NEXT
skills/verify.md — ephemeral verify is one part of the cycle's verify step,
not a substitute for the others (build, hygiene, RPC security sweep).
