# Player of the Season — Epic Manifest

*Scoped 2026-06-30 via `/scope`. Audit + plan only — no code yet.*
*Runs as an UNMANNED epic loop: `/loop /dev-loop PLAYER_OF_SEASON_HANDOFF.md`.*
*Each `### PR #n` = one dev-loop cycle → one PR. The loop stops at every gate marked 🚦*
*(human / migration-apply). PR-only; never pushes main; never applies a migration or*
*touches RLS/auth without explicit sign-off.*
*Plan gate: batched.  Merge mode: per-phase.*

---

## WHAT IT IS (plain English)

At the end of a season, a team crowns its **Player of the Season** — the player who won
**Player of the Match (POTM) most often** across the season's games. The admin taps
"Crown your Player of the Season", the app pre-fills the season's POTM leader (admin can
override or break a tie), and locks it. Every player then sees a **gold trophy reveal**
and a permanent badge on the winner's profile. The winner can tap **Share** to post a
free "Season Wrapped" card (their POTM count + key stats) — the acquisition hook and the
first seed of the future IO-Wrapped deck.

The whole thing is built on the POTM ritual the team **already does every week** — it's
the season-long capstone of votes they've already cast, not a new voting system. It is
**casual-team-first**; clubs, gym, and leagues extend the same record later.

**One new idea only:** a season award is a *frozen, remembered fact* (a Roll of Honour),
not a live leaderboard. StatsView already shows "who's leading on POTMs this year" — this
feature is the **crowning moment + the permanent record + the reveal + the share**.

## LOCKED DECISIONS (assumptions — confirm at the human review)

1. **Mechanic = cumulative POTM-match wins over the season; admin CONFIRMS / overrides.**
   The app auto-suggests the player with the most POTM wins in the window; the admin
   confirms, overrides to any squad member, or declares "no award". **A dedicated
   end-of-season re-vote is explicitly DEFERRED to Phase 2** (it's a second tier-3 epic;
   the per-match POTM tally is already a strong, earned season signal, and "reuse over new
   systems" wins for v1). *(This is THE product fork — see review.)*
   **Accepted v1 trade-off (choose eyes-open):** cumulative POTM *count* rewards **volume
   over consistency** — a player with 5 wins from 25 games beats one with 4 wins from 6,
   and the `played ≥ 3` floor (decision 5) only screens out one-game wonders, it does not
   add a rate/quality dimension. The admin override (and the Phase-2 ranked re-vote) are
   the release valves. If "best per-game" matters more than "most over the year", that's a
   signal to pull the Phase-2 vote forward.
2. **Season = an admin-set window at crowning time, stored ON the award row** (a free-text
   `season_label` like "2025/26" + `period_start`/`period_end` dates). **Default window =
   1 Aug → 31 Jul** (the English grassroots football season; the admin can edit both
   bounds before locking). This default must be coded explicitly — it is the single input
   that decides the winner, so don't leave "a sensible football season" to the builder.
   **No separate `team_seasons` table in v1** — casual teams have no season entity, and
   this avoids both the wrong Jan-1 calendar-year hack *and* a whole new CRUD surface.
   (A real season table is a clean later add if multi-season management is wanted.)
3. **The award is a FROZEN, append-only record** (a "Roll of Honour" that survives later
   match edits and persists across years). Modelled on the `member_grades` award-ledger
   (mig 357), **polymorphic** (`award_type` / `scope_type` / `scope_id`) so club / gym /
   league / secondary awards (Golden Boot, Most Improved) all extend it **additively** —
   no new table per future award.
4. **Ties → surface joint leaders; admin breaks the tie** (reuse the existing
   `POTMTiebreakModal` arm-then-confirm + `was_admin_decided` pattern). The
   "No POTM this week" affordance becomes **"No award this season"**.
5. **Minimum-games eligibility floor = reuse StatsView's `played ≥ 3`** so a one-game
   wonder can't win on a couple of lucky POTMs.
6. **Guests excluded** (inherited — a guest can never be POTM; a defensive `is_guest=false`
   filter is still added because the flag is *current* and drifts on promote/demote).
7. **v1 = CASUAL teams only.** Club / youth / gym / league get the award later via the
   polymorphic ledger, **inheriting the `get_club_public` youth-suppression gate**.
   **Known v1 limitation (state it plainly):** casual `players` rows carry **no
   `member_profiles.dob`**, so v1 applies **no age check** — winner names show in-app and
   on the winner-shared card on the assumption casual = adult Sunday-league. **Any casual
   team that is actually a youth side is out-of-scope risk until PR #7** wires the
   suppression gate. v1 keeps the blast radius small by being team-internal + winner-
   initiated share only (no reception-display / public-club-page surface).
8. **Display & consent:** team-internal display (token/auth-gated) shows the winner's full
   name to the squad — **parity with POTM, no consent gate**. The shareable card is
   **winner-initiated** (implicit consent — you're sharing your own award) and **free,
   never paywalled** (Strava's anti-pattern). Casual = adult Sunday-league context →
   names shown; the youth/club extension inherits the U18 public-suppression gate.
9. **UK-GDPR delete-cascade is mandatory and lands in the SAME migration.** `season_awards`
   stores `recipient_id` + a `recipient_name_snapshot`; casual `players` are
   **anonymised, not deleted**, so a cascade off `players` won't fire — an **explicit
   purge/scrub line is added to BOTH `delete_my_account(p_token)` (mig 068) and
   `delete_my_account_auth()` (mig 370)**.
10. **Whole feature ships DARK** — every surface self-hides until an award row exists
    (the `PerMatchFitnessCard` "`return null` when empty" pattern). The entire feature is
    **ship-safety CLEAR except PR #1** (the ledger migration + write RPC = TIER-3),
    so it's App-Store-freeze-safe.

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **Next free migration = 457** (highest existing = `456_match_health_routes_*`; PR #1
  needs a matching `457_*_down.sql`). First-come on `main` — confirm before applying.
- **No season concept exists for casual teams.** The `seasons` table is **league-only**
  (FK `league_id`; SCHEMA.md L529); `matches` has **no `season_id`**, only
  **`matches.match_date`** — an **ISO date string, NOT a timestamptz** (SCHEMA.md L158),
  indexed `idx_matches_team_date (team_id, match_date)`. A casual season = a **date window
  over `match_date`** (lexicographic `>=`/`<=` on `YYYY-MM-DD` = chronological). There is
  **no `actual_kickoff_at` on `matches`** (that's the league `fixtures` clock).
- **POTM source of truth (3 stores):** `matches.motm` (player_id, **text**, SCHEMA.md
  L1029), `player_match.was_motm` (boolean, SCHEMA.md L302), `players.motm` (**all-time**
  counter — **DO NOT reuse for the season tally**; it accumulates across all time). The
  season tally must **recompute** from `matches.motm` (or `was_motm`) filtered by
  `match_date`, exactly as the existing per-match tally recomputes. `player_match.match_id`
  is **text not uuid** — never cast.
- **Guests already excluded at source** (mig 219: `submit_potm_vote` / `get_potm_tally` /
  `admin_close_potm_voting` all reject guest nominees) → a tally on `matches.motm` inherits
  it; add a defensive `is_guest=false` guard (the flag is *current*, drifts on
  promotion/demotion which reuses the same persistent `players` row).
- **Reuse pattern for the crowned record = `member_grades` (mig 357)** — append-only
  ledger (`awarded_at` / `awarded_by` / `awarded_seq` GENERATED IDENTITY tie-break; never
  UPDATE/DELETE a past award). **NOT `club_team_potm`** (single-row UPSERT, no history).
  ⚠️ **Correction:** mig 357 has **no** soft-delete column (its `active` flag is on
  `grading_schemes`, not the award ledger). The `voided boolean` on `season_awards` below
  is a **NEW** column this feature adds — borrow 357's append-only *shape*, not a voided
  pattern (357 doesn't have one).
- **`club_team_potm` (mig 449) is ORTHOGONAL — do not reuse.** It's a manager-pick,
  free-text Player-of-the-Month for **club_teams** (uuid PK → `club_teams`), on a different
  auth spine (`auth.uid()` → `club_team_managers`, not `admin_token`), public-web facing
  with a youth-suppression gate. Casual PoS is vote-derived/computed, player-FK'd,
  admin-token-auth'd, squad-private. Borrow only the *concept* of the public youth gate.
- **Gold is already tokenised** (`apps/inorout/src/theme/tokens.css`): `--gold #E8A020`,
  `--gold2`, `--goldb`, podium `--silver`/`--bronze` + dark row tints. **No new hex.**
  Optional new **`--gold-glow` shadow token** to avoid inlining a 4th gold RGBA literal.
  Award glyph = Phosphor **`Trophy` `weight="thin"` `color="var(--gold)"`** (the sanctioned
  SVG-colour-via-prop pattern), sized **up** from the per-match POTM to read "bigger".
- **Frontend reuse (the spine):** `StatsView.jsx` already computes the season-period POTM
  leaderboard (`topMotm`, period `month|season|all`) — this is where the admin "Crown" CTA
  and the pinned winner hero live. Reveal animation = `POTMVotingModal.jsx` `isResult`
  block (Framer spring-in Trophy + Bebas name). Arm-then-confirm + tie-break +
  "No POTM this week" = `POTMTiebreakModal.jsx`. Self-hide-DARK stat-card shell =
  `PerMatchFitnessCard.jsx`. Share-card pattern + `potmOfWins` stat = `MyIOView.jsx`.
- **Share path is CLEAR (no native plugin):** `navigator.share` (Web Share API — already
  live in `HistoryView.jsx`, `TournamentScreen.jsx`) + `canvas.toBlob` (in
  `clubSettingsHelpers.js`). **No `html2canvas` in repo** → the card is a hand-drawn
  `<canvas>` render or text-share. **Never add `@capacitor/share`** (would flip to TIER-3
  PROTECTED + re-arm the App-Store freeze).
- **Realtime:** the crown write calls `notify_team_change(team_id, 'season_potm_announced')`
  → App.jsx's **generic broadcast subscriber** (`App.jsx` ~L1107, re-fetches on any
  broadcast) already handles it → **no new subscriber needed** (verify topic + event name
  + private flag match, HR#10; the new reason string isn't in the §11.2 locked list —
  flag it like the existing OI-62/63 items).
- **Security footgun (`feedback_default_privileges_revoke`):** standing
  `ALTER DEFAULT PRIVILEGES` auto-grant **anon AND authenticated** on every new `public`
  table; `REVOKE … FROM PUBLIC` does NOT undo it. New table must
  `REVOKE ALL ON TABLE season_awards FROM anon, authenticated;` (named roles). Mig 449
  does this correctly — copy it. Pin `search_path` in every function; `pg_notify('pgrst',
  'reload schema')` at end of migration.
- **Test discipline:** real team via `admin_token`, **never `team_demo`** (HR#6).
  Ephemeral-verify the write RPC against an `_e2e_`-prefixed throwaway fixture,
  leak-check = 0 (HR#15). Write RPC INSERTs `audit_events` (HR#9). Any returned field a JS
  consumer reads → mapper updated same commit (HR#12). Record future consumers in RPCS.md
  Notes (HR#14): reception display, IO-Wrapped, watchOS, club public page, Gaffer briefings.

---

## ROADMAP — PRs in dependency order (v1)

### PR #1 — Foundation: `season_awards` ledger + write/read RPCs (mig 457)  🚦 TIER-3 (migration apply + RLS + new write RPC = sign-off)
Loop drafts the `.sql` (+ `_down.sql`), runs ephemeral-verify against the live DB with
rollback, then **STOPS at the apply sign-off gate** (does NOT apply).
- NEW table `season_awards` (append-only ledger, modelled on `member_grades`): `id uuid
  pk`, `award_type text NOT NULL` ('player_of_season' v1), `scope_type text NOT NULL`
  ('casual_team' v1), `scope_id text NOT NULL` (`team_id`, text holds future uuid/text
  PKs), `season_label text`, `period_start date`, `period_end date`, `recipient_kind text`
  ('player' v1), `recipient_id text` (→`players(id)`), `recipient_name_snapshot text`,
  `potm_wins int` (frozen count at crowning), `was_admin_decided boolean DEFAULT false`,
  `awarded_by text`, `awarded_by_actor_type text`, `awarded_at timestamptz DEFAULT now()`,
  `awarded_seq bigint GENERATED ALWAYS AS IDENTITY`, `note text`, `voided boolean DEFAULT
  false` (NEW soft-delete — re-crowning voids the prior row, never UPDATEs it). RLS-on,
  **NO policies**, `REVOKE ALL … FROM anon, authenticated` (named roles).
- `set_season_award(p_admin_token, p_season_label, p_period_start date, p_period_end date,
  p_winner_id text /* NULL = no award */, p_was_admin_decided boolean)` — SECURITY DEFINER,
  `search_path` pinned, derive `team_id` from `admin_token` (use `resolve_admin_caller`
  for VC/venue parity), recompute + **freeze** the winner's POTM-win count, reject a guest
  winner, INSERT `audit_events` ('season_potm_announced'), `notify_team_change`. Single
  overload; `REVOKE … FROM PUBLIC, anon; GRANT EXECUTE TO authenticated`.
- `get_team_season_awards(p_admin_token /* or p_player_token */)` read (STABLE SECDEF) →
  returns an **array** of award objects `{award_type, season_label, period_start,
  period_end, recipient_id, recipient_name, potm_wins, was_admin_decided, awarded_at}` so
  multi-award seasons + history fit with no later shape change.
- `get_season_potm_standings(p_token, p_period_start, p_period_end)` read → the candidate
  leaderboard (counts only, no voter identity) that feeds the Crown pre-fill, applying the
  `played ≥ 3` floor + guest exclusion.
- **GDPR cascade (same migration):** add explicit `season_awards` scrub to BOTH
  `delete_my_account(p_token)` (mig 068) and `delete_my_account_auth()` (mig 370).
- JS wrappers (`setSeasonAward`, `getTeamSeasonAwards`, `getSeasonPotmStandings`) in
  `packages/core/storage/supabase.js` + barrel; record future consumers in RPCS.md (HR#14).
- Gates: rpc-security-sweep (SECDEF, anon-revoked, search_path, single overload),
  ephemeral-verify (assert: crown stores + freezes count, anon can't write, guest winner
  rejected, "no award" path, account-delete purges the row, audit row written, leak-check
  = 0), `node --check`, build, casual-regression (touches `packages/core`).
- Done-check: on an `_e2e_` fixture an admin crowns a winner → row stored with frozen
  `potm_wins`; anon write rejected; account-delete purges it; leak-check = 0.

### PR #2 — Admin "Crown the Season" UI (TIER-2, CLEAR)
- On `StatsView.jsx` season view (admin only): a "Crown your Player of the Season →" CTA
  under the existing POTM leaderboard → `SeasonAwardModal` (clones `POTMTiebreakModal`
  arm-then-confirm). Pre-fills `get_season_potm_standings[0]`, shows `season_label` +
  from/to inputs (football-season default), lets the admin override to any squad member,
  surfaces **joint leaders** on a tie, and offers **"No award this season"**. Calls
  `setSeasonAward`.
- **Crowning is a one-shot, irreversible-feeling write** → per CONVENTIONS: `isSavingRef =
  useRef(false)` double-fire guard on the Lock-In button, optimistic UI with revert-on-
  error (the modal shows the crowned state immediately, reverts + toasts if the RPC fails).
- Gates: hygiene (7/7), `node --check`, build, casual-regression, Playwright (admin crowns;
  winner persists; a 2-way tie shows joint leaders, NOT a `squad[0]` fallthrough — HR#12
  latent-bug class).
- Done-check: admin crowns on a seeded team → award persists and renders; tie path works.

### PR #3 — Reveal + persistent badge, ships DARK (TIER-2, CLEAR)
- Reuse `POTMVotingModal.jsx` `isResult` animation, scaled up, copy "PLAYER OF THE SEASON".
  Persistent gold badge on `PlayerProfile.jsx` + `MyIOView.jsx` next to the POTM tile, and
  a pinned gold winner hero on `StatsView.jsx` season view. **Self-hides DARK** until an
  award row exists (`PerMatchFitnessCard` pattern). Reveal pushes live via the existing
  broadcast subscriber (wired in PR #1; no new subscriber).
- Gates: hygiene, `node --check`, build, casual-regression, Playwright (winner sees reveal;
  squad sees badge; **no award → renders nothing**).
- Done-check: with a seeded award the reveal + badge show; with none, every surface is empty.

### PR #4 — "Season Wrapped" shareable card (TIER-2, CLEAR)
- Winner-initiated `SeasonAwardCard` — hand-drawn `<canvas>` behind `navigator.share` (Web
  Share API; **NO `@capacitor/share`**), with `navigator.canShare({files})` feature-detect
  and a **text-share fallback**. Shows name, season label, POTM count, goals, win %, games,
  reliability. **Free, never paywalled** (Strava's paywalled-Wrapped is the anti-pattern).
  Seeds the future IO-Wrapped deck.
- ⚠️ **iOS gotcha (cited, build-this-in — do NOT discover it at the device gate):**
  `canvas.toBlob()` is **async**, and iOS Safari **expires the user-activation gesture**
  before the blob resolves → `navigator.share({files})` silently fails on a home-screen
  PWA install. **Workaround: build the File synchronously inside the tap handler** — use
  `canvas.toDataURL()` → manual `Blob` conversion (no `await` before `share()`), or
  pre-render the blob *before* the tap and pass it in. Sources:
  [MagicBell — PWA iOS limitations 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide),
  [Lee Martin — sharing files from iOS Safari Web Share](https://blog.bitsrc.io/sharing-files-from-ios-15-safari-to-apps-using-web-share-c0e98f6a4971).
- Gates: hygiene, `node --check`, build, casual-regression. 🚦 **real-device share-sheet
  walk owed** (HR#13 — iOS share sheet + the user-activation timing can't be seen by
  build/Playwright; test the file-share AND the text fallback on a home-screen install).
- Done-check: tapping Share produces a card image (or, on file-share failure, text) in the
  iOS share sheet on a home-screen install.

---

## 🚦 GATES THE LOOP MUST STOP AT

- **G1 — Migration 457 apply** (after PR #1 EV passes): operator reviews + applies. New
  table + RLS + new write RPC + edits to two account-deletion RPCs → never auto-applied.
- **G2 — Per-PR intent / merge** (per-phase merge mode): each PR stops for sign-off before
  merge (merge = live web-bundle deploy).
- **G3 — Real-device share-sheet walk (PR #4, HR#13):** tap Share from a home-screen
  install; confirm the card reaches the iOS share sheet. (Build/Playwright can't see it.)
- Device eyeball of the reveal + badge on a real iPhone install (PRs #2–#3) is owed before
  the feature is declared done.

## DONE = v1 (casual Player of the Season)
PR #1–#4 merged (PR #1 applied at G1); an admin can crown a season winner from the POTM
leaderboard; every player sees the gold reveal + the winner's permanent badge; the winner
can share a free Season Wrapped card; every surface self-hides until an award exists; the
real-device walks (G3 + reveal eyeball) signed off; `season_awards` rows purge on account
deletion.

---

## PHASE 2 — DEFERRED (re-scope before building; NOT part of this loop)
- **PR #5 — Dedicated end-of-season ranked vote (TIER-3).** The best-practice "wow"
  upgrade: a 3-2-1 ranked ballot seeded by the POTM standings, mirroring migs 011/016/219/
  242 — new `season_potm_votes` table (RLS-on, zero policies, `UNIQUE(award_id, voter_id)`,
  write-once, voter_id never exposed), open/cast/close lifecycle RPCs, self-vote blocked,
  one-vote-per-member (one-per-family for guardians), pre-declared tie-break, audit_events.
  Open the vote on the **final fixture while it's hot**, short window + push reminders
  (avoid dead-of-summer turnout collapse).
- **PR #6 — Push announcement (TIER-3).** New `cronType: 'seasonPotmAnnounce'` branch in
  `api/notify.js` reusing existing web VAPID + native APNS/FCM transports +
  `register_push_subscription` opt-ins (CLEAR plumbing; tier-3 for the write+audit+native
  send path). Dedup via `notification_log`.
- **PR #7 — Club / youth / gym / league extension + secondary awards.** New
  `(award_type, scope_type)` pairs on the same `season_awards` ledger (Golden Boot, Most
  Improved, club Player-of-the-Season). **Public surfaces (reception display, club page,
  exported card) MUST flow through the `get_club_public` youth-suppression gate** — U18 /
  unknown-DOB suppressed; no DOB/photo/contact leaked. (Casual `players` have no
  `member_profiles.dob` — confirm the casual public path treats adult-context names as
  shown, vs the youth fail-safe.)

## Related
- `rls_migrations/016_rpcs_potm.sql`, `011_rpcs_token_writes.sql`, `219_potm_excludes_guests.sql`,
  `242_potm_tally_public.sql` — the POTM voting + tally spine this builds on.
- `rls_migrations/357_*` (`member_grades`) — the append-only award-ledger template.
- `rls_migrations/449_modular_club_page_modules.sql` — `club_team_potm` + `get_club_public`
  youth-suppression gate (orthogonal; the public-safety precedent for Phase 2).
- `apps/inorout/src/views/StatsView.jsx`, `POTMVotingModal.jsx`,
  `AdminView/POTMTiebreakModal.jsx`, `PerMatchFitnessCard.jsx`, `MyIOView.jsx` — reuse spine.
- `FEATURES.md` L2659 "IO Wrapped — end-of-season shareable card" — PR #4 seeds it.
- `DECISIONS.md` L4139 "Awards Night" club event — the Phase-2 club reveal surface.
