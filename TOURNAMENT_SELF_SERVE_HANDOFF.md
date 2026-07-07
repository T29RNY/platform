# Standalone Tournament Self-Serve — Epic Scope & Handoff

> **Trigger (paste to build — DARK-shipped MVP, flag-gated):**
> `/loop /dev-loop TOURNAMENT_SELF_SERVE_HANDOFF.md`
>
> Plan gate: batched · Merge mode: per-phase
>
> *Scoped 2026-07-06. Read alongside `SELF_SERVE_MULTI_VERTICAL_HANDOFF.md` (the sibling epic
> this follows), `DECISIONS.md`, and the Event OS engine (`rls_migrations/314–328`, `452/453`).*

---

## WHAT IT IS

Today the In or Out app lets a plain consumer self-serve create a **casual squad** and a
**competitive team**, and (just shipped) a **venue** shell. It does **not** let a consumer create
a **tournament** — the only creation RPCs are `club_admin_create_tournament` (needs a club +
`club_team_managers` row) and `venue_create_tournament` (needs a venue operator context). A
casual organiser — a mate running a 6-a-side knockout, a workplace 5-a-side cup, a charity
tournament — has no club/venue, so there is **no front door** to spin up a bracket.

This epic adds that front door: a **6th "Tournament" vertical** in the `/create` chooser that lets
an authenticated consumer create, share, fill, and **run a tournament entirely from their phone** —
reusing the fully-built Event OS engine (brackets, fixtures, standings, knockout advance,
sponsors, sports-day) with **almost no new backend**. Unlike venue/club/gym (which capture a shell
natively then hand off to the web console because configuring pitches/payouts is a laptop job), a
one-day tournament is **run pitch-side on a phone** — so it is a `surface:'native'` vertical with a
native "Run tournament" screen, and that is the defining difference that makes it **its own small
epic, not PR7 of the multi-vertical one.**

**The two load-bearing discoveries that shrink this from an XL build to an M/L build:**

1. **`resolve_venue_caller` Stage 1b already de-tokenises management.** (`rls_migrations/237_venue_staff_logins_core.sql:106-122`, documented again at `rls_migrations/439_*.sql:6-7`.) A logged-in user passes their **`venue_id` in the `p_token` slot** and is authorised via `auth.uid()` against their `venue_admins` row — **no master token needed.** Because `self_serve_create_venue` (mig 484) already mints exactly that owner row, a self-serve organiser can drive **every existing `venue_*` tournament management RPC** (`venue_add_competition`, `venue_approve_team`, `venue_generate_schedule`, `venue_seed_knockout`, `venue_update_tournament_status`, …) unchanged, passing venue_id-as-token. **No self-serve management twins are needed** — this is the single biggest scope reduction, and it's proven in-production (the operator mobile tournament screens already use this path).

2. **`tournament_events.venue_id` is NOT NULL** (`rls_migrations/315:19`; mig 452 dropped NOT NULL only on `club_id`) and is consumed by 5+ INNER `JOIN venues` readers incl. the public page. So a "standalone" tournament **must** hang off a venue. The clean answer (reuse over new systems): the create RPC **mints/reuses a hidden "personal host" venue** per organiser (the mig-484 owner-venue shell), keeps `venue_id` populated, and **never shows the word "venue"** to the user. No schema break, no nullable-venue ripple.

**Net new backend = TWO small RPCs** (create + a score-and-advance RPC), **one additive column**, and **two compliance RPCs** (cancel/delete + moderation-hide). Everything else is reuse.

---

## LOCKED DECISIONS

Assumed product/architecture calls — confirm or adjust at the human review before building.

1. **Own small epic (5 PRs), `surface:'native'`, run-it-from-your-phone** — NOT a `surface:'computer'`
   hand-off like venue/club/gym, and NOT PR7 of the multi-vertical epic. The native "Run" UI is the
   point and the bulk of the effort.

2. **Ownership = the mig-484 hidden-personal-venue shell, reused across the user's tournaments.**
   `self_serve_create_tournament` finds-or-creates ONE hidden host venue per user (marked so it never
   appears in the operator venue chooser — recommend a `venues.is_personal_host boolean` or an
   `origin='self_serve_personal'` value), then inserts every tournament under it. One host (not one
   venue per tournament) so the mig-484 "≤3 pending venues" cap doesn't block the 4th tournament.

3. **Management REUSES existing `venue_*` RPCs via Stage 1b (venue_id-as-token) — zero twins.** The
   create RPC returns the `venue_id`; the frontend passes it as the `venueToken` arg to the existing
   wrappers (`venueAddCompetition`, `venueApproveTeam`, `venueGenerateSchedule`, `venueSeedKnockout`,
   `venueUpdateTournamentStatus`, …). Safe because Stage 1b re-checks `auth.uid()` ownership on every
   call — a bystander passing someone else's venue_id gets no match (`invalid_venue_token`). This is
   the reconciliation of the security lens (which assumed twins) and the technical lens (which found
   Stage 1b): **reuse strictly dominates, PROVIDED ephemeral-verify proves the bystander-rejected
   invariant.** `venue_id` is NOT a secret and NOT the master `venue_admin_token` (which is never
   returned) — it is only a selector Stage 1b gates on `auth.uid()`.

4. **The ONE genuine score gap: knockout advancement.** Live round-robin/group **standings already
   recompute** from `fixtures.home_score/away_score` inside `get_tournament_public` — and a venue-token
   fixture-score writer exists (`venue_update_fixture_result`, mig 127). BUT tournament **knockout
   advance** (`_advance_tournament_winner` mig 187, `_advance_tournament_double_elim` mig 325) is
   triggered **only** by `ref_confirm_tournament_match` (ref-token). So one small net-new RPC —
   `self_serve_enter_result(venue_id_as_token, fixture_id, home, away)` — sets the final score AND
   `PERFORM`s the advance helper (safe: the helpers are internal SECDEF, callable only from inside
   another SECDEF). **Direct final-score entry, not live goal-by-goal** — correct altitude for a mate
   on a touchline; the full ref console stays available for organisers who want it. (Rejected: issuing
   a per-fixture ref-token to the organiser — heavier, forces the ref-app iframe.)

5. **Entry fees stay INFORMATIONAL-only in v1.** `entry_fee_pence` already exists and displays on the
   public page, but there is **no Stripe charge path** wired to tournament entry (grep-confirmed). Keep
   it non-collecting (organiser collects offline). Collecting entry money would inherit Stripe Connect
   KYC/AML + refund/chargeback + a stronger data-controllership argument — defer to a later PR, gated
   like venue self-serve (Decision #10/#13 of the sibling epic).

6. **Ships DARK behind a flag until the compliance builds land + the real-device walk passes.** The
   registry `status:'soon'→'live'` toggle (or a `VITE_*` flag) keeps the create card hidden in prod
   while the RPCs + screens land on main (merge = live prod deploy). Flip ON only after PR #5
   (moderation + delete) + the Hard-Rule-13 walk.

7. **Compliance = SHIP-WITHOUT the club/gym safeguarding stack, WITH 4 guardrails.** A self-serve
   tournament captures **team names, not people** — registration inserts only `(competition_id,
   team_name, status)` (no dob, no roster, no `member_profiles`), so the safeguarding/DPIA/welfare
   gates that fire on a `dob<18` save **have no trigger** and do not apply. It lives on the
   casual/adults-open side of the consent wall. Valid ONLY with: (a) **no player rosters / no dob** —
   enforced, keep the Event-OS `athlete_name` performance path operator-only; (b) **Apple 1.2
   moderation** — net-new report/flag + takedown/hide (no existing mechanism to inherit); (c) **Apple
   5.1.1(v) reverse path** — an owner-only cancel/delete RPC (clean — no minors' records, so no
   Art-17(3)(b) carve-out); (d) **money informational-only** (Decision #5). (b) and (c) are real
   builds (PR #5), not assertions.

8. **Multi-sport, not football-only — the engine already supports it; the self-serve flow must WIRE it.**
   The Event OS engine is sport-agnostic by design: fixtures store a generic numeric `home_score`/
   `away_score` (any two-sided sport), and `league_config.ref_ui_config` (mig 315:96-101) is a
   sport-configurable scoring UI — its own schema comment gives a **judo** example
   (`{"show_cards":false,"show_subs":false,"score_label":"Points", events:[{"type":"ippon",...}]}`),
   so "Goals/cards/subs" are the *default football skin*, switchable off + relabelled per sport. There is
   also a separate individual-performance mode (`performance_events`: time/distance/height/weight, heats)
   for athletics/sports-day. BUT as scoped the self-serve flow would default everything to football (the
   venue shell defaults `sport='football'` and there was no sport picker). So: **the create wizard
   captures a `sport`** (from the existing discipline pick-list — `disciplineLabels.js`), the create RPC
   sets it on the host venue + the tournament and **applies the matching `ref_ui_config` preset** (a small
   preset table: e.g. basketball/netball → `score_label='Points'`, hide cards; hockey → keep cards, etc.),
   so a non-football organiser sees the right labels. **v1 = the two-sided-score bracket/league sports**
   (football, futsal, basketball, netball, hockey, …) — these work through the generic score + preset with
   no engine change. The **individual-performance/sports-day mode stays operator-only** (it captures
   per-athlete names = individual PII, which would re-open the compliance stack — Decision #7 keeps it out
   of self-serve). A brand-new sport with bespoke scoring events (judo ippon, etc.) is a later preset add,
   not a v1 blocker.

---

## PRE-BUILD ANSWERS — LOCKED 2026-07-07 (operator-confirmed, do NOT re-ask)

Pre-flight re-checked on `main` before locking: migrations **489/490/491 confirmed free**
(highest on main = 488); multi-vertical **PR5/PR6 (club/gym) NOT started** (both still
`status:'soon'`, `createRpc:null`) so no shared-file collision; no tournament self-serve wiring
exists yet. Safe to build.

1. **Sport pick-list (v1)** — a NEW curated code-side list (there is NO existing sport constraint;
   `venues.sport` is free text default `'football'`; `disciplineLabels.js` is the club-discipline
   list = wrong shape). v1 ships only sports that map to a single running two-sided score, each with
   a `ref_ui_config` preset:
   - Football / Futsal / 5-a-side / Hockey → `score_label='Goals'`, cards on, subs on
   - Rugby → `score_label='Points'`, cards on, subs on
   - Basketball / Netball / Volleyball / Handball → `score_label='Points'`, cards off, subs off
   - **Racquet sports (Tennis / Badminton / Squash / Padel / Table Tennis)** → `score_label='Sets'`,
     cards off, subs off. **Scored by RESULT, not live points** — the organiser enters the final set
     score (e.g. "2" v "1") so the bracket advances. NO live 0-15-30-40/deuce state machine — that is
     a bespoke scoring engine, explicitly OUT of scope (different product). Singles = one person
     registers under their own name (still name-only, so compliance wall holds — Decision #7).
   - **Other (custom)** → `score_label='Score'`, cards off, subs off.
   - Deferred, named: cricket (innings/overs don't fit one running score); bespoke-event sports
     (judo ippon etc.) = later preset add, not a v1 blocker.

2. **Personal-host venue marker** — add a dedicated **`venues.is_personal_host boolean DEFAULT false`**
   (indexed), NOT an overloaded `origin` value. Single-purpose, self-documenting; the operator venue
   chooser filters it out. (`origin` already carries `self_serve` from mig 484 — keep the concepts
   separate.)

3. **Cancel semantics (PR #5)** — **soft `cancelled` status** is the primary reverse path (preserves
   audit + referential integrity for registered teams; public page shows "cancelled"). Hard-delete
   reserved only for a zero-registration empty shell. Satisfies Apple 5.1.1(v).

4. **Dark-flag mechanism** — the **registry `status:'soon'→'live'` toggle** (identical to how club/gym
   ship dark today), NOT a `VITE_*` env flag. One-line flip, no Vercel env plumbing.

5. **Abuse cap** — **N = 10** active/draft self-serve tournaments per user.

Deliberately FUTURE (flagged, not v1): "turn your existing squad's fixtures into a cup" contextual
shortcut; the "my tournaments" list (the `created_by_user` column is the seam being built now so it's
a clean later add).

---

## KEY AUDIT FACTS

Load-bearing facts established during scope — do not re-derive.

- **`resolve_venue_caller(p_token text)` Stage 1b** (mig 237:106-122): `WHERE va.user_id = auth.uid()
  AND va.venue_id = p_token` — venue_id-as-token authorises the owner. Stage 1 (`venue_admin_token =
  p_token`) misses (self-serve venues have a NULL master token; venue-ids don't collide with random
  tokens) → falls through to Stage 1b. `role='owner'` passes the `manage_facility OR manage_tournaments`
  cap gate in `_authorise_venue_tournament` (452:517-522) and `venue_create_tournament` (452:572-577).
- **`self_serve_create_venue` (mig 484)** returns `{ok, venue_id, verification_status, origin}` —
  returns the **venue_id** (usable as the Stage-1b token) but NEVER the `venue_admin_token`. Mints the
  `venue_admins(role='owner', status='active')` owner row. Abuse cap = ≤3 pending self-serve venues/user.
- **`tournament_events`** (mig 315:17-37, +326/327/382): MUST populate `venue_id` (NOT NULL), `name`,
  `slug` (UNIQUE, regex `^[a-z0-9][a-z0-9\-]{1,79}$`), `event_date` (NOT NULL). Everything else defaults
  — `status` defaults `'draft'` (CHECK `draft|open|closed|live|completed`), `info` NOT NULL default `{}`,
  fees default `0`/`per_team`, `club_id` NULL. `get_tournament_public` returns `not_found` for `draft`
  (452:68) — organiser must flip to `open` before the share link resolves. **No `cancelled`/`archived`
  status exists** — the reverse path must add one (or hard-delete).
- **Participant side is fully built + reusable club-less:** `tournament_register_team` (anon, mig 384 /
  452:272), `tournament_join_via_invite` (452:352), `tournament_set_team_follow` (452:430), public page
  `get_tournament_public` (452:43). `_club_feature_enabled(NULL,'tournaments')` **fails OPEN**
  (`COALESCE(...,true)`, mig 399) — so a club-less (self-serve) tournament is NOT blocked from
  registration. Registration lands `status='pending'` (organiser approves via `venue_approve_team`).
- **Native run surface ~80% exists** in `apps/inorout/src/mobile/screens/`: `TournamentView.jsx`
  (public page + register card + follow + live standings, 30s poll while live), `OperatorTournaments.jsx`
  (monitor-only today), `RefFixtures.jsx`/`RefMatch.jsx` (ref-token score console in an iframe). Routes
  `/tournament/:slug` (public, signed-out) + `/tournament/join/:code` (auth) already parsed in
  `App.jsx:100-114`.
- **Score reality:** `_advance_tournament_winner` (mig 187) / `_advance_tournament_double_elim` (mig 325)
  are internal SECDEF (`REVOKE … FROM PUBLIC, anon, authenticated`) — callable only from inside another
  SECDEF; triggered today only by `ref_confirm_tournament_match` (325:470-472). `venue_record_result` /
  `club_admin_record_result` are **sports-day performance** (athlete/value), NOT football match scores.
- **Chooser seam:** `apps/inorout/src/onboarding/verticalRegistry.js` (5 cards) + `VerticalChooser.jsx`
  + `index.jsx` (branch on `ob.vertical`) + `hooks/useOnboarding.js`. `CreateVenue.jsx` is the
  self-contained wizard-branch template (owns its own state, calls its wrapper directly, stays OFF the
  casual `useOnboarding` path → casual-regression safety). A tournament card = a registry row +
  `CreateTournament.jsx` sibling branch + `useOnboarding` `vertical==='tournament'` case.
- **Next free migration = 489** (updated 2026-07-07: the Venue Setup Wizard W1–W5 fully MERGED, taking
  485–488). This epic's three migrations are now **489 / 490 / 491** (were 488/489/490 at scope time).
  Re-confirm against `main` before numbering (first-come-on-main).
- **Multi-sport engine (Decision #8):** fixtures use generic numeric `home_score`/`away_score` (any
  two-sided sport); `league_config.ref_ui_config` (mig 315:96-101) makes the scoring UI sport-configurable
  (relabel score, hide cards/subs, custom events — judo example in-schema); `performance_events` is a
  separate individual-sport/sports-day mode (operator-only — captures athlete PII). `venues.sport` +
  `playing_areas.sport_types` already carry sport context. Football is the default skin, not a hard limit.
- **check-live-config:** new `mobile/screens/*.jsx` + `packages/core` wrapper + new RPC = **CLEAR-dark**.
  The ONLY PROTECTED trigger is editing `apps/inorout/src/App.jsx` (ROUTING) — **avoidable**: reuse the
  existing `/tournament/*` + `/hub/*` routes and add the create entry via the `VerticalChooser` registry
  seam, not a new App.jsx route.

---

## ROADMAP — PRs in dependency order

### PR #1 — `self_serve_create_tournament` create RPC (+ hidden personal host) — **tier-3 · CLEAR frontend / PROTECTED-by-gate backend · effort M** 🚦
Goal: de-gated, `authenticated`-only SECDEF RPC that in ONE transaction find-or-creates the hidden
personal host venue (mig-484 shell logic + owner row, marked `is_personal_host`), inserts the
`tournament_events` row, and **auto-creates one default `competitions` row** so teams can register
immediately. Two non-obvious correctness requirements the RPC MUST own (SWEEP findings):
**(i) collision-safe slug** — `tournament_events.slug` is globally UNIQUE and unbounded self-serve
users WILL collide on "sunday-6-a-side", so generate `slugify(name) + '-' + short-random-suffix` and
retry-on-conflict (EV must assert two users creating the same name both succeed); **(ii) insert
`status='open'`, NOT `'draft'`** — because a default competition is auto-created in the same
transaction, the tournament is immediately shareable, and `get_tournament_public` returns `not_found`
for `draft` (so a `draft` insert would make the headline "20-second create → live share URL" a DEAD
link). Derives ownership
from `auth.uid()`; `verification_status='pending'`; anon REVOKEd by name; abuse cap (≤N active/draft
self-serve tournaments/user); canonical `audit_events` + `actor_type='venue_admin'`. Returns
`{ok, tournament_id, slug, venue_id}` (venue_id = the Stage-1b management token; **never** the master
token). Additive column **`tournament_events.created_by_user uuid NOT NULL` (indexed)** — promoted from
"optional" to load-bearing (FUTURE-PROOF): it makes ownership a first-class queryable attribute
independent of the venue-shell hack, and is the escape hatch for the Stage-1b/venue coupling (enables a
later "my tournaments" list, co-organiser/transfer, clean per-user caps, and migrating off the
hidden-venue kludge if `venue_id` ever goes nullable — a single backfill). Plus optional `origin` + the
`venues.is_personal_host` marker. Migration **489** (`.sql` + `_down.sql`, HR#11).
- Gates: SQL drafted → 🚦 **migration-apply sign-off (human)** → rpc-security-sweep (SECDEF, search_path
  pinned, single overload, anon REVOKEd, `authenticated`-only, valid `actor_type`) → **ephemeral-verify**
  (fresh no-venue user → create → assert one tournament + one owner `venue_admins` row + default
  competition + `verification_status='pending'` + `status='open'`; **two users creating the same tournament
  name both succeed** (slug-collision safety); a **bystander** passing the owner's venue_id is rejected;
  **no token leak**; cap enforced; leak-check `_e2e_%`=0) → rpc-consumers (HR#14) → build · hygiene.
- 🚦 Gates: migration apply · self-ownership/RLS review.
- Done-check: EV proves a brand-new user with zero venues ends up owning exactly one new tournament
  (owner row + default comp + audit) while a bystander is rejected — verified against live DB with
  rollback, re-run post-apply.

### PR #2 — 6th chooser card + native create wizard — **tier-1 · CLEAR (dark) · effort M**
Goal: add a `tournament` row to `verticalRegistry.js` (`surface:'native'`, `createRpc:
'self_serve_create_tournament'`, distinct icon — Trophy is taken by competitive), a self-contained
`CreateTournament.jsx` step (name, **sport** [see Decision #8], optional date, format: knockout / round-robin / groups→KO) cloned
from `steps/CreateVenue.jsx`, the `vertical==='tournament'` case in `useOnboarding.js` + `index.jsx`, the
`selfServeCreateTournament` wrapper in `packages/core/storage/supabase.js` + barrel export, and a
redirect on success to the share/manage screen. **Ships behind the dark flag.** No App.jsx route edit.
- Gates: build · hygiene (CSS-vars, thin Phosphor) · lint · casual-regression (expect no-op) · Playwright
  chooser-routing smoke · 🚦 real-iPhone native walk (HR#13).
- 🚦 Gate: real-device native walk.
- Done-check: signed-in user taps "Tournament" → creates one → lands on a manage/share screen; casual +
  competitive flows byte-identical.

### PR #3 — Share + public registration loop + the acquisition CTA (**MVP completes here**) — **tier-1 · CLEAR (dark) · effort S**
Goal: the organiser share-link surface (share sheet with a **QR code** they flash pitch-side — reuse the
reception-display QR-in-CTA pattern) + confirm the existing public `TournamentView.jsx` +
`tournament_register_team` work for a club-less self-serve tournament (verified: `_club_feature_enabled`
fails open, so no RPC fix needed). Plus the SWEEP acquisition wedge: **an "install to follow your team
live" CTA on the public `/tournament/:slug` page** — the strategic payload, since every spectator/player
who taps the shared live-results link is a top-of-funnel install at peak emotional investment (see
OPPORTUNITY). Pure frontend, no migration (keeps the MVP at exactly one tier-3, PR #1). Registrant-side
undo (`tournament_withdraw_team`) is deferred to PR #5 with the other reverse paths; until then the
organiser removes a team via the reused `venue_reject_team`. Manage screen shows an honest "scoring
coming soon" state until PR #4 (Decision #12 — no dead end).
- Gates: build · hygiene · Playwright (create → open public link on a 2nd context → register a team →
  appears pending).
- Done-check: a second device registers a team into the self-created tournament with no operator token,
  and it shows as pending to the organiser.

### PR #4 — Native "Run tournament" management UI + `self_serve_enter_result` — **tier-3 (net-new write RPC + migration 490) · CLEAR (dark) · effort L** 🚦
Goal: the organiser run screens in `apps/inorout` (re-skin of the `OperatorTournaments`/`SessionsScreen`
tournament logic, never saying "venue"): open registration, approve/reject pending teams, add
competitions, generate schedule, seed knockout, enter scores, live standings/bracket — **all reusing the
existing `venue_*` wrappers with venue_id-as-token (Stage 1b), zero twins.** The ONE new RPC:
`self_serve_enter_result` (mig **490**) — sets the fixture final score AND `PERFORM`s the advance engine,
authorised via a small `auth.uid()` check that the caller owns the tournament's venue (or reuse
venue_id-as-token through `_authorise_venue_tournament`). Two SWEEP wow-adds (reuse existing infra —
HR#9 audit + HR#10 publisher⇄subscriber parity apply): **participant notifications** (a captain gets a
push/in-app confirm on team-approval, and "your match is next" via the existing member-push + follow
list — closes the post-register dead-air), and a shareable **"WINNER" card** on completion (the players'
wow AND the content-wheel feedstock — see OPPORTUNITY). If push proves heavier than v1 allows, ship the
on-screen confirms and defer push explicitly (not silently).
- Gates: build · hygiene · lint · casual-regression · 🚦 **migration-apply (human)** for mig 490 ·
  **ephemeral-verify** (full lifecycle as a self-serve owner, no token: create→register→approve→schedule
  →score→**knockout advances**→standings; bystander rejected; rollback; leak-check 0) · rpc-security-sweep
  · Playwright manage-flow smoke · 🚦 real-iPhone native walk (score entry + advance on-device).
- 🚦 Gates: migration apply (490) · real-device walk.
- Done-check: on a real iPhone the organiser approves a team, generates a schedule, enters a score, and
  the standings + knockout bracket advance — verified end-to-end.

### PR #5 — Compliance: reverse path + moderation (**gates flipping the flag ON**) — **tier-3 · CLEAR frontend / PROTECTED backend · effort M** 🚦
Goal: the two compliance builds that let the create card go live to the public. (a) **Reverse path**
(Apple 5.1.1(v)): `self_serve_cancel_tournament` (owner-only, `auth.uid()`) that sets a new `cancelled`
status (or hard-deletes the shell + child competitions/teams/fixtures), audited — clean, no safeguarding
carve-out. (b) **Apple 1.2 moderation:** a report/flag affordance on the public `/tournament/:slug` page
+ a server-side takedown/hide (a superadmin/owner ability to hide a tournament; reuse `venue_reject_team`
for offensive team names). (c) **Participant-side undo** (SWEEP): a tiny `tournament_withdraw_team`
RPC — a registered captain (an identifiable person via `auth.uid()`) withdraws their own team. Migration
**491** (statuses/flags + withdraw). After this + the real-device walk, flip the registry flag `soon→live`.
- Gates: SQL drafted → 🚦 **migration-apply (human)** → rpc-security-sweep · ephemeral-verify (owner
  cancels own tournament; bystander cannot; leak-check 0) · build · hygiene · Playwright (create → cancel →
  gone from public) · 🚦 **UGC-moderation review (human)** · 🚦 **flag-flip sign-off** (go-live to public).
- 🚦 Gates: migration apply (491) · moderation review · flag-flip-to-live sign-off · real-device walk.
- Done-check: an owner cancels their tournament in-app and it vanishes from the public page; a reported
  tournament/team name can be hidden by an admin — real reverse path + real takedown, then the flag flips.

---

## 🚦 GATES the loop must stop at

- **Migration applies:** PR #1 (489), PR #4 (490), PR #5 (491) — SQL drafted + ephemeral-verified, then
  human applies. Never auto-apply.
- **PR #1 self-ownership/RLS review** — the de-gated create + the venue_id-as-token reuse pattern.
- **Every PR: Hard-Rule-13 real-iPhone native walk** (all touch create/routing).
- **casual-regression on every PR touching `apps/inorout/src`.**
- **PR #5 compliance gates** — UGC-moderation review + the flag-flip-to-live sign-off (the create card
  stays DARK in prod until these clear).
- **Cloud-session collision (updated 2026-07-07):** the **Venue Setup Wizard is now fully MERGED**
  (W1–W5, PR #313) — that collision is CLEARED. The remaining risk is the multi-vertical **PR5/PR6**
  (club/gym), which edit the SAME files (`verticalRegistry.js`, `onboarding/hooks/useOnboarding.js`,
  `packages/core/storage/supabase.js`, shared docs) — but they are **BLOCKED/unbuilt** (compliance stack),
  so they are not an *open* PR right now. Practically: this epic can proceed, but **re-check on `main`**
  that PR5/PR6 haven't started, and if they're in flight, land them first or branch off their head
  (CLAUDE.md rule 1/4). Migration numbers **489/490/491** (re-confirm on `main` — venue wizard took 485–488).

## DONE =

The `/create` chooser has a 6th "Tournament" card; a consumer can create a tournament in ~20 seconds,
share a public results link, have teams self-register, approve them, generate fixtures, enter scores
pitch-side, watch standings + the knockout bracket advance live, and crown a winner — **all from their
phone, owning exactly the tournament they created**, every write audited, casual flow byte-identical,
entry-fees informational-only, an in-app cancel/delete + a report/takedown path in place, and the whole
flow walked on a real iPhone before the flag flips live. **MVP = PR #1–#3** (create + share + register,
DARK behind the flag); run/manage (PR #4) + compliance (PR #5) gate going live to the public.

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

- **MISSED — the correctness bug in the headline, plus four edges between lenses.** (1) The biggest:
  moving create from a handful of curated operators to *unbounded untrusted consumers* against a
  globally-UNIQUE `slug` means two mates both making "Sunday 6-a-side" → the second throws a raw
  unique-violation. Folded into PR #1 (collision-safe slug + EV assertion). (2) The
  **single-organiser SPOF** — the whole tournament hangs off one `auth.uid()`; if the organiser's phone
  dies at 11am on match day, nobody can approve teams or score. Venues have multi-row `venue_admins`,
  but the self-serve mint gives exactly one owner. **Deferred, named:** co-organiser/ownership-transfer
  is out of v1 scope but the promoted-to-load-bearing `created_by_user` column (see FUTURE-PROOF) is the
  seam that makes it a clean later add. (3) A **registered team's own reverse path** — folded into PR #3
  (`tournament_withdraw_team`). (4) The **abandoned half-run tournament** parks at `status='live'`
  forever, leaving a stale bracket on a branded URL — recommend a later auto-complete/expiry sweep
  (out of v1, flagged). And the audience nobody named until now: the **spectator/player** (not the
  captain) — the person the whole growth loop below depends on — whom registration reaches only via a
  team *name*. PR #3's install CTA is what gives them a relationship to the app.

- **OPPORTUNITY — the public live-results link IS the platform's strongest acquisition wedge, not a
  feature.** STRATEGY.md frames casual squads as "acquisition, never revenue"; a 24-team tournament is
  ~200 players + spectators who each tap a polished live bracket on *your* app at peak emotional
  investment (did we win?), for free, per event — and it fans out to **strangers**, not just the
  organiser's contacts, so it's a materially higher-velocity install engine than squad invites. It plugs
  straight into three backlog items this now makes cheap: the **content wheel** (a completed bracket +
  WINNER card is auto-generated short-form with a built-in install CTA), the just-shipped
  **competitive-team/league vertical** (a recurring cup is the natural on-ramp to a standing league — a
  "graduate this cup into a league" upsell), and the **client-onboarding import tool** (a tournament with
  N registered teams is a pre-built roster a venue could adopt). The cheapest leak→loop conversion — the
  "install to follow your team live" CTA on `/tournament/:slug` — is pulled forward into PR #3 so the
  distribution side (the actual moat) isn't an afterthought.

- **FUTURE-PROOF — promote `tournament_events.created_by_user` from optional to `NOT NULL` + indexed.**
  Of every choice here, this is the one specific lever that buys the most exit optionality for the least
  cost today. It expresses ownership as a first-class, queryable attribute *independent of the
  venue-shell hack* — which is exactly the escape hatch for the debt Decision #3 knowingly takes on
  (ownership-as-venue_id-through-Stage-1b permanently couples tournament ownership to `venue_admins`).
  With it you can later add co-organiser/transfer (the SPOF fix), render "my tournaments" without joining
  through the personal-host venue, enforce per-user caps cleanly, feed the "my stuff" hub + the Pillar-D
  AI agent, and — if `venue_id` ever goes nullable — migrate off the hidden-venue kludge with one
  backfill. `is_personal_host` is a good-but-narrow marker; Stage-1b reuse is the biggest *scope* win but
  it's a lock-in. `created_by_user`, made load-bearing, is the cheapest flex. (Folded into PR #1.)

- **WOW — per audience, with the headline fixed.** *Organiser:* create in ~20s → a **live public
  results URL + QR** they flash pitch-side — but ONLY because PR #1 now inserts `status='open'` (a
  `draft` insert made this a dead link — the single most important SWEEP fix). Then enter a score on the
  phone and watch the table + bracket recompute live (they're the referee now). *Team captains:* register
  → an immediate "you're in, awaiting approval" confirm + a push on approval (PR #4) — closing the
  post-register dead-air that would otherwise kill the moment. *Players/spectators:* a no-login public
  page with live standings auto-refreshing every 30s while live, one-tap ★ follow-your-team, and a
  shareable **WINNER card** at completion (PR #4). *Existing casual user:* a 6th chooser card is
  low-wow on its own (the chooser is now crowded) — the cheaper lift is contextual surfacing ("turn your
  squad's fixtures into a cup") to squads that already exist; this audience is a discovery surface, not
  an audible-wow one, and that's fine.

---

## Related

- `SELF_SERVE_MULTI_VERTICAL_HANDOFF.md` — the sibling epic (chooser + creator-becomes-owner + `self_serve_create_venue` mig 484) this reuses and follows.
- `rls_migrations/452_modular_epic_d1_venue_tournament_create.sql` — the venue_* tournament management suite (reused via Stage 1b) + the create template.
- `rls_migrations/484_self_serve_create_venue.sql` — the de-gated create + hidden-owner-venue pattern PR #1 clones.
- `rls_migrations/237_venue_staff_logins_core.sql` — `resolve_venue_caller` Stage 1b (the de-tokenising unlock).
- Event OS: `rls_migrations/314–328` (engine), `385` (referees), `439` (mobile tournament index + follow).
- MEMORY: `project_venue_operator_tournaments`, `project_event_os`, `project_self_serve_multi_vertical`, `reference_native_app_only_no_pwa`.
