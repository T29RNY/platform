# TOURNAMENT_GROUPS_KO_HANDOFF.md — "Groups then knockout" self-serve tournament format

**Trigger:** `/loop /dev-loop TOURNAMENT_GROUPS_KO_HANDOFF.md`
**Plan gate:** batched · **Merge mode:** per-phase
**Scoped:** 2026-07-07 · builds on `TOURNAMENT_SELF_SERVE_HANDOFF.md` (migs 489–497, all live) · next free migration **501**

---

## ⚑ PR#1 SHIPPED + SCOPE CHANGE (2026-07-08) — READ BEFORE PR#2

**PR#1 (backend) is BUILT, APPLIED-TO-LIVE + EV-verified + reviewed + on a branch (`feat/tournament-groups-ko-backend`), PR open, awaiting merge.** migs **498** (seed_group_stage) + **499** (retire_group_team) + **500** (venue_seed_knockout made config-driven) all applied to live + paired downs + wrappers + barrel. EV PASS (qpg=2 full chain + qpg=1 top-1 + retire + strand guard, leak 0); rpc-security PASS; QA+Security reviews clean.

**SCOPE CHANGE (operator-approved during PR#1):** qualifiers-per-group is now **configurable — top-1 OR top-2** (v1), not fixed top-2. This overrides LOCKED DECISION #2. Rationale: top-1 is no-show-robust and enables "2 groups of 3 → winner of each into a final". Consequences that PR#2/#3 MUST honour:
- `self_serve_seed_group_stage` takes a 5th arg **`p_qualifiers_per_group ∈ {1,2}`** (wrapper `selfServeSeedGroupStage(venueToken, eventId, compId, numGroups, qualifiersPerGroup)`).
- **MIN TEAMS = `num_groups × (qualifiers_per_group + 1)`** (top-1 → 2/group, top-2 → 3/group). This closes the single-no-show strand; a *second* no-show in the SAME group is a **named v1 limitation** (`group_would_strand` error; organiser can `self_serve_cancel_tournament`).
- `venue_seed_knockout` reads `config.qualifiers_per_group` (default 2 → paid flow unchanged).
- **PR#2 UI:** the ManageTournament picker becomes **group-count + how-many-advance**, offering only combos where `num_groups × qpg ∈ {2,4,8,16}` and showing the resulting shape ("2 groups, top 1 → straight final" / "2 groups, top 2 → semi-finals" / "4 groups, top 1 → semi-finals" / …). Valid v1 combos: (2,1)→final, (2,2)→semis, (4,1)→semis, (4,2)→QF, (8,1)→QF, (8,2)→R16.
- **PR#3 create form** unchanged in spirit — the format chip stays "Groups, then knockout"; the qpg choice lives in Manage (mirrors group count).

---

## WHAT IT IS

The self-serve phone tournament flow (apps/inorout `/create` → onboarding) today offers two
formats: **Knockout** and **Round robin**. The third format every real one-day cup actually
uses — **Groups, then knockout** (split teams into groups, all-play-all within each group,
top teams from each group feed a knockout bracket to a champion) — was deliberately deferred
because no tournament-mode group-assignment step was exposed (`CreateTournament.jsx:41-49`,
Decision #12 "no dead ends").

This feature exposes exactly that step. The whole run happens on the organiser's phone in
ManageTournament: create → share → teams register → **draw groups & play group stage** →
**one-tap generate knockout** → score to champion.

**The gap is tiny because the machinery already exists.** Verified across a 5-lens audit:
- `self_serve_create_tournament` (mig 489:164-170) **already accepts `format='groups'`** → competition `type='cup', format='group_stage'`. Create side needs **zero backend change**.
- `self_serve_enter_result` (mig 493:93) **already scores both** group fixtures (group_label set → draws allowed, no advance) and knockout fixtures (group_label NULL → advance).
- `get_tournament_public` (mig 452:167-205) **already returns per-group standings** (group_label, group_rank, pts/gd/gf).
- `venue_seed_knockout` (mig 452:1020, wrapper `venueSeedKnockout` supabase.js:7376) **already seeds the KO bracket from group qualifiers** — cross-seeded (A1 v B2), top-2/group, hard-gated on all group fixtures complete. Auth via `_authorise_venue_tournament` (the same Stage-1b venue-token surface self-serve already uses).
- The public page `TournamentScreen.jsx:498-545` **already renders** groups + per-group tables + ADV badges + the resulting bracket.

**The only net-new backend is a tournament-mode group-stage seeder** (assign teams to groups +
generate per-group all-play-all fixtures), mirroring exactly what mig 491
(`self_serve_seed_single_elim`) did for straight knockout — plus a small **walkover/retire**
RPC so a no-show can't strand the tournament (see LOCKED DECISION #8 and MISSED below).

---

## LOCKED DECISIONS (confirm before build)

1. **Format chosen at create; group count chosen at generate-time in Manage.** At create,
   team count is 0 — asking "how many groups?" then is a guess. Re-add `{ code: "groups",
   label: "Groups, then knockout" }` to `FORMATS` (CreateTournament.jsx:46); the group-count
   picker lives in ManageTournament, run against the live approved-team count. Mirrors the
   knockout flow exactly.
2. **Top-2 per group, fixed for v1.** `venue_seed_knockout` hardcodes `group_rank IN (1,2)`
   (mig 452:1184). Best-3rd-place / top-1 qualification is **deferred** (would need a KO-seeder
   variant). Recorded as future work.
3. **num_groups ∈ {2, 4, 8} ONLY.** Because qualifiers = 2 × num_groups must be a power of 2
   (4/8/16) for `venue_seed_knockout`'s bracket check (mig 452:1190). 3 groups → 6 qualifiers →
   `bracket_size_not_supported`, stranding a played group stage. The seeder **rejects**
   non-{2,4,8}; the UI offers only those.
4. **Auto snake-draw by registration order.** Teams drawn into groups snake-style
   (1,2,3,3,2,1…) for balance. Manual drag-to-assign is **deferred** to a later "shuffle
   groups" affordance.
5. **System letter group labels (A/B/C…), NOT operator free-text.** Keeps group names out of
   the UGC surface — the existing report/moderation stack (migs 495-497) already covers team
   names + the tournament; no new moderation code. Free-text group names would be new
   reportable content — deferred.
6. **Group fixtures unscheduled (NULL date/time).** Self-serve is pitch-side "who's next",
   not a timetable; ManageTournament groups fixtures by round_name, not time. The seeder takes
   **no** slot/pitch/time params.
7. **Single competition holds both phases.** Group + KO fixtures share the one auto-created
   "Main Draw" competition (mig 489:255-261); `venue_seed_knockout` inserts KO fixtures into
   the same competition_id, and `get_tournament_public` renders them by fixture shape. Do NOT
   create a second competition.
8. **A no-show is handled by an explicit walkover/retire path (NOT fabricated scores).** See
   MISSED. A "retire team" action walks over that team's outstanding group fixtures so the KO
   gate can clear. v1 is **single-device-organiser** (manage entry is by `created_by_user`,
   mig 492) — a co-host grant on a second phone is deferred.
9. **Persist group intent into `competitions.config` at seed time** (`{num_groups,
   qualifiers_per_group: 2}`) — future-proofing, see FUTURE-PROOF. Costs one `jsonb_build_object`.

---

## KEY AUDIT FACTS (load-bearing — do not re-derive)

- **Next free migration = 498** (highest live = 497; re-confirm against live before taking it —
  cloud-session first-come rule). This feature takes **498** (seed group stage) + **499**
  (retire/walkover).
- **REUSE, zero change:** `self_serve_create_tournament` (mig 489, accepts `format='groups'`),
  `self_serve_enter_result` (mig 493, scores both phases), `get_tournament_public` (mig 452,
  group standings), `venue_seed_knockout` (mig 452:1020) + wrapper `venueSeedKnockout`
  (supabase.js:7376), public page `TournamentScreen.jsx:498-545`.
- **`venue_seed_knockout` behaviour (mig 452:1020-1272):** auth via `_authorise_venue_tournament`
  (works for self-serve personal-host venue_id); refuses `incomplete_group_fixtures` if any
  group fixture ≠ completed (452:1057-1064) — the clean server gate; requires ≥2 groups; picks
  top-2/group via a full-tiebreaker standings CTE (pts→h2h→gd→gf→name), writes group_rank;
  power-of-2 qualifier check; cross-seeds A1 v B2; KO fixtures land in the same competition,
  group_label NULL, feeder-wired; sets `config.knockout_seeded`.
- **⛔ DO NOT USE the Phase-11 league-mode functions** — they write `fixtures.home_team_id`
  (text) and guard on `cup_ties`, which `self_serve_enter_result` **cannot score** (mig
  493:18-19 documents this incompatibility). Specifically avoid: `venue_persist_group_stage`
  (mig 192), `get_group_standings` (mig 193), `venue_seed_knockout_from_groups`
  (supabase.js:3662). These are red herrings that produce an un-scoreable bracket.
- **New RPC 498 `self_serve_seed_group_stage(p_venue_token text, p_tournament_event_id uuid,
  p_competition_id uuid, p_num_groups int)`** — mirror mig 491 exactly for auth / idempotency /
  audit / grants style. Body: authorise → competition-belongs-to-event **AND format='group_stage'**
  re-check (mig 491:69-79 — load-bearing IDOR guard) → idempotency (`config->>'groups_seeded'`
  OR any fixture exists) → `SELECT … FOR UPDATE` on the competition row (serialise concurrent
  seeds) → read active teams → validate `num_groups ∈ {2,4,8}` and `team_count ≥ 2×num_groups`
  → snake-assign `competition_teams.group_label` (letters) → per-group all-play-all fixtures via
  the circle method **verbatim from `venue_generate_schedule` (mig 452:909-948)** but partitioned
  per group, with `group_label` SET + `home/away_competition_team_id` + `week_number` +
  `round_name='Group '||label` + status 'scheduled' → set `config = config ||
  '{"groups_seeded":true,"num_groups":N,"qualifiers_per_group":2}'` → `audit_events`
  (action `tournament_group_stage_seeded`, mig 491:173-183 shape, Hard Rule 9).
- **New RPC 499 `self_serve_retire_group_team(p_venue_token text, p_competition_team_id uuid)`**
  — authorise via the team's competition→event→venue chain; for each of the team's group
  fixtures still ≠ completed, mark completed as a conventional walkover (opponent 3-0, or 0-0
  double-forfeit if both sides retired — decide), audit `tournament_group_team_retired`. This
  clears the `incomplete_group_fixtures` gate without fabricated real scores.
- **Grants (both RPCs, authenticated-only — mig 491:195-197 profile):** `SECURITY DEFINER`,
  `SET search_path TO 'public','pg_temp'`; `REVOKE ALL … FROM PUBLIC`; `REVOKE ALL … FROM anon`
  (by name — default-privileges gotcha); `GRANT EXECUTE … TO authenticated`.
- **Wrappers:** add `selfServeSeedGroupStage` + `selfServeRetireGroupTeam` to
  packages/core/storage/supabase.js (+ barrel export). `venueSeedKnockout` already exists (7376).
- **ManageTournament generate branch** (ManageTournament.jsx:285-311) is single-branch today
  (`single_elimination` vs round-robin) — becomes phase-aware for group_stage (see PR2).

---

## ROADMAP

### PR #1 — Group-stage backend (migs 498 + 499 + wrappers) · TIER-3 · PROTECTED · 🚦
- New RPC `self_serve_seed_group_stage` (mig 498) + `self_serve_retire_group_team` (mig 499),
  paired `_down.sql` each; wrappers `selfServeSeedGroupStage` + `selfServeRetireGroupTeam` +
  barrel exports. No change to `self_serve_create_tournament` (mig 489 already accepts 'groups')
  → **no overload risk**.
- Gates: 🚦 migration apply (Hard Rule 11: paired down + same-commit source + next-number) ·
  🚦 **ephemeral-verify the FULL chain** (seed 8 teams → 2 groups of 4 → score all group games
  → `venue_seed_knockout` → score semis + final → champion; then a second EV: seed → retire one
  team → confirm KO gate clears; `_e2e_` only, auto-rollback, leak-check = 0) ·
  🚦 rpc-security-sweep (`check-rpc-security.sh self_serve_seed_group_stage` +
  `self_serve_retire_group_team` — 491 authenticated-only profile).
- **DONE-check:** both EV DO-blocks `RAISE EXCEPTION 'ROLLBACK_TESTS_PASSED'`; check-rpc-security
  PASS; `_e2e_%` count = 0.
- **Effort:** M.

### PR #2 — ManageTournament group-stage run UI + public qualify-tint · TIER-2 · PROTECTED · 🚦
- Phase-aware detail view: (a) no fixtures + format=group_stage → group-count picker (chips
  2/4/8, auto-defaulted from approved count, shows resulting shape + honest imbalance line) →
  "Draw groups & generate fixtures → go live" (calls `selfServeSeedGroupStage`); (b) group stage
  live → per-group standings tables (from `venueGetTournamentStandings`, top-2 rows gold-tinted)
  + grouped fixture list + a "didn't show / retire team" affordance (calls
  `selfServeRetireGroupTeam`); (c) all group games complete → prominent "Generate knockout"
  button (calls `venueSeedKnockout`), disabled-with-reason until then; (d) KO → existing bracket
  scoring. Phase banner under the title ("Group stage · 6 of 12 played" / "Knockout ·
  Semi-finals"). Plus a few lines of CSS in `TournamentScreen.jsx` public page to gold-tint the
  top-`group_rank` rows (the shareable/reception-display moment — data already present).
- Ships **dark** (no dropdown option yet → surface only reachable via a group_stage tournament,
  none in prod), so no dead-end during the build.
- Gates: 🚦 casual-regression (touches apps/inorout/src) · 🚦 real-iPhone walk (Hard Rule 13,
  native run flow) · Playwright browser smoke of the seeded-tournament manage chain.
- **DONE-check:** on a seeded group tournament — draw groups → standings render → score all →
  generate KO → score final → champion, both in Playwright and on-device; public page shows
  tinted qualifying rows.
- **Effort:** L (the bulk of the epic — standings block + phase-state logic + retire affordance).

### PR #3 — CreateTournament format flip (go-live) · TIER-1 · CLEAR · 🚦
- Re-add `{ code: "groups", label: "Groups, then knockout" }` to `FORMATS`
  (CreateTournament.jsx:46) + a group-specific `friendly()` arm. Delete the deferral comment.
  This is the switch that makes the whole path user-reachable — lands LAST (Decision #12).
- Gates: 🚦 casual-regression · quick real-device create walk.
- **DONE-check:** create form offers "Groups, then knockout"; create → PR2 manage UI runs it
  end-to-end on-device.
- **Effort:** XS.

---

## 🚦 GATES the loop must stop at

- **PR1:** migration apply (498 + 499) · ephemeral-verify (full group→KO chain + retire path) ·
  rpc-security-sweep. Three human sign-offs.
- **PR2:** casual-regression · real-iPhone walk of the group-stage run flow.
- **PR3:** casual-regression · real-device create walk.
- **Expected stops: 3 of 3 PRs need sign-off** (PR1 = 3 gated actions; PR2 + PR3 = device walks).

## DONE =

A signed-in organiser can, entirely on their phone: create a "Groups, then knockout" tournament,
share it, approve registered teams, draw them into 2/4/8 balanced groups, play the group stage
(scoring group games with draws allowed), retire a no-show without stranding the event, tap once
to generate a correctly cross-seeded knockout from the top 2 of each group, and score through to
a champion — with the public page showing live group tables (qualifiers tinted) and the bracket
throughout. No dead ends at any state.

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

- **MISSED — the no-show poisons a whole group and hard-blocks the KO.** `venue_seed_knockout`
  refuses to seed unless *every* group fixture is `completed` (mig 452:1057-1064). A team that
  registers but doesn't turn up leaves all its group fixtures unplayable, so "Generate knockout"
  throws `incomplete_group_fixtures` forever with no in-app escape — a public, pitch-side dead
  end. `ScoreEntry` + `self_serve_enter_result` (mig 493:55-60) only accept two real scores, so
  the organiser can't cleanly mark a no-show without inventing results that distort standings.
  **Resolution (folded in):** RPC 499 `self_serve_retire_group_team` + a "didn't show / retire"
  affordance in PR2 that walks over the team's outstanding group fixtures in one tap. Two lesser
  siblings noted: the snake-draw must never create an empty competition_team slot; and v1 is
  single-device-organiser (co-host grant deferred).
- **OPPORTUNITY — this quietly finishes self-serve *league* and is the reception-display demo.**
  A "league" is a single round-robin group whose standings you never seed a KO from — the same
  `get_tournament_public` standings block this feature proves. Once group tables render, self-
  serve casual league is a config label away, not a new build. And a live, auto-updating group
  table with qualify-tint is exactly the "reception display money moment" STRATEGY.md names —
  point the display app at a live tournament's public page for a near-zero-cost sales demo.
  Shipping groups→KO on the phone also field-tests the paid venue-operator tournament epic's
  group engine (Epic D, mig 452) for free, since self-serve rides its rails.
- **FUTURE-PROOF — persist `{num_groups, qualifiers_per_group}` into `competitions.config` at
  seed time.** Today the qualification rule lives implicitly as a hardcoded `group_rank IN (1,2)`
  deep in `venue_seed_knockout`. Recording the intent as data when groups are drawn (one
  `jsonb_build_object` in mig 498, same edit surface as adding the param) means a later best-3rd
  / top-1 variant reads `config.qualifiers_per_group` — no schema change, and the group
  *generator* never needs to know the qualifier *rule*. Strictly better than only taking
  `p_num_groups` as a param.
- **WOW — organiser: the one-tap auto-seeded cross-bracket; spectators: the qualify-tint.** The
  organiser finishes the last group game, taps "Generate knockout" once, and a correctly
  cross-seeded bracket (A1 v B2) materialises with zero manual pairing — the standings maths +
  seeding they'd otherwise do on paper, done instantly. (PR2 must add the two-step generate; the
  current one-button flow has no group branch.) For spectators, a plain standings grid reads as
  admin — the cheap, high-impact add is gold-tinting the top-2 rows of each group (data already
  in `get_tournament_public.group_rank`), turning the public page / reception TV into an at-a-
  glance "we're through / we're out" — the single most screenshot-able, most-shared moment.

## Related

Builds on [[project_tournament_self_serve]] (`TOURNAMENT_SELF_SERVE_HANDOFF.md`, migs 489-497).
Reuses the Epic-D venue-operator tournament engine [[project_venue_operator_tournaments]]
(mig 452). Unlocks a potential self-serve casual league (round-robin + standings, no KO seed).
