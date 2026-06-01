# In or Out — Key Decisions Log
*Last updated: May 29 2026 (session 59 — Phase 9: Twilio transport core unwired; league reminder crons are competitive-only, loop the fixtures table)*

Architectural, product, and design decisions that should inform future work.
Read this before building new features to avoid re-litigating settled questions.

---

## Revenue joins the Health Score as a 4th axis = collection-rate, additive (session 64, HQ-I Phase 2 / Payments V4)

The Cycle 4 health score (3 axes) explicitly deferred revenue "until data exists." The Payments
Ledger (V1–V3) now accrues that data, so `_hq_health_score` (mig 182) gains a **revenue axis**.
Settled calls:

- **Axis = collection-rate %** (collected / owed, non-refunded charges), NOT revenue volume.
  Volume isn't comparable across venues and isn't a *health* signal; collection discipline is
  (it's the "leakage" framing — money owed but not collected). Mirrors `venue_get_charges` so HQ
  agrees with the apps/venue Payments screen to the penny.
- **Weight 0.30**, equal to utilisation & completion; **operations stays the single heaviest at
  0.40**. (Operator chose 0.30 over 0.20/0.40.)
- **Purely additive.** A venue with no charges (every production venue today) has owed = 0 → the
  revenue axis is NULL → dropped and the remaining axes renormalise *exactly* as before. No
  production score moves until real ledger data exists. Honours "never invent a number."
- **All-time, not range-filtered** for health (matches the app's "reliability is always all-time"
  convention). The analytics `revenue` card *is* optionally range-filtered (by charge created_at).
- Hard-red overrides (critical incident, past_due/cancelled, expired trial) still take precedence
  over the score. A `revenue` top_reason ("Collecting X% of fees owed") fires when it's weakest.

Also closed a latent gap: mig-179's commit claimed it wired health_score/reason into
VenueHealthGrid but only touched SQL — the score was invisible. V4 actually wires it. See
[[project_hq_intelligence]] and FEATURES.md.

## Venue Health Score is a transparent /100 across three axes (session 63, HQ-I Phase 1 Cycle 4)

`hq_get_company_state` (mig 179) replaces the categorical red/amber/green dot with a scored
model. Settled so the number stays meaningful:

- **Three axes, each 0–100:** operations (`100 − 40·critical − 10·other-open − 8·unallocated
  − 5·unassigned-refs`, floored), utilisation (`min(100, overall_pct × 2)` — 50% used = full
  marks, because raw fill % is tiny against an 08–22×7 denominator), fixture_completion
  (`100·done/(done+remaining)`). **Weights ops 0.40 / util 0.30 / completion 0.30.**
- **Missing axis → dropped and weights renormalised** (helper `_hq_health_score`); a brand-new
  venue with no fixtures/utilisation is scored on what exists. Never invent a number.
- **Band ≥80 green / ≥55 amber / else red.** Hard-red overrides (critical incident, subscription
  past_due/cancelled, expired trial) force red + their own reason regardless of score — carried
  over from the categorical logic so a paying-status problem can't hide behind a good score.
- **top_reason = weakest present axis**, phrased for a human. **Revenue & churn explicitly not
  weighed yet** (no data) — an intelligence product states the gap rather than faking it.

Additive return-shape: `health_score`, `health_reason`, `health_axes` per venue (existing
`health` retained). Consumer: apps/hq VenueHealthGrid. See [[project_hq_intelligence]].

## Utilisation is measured on a clipped 30-min bucket grid (session 62, HQ-I Phase 1 Cycle 2)

`hq_get_utilisation` (mig 178) computes pitch utilisation. Settled rules so the numbers can't
drift later:

- **Used = fixtures + CONFIRMED bookings only**, from `pitch_occupancy` (`source_kind IN
  ('fixture','booking')`, `active`). **Maintenance excluded** from used. **Requested (pending)
  bookings are surfaced separately and NEVER counted** — demand signal, not occupancy.
- **Usage is clipped to opening hours** via a 30-minute, Europe/London bucket grid → utilisation
  is always 0–100% and empty-prime always ≥0. A booking outside stated open hours (rare; the
  booking gate blocks it) is ignored in the %. Chosen over raw uncapped hours because >100% /
  negative-empty reads as a bug to operators.
- **Available = each pitch's `booking_windows`**; if none, fall back to **08:00–22:00 every day**,
  flagged `assumed` (mirrors the booking-discovery default). Never silently treat a gap as fact.
- **Prime/off-peak resolves per pitch:** `playing_areas.prime_time_windows` →
  `venues.default_prime_time_windows` → `"not_configured"` (left NULL, never guessed).
- **Default range = trailing 28 days** (mirrors `hq_get_analytics`); from/to optional.
- **best/worst day = day-of-week; best/worst slot = hour-of-day** (recurring weekly shape, not
  noisy calendar points).

Read-only (no audit/broadcast), SECDEF, anon-denied, region-scoped via `resolve_company_caller`.
Cycle 3 surfaced it in apps/hq (Utilisation tab + a card). See [[project_hq_intelligence]].

## Prime-time is venue-configurable, not a hardcoded band (session 61, HQ-I Phase 1 Cycle 1)

HQ utilisation splits prime-time vs off-peak per venue. There is no notion of "peak hours" in the
schema, so a choice was forced: ship overall-only first, hardcode a band (e.g. weekday 18:00–22:00),
or let venues define their own. **Decision: venue-configurable** — new
`playing_areas.prime_time_windows jsonb` (`[{day_of_week 0-6, start_time, end_time}]`, mirrors the
`booking_windows` pattern), edited per-pitch in the apps/venue Booking-settings modal. Empty `[]` =
"no peak defined" → the pitch counts as off-peak all day, and HQ says *not configured* rather than
guessing. Chosen because a hardcoded band is wrong for many venues (5-a-side leagues peak at
different times than weekend academies) and an "intelligence" product must not present a guessed band
as fact. Cost: one schema column + a small editor before any prime-time metric appears (HQ-I Cycle 2
consumes it). See [[project_hq_intelligence]] and FEATURES.md HQ-I roadmap.

---

## Venue payments = one unified cash/online ledger; online is staged link→Connect (session 60, scoped)

Venue-side money (owed to the venue for pitch hire + league/cup fixtures) — full plan in
`VENUE_PAYMENTS_SCOPE.md`. Key settled calls:

- **Unified ledger** (`venue_charges` + `venue_payments` instalment log), not per-surface tables —
  chosen for reporting (one query for collection rate / outstanding / revenue, sliceable by
  venue/team/competition/period; no UNIONs). Bookings = one payer; fixtures = per team.
- **Instalment log** (each payment a row) + **default fee + per-charge override** (fees on
  `league_config` / `playing_areas`). **Fixture payer** = `league_config.fixture_fee_payer`
  (`both`|`home`) + per-fixture add/void toggle.
- **Cancellation ≠ payment status** — cancellation stays on booking/fixture status.
- **Online shares the ledger** — an online/transfer payment is just a `venue_payments` row with a
  non-cash `method` + `external_ref`; only capture differs (admin marks vs webhook). So cash now,
  online later, no redesign.
- **Online staged**: hosted `venues.payment_link` (interim, any provider) → **Stripe Connect +
  Apple/Google Pay** (V5, full rails — per-venue connected account + KYC + Apple-Pay domain
  verification). Apple/Google Pay are NOT a toggle; "directly to the venue" requires Connect.
- **Distinct from Phase 8** (venue/company → In-or-Out SaaS billing) and from player match-subs
  (`payment_ledger`, player → team admin — the PlayerView "Transfer" button is a disabled
  placeholder there, unrelated).

---

## HQ analytics is composable (card registry), and the AI composes over it — not raw SQL (session 60, Cycle 6.3)

The operator asked whether HQ could be customisable — pick from preset outputs, or select
datasets an AI combines into a dynamic dashboard. Settled:

**Composable, not fixed tabs.** This supersedes scope 6C's fixed four-tab analytics. HQ has a
**card registry** (overview, venue_comparison, top_scorers, discipline, incidents, billing — each
backed by one known query in `hq_get_analytics`) and a **per-admin saved layout**
(`company_admins.dashboard_config`, mig 172 — mirrors Phase 4's `venues.display_config`). "Presets"
are named starting layouts. This is **Layer A** — deterministic and safe.

**The AI layer (Layer B) is deferred to Phase 7 and composes over Layer A's registry — it never
writes raw SQL.** Per GAFFER.md's "grounded, not generative": the AI selects + arranges cards from
the registry and narrates, every number backed by a real query. Building B before A would mean the
model improvising against the schema (RLS-bypass / hallucination risk) — so A is the prerequisite,
not optional. Timing: after the registry, with Phase 7's AI-Gateway wiring (operator chose this
over pulling a standalone HQ-AI cycle forward).

**Only confirmed data sources become cards.** `match_events` (goals/cards) and `fixtures` scores
+ `incidents`/`venues` are real; "% of players who opened the app" and league standings have no
clean source today, so those cards are deferred, not faked.

---

## Phase 6 HQ Dashboard — Cycle 6.1 scoping (session 60)

Four operator calls settled before the audit, plus one schema discovery:

**1. HQ lives in a NEW `apps/hq` app, not the `clubmanager` stub.** The reserved
`apps/clubmanager` stub directory name collides with the (historically misnamed)
`platform-clubmanager` Vercel project that actually deploys `apps/inorout` to
www.in-or-out.com. A clean `apps/hq` matches the `/hq` route and avoids that muddle. It
mirrors the superadmin scaffold (Vite alias, vercel.json SPA rewrite, OAuth gate).

**2. HQ auth = OAuth + company_admins (auth.uid(), NO token).** Per scope 6A — unlike the
venue app's token model. `resolve_company_caller(p_company_id)` resolves auth.uid() →
company_admins (role+region); a platform_admin (mig 045) is a super_admin override over any
company. The 6.5 preview route is the only token-based HQ surface. `company_admin_whoami`
gates the app (mirrors `superadmin_whoami`).

**3. regional_admin is built NOW (added `venues.region`).** company_admins.region (mig 055)
had nothing to match against. Added `venues.region` (mig 169); HQ RPCs filter venues to the
caller's region when role='regional_admin'. super_admin = all company venues; analyst =
read-only (hq_resolve_incident rejects with `read_only_role`).

**4. Cycle 6.1 was a "fuller" slice** — foundation + venue drill-down + incident resolve
(6.1+6.2 folded). Later cycles: 6.3 analytics, 6.4 live activity feed, 6.5 preview token,
6.x HQ weekly digest (the deferred Phase 9 cycle).

**Schema discovery (mig-088/092 + audit_events.team_id):** `audit_events.actor_type` CHECK
lacked `'company_admin'` (would have failed every HQ audit INSERT — the recurring whitelist
bug class); added it (mig 171). And `audit_events.team_id` is **NOT NULL with no FK** — the
venue/league convention stores the **venue_id** there for non-team events, so
`hq_resolve_incident` does the same. Both caught by ephemeral-verify before commit.

---

## Phase 9 SMS/WhatsApp + league reminder crons — scoping (session 59)

Continuing Phase 9 (build order 9→6→11), four operator calls settled before the audit:

**1. Twilio is the SMS + WhatsApp provider; transport core only this cycle (unwired).**
One Twilio client does both (WhatsApp via the `whatsapp:` address prefix). `api/_sms.js`
is built as the no-op-safe transport core (mirrors `_mailer.js`) — `sendSms`/`sendWhatsApp`,
a `TEMPLATES` registry, `sendTemplated`, and a `pickChannel(preferred, contacts)` stub — but
is **imported nowhere**. **Why unwired:** the only recipients reachable today are refs
(`match_officials` carries phone/whatsapp_number/preferred_channel); players have
`phone`/`notification_channel` columns (mig 056) but **no UI captures a phone**, so the
push→email→SMS player fallback can't deliver. Building the router + contact-capture/preference
UI is its own later 9.x cycle. Refusing to wire a channel that can't deliver keeps the cycle
honest. See "Competitive availability REUSES the casual in/out board" (session 54, Cycle 5.5).

**2. The reminder/availability crons are COMPETITIVE-ONLY and loop the `fixtures` table.**
Casual teams already have autoOpen + gameDay9am + oneHrBefore via the `schedule`-based path
(notify.js); adding the new crons to casual would double-remind. League fixtures have **no
`schedule` row** (Cycle 5.5 reuses `players.status` for availability but timing lives in
`fixtures`), so the new jobs read `fixtures` directly. Two jobs: `availabilityRequestJob`
(48h out, UK 9am window, asks the full active squad of both teams to mark in/out) and
`fixtureReminderJob` (~2h before kickoff, nudges only still-unmarked `status='none'` players).

**3. Quiet hours = default 22:00–08:00 UK, queue + flush — inherited, not rebuilt.**
Delivery goes through `/api/notify` direct mode, which already queues during quiet hours and
flushes via `flushQueue`. League teams have `reminders_config={}`, so the default window
applies automatically. Both crons fire in daytime windows (9am / ~2h before an evening
kickoff) so quiet-hours is N/A in practice; the queue is a backstop. New timing helpers
(`nowInUkFull`/`addDaysIso`) compare UK wall-clock to UK wall-clock (fixtures store UK
wall-clock) so the new path is DST-correct without touching the shared (UTC-evaluated)
`isQuietHours` — fixing that globally would touch the casual push path and is left as
pre-existing tech debt.

**4. No migration / no new RPC this cycle.** The crons read `fixtures`/`team_players`/
`players` with the service role (the established cron.js convention — lineupLockJob etc.) and
write only `notification_log` push rows (free-text `type`, existing columns). So no
ephemeral-verify, no rpc-security-sweep, no schema change. Dedup is a `notification_log`
guard (`alreadyLogged`) because direct mode does not dedup itself.

---

## Teamsheet eligibility: suspension is overridable, squad-size is league config, double-reg blocks now (session 56, Cycle 5.7)

**Decision (closes Phase 5):** `team_admin_submit_lineup` is the **authoritative** eligibility
gate — every check runs server-side before any write — and `team_admin_check_eligibility`
(read-only) powers the pre-submit UI. Three product calls, locked with the operator:

1. **Suspended / ineligible → override-with-confirmation.** Submit blocks by default if a picked
   player's own registration is `status IN ('suspended','ineligible')` or `suspension_until >
   today`. The team admin may proceed **only** by passing that player_id in
   `p_override_player_ids`; the override is recorded in the `lineup_submitted` audit row
   (`metadata.override_player_ids`). The UI requires a per-player tap ("SUSPENDED — TAP TO
   OVERRIDE" → "OVERRIDDEN") before submit enables. (scope §1147)
2. **Squad size → per-league config on the matchday sheet.** New nullable
   `league_config.min_starting` and `max_subs` (mig 161). `min_starting` = the on-pitch team
   size the sheet must name (5 for 5-a-side, 7 for 7-a-side, 11…); `max_subs` = the bench cap
   (could be 3, could be 15). Enforced as `starting_count >= min_starting` and `bench_count <=
   max_subs`, **hard block**. `NULL = unbounded` per column → existing leagues unaffected (no
   backfill). The venue/league sets these; `get_league_config` returns them via `to_jsonb(*)`
   (additive, no mapper change).
3. **Double-registration → hard block now, league resolves later.** A picked player with a
   registration to a **different** team in the same competition cannot be submitted; the RPC
   raises `player_double_registered` and writes a `lineup_double_registration_blocked` audit row
   for the league admin to act on. The full two-sided confirm flow (scope §1148: flag to team
   admin AND league admin, both confirm) is **deferred to Phase 4/6**, when `apps/venue` gains a
   per-player view. Rationale: ship a real integrity gate now without a net-new multi-app
   surface; the middle path keeps 5.7 = "closes Phase 5".

**Corollary — `team_admin_*` RPCs use `resolve_admin_caller` too.** The session-49 dual-lookup
rule (admin_token OR VC player_token) was written for `admin_*` RPCs, but the same VC-via-
`/p/<vc_token>` access path applies to the teamsheet RPCs. `team_admin_submit_lineup`,
`team_admin_check_eligibility`, and `get_team_next_fixture_lineup` all resolve the caller via
`resolve_admin_caller` (it RETURNS empty, doesn't raise, so each call is followed by an explicit
`invalid_admin_token` guard). This fixed a latent 5.6 bug where VCs got `invalid_admin_token` on
the teamsheet. **Apply going forward:** any new `team_admin_*` RPC keyed on an admin token must
use `resolve_admin_caller`, not a bare `teams.admin_token` lookup.

**Known gap (accepted):** nothing in the DB yet *writes* `player_registrations.status =
'suspended'` — 5.7 *enforces* suspension but a discipline surface that *sets* it (from cards /
league admin) is a later phase. Until then suspension state is seeded/manual.

---

## Teamsheet: pick from the squad, and submitting registers the players (session 55, Cycle 5.6)

**Decision:** the manager builds a league line-up on a **dedicated Teamsheet screen** —
NOT the casual Make Teams screen (league fields one team v an external opponent, so the
casual A/B split never applies). The pick-list is the players who marked **IN** on the
casual board (5.5), with maybe/no-response shown lower so one can still be pulled in;
each is assigned Starting or Bench. **Submitting the teamsheet auto-registers the picked
players into the competition** (`player_registrations` status active) — there is no
separate "register players" step.

**Rationale:** nothing else populated `player_registrations` for real teams, yet the ref
view and fixture detail read each squad from it — so a real team would have shown the ref
an empty squad. Making submission the registration moment closes that gap with zero extra
admin friction, and mirrors the existing auto-register-on-event precedent (mig 120). The
ref RPC change is **backward compatible** (full squad until a lineup exists) — the
load-bearing constraint for the highest-risk cycle. Squad-size limits, hard suspension
blocks, and double-registration resolution are deferred to Cycle 5.7 (5.6 only *warns*).
Shipped in three staged commits (migs 159–160). See FEATURES.md + RPCS.md.

---

## A league team is ALWAYS a separate squad; casual teams are never promoted in place (session 55, mig 158)

**Decision:** casual and competitive are *distinct squads*. A casual group that wants
league football registers a NEW squad (its own `team_id`, marked with the LEAGUE pill,
appearing as a second MY SQUADS entry) and switches to it in the app — so a person has
two squads, one casual and one league, each with its own in/out board. A casual
`team_id` is NEVER promoted to competitive in place.

**What changed:** `join_register_team` (mig 098) previously offered two paths — create a
new competitive team, OR reuse an existing team the caller admins, promoting it
casual→competitive via `UPDATE teams SET team_type='competitive'`. Mig 158 removes the
in-place promotion: a casual `existing_team_id` is rejected with
`casual_team_cannot_register`; an `existing_team_id` is accepted ONLY when the team is
already competitive (the legitimate forward case of a league team also entering a cup,
Phase 11). The new-team path is unchanged.

**Rationale:** this reverses the permissive mig-098 design and supersedes the Cycle 5.5
"revisit separate-availability-vs-reuse for the dual-context case" note below. It closes
the global-`players.status` dual-context must-fix (BUGS.md) *structurally* rather than by
managing it: because a casual `team_id` can never be in a competition, the mig-157
completion trigger can only ever touch competitive squads — a casual board is never
reset by a league fixture. Keeps `players.status` and the casual read/write paths
unchanged (no parallel availability system, no ripple to the admin make-teams /
manage-squad / who's-in screens), consistent with "reuse over new systems."

**Process for a casual group to join a league:** venue shares the league code →
member opens `/join/CODE` → signs in → creates a NEW league squad → venue admin approves
(`venue_approve_team_registration`, mig 099) → squad goes active with the LEAGUE pill.
(No league-registration wizard UI exists in apps/inorout yet — RPC + wrapper only; when
built it must offer "create a new league squad" only. The RPC enforces the rule regardless.)

---

## Competitive availability REUSES the casual in/out board, not a new system (session 54, Cycle 5.5)

**Decision:** a competitive league team's per-fixture availability is the *same* casual
IN/OUT board (`players.status` via `set_player_status`), not a new `player_availability`
table or new write RPC. A competitive team plays one fixture at a time, so the casual
single-current-game model fits. `PlayerView` overlays an "effective schedule" derived from
the next upcoming fixture (board live + opponent/date/venue/time) only when a fixture exists;
casual teams have no fixtures so they are byte-identical. **Rationale:** the admin
make-teams / manage-squad / who's-in screens already read `players.status` — reusing it means
they need **zero change**, whereas a separate availability table would have *forced* them to
read two sources. "Start fresh each game" is a trigger on `fixtures`
(`reset_team_status_on_fixture_played`, mig 157) that resets both teams' statuses on
completion — chosen over editing each completion RPC (ref/venue/walkover) so one hook covers
all paths. **Known edge (accepted, unsolved):** `players.status` is global per player, so a
player on BOTH a casual and competitive team would have casual availability reset when a
league game completes. No such dual-context team exists yet (testbed is competitive-only);
revisit at the casual→competitive cutover for real existing teams. **Tracked as MUST-FIX
tech debt in BUGS.md** (scope status per (player, team) before any real team is both casual
and competitive).

---

## Pitch booking — renewal is right-of-first-refusal but venue re-approves (session 53)

**Decision:** a weekly block within **21 days** of its end auto-reserves the next block of
the same slot for that team — a genuine occupancy hold (`pitch_bookings.status='hold'`,
priority 2) so no one else can take it during a **7-day grace** (clamped to never pass the
day before the first held week). Hold length **mirrors the original block (no cap)**. The
team's "Keep slot" (`confirm_renewal`) does **not** auto-confirm — it flips the holds to
`requested` and the **venue re-approves** through the existing inbox / `venue_confirm_booking`.
Unconfirmed holds **auto-expire** (no manual "decline"). All driven by a 09:00-UK pass in
`api/cron.js`. **Rationale:** the slot is the venue's inventory — first-refusal protects the
incumbent team without removing the venue's final say; reusing the approve path avoids a
second confirm flow. Push is on (renewal-held/expired + fixture-superseded) targeted at team
admins via a service-role resolver. **Booking initiative complete (Stages 1–7).**

## Calendar dates must be built from local components, never `toISOString()` (session 53)

**Decision:** any `YYYY-MM-DD` derived from a JS `Date` MUST use local getters
(`getFullYear/getMonth/getDate`), never `new Date(...).toISOString().slice(0,10)`.
**Rationale:** `toISOString()` converts to UTC; in UK BST (UTC+1) the midnight hour rolls
back a day — this bit the venue date-nav and the casual `BookPitchModal` block-start (a
booking written a day early), same family as the cron UK-time bug (GO_LIVE §6.7). Times are
fine via `toLocaleTimeString({timeZone:'Europe/London'})`; it's only date-string derivation
that's banned from `toISOString`. (Fixed `202d16a`; pre-flight GO_LIVE §11.2.)

---

## Pitch booking — occupancy is the single source of truth (session 52)

**Decision:** one `pitch_occupancy` table with a **partial GiST `EXCLUDE … WHERE active`**
governs all double-booking. Fixtures, bookings, and maintenance all project rows in;
displacement = deactivate the loser in-txn before the winner inserts. Priority order
**maintenance(0) > fixture(1) > block(2) > ad-hoc(3)**. Confirmed bookings are never
silently bumped — the venue fixture-write RPCs raise `confirmed_booking_clash` and need
explicit `p_displace_booking_ids[]`. **Rationale:** a unique-(pitch,slot) key can't express
variable durations/arbitrary windows; the guard must be DB-enforced regardless of source.

## Pitch booking — Stage 2 split around Stage 3 (session 52)

**Decision:** the venue projection layer (Stage 2) was split: **2a** (columns + maintenance/
fixture triggers + EXCLUDE→`pitch_double_booked` translation) shipped before Stage 3's
booking tables; **2b** (fixture auto-yield + confirmed-clash gate) shipped after, because
both reference `pitch_bookings`. **Rationale:** a trigger/RPC body can't reference a table
that doesn't exist yet — dependency-correct ordering over the plan's nominal stage numbers.

## Pitch booking — casual flow changes deliberately (not flag-hidden) (session 52)

**Decision:** unlike Phase 5 competitive surfaces (render-gated, invisible to casual), the
booking entry **deliberately appears** in the casual Admin ▸ Match Settings ("Book a Pitch").
`casual-regression.md` proves the *existing* controls are unchanged, not that the screen is
pixel-identical. **Booking writes are authenticated-only** (`auth.uid()` → `team_admins`);
the demo team is NOT a valid test target — needs a real signed-in squad.

## Pitch booking — off-system venues plumb in via emitted events (session 52)

**Decision:** every booking write emits an `audit_events` row + a realtime broadcast, so
notifying a venue NOT on our system later = subscribe to `booking_requested` and dispatch
(email/SMS/webhook) — **no change to the booking RPCs**. Their confirm-back can reuse
`venue_confirm_booking`/`venue_decline_booking` behind a magic-link token. **Limit:**
guaranteed no-double-book against a venue's *own* external calendar is impossible without a
live two-way sync; our hold is best-effort for off-system venues. Prerequisite for any of
this: a transactional sender (none exists yet — Phase 9).

## Phase 5 competitive features are SQUAD-scoped, not player-scoped (session 51)

**Decision:** the trigger for showing League Mode surfaces inside
`apps/inorout` is per-SQUAD, not per-player. A player belongs to
multiple squads (existing MySquads accordion); some of those squads
may be casual, some may be competitively registered. League surfaces
appear only when the player has a competitive squad selected as
their active context. A player on multiple casual squads + one
competitive squad sees zero league surfaces when on the casual
squads.

**Why:** matches the existing mental model (MySquads is the
squad-switcher). Means casual-only members of a competitive squad
see league info (which is correct — they're part of that team
whether or not they've been individually registered yet). Player-
level eligibility still gets enforced at teamsheet submission via
`player_registrations`.

**How to apply:** Phase 5 Cycle 5.1 adds a `LEAGUE` pill to MySquads
rows when the squad has an active `competition_teams` row. All
downstream competitive surfaces (standings, fixtures, opposition
intel) render-gate on the active-squad's `is_competitive` flag.

---

## Phase 5 surfaces sit as collapsibles inside existing tabs (session 51)

**Decision:** no new top-level NavBar tab for league content. New
competitive surfaces live as render-gated collapsible cards inside
the existing `my-view` tab of PlayerView, following the same
accordion primitive that MySquads already uses.

**Why:** casual flow is sacred. Adding a new tab visible to casual
users (or even a Casual/Competitive/All toggle in the header) would
risk regressing the experience for the much larger casual user
base. Render-gating inside existing tabs means a casual-only player
sees zero new DOM and runs zero new conditional branches.

**How to apply:** every Phase 5 competitive component lives under
`apps/inorout/src/views/competitive/` (new directory) and is
imported only inside a `is_competitive ? <Component /> : null`
guard. The mandatory `Skills/casual-regression.md` check enforces
that no casual-only player ever sees a visible change.

---

## Teamsheet IS the source of truth for ref pre-match (session 51)

**Decision:** when a team admin submits a teamsheet for a
competitive fixture (Phase 5 Cycle 5.6), the ref's pre-match screen
shows that submitted lineup (starting XI + bench) rather than the
full registered squad. Required: new `fixture_lineups` table +
`team_admin_submit_lineup` RPC + backward-compatible update to
`get_fixture_state_by_ref_token` (mig 120) — fall back to full
registered squad if no lineup submitted.

**Why:** matches how real leagues operate. Refs check the
submitted teamsheet at kickoff to verify only eligible players take
the field. Without this, the ref view's "squad" is informational
only and the actual eligibility check happens off-platform.

**How to apply:** Cycle 5.6 is the highest-risk cycle in Phase 5
(new schema + RPC + ref-view change in one commit). Backward
compatibility test is the load-bearing verification: an existing
fixture WITHOUT a lineup must still show the full squad in ref view
exactly as today.

---

## Phase 5 uses "Competition" not "League" in new component names (session 51)

**Decision:** all new Phase 5 components use the word "Competition"
rather than "League" in their names and visible headings. So
`CompetitionStandingsCard.jsx` not `LeagueStandingsCard.jsx`;
"Competition Standings" not "League Standings" in UI text.

**Why:** the existing `PlayerLeagueTable` component (StatsView)
ranks PLAYERS within a SQUAD — it is the casual squad's internal
ranking. The competitive standings rank TEAMS within a LEAGUE.
Using the same "League" word for both creates real user confusion
when they sit close to each other in the UI.

**How to apply:** every new Phase 5 file/component/header uses
"Competition" or "Comp". The pre-existing `PlayerLeagueTable`
stays unchanged (renaming it would churn the casual code we promised
not to touch).

---

## Admin views must never impersonate a player (session 51)

**Decision:** when an admin's self-row cannot be resolved (auth
missing, admin not linked to a player on this team, RPC returned
`is_self=false` everywhere), the admin must land on AdminView
directly. Falling back to "use squad[0] as the admin's identity"
is banned in any code path. Server-side: all squad aggregators
MUST use deterministic `ORDER BY` (`tp.created_at, p.id` is the
canonical order). Client-side: `myId` fallbacks must not use
positional indexing into the squad.

**Rationale:** mig 125 + 2026-05-27 incident. rockybram was
rendered as Pritpal on his own admin PWA because `is_self`
resolved to false (auth missing on PWA cold-start) and the client
fell back to a non-deterministically-ordered `squad[0]`. Identity
in the app must never come from positional luck.

**Applies to:**
- Every `jsonb_agg` over `team_players` JOIN `players` —
  must have `ORDER BY tp.created_at, p.id`
- `App.jsx` `myId` / `myPlayer` fallbacks — must never use `squad[N]`
- Any new state derivation that asks "which player is the user?" —
  must use `is_self` / explicit token match, never order

**Reference:** mig 125 (commit a1c13d0), App.jsx:1168 (the
removed fallback — currently held on branch
`fix/admin-impersonation-guard` pending iPhone test).

---

## Cron writes that change visible state MUST go through RPCs (session 51)

**Decision:** when a cron job (api/cron.js or any scheduled
function) needs to mutate `schedule` / `matches` / player state in
a way that's also done by an admin UI flow, it MUST call the same
RPC the admin UI calls (or a service-role-scoped sibling that
shares the same body). Raw `supabase.from(...).update(...)` from
cron is banned for any state shared with an admin path.

**Rationale:** mig 126 + 2026-05-27 incident. cron.js's
`autoOpenGameJob` flipped `game_is_live` via raw update, bypassing
the `admin_go_live` RPC (mig 077) that owned the full week-open
transition. The cron-set state was a strict subset of what
admin_go_live did — missing matches row, missing
`active_match_id`. Players could vote, but admins couldn't pick
teams. The drift was invisible until an admin tried Make Teams.

**Pattern:** if the admin RPC takes an admin token but cron has
team_id, add a service-role-scoped sibling (e.g.
`admin_go_live_for_team(p_team_id)`) that:
- Shares the same body as the admin RPC (matches creation,
  schedule transition, idempotence)
- Adds any cron-specific concerns (e.g. clearing `auto_open_pending`)
- Writes audit with `actor_type='system'`,
  `actor_identifier='cron:<job_name>'`
- `REVOKE ALL` from anon, authenticated; `GRANT EXECUTE` to
  service_role only

**Applies to:** every job in api/cron.js, every Vercel scheduled
function, every pg_cron callback.

**Reference:** mig 126 (commit c29b20d), api/cron.js
`autoOpenGameJob` (the changed callsite).

---

## admin_* RPCs MUST accept VC player tokens via dual lookup (session 49)

**The rule:** every SECURITY DEFINER RPC that authorises a caller
against `teams.admin_token` must ALSO accept a Vice Captain's player
token as a valid caller token. Resolution order is fixed:

  1. `SELECT id FROM teams WHERE admin_token = p_admin_token`. If a
     row is returned, actor_type = `'team_admin'`, ident =
     `'admin_token:' || md5(p_admin_token)`.
  2. Else, `SELECT tp.team_id FROM players p JOIN team_players tp
     ON tp.player_id = p.id WHERE p.token = p_admin_token AND
     tp.is_vice_captain = true` — scoped to the target entity's
     team where applicable. If a row is returned, actor_type =
     `'vice_captain'`, ident = `'vc_token:' || md5(p_admin_token)`.
  3. Else, raise `invalid_admin_token`.

Audit inserts MUST record the resolved actor_type so post-incident
forensics can distinguish admin actions from VC actions. Mig 116
(`admin_delete_player`) is the reference implementation.

**Why:** since commit 767b499 ("pass route.token to AdminView for
VCs too"), Vice Captains opening AdminView via /p/<vc_token> have
their player token passed as `adminToken` to every admin RPC call
site. Mig 073's partial VC fallback only handled the `p_admin_token
IS NULL` case — useless because the client DOES pass a token, just
the wrong kind. Result: any admin_* RPC without a VC fallback
silently fails for every VC, every time. The team_admin path
continues to work, masking the issue from team-owner test accounts.
Session 49 caught this on `admin_delete_player`; mechanical sweep
of the remaining admin_* RPCs is outstanding.

**Applies to:** every existing and future `admin_*` RPC that takes
a `p_admin_token text` parameter. Specifically known to need
auditing: `admin_add_player`, `admin_update_player_name`,
`admin_save_teams`, `admin_cancel_match`, `admin_set_player_status`,
`admin_record_payment`, and any other write surface exposed to the
AdminView. Read RPCs that already accept a player token (e.g.
`get_team_state_by_player_token` post-mig 070) are out of scope —
they have a separate token-resolution pattern.

**How to apply:** when adding a new admin_* RPC, copy the dual-
lookup block from mig 116 verbatim. When auditing existing
admin_* RPCs, treat anything that raises `invalid_admin_token`
without going through the dual lookup as a bug — fix it in the
same commit. The `skills/rpc-security-sweep.md` gate should be
extended to flag admin_* RPCs missing the VC path.

---

## LEAGUE MODE — OPERATOR-LED ONBOARDING FOR YEAR 1 (session 48)

**The rule:** every new venue is created by a platform admin (Tarny)
through `superadmin_create_venue` and the `/superadmin/venues/new`
form. **No self-serve venue signup ships before year 2.** Billing is
manual for year 1 — Stripe Invoicing, GoCardless, or Wise transfer
per venue. Phase 8 of `LEAGUE_MODE_SCOPE.md` (Stripe Connect
self-serve) is deferred.

**Why:** at £199/mo × 12 = £2,388 LTV per venue, a 30-min onboarding
call has obvious ROI when supply is constrained. Upmarket customers
(Goals, Powerleague) will not self-serve a subscription — they need
a named contact, procurement process, and contract. League Mode is
still being debugged in flight; manual onboarding catches 10× more
edge cases than a self-serve form that errors silently. The 5 days
that would have built Phase 8 are reallocated to product features
that close more high-leverage deals.

**How to apply:** when building any "venue create" or "venue signup"
surface, route it through `superadmin_create_venue` (platform-admin
gated). If a future cycle proposes a public venue signup, the answer
is "year 2" unless the operator explicitly says otherwise. The
`/superadmin/venues/new` UI is the primary creation surface and
should evolve with onboarding learnings (more fields, defaults,
contract checkboxes) rather than being replaced by a self-serve
twin.

---

## LEAGUE MODE — `/league/TOKEN` MERGES INTO `/venue/TOKEN` (session 48)

**The rule:** League admin UI is the venue admin dashboard
pre-filtered to one league. `/league/TOKEN` resolves via
`resolve_league_caller`, which surfaces a league-pick prompt when the
caller arrives via `venue_admin_token`. The data model keeps
`leagues` separate (Phase 1 already shipped `leagues.league_admin_token`)
so splitting later is cheap.

**Why:** with operator-led onboarding (above), Tarny is doing both
venue and league setup in one session anyway — the distinction is
academic for year 1's modal customer. Independent leagues hired at a
venue (Model B in the session 48 design Q&A) become a future cheap
add when a real customer surfaces. Building two surfaces now is
premature.

**How to apply:** don't build a separate `LeagueView` component
tree. League-specific surfaces live in `VenueView` with a "pick a
league" picker or a deep-link pre-filter.

---

## LEAGUE MODE — PHASE 4 RECEPTION DISPLAY (session 57)

**Venue-scoped on a new `venues.display_token`, NOT per-league.** The reception
TV shows every active competition at the venue (scope §4D), so it keys on a
per-venue token. We added `venues.display_token` (parallel to the pre-existing
`leagues.display_token`) rather than reuse `venue_admin_token` — the admin token
is the operator's read-write secret and must never appear on a public TV URL. A
multi-league venue (demo_venue has two) is handled by one display rotating
through its competitions, not by multiple per-league screens.

**Composite multi-zone layout supersedes the scope's single-panel auto-cycle.**
The operator's call: the screen shows several datasets at once (live scores +
table + top scorers + ticker), default "Live-led split" (live scores the hero,
table rail, scorers under, ticker along the bottom; flips to Upcoming/Recent when
idle). The scope's fixed/cycle/smart "panels" still exist as `display_config`
(`zones`, `mode`, `interval_secs`, `custom_message`), but cycling is for overflow
within the composite, not a one-panel-at-a-time carousel.

> ⚠️ **The session-57 visual execution is NOT final.** The operator judged the first
> layout too plain and a broadcast-grade redesign is scheduled (a ChatGPT-generated
> mockup is the starting reference). The *decisions* above hold (venue-scoped,
> composite multi-zone, default Live-led split, configurable zones); only the visual
> design / component layout in `apps/display/src` changes. The `display_config`
> contract and `get_display_state` payload are the fixed substrate the redesign
> builds on — if the redesign needs a new zone key or field, that's an additive
> schema/RPC change, not a rewrite.

**Client-side PIN lockout; PIN never leaves the server.** `check_display_pin`
answers ok/required without returning the PIN; `get_display_state` omits it. The
3-strike / 30-min lockout lives in `apps/display` localStorage. This keeps the
whole display read-only (no write RPC for the gate) — only
`venue_update_display_config` writes, and only from the operator.

**Identity = capability URL, consistent with the platform.** No login/email for
the display (or any venue/ref surface today; `venue_admins`/`company_admins`
remain unused scaffolding). `display_token` + an optional PIN locks a screen to
one venue. Layout changes are made only on the operator's `venue_admin_token` link
(apps/venue ▸ Reception display) — the TV link is read-only. Token rotation
("regenerate display link") is a deliberate future add, not in Phase 4.

**Standings engine is lifted, not reinvented.** `get_display_state` reuses
`get_league_standings_for_player`'s scoring byte-for-byte (walkover/forfeit → 3/0,
W/D/L from effective score, `standings_visibility` gate) in a confirmed pass, and
adds a parallel LIVE pass folding in-progress `match_events` scores for the §4D
amber "provisional" table. Form column deferred (no RPC computes it yet).

**New `apps/display` app, not a route in apps/venue.** Standalone Vite SPA, own
Vercel project (mirrors apps/ref/apps/venue). Keeps the public TV surface
decoupled from the operator dashboard's deploy; read-only, so it never touches
`apps/inorout/src` or `packages/core` write paths.

---

## LEAGUE MODE — BUILD ORDER AFTER PHASE 4 (session 58)

**The rule:** the next three phases to build are **9 (finish notifications) → 6 (HQ
dashboard) → 11 (cups)**, in that order. Phase 7 (AI layer) and Phase 10 (public
pages) come *after*. Phase 8 (billing) stays deferred to year 2. **This supersedes
the earlier "Phase 7 is the next major / operator's stated priority after 9" pointer**
(sessions 56–57) — the operator reprioritised in session 58.

**Why this order (methodical, operator delegated the sequencing):**
- **9 first** — the Cycle 9.1 codebase is warm (`api/_mailer.js` + the 15-min cron
  dispatcher just shipped), so the remaining cycles (SMS/WhatsApp via Twilio; the
  fixture-reminder + 48h availability crons) are low-risk extensions. Critically, the
  reminder/availability crons **close a loop Phase 5 left open**: competitive
  availability reuses the casual in/out board (Cycle 5.5) but nothing yet pushes the
  squad to respond. Finishing existing work before opening new surfaces.
- **6 next** — "data flows up; the operator's screens don't yet" (the standing
  Phase 4/6 convergence note). HQ is the larger net-new surface and unblocks the one
  Phase 9 cycle deliberately held back.
- **11 last** — cups are the most cross-cutting feature (fixtures, standings→brackets,
  ref view, reception display, player view all change), so they're safest once every
  other surface is stable. Groundwork already exists (`cup_rounds` table mig 055,
  `generateCupBracket` engine in `packages/core`).

**How to apply:** **the Phase 9 "HQ weekly digest" cycle does NOT ship with the rest
of Phase 9 — it rides with Phase 6**, because the digest is just a scheduled email
over HQ aggregation queries that don't exist until Phase 6 is built. When picking up
Phase 9, build SMS/WhatsApp + the reminder/availability crons; leave the digest for
the Phase 6 cycle.

---

## LEAGUE MODE — EXISTING CASUAL TEAMS STAY VENUELESS FOREVER (session 48)

**The rule:** `teams.venue_id` is never set for any team that
predates the team's competitive-league registration. Existing casual
teams (Footy Tuesdays, rockybram, etc.) keep `venue_id IS NULL`
forever. Venues only see teams that registered via `/join/CODE` into
one of their competitions.

**Why:** no migration risk, no claim-collision risk, cleanest data
model. If a casual team later wants a venue association, they
register a competition entry — that's the only path. The "venue claims
existing teams" and "team admin proposes a venue" patterns considered
during design were both rejected for collision risk + complexity.

**How to apply:** never write a migration or RPC that retroactively
populates `teams.venue_id` for existing rows. Phase 2 RPCs scope
"venue's teams" exclusively via `competition_teams` ↔ `competitions` ↔
`seasons` ↔ `leagues` ↔ `venues`.

---

## LEAGUE MODE — SQUAD MODE IS PER-LEAGUE CONFIG, LOCKED AT FIRST FIXTURE (session 48)

**The rule:** `leagues.squad_mode` is one of
`'registered' | 'open' | 'mid_rigid'`. Wizard step 2 asks. Once the
first fixture of any season under that league is played
(`squad_mode_locked_at` set), the value is immutable. Mid-season
changes require a platform admin override.

  - `registered` — fixed squad of N players. Per-fixture lineup
    submitted from that squad. Loan players require admin approval.
  - `open` — like casual today. Whoever clicks IN plays. No formal
    teamsheet.
  - `mid_rigid` — squad registered but lineup defaults to all-available;
    no per-fixture submission.

**Why:** different competitive cultures need different rigour, and
mid-season changes break standings and audit trails.

**How to apply:** Phase 2 wizard sets the value once at season setup.
Phase 5 (player competitive features) reads `squad_mode` to decide
whether a teamsheet submission RPC is exposed. Never allow a client
to change `squad_mode` after `squad_mode_locked_at` is non-NULL.

---

## BULK-INSERT RPCs AUDIT ONE ROW, NOT N (session 48, mig 091)

**The rule:** an RPC that inserts many rows in one call (e.g.
`venue_generate_fixtures` writing 50+ fixtures) writes a SINGLE
`audit_events` row with `metadata.<count>_field`. Do NOT write one
audit row per inserted row.

**Why:** audit_events should capture user-meaningful events, not
disk I/O. "Generated 50 fixtures for competition X" is one decision.
50 individual rows clutters the log and degrades read performance on
`audit_events` queries. The `notify_*_change` broadcast is also one
event ("fixtures_generated"), not 50.

**How to apply:** for every Phase 2+ bulk-write RPC, the audit insert
is one row with metadata fields counting/summarising the batch.
Pattern established in `venue_generate_fixtures` (mig 091) — copy that
shape.

---

## SCHEMA-SYNC MUST SWEEP `pg_constraint`, NOT JUST COLUMNS (session 48)

**The rule:** before adding any column DEFAULT change, ALTER COLUMN,
or INSERT in an RPC that targets a Phase 1 table (or any pre-existing
table), query `pg_constraint` for that table and verify the values
you plan to use are in the existing CHECK enum. Add this query to
every cycle audit alongside the existing column-existence sweep.

**Why:** session 48 caught FOUR latent CHECK constraint bugs across
Cycles 2.1–2.3:
  - `competition_teams.status` allowed only
    `('active','withdrawn','expelled')` — mig 083's DEFAULT flip to
    `'pending'` would have failed every new INSERT.
  - `audit_events.actor_type` allowed only the original 7 personas —
    every Phase 2 mutating RPC's audit insert would have failed
    (`venue_admin`/`league_admin`/`platform_admin` missing).
  - `seasons.status` allowed only `('setup','active','completed','archived')`
    — RPC filtered on `'registration_open'` (no-op but wrong).
  - `incidents` has no `status` column at all; "open" is derived from
    `resolved_at IS NULL` (RPC referenced a non-existent column).

The pattern: mig 055 / mig 003 are narrower than scope-file
assumptions. Reactively fixing each one cost one round-trip per
cycle. Proactive sweep at audit-time prevents it.

**How to apply:** run
  ```sql
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'public.<table>'::regclass;
  ```
  for every table the cycle will touch, alongside the column existence
check from `skills/scripts/check-db-schema.sh`. Cross-reference every
status / enum value the RPC will use against the live constraint.

---

## ANY BULK-RESET OF `players.status` MUST ALSO CLEAR `admin_locked_in` (session 47, mig 082)

**The rule:** any RPC that bulk-resets `players.status` to `'none'` across
a team (cancel match, weekly rollover, season reset, restore-from-disabled,
etc.) MUST include `admin_locked_in = false` in the same UPDATE. Treat it
as an inseparable part of "reset the player to a clean slate" alongside
`paid`, `self_paid`, `paid_by`.

**Why:** `admin_locked_in` is set true by `admin_set_player_status` (mig 038)
and gates `set_player_status` (the player's self-toggle RPC) — a stale `true`
silently blocks the player from setting their own in/out next week, with no
visible error in normal admin flows. Cancellation (and any other bulk reset)
must invalidate the lock because it belongs to the previous game, not the
next one.

**How to apply:** when writing or reviewing any new RPC that does
`UPDATE players SET status='none' ... FROM team_players` (or similar
team-scoped reset), check the SET list includes `admin_locked_in = false`.
Established by mig 082 after the 2026-05-26 Footy Tuesdays cancellation left
Ranza stranded — see BUGS.md RESOLVED entry. Currently only the cancel path
is fixed; `open_next_week`/`advance_game_date` weekly rollover is flagged
for a follow-up audit.

---

## CLOUD/MOBILE CLAUDE SESSIONS MUST HAND OFF A PENDING SOURCE-FILE COMMIT (session 47)

**The rule:** any Claude session that applies a change to the live
DB (or any other shared state) without filesystem access to the
repo MUST end by stating, verbatim, the source artefact(s) the next
desktop session needs to commit. The desktop session that picks up
the work treats reconciling the repo with live as priority zero,
ahead of any new task.

**Why:** during this session a hotfix to `get_team_state_by_admin_token`
(restoring `group_number` + `group_labels` dropped in mig 070) was
applied to the live DB at 12:38 UTC from a mobile Claude session.
The session couldn't write files, so the migration source never
landed in `rls_migrations/`. The live DB ran ahead of source for
~3 hours before this session noticed. Violates hard rule #11
("migration source files MUST land in the same commit as the live
DB apply"). Discovered only because BUGS.md / live behaviour
diverged from what the rls_migrations/ folder claimed.

**How to apply:**
- A cloud session that calls `mcp__supabase__apply_migration`
  (or directly runs DDL via `execute_sql`) must end its final
  message with: "**Next desktop session: write
  `rls_migrations/NNN_<slug>.sql` matching the SQL applied here,
  before doing anything else.**"
- The desktop session's first action on resume is to confirm the
  forward + down source files exist in the repo. The new pre-commit
  hook gate (this session) blocks any commit that introduces a
  forward migration without a matching `_down.sql`, which catches
  the simpler half of the failure.
- Read-only cloud/mobile work (queries, log fetches, plans) is
  unaffected — only writes need the hand-off.

**Exceptions:** none. A live change without a source file is
*always* a hard rule #11 violation, even if behaviourally correct.

---

## READ RPCs MUST MATCH THE PRIVILEGE PROFILE OF WHATEVER WRITES THE CALLER CAN ALREADY MAKE (session 47, mig 080)

**The rule:** when a write surface is broadened (e.g. VCs can now
call admin_* writes via player_token per session-45 mig 075), the
read RPC that powers the matching display surface must be broadened
in the same sweep. Otherwise saves succeed silently on the server
and silently fail on the client display, which is the worst possible
debugging surface.

**Why:** session 45 made VCs writers across every admin_* RPC. The
read RPC `get_team_state_by_player_token` (mig 071) was not
touched — it kept its deliberately-minimal "ordinary player" squad
shape with no payment/stats/locks fields and no caller-self row.
For 12 days, VCs running AdminView via /p/<token> saw their Make
Teams, Group Balancer, Payments, POTM tally, and stats columns
silently break on reload while every write succeeded server-side.
Surfaced only when Tarny noticed groups resetting on game day.

**How to apply:**
- After any write-RPC grant change that broadens the caller pool,
  audit the read RPCs that power the same surface (`get_team_state_*`
  and any `get_*` that feeds the writing surface) and either:
  - widen the read RPC to match (the mig 080 pattern: branch on
    `v_privileged` to return the full admin shape for VCs/admins
    while keeping the limited shape for ordinary players), OR
  - explicitly document why the asymmetry is intentional.
- Before merging any write-parity sweep, grep every read RPC
  consumed by the affected surface for the missing fields and
  confirm coverage matches the new write capability.

**Exceptions:** privacy-driven asymmetry (e.g. ordinary players
must not see who paid whom) is fine — document it in the read RPC
header.

---

## state.player AND state.squad CAN OVERLAP — CALLERS MUST DEDUPE BY id (session 47)

**The rule:** any code path that prepends `state.player` to
`state.squad` (or merges them in any way) MUST filter the squad by
`p.id !== state.player.id`. The two collections can contain the
same player id when the caller is privileged.

**Why:** mig 080's privileged branch of `get_team_state_by_player_token`
returns the caller's own row inside `v_squad` with `is_self=true`.
The caller's record is also returned separately as `v_player` from
`to_jsonb(p.*)`. Both shapes serve different needs (`v_player` has
`user_id` for the auth-linking flow; the squad row has `group_number`
and `is_self`). Naïve prepend `[state.player, ...state.squad]`
double-renders the caller for VCs/admins (the Live Board bug Tarny
hit). The two-shape problem is structural — neither shape is wrong,
the consumer is.

**How to apply:**
- Use the `buildPlayerSquad(player, squad)` helper in
  `apps/inorout/src/App.jsx` (added this session) for all player-
  route squad assembly. It merges squad-row fields onto `state.player`
  and filters the duplicate. Don't reinvent at every call site.
- For any new collection where the RPC return shape may include the
  caller, apply the same merge-then-filter pattern. State explicitly
  in the consumer comment that the dedupe is required and why.

**Exceptions:** ordinary-player /p/ route — the server still excludes
the caller from `state.squad`, so the helper's `.find` returns
undefined and the `.filter` is a no-op. Safe to use unconditionally.

---

## ALL admin_* RPCs MUST GRANT BOTH anon AND authenticated (session 46, mig 078)

**The rule:** every `admin_*` SECURITY DEFINER RPC must
`GRANT EXECUTE` to BOTH `anon` and `authenticated`. The function
body owns access control via `resolve_admin_caller(p_admin_token)`
(see mig 074) — it already accepts admin_token OR VC player_token
and raises `invalid_admin_token` for anything else. There is no
remaining reason to restrict at the PostgREST grant layer; doing
so blocks two legitimate caller shapes:

1. **anon-admin flow** — admin opens `/admin/<token>` URL in a
   session without a JWT (PostgREST role = `anon`). The token
   itself is the credential.
2. **VC flow** — vice captains authenticate via `player_token`,
   never via `auth.uid()`, so they always come through `anon`.

**Why this exists as a separate rule:** the session-45 "blanket
VC = owner parity" sweep (mig 075) rewrites function bodies but
deliberately doesn't touch GRANTs. Two RPCs
(`admin_set_player_group` and `admin_clear_all_groups`) had been
authenticated-only since mig 031 (Group Balancer launch) and
inherited that grant through the sweep unchanged. Result:
rockybram's brand-new squad hit "Failed to save group — try
again" on every group balancer tap. Body and data were healthy;
only the grant blocked PostgREST callers. Fixed in mig 078.

**How to apply:**
- New `admin_*` RPCs: default grant block is
  ```sql
  REVOKE ALL ON FUNCTION fn_name(args) FROM public;
  GRANT EXECUTE ON FUNCTION fn_name(args) TO anon, authenticated;
  ```
- Sweeping migrations that claim "every admin_* RPC now …" must
  explicitly enumerate grants via `pg_proc.proacl` and assert
  every match contains both roles.
- Before merging any new admin_* RPC, run:
  ```sql
  SELECT proname, proacl::text
  FROM pg_proc
  WHERE proname LIKE 'admin\_%' ESCAPE '\\'
    AND pronamespace = 'public'::regnamespace
    AND NOT (proacl::text LIKE '%anon=X%' AND proacl::text LIKE '%authenticated=X%');
  ```
  Any row in the output is a regression — investigate or fix
  before commit.

**Exceptions:** none currently. If a future admin_* RPC needs
tighter control, document why HERE and skip that function name
in the assertion above.

---

## ADMIN_* RPC PARITY / SMOKE TESTS NEVER RUN AGAINST PRODUCTION ROWS (session 45, post-incident)

**The rule:** any verification sweep that exercises admin_* RPCs
(toggle on/off, before/after asserts, parity between admin_token
and VC player_token routes) MUST operate against an ephemeral
team + players created inside the test transaction and torn down
on completion. Real production rows are not valid test subjects,
even when "we'll revert it after."

**Why:** session 45's VC-parity verification ran against
team_KPaoX8oJYMQ (Footy Tuesdays) using Bally and Bidz as guinea
pigs. Two residues surfaced after the fact:

- Bally's status was toggled `out → in` and back to `out`, but
  the sweep ended on the `in/locked_after:true` step and the
  matching revert was missed. Nickname `TempNick` was set but
  never cleared. Bally appeared locked-in with a placeholder
  nickname for ~50 minutes before the user noticed.
- Bidz had been legitimately promoted to Vice Captain at
  08:52:51. The parity sweep at 09:57:08 toggled his VC flag
  true/false/true/false in one transaction to prove both auth
  routes work. The sweep ended in `false` regardless of his
  start state — silently undoing the real promotion.

A "toggle on then off" test that doesn't snapshot the starting
state will always corrupt rows that started in the non-default
state. The only safe pattern is: create row → toggle → assert →
drop row.

**How it's enforced going forward:** a future
`verify_admin_parity` skill / SQL function (filed in BUGS.md
under "LOW — Known workarounds exist #0") will own this. Until
that's built, any admin_* RPC change must be verified manually
against `team_demo` (acceptable for non-RLS paths) or a freshly
created throwaway team, not against any team a real user can see.

**Corollary — direct UPDATEs from MCP bypass audit_events.**
When an operator must clean up residue from a botched sweep, the
cleanup pass should be repeated through the admin_* RPC path
afterwards so the audit trail records who/when did the fix —
even though the row state is already correct and the RPC writes
a no-op `before == after` audit row. The audit row is the point,
not the state change.

---

## VICE CAPTAINS HOLD FULL OWNER-GRADE AUTHORITY (session 45)

**The rule:** a Vice Captain (`team_players.is_vice_captain = true`)
can perform every admin action the team owner can. The only thing
that distinguishes the owner is who created the team and who holds
the secret admin_token. Day-to-day permissions are identical.

**How it's enforced:** every admin_* RPC resolves its caller via
`resolve_admin_caller(p_token text)` (migration 074). The helper
accepts either the team's admin_token or a VC's player_token and
returns the team_id plus audit identification fields. The admin
surface has no per-RPC permission special cases.

**What survives the change:** the audit trail. Owner-driven calls
are stamped `actor_type='team_admin'` /
`actor_identifier='admin_token:<md5>'`; VC-driven calls are stamped
`actor_type='vice_captain'` / `actor_identifier='player_token:<md5>'`.

**What does NOT change:** RPC signatures, return shapes, error codes,
guest guards, business logic. No client wrapper or React component
was touched in the sweep — `App.jsx:1190` already routes the VC's
player_token through after commit `767b499`.

**Why this matters going forward:** when adding any new admin_* RPC,
use the helper. Do not write a fresh `SELECT id INTO v_team_id FROM
teams WHERE admin_token = p_admin_token` — that pattern is the bug
the sweep eliminated and reintroducing it silently breaks VC parity.

**`team_admins` table is a separate concept.** It exists for future
multi-owner / co-owner semantics and is intentionally not consulted
by `resolve_admin_caller`. If we later want non-VC co-admins, that's
its own migration and its own rule entry.

---

## TOKEN IS THE PWA's IDENTITY; SIGN-IN ONLY FOR ACCOUNT ACTIONS (session 43)

**The mental shift:** stop trying to make sign-in survive the iOS
Safari→home-screen-app storage partition. The token in the URL
(`/p/<token>` or `/admin/<token>`) IS the identity for day-to-day
use. Sign-in is only requested when an action genuinely cannot be
done without an auth user — joining a new team, linking an existing
player to an account, deleting an account, and (for admins/VCs only)
tapping their own player-self actions on `/admin/<token>` routes.

**Why:** session 41+42 telemetry proved Apple's storage partition
makes sign-in fragile by design. Sessions established via Safari
OAuth never reach the installed PWA. The choice was either:
- (a) fight Apple's partition with clever bridges — unreliable, and
  blocked outright by Google's webview detection for OAuth.
- (b) accept the partition; sign in INSIDE the PWA when needed; use
  tokens for everything else.

We chose (b). The email-OTP modal (`AuthGateModal.jsx`,
`useRequireAuth.js`) runs entirely inside the PWA's webview, so the
JWT lands in PWA-scope localStorage and persists across reopens
(iOS only evicts after 7 days of zero use — irrelevant for a weekly
app).

**Concrete rules for new features:**
- A read that's keyed by player → take the token, not auth.uid().
  Use the `player_get_teams_by_token(token)` pattern (migration 072).
- A write that targets a player row → take the token. Identity is
  proven by token + RLS (SECURITY DEFINER on the RPC).
- A write that creates or destroys an auth user / linkage (join,
  link, delete account) → gate with `useRequireAuth`. Render the
  AuthGateModal inline; on `onAuthed` re-run the action.
- An admin/VC self-write on `/admin/<token>` → gate with
  `needsSelfAuth = isAdmin && !me?.isSelf`. The isSelf flag (from
  mig 070, surfaced via the `dbToPlayer` mapper since session 43)
  is true only when the row matches `auth.uid()`. Without a match
  we fall back to `squad[0]` and acting as that user is the bug.
- Magic links are NOT a substitute for email OTP. The link opens
  in Mail.app → Safari, which is the wrong storage partition.
  Always offer the 6-to-10 digit code as the primary path.
- Google sign-in is NOT in the PWA modal — Google sometimes blocks
  "webview" sign-ins for security, and PWAs sit in the grey zone.
  Email-OTP avoids the risk entirely.

**Browser users (not the home-screen app) are unaffected** — they
continue to see today's `SignIn.jsx` (Google + magic link) at `/`.

**End-of-beta migration:** Capacitor wrap will use native
ASWebAuthenticationSession for sign-in. JWT lives in iOS keychain,
never evicted. ~90% of this session's code (the modal, hook,
explicit Supabase config, OTP wiring) transfers. The 10% that
retires (the in-PWA "you need to sign in" surface for admin self-
tap) is trivial to remove.

---

## ONE PLAYER ROW PER TEAM-MEMBERSHIP (session 42, migrations 065–069)

**Invariant:** every (auth user, team) pair has its own `players` row,
with its own `token`. The auth `user_id` is the cross-team link
already (and powers `player_get_teams`); the `players` row is the
per-team identity. Tokens uniquely identify a team-membership.

**Why:** the previous model — "look up player by user_id, reuse it
for additional team joins" — broke routing. `/p/<token>` resolves
deterministically to the earliest `team_players.created_at`, so once
a user joined a second team they had no way to reach it. MySquads
also collapsed into a single non-clickable row because both squads
shared a token.

**Implications:**
- Stats (`player_match`, `player_career`) are per-team automatically:
  a player's history at team A doesn't follow them when they join
  team B. This is correct — stats are about a team's roster.
- `link_player_to_user` no longer refuses when the auth user already
  owns another player row. It only refuses if the *target row* is
  already linked to a different user.
- `delete_my_account` iterates every player row owned by the auth
  user — leaving no orphan per-team rows behind.
- Existing tokens remain valid: the data-split migration 069 keeps
  the earliest `team_players` row pointing at the original players
  row, so PWA installs and bookmarks don't break.

**What to do when adding new join paths or account-scoped writes:**
- Look up players via `user_id` *and* `team_id` together — never by
  `user_id` alone.
- A new join path must mint a fresh `players` row + token when the
  caller is not yet on the target team, even if they're already a
  player elsewhere.

## SHARE-LINK TOKEN VISIBILITY (session 42, migrations 070–071)

**Rule:** an admin or vice-captain of a team sees every squad row's
`token` field in the squad payload they read. Regular players see
their own token only (it's already in their URL); other rows have
`token = null`.

**Why:** the "Copy personal link" admin UX needs `/p/<that player's
token>` — that's the whole point of being able to onboard squad
members onto their own PWA. Exposing the token to admins/VCs is a
wash on access: admins already have stronger powers via admin RPCs
that attribute correctly (set status, mark paid, kick, schedule).
The token only adds player-self attribution surface (self-pay, POTM
vote), which is a UX issue not a security one.

**Implementation:**
- `get_team_state_by_admin_token` (migration 070): unconditional
  `'token': p.token` + explicit `'is_self': (p.user_id = auth.uid())`
  flag for identifying the caller's own row. App.jsx resolves the
  admin's player via `is_self`, not via token-truthiness.
- `get_team_state_by_player_token` (migration 071): derives
  `v_privileged` (VC on this team OR active `team_admins` for the
  caller's user_id) and exposes `'token'` on squad rows only when
  privileged. Regular players continue to see null tokens.

**What to do when adding new state-read RPCs that include a squad:**
- Decide whether the caller is privileged for this team.
- If yes, expose `p.token` on every row.
- Never assume "only the caller has a token" — use an explicit
  `is_self` flag if you need to identify the caller's row.

## AUTH-DECOUPLING POSTURE (session 41)

PWA auth is fragile. iOS partitions PWA localStorage from Safari
localStorage; sign-in via Safari leaves the PWA's storage scope
empty. Confirmed via session 41 telemetry (migration 064): Tarny's PWA
app_boot rows show `session_present_client=false` despite confirmed
sign-up + recent OAuth callback.

**Posture going forward:** features that need to work for all squad
members must NOT depend on `auth.uid()` at request time. The default
becomes: bearer-token (player_token, admin_token) for identity, with
auth.uid() used only for identity-narrowing within an already-trusted
context (e.g. exposing the admin's own player token in the squad
payload — migration 061 — uses auth.uid() to pick which row to
populate the token field on; the admin_token already gates the RPC).

**Concrete principles:**
- **Live updates: broadcast channels, public flag.** Migration 062
  set `notify_team_change` to publish with `private=false` because the
  channel UUID is itself the secret (only delivered via team-state
  RPCs which require admin/player token). Postgres_changes pipe is
  RLS-gated and silently drops events for unauthed clients — it stays
  as a fallback but should not be relied on alone.
- **Writes: token, not auth.uid().** Set_player_status, set_player_paid,
  set_player_injured, add/remove_guest, register_push_subscription,
  submit_potm_vote all take a player token. Cannot rely on auth at
  call time.
- **Reads: same.** get_team_state_by_player_token, get_my_injuries,
  get_my_payment_history take tokens.
- **Identity narrowing: auth.uid() when present, gracefully no-op when
  not.** Migration 061's `CASE WHEN p.user_id = auth.uid() THEN
  p.token ELSE NULL END` pattern: if auth attached, the admin gets
  their player token; if not, nothing leaks and the admin just can't
  act as a player from /admin/ route in that session.
- **Auth.uid()-only paths are second-class.** MySquads accordion,
  league reads, account-link flow all use auth.uid(). They will fail
  for PWA users whose storage doesn't have a session. Acceptable for
  now; needs UX surface (auth-expired prompt) in a future cycle.

This posture does NOT preclude fixing the underlying iOS partition
issue. But it should mean that even if/when that fix lands, the
features that work today via tokens continue to work without depending
on the fix.

---

## OBSERVABILITY METHODOLOGY (session 41)

Every fire-and-forget RPC must INSERT into `audit_events`. Codified as
CLAUDE.md hard rule #9. Pattern from migration 060 extended to all
known player self-writes in 063. Every new player/self-write RPC must
follow.

Comparison of `metadata.session_present_client` (client says) vs
`actor_user_id IS NOT NULL` (server saw JWT) inside audit rows is the
canonical diagnostic for auth-attachment problems. Migration 064
adds `app_boot` action that captures this on every page load.

The methodology was the unlock that made session 41's diagnoses
possible — without it we'd have been guessing for hours about what was
actually broken.

---

## REALTIME PUBLISHER/SUBSCRIBER PAIRING (session 41)

Server-side `notify_team_change` was firing broadcasts to
`team_live:<key>` with nobody subscribed on the client. This sat in
the codebase for an unknown period — a write-only firehose. CLAUDE.md
rule #10 now requires: any RPC that publishes (notify_team_change,
realtime.send) must have a matching client subscriber, verified at
audit step. Topic, event name, and `private` flag must all match
byte-for-byte.

The 062 migration established the canonical pattern (public broadcast,
client subscribes via `supabase.channel('team_live:'+key).on('broadcast',
{ event: 'broadcast' }, ...)`). New realtime additions should follow.

---

## MIGRATION SOURCE-VS-LIVE INVARIANT (session 41)

If a migration is applied via `mcp__supabase__apply_migration`, the
source `.sql` and `_down.sql` files must land in the same commit.
Session 41's admin-badge work broke this temporarily (058 was applied
to live but its source file ended up in the held working tree). The
drift lasted ~4 sessions until session 44 finally committed the
source files alongside the held JSX work (commit `98b7ce6`).
CLAUDE.md rule #11 prohibits this going forward.

When a held cycle resumes, the in-flight migration source must be
committed alongside the cycle's other files. Better: don't apply
migrations during a held cycle if commit is uncertain.

---

## MULTI-SPORT POSTURE (session 40, migration 050)

The platform is designed to host non-football sports (cricket, basketball,
netball, hockey, walking football, futsal etc.) without rewriting the existing
football flows. The chosen posture:

- **Hard rule: zero renames of existing tables, columns, or fields.** Every
  existing football-named identifier (`matches.score_a`, `matches.motm`,
  `matches.scorers`, `player_match.goals`, `player_match.clean_sheet`,
  `player_match.yellow_cards`, `player_match.red_cards`, `players.bib_count`,
  etc.) stays exactly as it is. Renaming any of them is hundreds of files of
  churn for theoretical future value — rejected.
- **All NEW identifiers from Phase 0 onward MUST be sport-agnostic.** No
  "goal", "motm", "potm", "bib", "cleanSheet", "cards" in any new column,
  table, RPC, or JS identifier name unless the thing genuinely only ever
  applies to football and will never need a non-football equivalent. When in
  doubt, pick the generic word.
- **Source of truth: `league_config.sport`.** Single column, one row per
  league, default `'football'`. Phase 1 will add the same column to `venues`
  and `companies`.
- **`league_config.format` is open text** (no CHECK). Accepts football
  '5-a-side'/'7-a-side'/'11-a-side', cricket 'T20'/'ODI', basketball '5v5',
  netball '7v7', hockey '11v11', custom strings — no migration needed to add
  a new format.
- **`league_config.card_types text[]`** is already sport-flexible (cricket =
  empty, hockey = `{green,yellow,red}`, basketball = `{foul}`).
- **Labels (`game_label`, `squad_label`, `fixture_label`, `potg_label`, etc.)**
  are generic by name. Default values can be football-flavoured; the column
  names cannot.
- **Pattern for sport-specific stats when sport #2 lands:** add a
  `sport_stats jsonb` column to `player_match` and `matches`. Football
  continues to read/write the existing flat columns. New sports store their
  per-row shape inside the jsonb. New screens read from jsonb when the row's
  match_type sport ≠ football. Same pattern Stripe uses for payment method
  details. Zero refactor cost to existing football flows.

Full rationale: `/Users/tarny/.claude/plans/did-the-venue-league-velvety-token.md`
(section "Multi-sport posture") and `LEAGUE_MODE_SCOPE.md`.

## AUTH & IDENTITY

- **Token links always work** — no auth for day-to-day use. `/p/TOKEN` never requires sign-in.
- **Auth only required when joining a new team.** `/join/CODE` is the only auth gate.
- **Email is the identity** — not the name. `auth.uid()` → `user_id` on players row.
- **Returning player joining a new team** reuses the existing `players` row — new `team_players` entry only, no new players record.
- **Flat stat columns** (`goals`, `motm`, `bib_count`, `w`, `l`, `d`, `attended`) are cross-team lifetime totals on one row. `player_match` rows support per-team breakdowns. Don't treat flat columns as per-team.
- **`ioo_redirect_to` is iOS-only.** Write MUST be gated by `isIOS && !isStandalone`. Writing on Android/desktop causes disorienting forced redirects.
- **`onboarding_complete=true`** is written exactly once, at step 3 (ShareLinks.jsx handleGoAdmin). Step 2 leaves it false.

## RLS & WRITES

- **No direct table writes from the client. Ever.** All writes via SECURITY DEFINER RPCs.
- **No direct table READS from customer-facing client paths either.** Session 36
  established this as a hard architectural rule after the H2H + StatsView
  bugs surfaced. Direct `.from()` reads are an RLS-blind spot — they may work
  for some auth contexts (player-token sessions where the user is in
  team_players) and silently fail for others (anon callers on /demoadmin,
  admin sessions where the auth user has no team_admins row). Wrap reads in
  a SECURITY DEFINER RPC that takes `p_admin_token` (or `p_token`) and
  derives team_id server-side. Existing direct reads are accepted only
  inside the admin-token JS function as a fallback path for authenticated
  player sessions. See migrations 041 + 042 for the canonical pattern.
- **Admin RPCs derive team_id from p_admin_token server-side.** Never pass team_id as a trust signal from the client.
- **Demo team is not a valid test target for auth or RLS flows.** team_demo has seeded created_at dates and (until session 36) no team_admins row. Always verify against team_finbars or a fresh team.

## PWA INSTALL ARCHITECTURE (session 37)

iOS Safari **partitions installed PWA localStorage from the Safari context** that
hosted the install, AND **reads `<link rel="manifest">` at HTML parse time**
(ignoring later JS mutations). The combination means that JS-side breadcrumbs
written before install are invisible to the launched PWA, AND React-side manifest
swaps after page load are too late. The only reliable path is to bake the right
`start_url` into the manifest at HTML parse time.

**The install architecture:**

- **`apps/inorout/api/manifest.js`** — Vercel serverless function. Accepts
  `?admin=<admin_xxx>` OR `?player=<p_xxx>`, regex-validates the token format
  only (no DB lookup — keep it minimal, public, fast). Emits a personalised
  manifest with `start_url=/admin/<token>` or `start_url=/p/<token>`. Headers:
  `Cache-Control: no-store, max-age=0` + `CDN-Cache-Control: no-store`.
  **Never** does a DB lookup, never logs the token, never redirects.
- **`apps/inorout/index.html`** — inline `<script>` runs synchronously during
  HTML parse. Reads `window.location.pathname`, matches `/admin/<token>` or
  `/p/<token>`, and injects the right `<link rel="manifest">` URL. Falls back
  to the static `/manifest.json` for every other path. **The static link tag
  MUST NOT be restored** — iOS will use whatever's in the HTML at parse time
  and our personalised injection only works if there's no competing static
  link. Sentinel comment in HTML reinforces this.
- **`apps/inorout/vercel.json`** — adds `Cache-Control: no-store` to the static
  `/manifest.json` too, so an eager iOS pre-fetch can't pollute later installs.
- **Post-create flow** (`useOnboarding.submitTeam`) — after the `create_team`
  RPC succeeds, hard-redirects via `window.location.replace` to
  `/admin/<token>?just_created=1`. Without the redirect, the install would
  happen at `/create` where the inline script has no admin token to inject.
- **Post-join flow** (`App.handleJoin`) — same pattern. After `playerJoinTeam`
  succeeds, hard-redirects to `/p/<token>?just_joined=1`.
- **App.jsx overlays** — reads `?just_created=1` / `?just_joined=1` from URL
  + `sessionStorage` props, renders `SquadReady` / `JoinSuccess` as top-level
  overlays BEFORE any view-routing happens. (Was originally in AdminView but
  AdminView only mounts when user taps the admin tab — moved to App level so
  it shows immediately.)
- **App.jsx root manifest effect** — for returning admins/players hitting
  `/admin/<token>` or `/p/<token>` directly, swaps `<link rel="manifest">` href
  via useEffect. Defense in depth — covers SPA route transitions where the
  inline script already ran for a different URL.

**Future-proofing artefacts** (regression tripwires):

- `apps/inorout/public/manifest.json` carries a `_comment` field warning future
  contributors NOT to change `start_url` (the dynamic endpoint owns
  personalisation).
- `index.html`, `SquadReady.jsx`, `App.jsx`, `api/manifest.js` all carry
  block-comment sentinels above the critical sections, with rules
  ("deps MUST include adminToken", "NO cleanup function", "NO DB lookup",
  etc.) and pointers to this DECISIONS.md section.

**Known scope decisions:**
- The dynamic manifest is for **install personalisation only**. Cross-context
  install (in-app webview → Chrome) still requires the localStorage breadcrumb
  path + PWAWelcome polymorphic paste box.
- `name` / `short_name` are NOT yet team-personalised — every install shows
  "In or Out" on the home screen. Could be extended to include team name.

## SUPER-ADMIN DASHBOARD (session 39, migrations 045 + 046)

A separate app at `apps/superadmin`, deployed as a separate Vercel project
(`platform-superadmin`), behind Vercel team SSO protection. Not part of
`apps/inorout` — the player-facing PWA stays small, mobile-first, and free
of admin-only dependencies.

- **Authorisation:** new `platform_admins` table (global, cross-team), parallel
  to per-team `team_admins`. Helper `is_platform_admin()` gates every
  `superadmin_*` RPC. **Membership is granted by hand via SQL only** — there
  is intentionally no UI to add platform admins, so the role can never be
  accidentally escalated. Defence in depth on top of the Vercel SSO wall.
- **Read RPCs (Phase 1+2 shipped):** `superadmin_whoami`,
  `superadmin_list_teams`, `superadmin_team_detail(team_id)`,
  `superadmin_recent_activity(limit, since)`. All SECURITY DEFINER + STABLE,
  all return jsonb, all start with `IF NOT is_platform_admin() THEN RAISE
  EXCEPTION 'forbidden';`.
- **Write RPCs (Phase 3+4 deferred):** token rescue (reset admin token,
  regenerate player token, add self as team admin) + data fix (override
  match result, mark/refund payments, clear injury, force-confirm teams).
  Every write will insert an `audit_events` row with `actor_type='super_admin'`
  and `actor_user_id=auth.uid()` for a clean intervention trail (the
  `audit_events.actor_type` CHECK constraint already permits this value).
- **UI:** Vite + React 18, plain dark admin styling, no framer-motion, no
  PWA, no PostHog. Three tabs: Activity (audit_events tail), Teams
  (sortable list), Team Detail (drilldown). Read-only in v1.

## PUSH NOTIFICATION URL RULE (session 39)

**All server-to-self HTTP calls must use the canonical
`https://www.in-or-out.com`, never the apex `https://in-or-out.com`.**

Why: the apex 307-redirects to www. All sane HTTP clients (browsers,
curl with `-L`, `pg_net`, server-side fetch) **strip the `Authorization`
header when following a cross-host redirect** as a security measure. So
calling `https://in-or-out.com/api/notify` with a bearer token results in
the bearer being dropped at the redirect → the function sees no auth → 401.

Surfaced as a 73.7% Vercel error rate on Beta launch day. All six pg_cron
notification jobs were using the apex URL — bug latent since cron setup,
masked for weeks by parallel VAPID empty-string crashes. Once the VAPID
500s were fixed, the auth-strip 401s appeared.

Applied to:
- `cron.job` rows 1–6 — rewritten via `cron.alter_job` (apex → www)
- Any future internal HTTP call (edge functions, webhooks) must follow
  the same rule. Comment in migration 049 documents the gotcha.

## WORKSPACE DEPS MUST BE REAL PACKAGES (session 39)

**Every `@platform/*` listed as a dep in any `apps/*/package.json` or
`packages/*/package.json` must resolve to a real workspace package** —
i.e. there must be a corresponding `packages/<name>/package.json` with the
matching `name` field. Vite aliases (in `vite.config.js`) are configured
separately and must NOT appear as deps.

Why: Vite aliases work at build time, inside the bundler — npm has no idea
they exist. Local builds happily resolve them, but Vercel's `npm install` in
a fresh container goes to the npm registry for `@platform/*`, gets a 404,
and **aborts the entire workspace install** — breaking every other app in
the monorepo at the same time. Discovered the hard way when the superadmin
scaffold's first commit listed `@platform/supabase` (which was only ever a
Vite alias) as a real dep, taking down platform-clubmanager's CI.
`www.in-or-out.com` was protected only because Vercel "only promotes on
success" — but the deploy pipeline was blocked until the fix landed.

Enforced by `Skills/scripts/check-workspace-deps.sh` — a pre-commit hook
that fails fast if any `@platform/*` dep can't be resolved to a real
workspace package. Sub-second jq check, called from `check-build.sh` before
the build itself runs. Negative-tested by re-adding fake deps; the hook
blocks the commit with actionable error text pointing at the file and the
offending dep.

Bonus correction landed at the same time: the `@platform/core` Vite alias
target changed from `packages/core/index.js` (a specific file, so subpath
imports like `@platform/core/storage/supabase.js` were broken) to
`packages/core` (the directory, so Node + Vite resolve via the package's
`exports` map).

## ACCOUNT DELETION FK PURGE (session 37, migration 047)

`delete_my_account` MUST purge every public-schema FK that references the
user's `auth.users.id` before the edge function calls
`auth.admin.deleteUser()`. The 040 version anonymised the player row but
revoked (instead of deleting) team_admins rows and never touched
user_profiles — so Postgres refused the auth.users delete (NO ACTION FKs),
the edge function returned `ok:true,authDeleted:false`, and the auth row +
identity stayed forever. That orphan blocked the email from ever signing in
again with the same OAuth provider (Supabase finds the identity, looks up
the missing user_id → 404 "User not found" → silent OAuth loop).

**Rule:** any new public table that references `auth.users.id` with NO
ACTION MUST be added to the cleanup block in `delete_my_account`. CASCADE
FKs are fine as-is.

**Currently cleaned:** user_profiles (DELETE), team_admins.user_id (DELETE
own rows), team_admins.granted_by / revoked_by (NULL), platform_admins.granted_by (NULL).
**Auto-cascaded:** platform_admins.user_id (CASCADE), auth.identities (cascades when
auth.users is deleted by admin API).

Edge function carries a comment with the manual cleanup SQL for stuck accounts
if this ever surfaces again.

## ADMIN STATUS LOCK (session 34, migration 038)

- **Admin-set IN is asymmetric.** When admin sets a player to `in` via
  `admin_set_player_status`, `players.admin_locked_in` flips true. The player
  can still self-decline to out/maybe/reserve from `/p/TOKEN`, but cannot
  self-restore to IN — server returns `admin_locked_in` and rejects the write.
  Only admin can re-confirm them as IN. Any admin status change to
  out/maybe/reserve/none clears the lock. Rationale: an admin's IN reflects
  intent ("you're playing this week"), not a player declaration; a player
  flipping out shouldn't be able to silently re-promote themselves back into a
  squad the admin has now closed.
- **Squad-cap is enforced server-side on both paths.** Both
  `admin_set_player_status` and `set_player_status` refuse `in` if the active
  schedule's `squad_size` is met (raise `squad_full`). Client gates the IN
  button on top. Race window between count check and update is accepted —
  amateur-team scale, row-level locking would be disproportionate.
- **Injury override is a confirm, not a refuse.** Admin can set an injured
  player to IN/MAYBE/RESERVE but must confirm via modal. The injury flag is
  preserved; admin can clear it separately. Rationale: edge cases exist
  (player insists they're fine; admin updating retrospective status) and
  silent auto-clear would lose audit signal.
- **`admin_locked_in` is included in the admin-side state read only.**
  `get_team_state_by_admin_token` returns it; player-side reads do not. Player
  UI does not show a lock badge — server rejects with a clear error if they
  try, surfaced via the existing error-toast pipe. Minimal scope; revisit if
  the rejection error proves confusing in practice.

## PLAYER PROFILE & SELF-SERVICE ACCOUNT ACTIONS (session 35, migrations 039–040)

- **One PlayerProfile file serves both contexts.** `isAdminView` prop switches
  mode. Player mode is the default; admin mode is a graft (extra sections +
  branched RPC paths, destructive zone swap). Rationale: the screen scaffold
  (sticky header, identity, Stats/Payment/Injuries sections) is identical
  across both — two files diverged on accident, not on purpose, and any
  future improvement had to be made twice.
- **Player-facing profile entry is a top-left avatar overlay on PageHeader.**
  Universal pattern (Instagram, WhatsApp, Discord). Doesn't push other
  content down — overlays absolute-positioned, IN OR OUT logo recentred via
  negative `marginLeft` to compensate. Avatar only renders when both `me`
  and `onAvatarTap` are passed, so the admin's PageHeader is unaffected.
- **Payment History accordion moved out of MY VIEW into Profile.** MY VIEW
  keeps current-week live payment state (Pay buttons, debt clear) in the
  response card. Historical ledger is reference data and belongs in Profile.
  Same UI pattern, just relocated; ~80 lines off PlayerView.
- **Leave squad ≠ Delete account.** Two distinct affordances:
  - **Leave squad** = soft remove from this team only. Player row + history
    (player_match, payment_ledger, player_injuries, potm_votes) preserved.
    Player can rejoin via invite link. Auth account untouched. UI: two-tap
    confirm with 4s reset window.
  - **Delete account** = hard nuke of the auth account, but FK-preserving on
    historical data. Players row is anonymised (name → "Deleted player",
    token/user_id/nickname cleared, disabled=true, disable_reason set), then
    detached from all teams. push_subscriptions + player_career deleted.
    Admin grants revoked. Edge function (`/api/delete-account`) calls
    `supabase.auth.admin.deleteUser` after the RPC. UI: glass modal with
    typed-DELETE guard.
- **Anonymise rather than delete on hard-delete.** Historical FKs (POTM
  votes, goal scorers, attended counts on past matches) stay intact so team
  records aren't corrupted, but identifiers are scrubbed for the GDPR-style
  "right to be forgotten" intent. Players row remains because deleting it
  would cascade-break per-match attendance, scorer lists, and POTM history
  that other team members still need to see.
- **Leave squad is debt-blocked, not attendance-blocked.** Refuses with
  `debt_owed:<amount>` if `owes > 0`. Anyone can leave once they've settled
  — even with attendance history. Different from admin's `admin_delete_player`
  which has the stricter `has_history` guard (forces admin to use Disable
  instead). The asymmetry is deliberate: admins shouldn't lose someone's
  history accidentally; players asking to leave have made an explicit
  decision and shouldn't be trapped.
- **Last-admin guard on delete_my_account.** Refuses with `last_admin:<csv>`
  (list of blocking team_ids) if the user is the only non-revoked admin of
  any team. Forces handover first to avoid orphaning a team. Same pattern
  Discord/Slack use for server ownership.
- **Token resolution for player RPCs goes through team_players join.** All
  four new RPCs (`get_my_payment_history`, `get_my_injuries`, `leave_squad`,
  `delete_my_account`) resolve `(player_id, team_id)` from `players.token`
  via team_players, mirroring the established `set_player_injured` pattern.
  Grants: `anon` + `authenticated` because `/p/TOKEN` runs unauthenticated.
- **VC toggle stays inside PlayerProfile (admin mode only).** Considered
  moving to a Roles section in Match Settings, but kept here because it's
  a per-player decision admins reach via the squad row → profile drilldown
  flow they already know. Standalone Roles area is a Phase 2+ consideration
  if multi-VC patterns emerge.

## PAYMENTS

- **Payment model:** cash only for Stage 1/2. Stripe slots in later.
- **`handleCashPayment` sets `self_paid=true` (not `paid=true`).** Player sees amber "Awaiting confirmation". Admin confirms → `handleMarkPaid` sets `paid=true`.
- **`selfPaid=true` still counts as paid** in PaymentsScreen — admin confirmation is a UX signal, not a payment gate.
- **Ledger cross-path:** player self-pays before lineup lock (matchId=null entry). When admin marks paid with real matchId, `handleMarkPaid` promotes the null entry rather than creating a duplicate.
- **PostgREST `.upsert()` cannot target partial unique indexes.** Use INSERT + catch `23505` instead.
- **`owes` double-increment guard:** `updatePlayerRecords` in ScoreScreen is the sole owes-increment path. `carryForwardDebts` removed session 26. Do not add a second increment path.

## STATS & DISPLAY

- **`player_match` is the source of truth for all stats.** `players` flat columns are write-only convenience fields, not used for display.
- **Reliability is always all-time** — never period-filtered. Numerator (`allTimePlayed`) and denominator (`totalTeamGames`) both use all-time queries. Reliability is a player trait, not a period stat.
- **H2H `dominantType`** is always team-wide all-time regardless of period selector — it's a UI presentation decision, not a stat. Team scoring style is stable; don't thrash it on period change.
- **Goals only counted** where `score_type = null OR 'exact'`. Use `hasGoalData(scoreType)` helper for all goal-related computation.
- **`matches.motm` stores player_id, NOT name.** Use `resolveMotm(motmValue, players)` for display. `isWinner` checks use ID comparison (`match.motm === me.id`).
- **`matches.bib_holder` stores player_id for new rows.** Legacy rows may have name strings. Use `resolveBibHolder(value, players)` which handles both.

## NAMING CONVENTIONS

- **POTM in UI, `motm` in DB/code** — never change DB column names.
- **Results in UI, `history` in filenames/functions** — never change.
- **`is_vice_captain` lives on `team_players`** (per-team), not `players` (global). Migrated session 26.

## ARCHITECTURE

- **VC access = full AdminView minus Rotate Admin Link.** Scoping done via `isViceCaptain` prop throughout. `role_scope` on players is dormant (Phase 2 RBAC).
- **`addPlayerToTeam` is the correct function for admin-adding players** — writes both `players` row and `team_players` link, generates token. `upsertPlayer` does NOT write `team_players` and must not be used for this purpose.
- **App.jsx state wrappers (`setSchedule`, `setSettings`) are pure setters.** Never add DB calls inside them. Child screens call RPCs explicitly before calling the setter for UI sync.
- **iOS localStorage does NOT bridge Safari to PWA.** Treat them as separate contexts.
- **`ioo_last_visited`** — permanent. **`ioo_redirect_to`** — one-time, 7-day, iOS only.
- **Multi-team admin:** Phase 2. Multi-team player switcher already built (MySquads.jsx, session 26).
- **PostgREST self-join workaround:** `getMostPlayedWith`, `getNemesis`, `getBestPartnership`, `getPlayerImpact`, `getPOTMEligiblePlayers` all use two sequential queries + JS computation. PostgREST foreign key joins unreliable in this config.
- **Install ("Add to Home Screen") UX is shared across join and create flows.** Lives in `apps/inorout/src/components/InstallSection.jsx` — platform-detected inline block (iOS 4-step carousel, Android numbered steps, desktop copy-link), no outer shell or CTA. Parent screens (`JoinSuccess`, `SquadReady`) own page chrome + sticky CTA + PostHog event with `flow: "join" | "create"`. Standalone PWA users get the section auto-hidden (returns `null`). Desktop copy-link target: join URL for the join flow, **admin URL for the create flow** — admins reopen the admin panel on phone to install (session 30).
- **TeamsScreen is "Smart by default" — auto-Smart fires on entry** when the match has no saved teams. LiveBoard (two-column A | B grid mirroring PlayerView's confirmed-teams tile) is the primary surface; tap-to-move between teams. The old per-row A/B button list was removed entirely. SMART panel opens by default with Group 1 + Group 2 seeded. BUILD TEAMS is a contextual gold CTA that only appears when groups have been edited since the last algorithm run. Decided session 31.
- **Game-live toggle hides when live.** Off state: "Make this week's game live" + slider. On state: pulsing green dot + "LIVE" badge, no slider. Admin uses Cancel This Week to go offline. Removes the ambiguous "Game is Open / Closed" wording (session 31).
- **Reopen-after-cancel creates a fresh match.** Cancelled match stays in history with `cancelled=true`. New `admin_reopen_week` RPC handles the full transaction (clear is_cancelled, insert new matches row, point active_match_id at it). Keeps the audit trail honest and avoids un-cancelling payment ledger refunds (session 31).
- **Admin-configured `schedule.dayOfWeek` is authoritative over the `gameDateTime`-derived weekday** in player-facing copy. The demo schedule had drift between the two (day_of_week='Wednesday' but timestamp on a Tuesday); when they disagree, the configured day wins. Session 31.
- **Status confirmation banners are one-shot, not persistent.** "🔒 Locked in", "👍 No worries", "🤞 Got it" etc. flash up for 5s after a setStatus tap, then slide-fade. They do NOT resurrect on page refresh. `hideConfirmation` initial state is `true` (session 31).
- **IO deeper-intel is computed client-side, not via RPC.** `packages/core/engine/deeperIntel.js` derives mostPlayedWith, mostFacedOpponent, nemesis, bestPartnership, impact, reliabilityRanking from `matches[]` + `squad[]` already in state. No new RPC, no schema change, no extra round-trip. Chosen over extending `get_team_state_by_player_token` because the source data is already loaded on every route and the computation is cheap. Phase 0B (Casual/Competitive split) will pre-filter `matches[]` before this engine sees them, so the cards inherit the filter for free (session 32).
- **MyIOView.jsx is exempt from the hex-literal hygiene check.** Documented in `skills/scripts/check-hygiene.sh` header. Rationale: CLAUDE.md itself mandates hex literals inside SVG fill/stroke (CSS vars don't work there) and this file is overwhelmingly SVG badge crests and gradient overlays. Same exemption pattern as `constants/colors.js`. If extending: keep new colours in the INSIGHTS array, not scattered through the file (session 32).
- **Smart Teams adoption analytics: rich `team_confirmed` event as the anchor.** Carries `manual_moves_before`, `manual_moves_after`, `regenerate_count`, `was_ai_picked_as_is`, `is_recommit`, plus prediction fields and team sizes. Secondary events (`team_drafted_auto`, `team_player_moved`, `team_regenerated`, `team_cleared`) fire alongside but the confirm event is what the dashboard queries. Session 31.

## SCHEDULING & CRON

- **`is_draft` is NOT the auto-open flag.** `is_draft=true` means onboarding incomplete only. `auto_open_pending=true` is the auto-open flag — reset weekly by `advanceGameDateJob`.
- **`advanceGameDateJob`** resets `auto_open_pending=true` weekly so games auto-open next week without admin action.
- **Lineup lock window:** first cron tick at or after kickoff (real-world window: kickoff → kickoff+15min depending on cron cadence). Requires `game_is_live=true` and `lineup_locked=false`.

## BETA PLAN

- **Stage 1:** team_finbars (Finbar's Tuesdays). Beta held — currently stabilising bugs.
- **Stage 2:** May 26 — Monday Footy added if Stage 1 week 1 is clean.
- **Broader beta:** ~Jun 9 — anyone willing to mandate the app.
- **Quiet public availability:** late Jul / early Aug.
- **Beta deal:** free forever for first 10 teams. Cash/bank transfer. Stripe fees only if Stripe lands.

---

## MID-GAME TEAM SWITCHES (Phase 2 — spec agreed)

- New stage in ScoreScreen between score entry and bibs
- Admin marks players who switched teams during the game (⇄ swap icon next to name)
- `team_switches jsonb` column on matches: `[{player_id, from: "A", to: "B"}]`
- `team_a`/`team_b` on match updated to reflect FINAL team assignments after switches
- `player_match.team_assignment` records the final team — W/L/D derived from that
- Match history shows ⇄ icon next to any player who switched
- Switch time not recorded — binary only
- Stage is optional — if no switches, admin skips through

---

## APPLE WATCH GOAL LOGGER (Phase 3 — spec agreed)

- Requires native iOS app (Capacitor) as container first
- watchOS extension in Swift/SwiftUI alongside Capacitor — not possible via Capacitor alone
- Interaction: tap team A/B → crown scroll to player → tap confirm → goal logged to Supabase
- Haptic confirmation on goal log
- Estimated effort: ~20h Capacitor iOS + ~8h watchOS = ~28h total
- Prerequisite: Apple Dev account £79 (same as Apple Sign In)

---

## PHASE 4 — LEAGUE MODE (superseded — now active programme)

The parked vision is no longer parked. Migrations 050–057 (session 40) shipped
the full schema spine — `venues`, `leagues`, `fixtures`, `match_officials` (was
`referees`) and 17 sibling tables all exist. Full active spec in
`LEAGUE_MODE_SCOPE.md`; Phase 2 (customer-visible surfaces) is the next cycle.

**Open schema questions inherited from the original Phase 4 vision (still latent):**
- `player_match.team_assignment`: may need to reference team_id not just 'A'/'B'
  once cross-team competitive fixtures land.
- `matches.motm`: may need to allow array (one POTM per side) for inter-team
  fixtures.

Decide both when Phase 2 RPC design touches `fixtures` ↔ `matches` ↔ `player_match`.

---

## GROUP BALANCER

- **Tap-to-assign over drag-and-drop.** Chosen for mobile reliability,
  accessibility, zero library footprint, and ~2–3h faster Stage 3 build. Drag
  was rejected (dnd-kit, Framer Motion, react-beautiful-dnd all considered).
  Drag is "playful" but the value of a balancer is *who ends up on each team*,
  not the gesture used to assign them. Tap → panels glow as targets → tap to
  commit. Tap outside cancels.
- **Win rate is the only signal.** No MMR, balance scores, or per-player
  numerical signals — keeps the system simple and avoids any path toward
  player-visible rankings. Random tiebreak within 5% of best score gives
  rerolls varied feel.
- **Group numbers are admin-only.** Never expose to player routes. Enforced by
  RLS (no anon read on `team_players.group_number`) and a header comment in
  `packages/core/engine/groupBalancer.js`.
- **`generateBalancedTeams` is a pure engine function**, no Supabase calls.
  Reusable by Ask the Gaffer Phase 2 (fair team suggestions) without
  reinventing the algorithm.

Full spec: `GROUP_BALANCER.md`.

---

## ASK THE GAFFER

- **Football-operations agent, not a generic chatbot.** Must be grounded in
  team data (`player_match`, `bib_history`, `team_players`, `matches`,
  `team_switches`, `ledger`). Feel: "a smart assistant for the organiser who
  already knows the squad."
- **Four-phase trust-graduated rollout:**
  1. Read-only assistant (Q&A, summaries, briefings)
  2. Recommendations (drafts shown, no actions taken)
  3. Confirmed actions (admin one-tap approve buttons fire existing RPCs)
  4. Semi-autonomous (auto-detect short squads etc.) — only after trust
     proven
- **Anything visible to players requires admin approval, even in Phase 4.**
  Hard rule.
- **All writes via existing SECURITY DEFINER RPCs.** No new direct-write
  paths for the agent. Auth via `adminToken` per RLS checklist.
- **LLM provider + data-access pattern** deferred until Phase 1 scope opens
  (cost is the primary factor).

---

## MARKETING LANDING PAGE

- **Beta:** Option A — conditional render at root. Single Vercel project,
  unauth + no token + root path → render landing, else app shell. Zero
  infrastructure change, preserves all existing `/p/TOKEN`, `/create`,
  `/join`, `/demoadmin` URLs.
- **Post-public-launch:** Option B — subdomain split (`in-or-out.com` =
  marketing, `app.in-or-out.com` = app). Requires updating Supabase OAuth
  callbacks, redirecting in-the-wild `/p/TOKEN` links, re-checking
  push-notification origin scope. Planned migration, not now.
- **Why now:** beta needs a public-facing landing page to capture sign-ups
  and run ads. Option A ships in a day; Option B is 1–2 days plus settle-in
  risk on existing share links.

---

## H2H DESIGN DECISIONS

- **Two matches queries:** Query 1a all-time (for `dominantType`), Query 1b period-filtered (for stats). One extra query per H2H open in 'all' mode — clarity wins over optimisation.
- **Sample size floors:** chemistry refuses to fire with < 3 games of each baseline. Main verdict requires ≥ 3 `totalShared`. Section 2 streak softens "1 in a row" to "won the last meeting".
- **Score type gating:** use `hasGoalData(scoreType)` for any goal computation. Filter data set first, then reduce over filtered set AND divide by filtered count (not unfiltered) so averages are honest.
- **`meRows`/`themRows` filtered by `matchMap` membership immediately after Query 2.** `matchMap` contains only period-filtered match IDs and is the single period-gating point — all downstream computation inherits period scope automatically.

---

## IO INTELLIGENCE

- **4 tabs for players, 5 tabs for admins.** 5th tab appears when `onAdminClick` prop is truthy (not an `isAdmin` prop).
- **Unlock thresholds are per-player per-team.** Progressive reveal based on `gamesPlayed`.
- **`useIOIntelligence.js` is a pure passthrough** — takes `stats` prop from state RPC, makes no direct Supabase calls. Rewritten session 25.
- Full IO spec in `IO_INTELLIGENCE.md`.

---

## MOTION & ANIMATION (session 36 — pre-launch polish)

- **framer-motion@12 is the standard motion primitive.** Installed in
  `apps/inorout` for the pre-launch UX overhaul. CSS keyframes are no
  longer used for component-scoped motion; they remain valid only for
  global utility animations (e.g. the `ioo-blink` live-game dot).
- **Motion must do real work.** Every animation maps to a moment that
  benefits from kinetic feedback — state change, reveal, reward, spatial
  continuity. No decorative fades. No hover effects on mobile-first
  surfaces. No animations that delay critical info (scores, fixtures,
  availability).
- **Shared-element pattern via `layoutId`** is the right tool for
  spatial continuity (e.g. PageHeader avatar → PlayerProfile big avatar
  morph, period-selector pill morph between tabs).
- **AnimatePresence + `popLayout` mode** for staggered enter/exit on
  lists where the items might be re-keyed (e.g. TeamsScreen shuffle —
  chips fade-shrink out and deal in with stagger keyed by shuffleNonce).
- **Springs over easings for arrival moments.** Use `type:"spring"` with
  damping 14–32 (lower = more bounce, reserve <16 for celebratory
  moments like POTM lock-in trophy). Use `easeOut`/`easeInOut` cubics
  for measurable durations (e.g. comparison bars filling — `[0.22, 1, 0.36, 1]`
  for a confident decelerating fill).
- **Counters use motion-value pattern, not React re-renders.** `animate(0, value, { onUpdate: v => node.textContent = ... })` writes DOM
  directly; avoids per-frame React reconciliation for ramping numbers.
- **Dwell time matters as much as entry time.** When an animation
  celebrates state (e.g. POTM "VOTE LOCKED IN"), extend the auto-close
  long enough for the user to register the reward — first-pass 3s was
  too tight (1.6 float cycles, read as twitch); 4.5s gives ~2.7 cycles
  which reads as intentional celebration. The cache-window math from
  ScheduleWakeup is irrelevant here — only the user-perception math is.
