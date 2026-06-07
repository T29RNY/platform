# In or Out — Feature Tracker
*Last updated: Jun 7 2026 (session 73 — remaining-work snapshot added at top; display re-skin wireframe shipped)*

---

## REMAINING WORK SNAPSHOT (session 73, 2026-06-07)

At-a-glance of everything left, across all surfaces. Status: 🔴 not started · 🟡 partly done · 🟢 built, only deploy/test owed. Detail for each lives in the per-phase sections below.

| Area | Task | Type | Status |
|---|---|---|---|
| Website / marketing | Deploy + wire the landing pages (`marketing/` — players + venues; design & motion done) | Infra/UI | 🟡 built, not deployed |
| App wrapping | Wrap the PWA as native iOS/Android app for the app stores (Capacitor/TWA) | Infra/New | 🔴 not started, not yet scoped |
| League — Display (TV) | Final visual design (wireframe baseline shipped session 73) | UI | 🟡 wireframe only |
| League — Display | Sponsor-image upload in venue settings (backend field already persists via `display_config`) | Backend+UI | 🔴 deferred |
| League — Display | Deploy `apps/display` to its own Vercel project + wire `VITE_DISPLAY_APP_URL` | Infra | 🔴 deferred |
| League — Display | Real-TV device test (wake-lock, reconnect, PIN, colours) | Test | 🔴 owed |
| League — Display | Nice-to-haves: display-token rotation, enterprise white-label removal | UI/Backend | 🔴 deferred |
| League — Ref app | Visual redesign sweep (functional & complete; styling deliberately bare) | UI | 🔴 deferred |
| League — Venue | Read-RPCs for team rosters / players / standings views | Backend | 🟡 some screens need data first |
| League — Venue | Skin those screens once data exists | UI | 🔴 blocked on above |
| League — Venue | Logged-in browser passes (payments screens etc.) | Test | 🟢 owed |
| HQ dashboard | Final visual polish + `regional_admin` region-filter UI | UI | 🟡 functional, polish pending |
| HQ dashboard | Deploy `apps/hq` to Vercel | Infra | 🔴 owed |
| HQ dashboard | Logged-in (Google-OAuth) browser passes — several surfaces | Test | 🟢 owed |
| AI — Phase 7 | "Ask the Gaffer" AI layer (team + HQ); HQ Weekly Brief rides on it | New feature | 🔴 not started (the big one) |
| Public — Phase 10 | Public, no-login league/standings/fixtures pages | New feature | 🔴 not started |
| HQ Intelligence — Phase 3 | Competition & Team-Risk analytics (at-risk teams, fill rate, completion) | Backend+UI | 🔴 not started |
| HQ Intelligence — Phase 4 | Weekly HQ Brief (auto-written) — depends on Phase 7 | New feature | 🔴 blocked on Phase 7 |
| HQ Intelligence — Phase 5 | "The Moat" (migration maps, dynamic pricing, etc.) | New feature | 🔴 far future |
| Payments | Venue Ledger **V5** — online card payments (Stripe Connect + Apple/Google Pay) | Backend/New | 🔴 deferred (cash/transfer tracked now) |
| Billing — Phase 8 | Self-serve SaaS subscriptions/billing | New feature | 🔴 deferred to year 2 |
| Operational | SMS/WhatsApp real-delivery once `TWILIO_*` env set | Test/Config | 🟢 owed (no-ops until keys set) |
| Operational | Monday HQ digest delivery eyeball once `RESEND_API_KEY` live | Test/Config | 🟢 owed |
| Operational | Real-iPhone passes: persistent guests, cups player view, reserve/injured (session 73) | Test | 🟢 owed |

**Net-new features left:** Phase 7 (AI) · Phase 10 (public pages) · HQ-I Phase 3. (Phase 8 billing + Payments V5 deliberately later.)
**Wrap-up (not new features):** the league/venue/HQ/display skins · deploying display + HQ + landing pages · native app-store wrapping (unscoped).

---

## PERSISTENT GUESTS — design (session 71, operator-approved decisions; NOT yet built)

**Problem.** Today a guest (+1) is a throwaway `players` row (is_guest=true, guest_of=host)
that is **hard-deleted on the weekly rollover** (migs 207/209) and by remove_guest_player. So:
no retained history, no accumulation, no way to promote/link to a member, and deleted-guest ids
linger unresolved in `matches.team_a/team_b` (raw ids shown in Results — operator screenshot).

**Why deletion exists (the tension to design around).** mig 207 deleted guests to fix a real
bug: a *leftover* guest row made the host's "Plus One" button disappear every week. Root cause
was conflating "person exists on the team" with "person is in THIS week". The future-proof fix
separates those — reusing the per-week `status` mechanism regulars already have.

**Target model.** A guest is a **first-class, persistent `players` row** that is never auto-
deleted; `is_guest=true` just means "brought by a host, not yet a self-managing member."
- **Persist + accumulate:** guest rows + their `player_match` history are never deleted, so
  appearances/stats build up.
- **Per-week participation:** on rollover a guest is reset to **dormant** (status='none',
  team=NULL, admin_locked_in=false) — NOT deleted. Dormant guests are hidden from the weekly
  board but stay in the team's guest roster.
- **Plus One logic** keys on "host has an ACTIVE guest this week" (a guest with guest_of=host
  AND status active), not "a guest row exists" — so a dormant guest never blocks the button.

**Operator-approved decisions (session 71):**
1. **Returning guests:** when a host taps "Plus One", they pick from the team's past guests
   (re-activate, keeping history) OR add a new name.
2. **Stats:** a guest's games accumulate on **their own record only**; they stay OUT of the
   team reliability table + POTM until promoted. (Keep the existing `is_guest=false` filters;
   promotion flips the flag and they start counting automatically.)
3. **Promotion:** BOTH — admin "make permanent" from the squad, AND guest self-claim on signup
   (link the existing guest row to their account). Either way history carries over (same row).

**Build slices (each its own audit→execute→verify→commit, EV + casual-regression):**
- **S1 — Foundation (stop deleting): ✅ SHIPPED (session 72, mig 216).** rollover RPCs
  (admin_go_live / admin_go_live_for_team) reset guests to dormant instead of deleting;
  remove_guest_player → dormant (not delete); board/squad rendering hides dormant guests via a
  shared `isDormantGuest(p)` engine helper (PlayerView board, AdminView squad + guest-count +
  orphan-detection, Payments guest list, Stats guest count, SquadScreen guest filter);
  get_team_state still exposes guests in the squad payload for S2's picker (no RPC shape change).
  **Keystone:** PlayerView `myGuest` now keys on an ACTIVE guest (status!=='none') so a dormant
  row no longer blocks the Plus One button. mig 216 is PURE function-redefinition (no row
  mutation) — reverses ONLY the guest-delete portions of migs 207/209; the existing mig-204 bulk
  status reset already leaves guests dormant. EV 7/7 + leak 0, casual-regression browser PASS,
  RPC-security-sweep PASS, live 14-ins invariance proven. *Operator owes the real-iPhone board
  test (Hard Rule 13) — confirm board renders + Plus One appears after a rollover.*
- **S2 — Returning-guest picker: ✅ SHIPPED (session 72, mig 217).** New
  `reactivate_guest_player(p_token, p_guest_id)` RPC (dedicated sibling, not an `add_guest_player`
  overload) brings a dormant team guest back: re-attaches `guest_of` to the calling host,
  `status='in'`, `team=NULL`, fresh per-week payment baseline, **keeps accumulated stats +
  player_match history**. PlayerView Plus One form gains a "Bringing someone back?" picker
  listing `squad.filter(isDormantGuest)` (no new fetch — dormant guests are already in the S1
  squad payload); tap a chip to re-activate, or use the existing name input for a new guest.
  EV 6/6 + leak 0 (stats/history preserved, payment reset, re-attach, bad-id + non-guest
  rejected), casual-regression browser PASS (empty-picker path byte-identical for teams with no
  dormant guests), RPC-security-sweep PASS, build clean, hygiene 7/7. *Operator owes a real-team
  eyeball of the picker once a dormant guest exists (next rollover) + Hard Rule 13.*
- **S3 — Promotion + self-claim: ✅ SHIPPED (session 72, mig 218).** Both routes land on the SAME
  row (history carries over). **Admin:** new `admin_promote_guest(p_admin_token, p_guest_id)`
  (resolve_admin_caller → VC parity) flips `is_guest=false, guest_of=NULL`, keeps token/status/
  stats/history; SquadScreen kebab gains a green "Make permanent" item; the admin "Guests" filter
  now shows dormant past guests too (DORMANT pill); "Copy personal link" enabled for guests so the
  admin can send the claim link. **Self-claim:** `link_player_to_user` gains a GATED promote-on-link
  branch — a guest sent their own `/p/<token>` link signs in and that row is promoted+linked (the
  token IS the identity, no name-matching); regulars are untouched (`is_guest=false` skips the
  branch). New `promoteGuest` wrapper + barrel. EV 5/5 + leak 0 (admin promote keeps stats/history/
  token; self-claim promotes a guest but leaves a regular's link unchanged; bad-token + non-guest
  rejected), casual-regression browser PASS, RPC-security-sweep PASS, build clean, hygiene 7/7.
  *Auth RPC touched → operator owes real-iPhone test (Hard Rule 13): sign in via a guest link →
  becomes permanent; and a normal sign-in still works.* **Guest link distribution UX** (a dedicated
  "send claim link" button vs the copy-link menu item) can be polished later if needed.
- **S4 — Legacy display:** already-deleted guests (e.g. 2 Jun match) are gone for good — show
  "Guest" for any unresolved `p_…` roster id (HistoryView). Handles orphaned history forever.
- **S5 — Stats verification: ✅ SHIPPED (session 72, mig 219).** Audit confirmed the PRIMARY team
  reliability/stats table (both routes — `getPlayerLeagueTable` + StatsView, and its derived
  POTM-awards/top-scorer/win%/bibs leaderboards) already excludes guests via `is_guest` filters
  that read the LIVE flag, so a promoted guest auto-appears (decision 2 core guarantee). Closed two
  gaps the audit surfaced: (1) **MY IO reliability ranking** (`deeperIntel.reliabilityRanking`)
  filtered nothing → now `.filter(p => !p.isGuest)`; (2) **POTM** — `get_potm_voting_state` already
  excluded guests from the nominee list, but `submit_potm_vote` / `get_potm_tally` /
  `admin_close_potm_voting` didn't enforce it (mig 219): guest nominee rejected
  (`nominee_not_eligible`), guests dropped from the tally, guest winner refused
  (`winner_not_eligible`) — all keyed on the live `is_guest` flag so a promoted guest is eligible
  automatically. EV 6/6 + leak 0 (guest barred as nominee/tally/winner; promoted guest counts),
  RPC-security-sweep PASS, build clean, hygiene 7/7. **Remaining (low, documented in BUGS):** the
  Gaffer AI-context RPC `gaffer_get_context_team_summary` top-reliable list doesn't filter guests
  (AI context only, not a user-facing table) — deferred.

**PERSISTENT GUESTS EPIC — ✅ COMPLETE (S1–S5, session 72).** Guests persist as dormant rows,
returning-guest picker, promotion (admin + self-claim via token link), legacy "Guest" display,
and stats/POTM exclusion-until-promoted all shipped. *Operator owes the real-iPhone passes flagged
per slice (Hard Rule 13): board + Plus One (S1), picker (S2), guest-link sign-in promotion (S3).*

**Reverses:** migs 207 (guest delete) + 209 (guest child cleanup) — superseded by the dormant
model. Their orphan-cleanup value remains for the already-deleted past guests.

---

## LEAGUE MODE — ROADMAP & VENUE-SURFACING GAPS (noted session 55, updated 56)

**Phase 5 COMPLETE. Phase 4 COMPLETE** (reception display). **Phase 9 COMPLETE** (email + SMS/WhatsApp transport + reminder crons + player channel fallback + HQ weekly digest — session 66). **Phase 6 functionally complete** (Cycle 6.1–6.5 — session 60). **Phase 11 cups COMPLETE** (single-elim session 65; group→knockout session 66).

**BUILD ORDER 9 → 6 → 11 — ✅ ALL THREE COMPLETE (session 66).** Next candidates (operator's
call): Phase 7 (AI layer) · `apps/display` redesign + Phase 4 device-test/deploy · Phase 10 (public
league pages). Detail of the completed 9/6/11 work retained below for reference.

**ORIGINAL BUILD ORDER (operator, session 58): 9 → 6 → 11** (methodical, not number order):
1. **Phase 9 (finish)** — ✅ email (9.1) · ✅ SMS/WhatsApp Twilio transport core (session 59,
   unwired) · ✅ fixture-reminder / 48h availability crons (session 59 — close the loop Phase 5
   left open: competitive availability exists but nothing reminded the squad) · ✅ **`_sms.js`
   wired for ref assignment** (session 65 — `ref_assigned` routes through `pickChannel` honouring
   `match_officials.preferred_channel`, whatsapp→sms→email fallback; `apps/inorout/api/cron.js`
   only, no DB/RPC/UI). ✅ **player contact-capture** (session 65, mig 189) — `set_player_contact`/
   `get_my_contact` + a NOTIFICATIONS section in PlayerProfile (phone + channel preference). ✅ **fallback
   wired (session 65):** the 48h/2h reminder crons now route each player via `pickChannel`
   (push→email→SMS/WhatsApp) — push through `/api/notify`, email via `_mailer`, SMS/WhatsApp via `_sms`,
   each logged to `notification_log` with its channel; league reminder email templates added. ✅ **HQ
   weekly digest (session 66)** — the last Phase 9 piece. `hq_get_analytics_for_company` (mig 190,
   service-role sibling of `hq_get_analytics`) + a `hqWeeklyDigest` `_mailer` template + `weeklyDigestJob`
   in cron.js: per-company "state of the group" email to super_admins, Monday 08:00 UK, previous-week
   range, dedup via `notification_log` keyed `company_id:weekStart`. **Template-first; the AI narration
   of the same dataset rides Phase 7** (see DECISIONS). **Phase 9 is COMPLETE.** *Operator owes a
   real-delivery test once `TWILIO_*` env is set (SMS no-ops until then) + a Monday digest delivery
   eyeball once `RESEND_API_KEY` is live.*
2. **Phase 6 (HQ dashboard)** — company-level cross-venue surface; data already flows
   up but nothing reads it. ✅ Cycle 6.1 (session 60): apps/hq app + auth/caller-resolution
   + company-state/drill-down/incident-resolve RPCs + Venue Health Grid + Alerts. ✅ Cycle 6.3
   (session 60): **composable analytics** — `hq_get_analytics` + per-admin saved layouts +
   6-card registry + presets + edit mode (Layer A; the AI composes over this in Phase 7).
   ✅ Cycle 6.4 (session 60): **live activity feed** (centre column) — cross-venue tonight's
   fixtures + live scores + goals ticker + per-venue realtime subscriptions.
   ✅ Cycle 6.5 (session 60): **HQ preview token** — 7-day no-login watermarked read-only link
   (`/hq/preview/TOKEN`) + super_admin Share-preview button. ✅ **HQ weekly digest shipped (session 66)** —
   the deferred Phase 9 cycle landed here as planned (`hq_get_analytics_for_company` mig 190 + cron
   `weeklyDigestJob` + `hqWeeklyDigest` email). **Phase 6 functionally complete** (6A–6E shipped).
3. **Phase 11 (cups & knockouts)** — most cross-cutting (fixtures/standings→brackets/
   ref/display/player); last, when other surfaces are stable. `cup_rounds` +
   `generateCupBracket` were groundwork. **Scope (session 65): single-elimination
   end-to-end first; ties decided by ref-entered extra-time and/or penalties; bracket
   shown on venue+player+display.** ✅ **Cycle 11.1 (session 65):** bracket persistence —
   `cup_ties` tree (mig 184) + `venue_persist_cup_bracket` (mig 185) builds the whole
   single-elim bracket (canonical seeding, byes, feeder edges, round-1 fixtures+charges)
   server-side; SeasonWizard single-elim branch wired. ✅ **Cycle 11.2 (session 65):** the
   bracket comes alive — decider columns (mig 186) + `_cup_advance` sweep & `cup_advance_after_result`
   trigger (mig 187) propagate winners into parent ties (decisive score, ref ET/pens, walkover,
   forfeit) and mark next ties `ready`; `ref_record_knockout_decider` + `ref_confirm_full_time`
   level→`needs_decider` change + ref `DeciderModal`; `venue_schedule_cup_tie` (operator schedules
   each round). ✅ **Cycle 11.3 COMPLETE (session 65):** `get_cup_bracket` read RPC (mig 188) +
   bracket on all three surfaces — **venue** `BracketView` (Cups tab + per-round scheduling),
   **player** `BracketOverlay` (modal from the FIXTURES "Bracket" button, self-gating), **display**
   `BracketZone` (replaces standings for cup competitions in the rotation). **Phase 11 (single-elim
   cups) COMPLETE** — create → play → ET/pens decider → advance → schedule → view, end to end.
   ◀ **Cycle 11.4a IN PROGRESS (session 66): group stage** — one competition, `format='group_stage'`
   owns both phases. `competition_teams.group_label`+`seed` / `fixtures.group_label` / `competitions.config`
   (mig 191) · `venue_persist_group_stage` (mig 192 — snake draw + server round-robin) · `get_group_standings`
   (mig 193) · SeasonWizard group_stage branch + group tables on venue/player/display. **Cycle 11.4b NEXT:**
   knockout-from-groups. ✅ **Cycle 11.4b (session 66):** extracted `_cup_build_bracket` (shared by single-elim
   + group seeding), `venue_seed_knockout_from_groups` (mig 194 — seeds the bracket from final standings,
   cross-group), `get_cup_bracket` extended with `groups`/`all_groups_complete`/`knockout_seeded`, and a
   "Build knockout" button in venue BracketView (gated on all-groups-complete). **Phase 11 group→knockout
   COMPLETE** — create groups → play → standings → Build knockout → ET/pens decider → advance → champion,
   end to end. Settled: single-competition model · auto snake-seed draw (operator-overridable) · manual
   Build-knockout trigger (see DECISIONS). *real-device player check owed (hard-rule #13).*

**After these three:** Phase 7 (AI layer — Ask the Gaffer evolved) · Phase 10 (public
league pages). **Phase 8 (billing/self-serve) deferred to year 2.** Also outstanding:
`apps/display` layout redesign + Phase 4 operator device-test/deploy.
*(This supersedes the earlier "Phase 7 is the next major" pointer — see DECISIONS session 58.)*

**Backlog — Venue Payments Ledger (scoped session 60, NOT built):** venue-side money owed/collected
for pitch bookings + league/cup fixtures (per team) — unified ledger, cash + manual transfer now,
online staged (hosted `venues.payment_link` → Stripe Connect + Apple/Google Pay in V5). Full plan +
data model + cycles V1–V5 in **`VENUE_PAYMENTS_SCOPE.md`**. Separate from Phase 8 SaaS billing.

---

## HQ INTELLIGENCE — TRACK ROADMAP (scoped session 61, 2026-05-30)

Positioning: **"Venue Intelligence, not venue reporting."** HQ answers *which venues are healthy,
what needs action, what HQ should do next* across six dimensions. This is the **evolution of Phase 6**
(the HQ foundation shipped in 6.1–6.5), layered as new 6.x cycles + the existing Payments V-track, not
a new app. Recorded here so the phase numbering stays reconciled (no competing schemes).

**HQ-I Phase 0 — Foundation** ✅ *shipped (Phase 6.1–6.5, session 60).* apps/hq, OAuth + `company_admins`,
role/region scoping, Venue Health Grid (🟢🟡🔴), venue drill-down, Alerts/Actions rail, composable
analytics (6-card registry + saved layouts), live activity feed, preview token. The canvas — not rebuilt.

**HQ-I Phase 1 — Venue Judgment** ◀ *scoping/building now (new cycles 6.6–6.7).* The first true
"intelligence not reporting" layer, on data that exists today:
- **Health Score /100** — upgrade the red/amber/green dot to a transparent scored model + "top reason"
  line, built only from existing inputs (utilisation, fixture completion, incidents); explicitly states
  what it can't yet weigh (revenue, churn). Consumes the utilisation RPC → builds *after* it.
- **Utilisation Intelligence** — new read RPC over the booking tables (`pitch_bookings`,
  `pitch_occupancy`, `playing_areas`): overall / prime-time / off-peak %, empty prime-time hours,
  best/worst days & slots; new panel + columns into the existing comparison surfaces.
- **Parallel foundation track:** Venue Payments Ledger **V1–V3** (schema + recording UI) — quietly
  starts money data accumulating so revenue can join later without a cold start. NOT the focus.
- *Deferred within Phase 1:* Weekly Brief, revenue UI.

**HQ-I Phase 2 — Revenue & Leakage** *(= Payments Ledger V4, lights up once V1–V3 data accrues).*
Revenue + collection columns into `hq_get_analytics`/comparison/overview; Revenue Leakage Radar
(unpaid balances, failed payments, empty prime-time → £, unfilled league spaces, at-risk team value);
feeds revenue back in as a Health Score input. **No faked revenue in production — demo-flag only.**

**HQ-I Phase 3 — Competition & Team Risk** *(new 6.x).* Active/new/withdrawn teams, teams at risk,
league fill rate, fixture completion by league, blowout% vs close-game%, early renewal-probability
(only once season-over-season data exists).

**HQ-I Phase 4 — The Analyst (Weekly HQ Brief)** *(the deferred "HQ weekly digest" cycle + Phase 7 AI).*
Generated weekly brief (group performance, best/weakest venue, leakage, opportunities, risks, actions),
built on the **Gaffer AI layer** (`GAFFER.md`) over `hq_get_analytics` — not a parallel template engine.
In-app first, then scheduled email digest (cron + Resend). Approach (AI vs template) **decided later.**

**HQ-I Phase 5 — The Moat** *(out for the foreseeable; = the original "exclude" list).* Player migration
map, cannibalisation detection, venue twins, dynamic pricing, referee performance impact, full player
cluster analysis, individual player intelligence, full financial forecasting, advanced AI recommender.

*Shape: 0 built → 1 (now) → 2 → 3 → 4 → 5 (someday). Phases 2–5 are a direction, not a commitment —
scope locks phase-by-phase. Revenue is 1 of 6 dimensions, not the spine.*

### HQ-I PHASE 1 CYCLE 1 SHIPPED — prime-time windows (session 61, 2026-05-30)

The peak-hours foundation for utilisation. Venues now mark per-pitch prime-time bands so HQ
(Cycle 2) can split prime vs off-peak.

- **mig 176** — `playing_areas.prime_time_windows jsonb DEFAULT '[]'` (additive, metadata-only add);
  `venue_update_pitch` gains a `prime_time_windows` validate+write block (`[{day_of_week 0-6,
  start_time, end_time}]`, no slot_lengths — it's a band); `venue_get_state` exposes the new key in
  the pitches projection. Both functions rebuilt on their **LIVE bodies** (135 / 168) — all existing
  keys preserved (display_token/display_config/bookings_enabled/cancellation_policy verified intact).
- **apps/venue** — BookingSettings modal gains a "Prime-time hours" section per pitch (day + start +
  end rows), saved via the existing `venueUpdatePitch` (no new wrapper, no barrel change).
- **Verified:** rpc-security-sweep (both SECDEF/search_path/1-overload/anon+authenticated, no PUBLIC) ·
  ephemeral-verify rolled back (valid persist · booking_windows untouched · inverted+bad-day rejected ·
  zero leak) · post-apply regression read (all mig-168 fields intact + new key) · hygiene 7/7 ·
  apps/venue build clean. Decision: prime-time venue-configurable (DECISIONS session 61).
- **Operator owes:** real venue-dashboard test — open Booking settings, add a peak window, save,
  reload, confirm it persists (hard-rule #13; apps/venue is not in PWA scope but UI-save is untested).

**Cycle 1.1 (same session) — venue-level default prime band.** Decision: a pitch with no
prime_time_windows INHERITS a venue default (not off-peak, not a hardcoded global). **mig 177** —
`venues.default_prime_time_windows jsonb`; `venue_update_booking_settings` gains a
`default_prime_time_windows` validate+write key; `venue_get_state` exposes it in the venue object
(rebuilt on the live mig-176 body — pitch prime/booking keys + display/bookings fields all verified
intact). BookingSettings modal gains a "Venue default (all pitches)" editor above the now-optional
per-pitch overrides. Cycle 2 resolution: pitch.prime_time_windows if set, else venue default, else
off-peak. Verified: rpc-security (both SECDEF/search_path/1-overload/anon+authenticated) ·
ephemeral-verify rolled back (default persists · bookings_enabled/cancellation_policy untouched ·
inverted+bad-day rejected) · regression read · hygiene 7/7 · build clean.

### HQ-I PHASE 1 CYCLE 2 SHIPPED — hq_get_utilisation (session 62, 2026-05-30)

The utilisation intelligence read layer over `pitch_occupancy` + `playing_areas`.
**mig 178** — `hq_get_utilisation(p_company_id, p_date_from, p_date_to)`:
SECURITY DEFINER, search_path pinned, STABLE, anon-denied, authenticated-only,
read-only (no audit/broadcast). Authorisation + region scoping reuse
`resolve_company_caller` (regional_admin restricted to its own region, mirroring
hq_get_analytics).

- **Locked metric rules (operator, session 61):** used = fixtures + CONFIRMED
  bookings from pitch_occupancy (`source_kind IN ('fixture','booking')`, active);
  **maintenance excluded**; **requested** bookings surfaced separately, never
  counted. Available = each pitch's `booking_windows`, else 08:00–22:00 all week
  flagged "assumed". Prime/off-peak per pitch = `prime_time_windows` else
  `venues.default_prime_time_windows` else "not_configured" (prime/offpeak left
  NULL — never guessed). Default range = trailing 28 days, optional from/to.
- **Model decisions (operator, session 62):** usage **clipped to opening hours**
  via a 30-min bucket grid (utilisation always 0–100%, empty-prime always ≥0);
  assumed-availability fallback spans all 7 days 08:00–22:00; best/worst **day =
  day-of-week**, best/worst **slot = hour-of-day**. Local time = Europe/London
  (occupancy ranges read back AT TIME ZONE to match local-time windows).
- **Returns** per-pitch + per-venue + company rollup: overall %, prime %,
  off-peak %, available/used hours, empty prime hours, best/worst day, best/worst
  slot, fixture/booking source split, requested hours; plus range/caller/assumptions.
- **Verified (read-RPC, ephemeral-verify not mandated):** rpc-security
  (SECDEF · search_path · 1 overload · anon-denied · authenticated-granted) ·
  live functional run vs company_demo (used 4.0h matched raw occupancy; source
  split 2.0/2.0; available 784.0 = 2 assumed pitches × 14h × 28d; overall 0.5%) ·
  BEGIN…ROLLBACK probe proving prime path (prime_avail 168.0, prime_used 3.0,
  empty 165.0, off-peak_used 1.0 — the 20:30–21:30 fixtures correctly straddle
  the 18:00–21:00 band) **and that a requested booking (1.0h) does NOT inflate
  used** (stayed 4.0); rollback confirmed clean (0 prime / 0 requested left) ·
  `hqGetUtilisation` wrapper + barrel export · apps/hq build clean.
  (Note: commit 48fea84's message cites pre-probe placeholder figures
  2.0/166.0/2.0; the live-verified values above supersede them.)
- **Wrapper:** `hqGetUtilisation(companyId, dateFrom=null, dateTo=null)` in
  packages/core/storage/supabase.js + barrel. **Downstream consumers (hard-rule
  14):** Cycle 3 UtilisationPanel.jsx + registry card; Cycle 4 Health Score /100
  input. A return-shape change must check both before shipping.
- **Next = Cycle 3:** utilisation frontend (registry card + dedicated
  UtilisationPanel.jsx). Cycle 4 = Health Score /100 upgrade in hq_get_company_state.

### HQ-I PHASE 1 CYCLE 3 SHIPPED — utilisation frontend (session 62, 2026-05-30)

The two surfaces for `hq_get_utilisation` (Cycle 2). **apps/hq only — no DB, no RPC
change.** Built to apps/hq's actual visual language (`.analytics` / `.acard` /
`.chips`+`.chip` / `.atable` + `--font-mono` numerals; tokens `--text-muted`,
`--warn`, `--good`, `--danger`); the few novel bits (util bar, expand caret, tags)
use inline styles, so no styles.css change was needed.

- **Dedicated `UtilisationPanel.jsx`** (default export, self-loading on `companyId`
  like AnalyticsView) — new **"Utilisation" nav button** in App.jsx (third tab,
  between Dashboard and Analytics; rendered via the existing view ternary, not a
  registry). Company `.chips` headline (overall/prime/off-peak used %, empty prime
  hours, used-of-available, busiest/quietest slot, requested-pending) + a per-venue
  `.atable` with a mini util bar that **expands on row-click to per-pitch detail**
  (overall/prime/off-peak %, empty prime, used hours, fixture/booking split,
  assumed-hours tag). Honest about gaps: shows "not set" + a hint when prime isn't
  configured (never guesses); flags assumed-availability pitches.
- **Registry card `utilisation`** — added to AnalyticsView's `ALL_CARDS` +
  `CARD_TITLES` (selectable in the Customise-dashboard editor). AnalyticsView now
  also self-loads `hqGetUtilisation`; new `UtilCard` (compact `.chips`:
  overall/prime/off-peak %, empty prime + busiest/quietest line) rendered via the
  `CardBody` switch, threaded through a new `util` prop.
- **No styles.css change** — the panel and card lean entirely on existing classes
  (`.analytics`/`.acard`/`.chips`/`.atable`) plus inline styles for the util bar,
  caret and tags, so the stylesheet was untouched.
- **Verified:** apps/hq build clean (84 modules transformed, exit 0); every field the components read (overall_pct,
  prime_pct, offpeak_pct, empty_prime_hours, used/available_hours, prime_configured,
  requested_hours, best/worst day+slot, prime_source, assumed_availability,
  source_split, range) cross-checked against the live Cycle-2 RPC output shape.
  **Operator owes:** logged-in browser pass (HQ is Google-OAuth gated; visual smoke
  can't run headless).
- **Correction note:** an earlier draft of this cycle was written against a
  hallucinated apps/hq structure (non-existent AnalyticsCard.jsx / `.stat-grid` /
  VIEWS array); those edits failed to apply and nothing was committed. This entry
  reflects the actual, built implementation.
- **Next = Cycle 4:** Health Score /100 + top reason in `hq_get_company_state`,
  consuming the utilisation RPC + (deferred) `_hq_venue_health_score` helper.

### HQ-I PHASE 1 CYCLE 4 SHIPPED — Health Score /100 + top reason (session 63, 2026-05-31)

The last locked Phase-1 cycle. Upgrades the categorical red/amber/green dot in
`hq_get_company_state` into a transparent **scored model** — completes "Venue Judgment".
**mig 179.**

- **Model (operator-locked):** three axes, each 0–100 —
  **operations** = `100 − 40·critical − 10·(open−critical) − 8·unallocated − 5·unassigned_refs`,
  floored at 0 (always present);
  **utilisation** = `min(100, overall_pct × 2)` (50% used = full marks), from the Cycle-2
  RPC, NULL when no measurable utilisation;
  **fixture_completion** = `round(100·completed/(completed+remaining))`, NULL when no
  fixtures yet. Weights **ops 0.40 / util 0.30 / completion 0.30**; a **missing axis is
  dropped and the remaining weights renormalised** (never invents a number) via the new
  helper `_hq_health_score(ops,util,completion)` (IMMUTABLE, search_path pinned).
- **Band:** score ≥80 green · ≥55 amber · else red. **Hard-red overrides** (force red + own
  reason regardless of score, carried over from the old logic): critical incident open,
  subscription past_due/cancelled, expired trial.
- **top_reason** = the weakest present axis, phrased for a human (override reason wins).
  Explicitly **NOT yet weighed: revenue, churn** (no data — stated, not faked).
- **Return-shape additions (additive, hard-rule #12):** each venue gains
  `health_score int|null`, `health_reason text`, `health_axes {operations, utilisation,
  fixture_completion}`. Existing `health` field retained (now band+override-derived). Wrapper
  `hqGetCompanyState` passes data through raw (no mapper). **Only consumer:** apps/hq
  `VenueHealthGrid` — now renders the score next to the dot + a reason line.
- **Verified live (company_demo):** rpc-security (hq_get_company_state SECDEF/search_path/
  1-overload/anon-denied/auth-granted; helper IMMUTABLE/search_path/not-secdef) · helper unit
  cases (100,50,80→79 weakest util; 100,NULL,80→91 renormalised weakest completion;
  60,NULL,NULL→60; NULL×3→null) · functional run (Demo Arena South green 100 "all healthy",
  axes ops100/util—/comp—; Demo Sports Centre **red 30 "Critical incident open"** hard-red
  override firing over axes ops19/util1.2/comp73) · apps/hq build clean (84 modules, exit 0).
  **Operator owes:** logged-in browser pass (HQ OAuth-gated).
- **Phase 1 (Venue Judgment) COMPLETE** (cycles 1, 1.1, 2, 3, 4). Next track: HQ-I Phase 2
  (Revenue & Leakage = Payments Ledger V-track) or Phase 3 (Competition & Team Risk).

### VENUE PAYMENTS LEDGER V1 SHIPPED — schema (session 63, 2026-05-31)

Groundwork for HQ-I Phase 2 (Revenue & Leakage) — starts money data accruing so revenue can
join HQ later without a cold start. **Schema only per VENUE_PAYMENTS_SCOPE.md — no RPCs (V2),
no UI (V3).** **mig 180.**

- **Two-table unified ledger:** `venue_charges` (what's owed — one row per booking, per-team per
  fixture; venue/team/competition/period sliceable) + `venue_payments` (instalment log; each
  payment/refund a row; soft-void via `voided_at`). Status/balance derived from non-voided
  instalments vs amount due. Online shares the ledger later (a non-cash row) — no redesign.
- **Fee config:** `league_config.fixture_fee_pence` + `fixture_fee_payer` (both|home),
  `playing_areas.default_fee_pence`, `venues.payment_link` (interim hosted online-pay URL).
- **RPC-only:** RLS on both tables, anon/authenticated revoked (V2 adds SECDEF RPCs).
- **Demo seed (demo_venue only, forward-only):** 24 charges (2 booking, 22 fixture) across
  paid:8/partial:8/unpaid:8 + 16 instalments (cash:8, bank_transfer:8); owed £540 / collected
  £255 so V3/V4 collection-rate reports are testable; production untouched (non-demo charges = 0).
- **Verified live:** structural (2 tables · COALESCE unique index · 4 fee/link columns · RLS on ·
  anon/auth revoked) + seed sanity (status mix · 2 methods · owed/collected totals). No RPC/JS
  this cycle, so rpc-security/ephemeral-verify/build N/A.
- **Next:** V2 = charge auto-creation hooks + `venue_record_payment`/`venue_void_payment` RPCs
  (→ ephemeral-verify); V3 = apps/venue Payments screen; V4 = HQ revenue/collection cards
  (= HQ-I Phase 2).

### VENUE PAYMENTS LEDGER V2 SHIPPED — RPCs + charge hooks (session 63, 2026-05-31)

Write layer over the V1 ledger. **Server-only — no JS/UI (wrappers + screen = V3).** **mig 181.**

- **4 RPCs** (SECDEF · search_path pinned · `resolve_venue_caller` · audited · notify):
  `venue_record_payment` (append instalment + recompute status), `venue_void_payment` (soft-void
  + recompute), `venue_set_charge_due` (override due + recompute), `venue_get_charges` (read:
  charges + balances + collection-rate summary). Shared helper `_recompute_charge_status`
  (non-voided instalments vs due; preserves terminal `refunded`).
- **3 charge auto-creation hooks** (rebuilt on LIVE bodies): `venue_confirm_booking` → booking
  charge (booking.amount_pence else `playing_areas.default_fee_pence`; **skip when no fee** —
  operator decision), `venue_generate_fixtures` → per-team fixture charges per `fixture_fee_payer`
  (skip when no fee), `venue_update_fixture_status` → on **void**, that fixture's charges set
  `refunded` (payments kept; postpone/walkover/forfeit untouched — operator decision).
- `notify_venue_change` whitelist += `payment_recorded`/`payment_voided`/`charge_updated`.
- **Verified live:** rpc-security (all SECDEF/search_path/1-overload/anon+auth; helper not-secdef)
  · **ephemeral-verify 8/8** (partial→paid→void→partial→set_due→paid · get_charges 54.4% rate ·
  bad-token rejected · refunded blocks payment · void refunds 2/2 fixture charges).
- ⚠️ **Incident (caught + fixed same cycle):** the EV result-capture variant committed instead of
  rolling back, mutating demo_venue (1 booking charge + 1 fixture + 3 charges). **Fully restored**
  to the V1 baseline (24 charges paid8/partial8/unpaid8, 16 payments, owed £540/collected £255,
  0 refunded) and verified. Lesson: an EV that needs to return a verdict must do so via
  `RAISE EXCEPTION verdict` (rolls back AND surfaces the result) — never a committed temp table.
- **Next:** V3 = apps/venue Payments screen (+ supabase.js wrappers, the JS binding deferred to
  here where there's a call site); then V4 = HQ revenue cards (HQ-I Phase 2).

### VENUE PAYMENTS LEDGER V3 SHIPPED — apps/venue Payments screen (session 63, 2026-05-31)

The operator-facing recording surface over the V2 RPCs. **Frontend-only — no DB/RPC change.**

- **4 supabase.js wrappers + barrel:** `venueGetCharges`, `venueRecordPayment`,
  `venueVoidPayment`, `venueSetChargeDue` (each: raw RPC name appears exactly once in
  supabase.js; camelCase wrapper + index.js export).
- **New "Payments" tab** in the venue Dashboard (third `view`, beside Operations/Bookings) →
  `PaymentsView.jsx`: Money summary (owed / collected / outstanding / collection-rate),
  status-filterable charge table (source · team · due · paid · balance · status), and a
  record-payment modal (amount + method cash/transfer/card/other + note) calling
  `venueRecordPayment`. Self-loads via `venueGetCharges`.
- **Scope (operator decision):** frontend on the 4 shipped RPCs only. Per-fixture charge
  add/void + `payment_link` show/edit → **V3.1** (each needs a new write RPC; note
  `venue_get_state` does NOT yet expose `payment_link`, so the link block in PaymentsView is
  inert until V3.1 adds it).
- **Verified:** apps/venue build clean (110 modules, exit 0); wrapper/raw-name/barrel/wiring
  cross-checked (defs=1, barrel=1, raw=1 each; PaymentsView imported + rendered). No write
  RPC added → ephemeral-verify N/A. **Operator owes:** logged-in venue-dashboard pass (token
  `demo_venue_token_DO_NOT_USE_IN_PROD`) — record a payment, see the balance + collection rate
  move.
- **Next:** V4 = HQ revenue / collection-rate / outstanding cards into the HQ analytics
  registry (= HQ-I Phase 2). Optional V3.1 first for per-fixture charge add/void + payment_link.

### VENUE PAYMENTS LEDGER V3.1 SHIPPED — per-fixture add/void + pay-link (session 64, 2026-06-01)

Finishes the operator's manual control over the ledger. **mig 183** (2 new write RPCs + 2 rebuilt).

- **`venue_add_fixture_charge(token, fixture_id, team_id, amount?)`** — manual per-team fixture
  charge (the "this team also pays" toggle). Amount = explicit arg or `league_config.fixture_fee_pence`.
  Validates fixture∈venue + team∈fixture. Idempotent vs `venue_charges_source_uniq`: a refunded
  charge for the same (fixture, team) is **reactivated** (status cleared off `refunded` then
  recomputed from kept payments) rather than duplicated.
- **`venue_void_charge(token, charge_id)`** — status → `refunded` (drops out of owed/collected),
  payments kept in history; mirrors the V2 fixture-void hook. Idempotent (`already:true` if voided).
- **`payment_link`** — added to the `venue_update_booking_settings` whitelist (validated `^https?://`,
  blank clears) and **exposed on `venue_get_state`'s venue object** (was missing — PaymentsView read
  `venue.payment_link` but it was always null).
- **apps/venue PaymentsView** — Add-charge modal (fixture + team + optional amount), per-row Void
  button, inline pay-link editor; fixed `teamName` to read the `state.teams` map (was looking up a
  non-existent `leagues[].teams`). 2 supabase.js wrappers + barrel. Minimal V3.1 CSS; full polish
  deferred to the venue design pass.
- **Verified:** **ephemeral-verify 13/13** against an `_e2e_` fixture (add-default · record-partial ·
  dup-rejected · void · reactivate→partial · add-away · get_charges owed4000/coll400/rate10 ·
  pay-link roundtrip · bad-token · team-not-in-fixture · amount-invalid · void-not-found ·
  bad-link), leak-check 0. **EV caught a real bug:** reactivation left status `refunded` because
  `_recompute_charge_status` preserves the terminal state — fixed by clearing to `unpaid` first.
  rpc-security 4/4 PASS (secdef+search_path+1-overload+anon/auth). venue + inorout builds clean;
  casual-regression PASS (packages/core change additive-only, no apps/inorout/src touched).
  **Operator owes:** logged-in venue pass (add a charge, void one, set the pay link).

### VENUE PAYMENTS LEDGER V4 SHIPPED = HQ-I PHASE 2 (Revenue & Leakage) (session 64, 2026-06-01)

Surfaces the V1–V3 ledger into HQ. **mig 182** (3 functions, all read/immutable — no write
RPC, so ephemeral-verify N/A). Revenue math mirrors `venue_get_charges` exactly so HQ agrees
with the apps/venue Payments screen.

- **New `revenue` analytics card** — `hq_get_analytics` gains a `revenue` block: company
  `owed_pence`/`collected_pence`/`outstanding_pence`/`collection_rate` + a `by_venue` breakdown
  (all scoped venues, region-filtered; optional date filter on charge `created_at`, all-time by
  default). AnalyticsView adds `"revenue"` to ALL_CARDS/CARD_TITLES, the `commercial` preset, the
  CardBody switch, and a `Revenue` component (chips + per-venue `.atable`, pence→£ formatter).
- **Revenue fed into the Health Score** — `_hq_health_score` gains a 4th axis (param-count change
  → old 3-arg signature DROPped first). Revenue axis = collection-rate %, weight **0.30**,
  **purely additive**: a venue with no charges (every production venue today) drops the axis and
  scores exactly as before. `hq_get_company_state` computes per-venue all-time collection rate,
  feeds it in, exposes `health_axes.revenue` + a top-level `collection_rate`, and a `revenue`
  `top_reason` ("Collecting X% of fees owed"). Hard-red overrides still take precedence.
- **Closed a latent gap:** mig-179's commit claimed it wired health_score/reason into
  VenueHealthGrid but the commit touched only SQL — the score was invisible in the UI. V4 wires
  the score badge (coloured by band) + reason line into VenueHealthGrid, so the revenue input is
  actually visible.
- **Verified live (company_demo, impersonated super_admin):** helper unit cases (additive: no-rev
  = unchanged 100; zero-rev → weakest=revenue); demo rollup £540 owed / £255 collected / £285
  outstanding / 47.2% (= V1 baseline); company_state — Arena South revenue axis null/score 100
  (no charges, additive), Sports Centre revenue 47.2/score 30→34 still red via critical override;
  analytics revenue block company + per-venue correct. rpc-security all 3 PASS (both RPCs
  secdef+search_path+1-overload+auth-only; helper not-secdef, old 3-arg cleanly dropped).
  apps/hq build clean (84 modules, exit 0). **Operator owes:** logged-in HQ browser pass.
- **Next:** HQ-I Phase 3 (Competition & Team Risk), or V3.1 (per-fixture charge add/void +
  payment_link), or V5 (Stripe Connect online rails).

---

## LEAGUE MODE — PHASE 4 RECEPTION DISPLAY SHIPPED (session 57, 2026-05-29)

> ⚠️ **LAYOUT REDESIGN — WIREFRAME ONLY, NOT FINAL (operator, session 73).** A first
> "premium broadcast" re-skin pass shipped session 73 (generated monogram crests,
> last-5 form guide, live-card lower-thirds, League-Leaders idle podium, sponsor slot,
> stylised pitch backdrop — all over the SAME payload). **The operator judged the
> result not good enough ("looks awful") and asked to leave it as a wireframe baseline;
> the FINAL visual design is a later session.** What IS done and keepable: the data
> layer additions (mig 221 `form`), the component structure, and the crest/form/idle
> mechanics. The DB/RPC/realtime layer (migs 164–168 + 221, `get_display_state`,
> `venue_live`, venue config editor) is stable. **Deferred to the final-look session:**
> sponsor-image upload in venue settings (Stage 2 — backend confirmed: `sponsor_image_url`
> already persists via `display_config`, just needs the venue uploader) AND deploying
> `apps/display` to its own Vercel project + `VITE_DISPLAY_APP_URL` (Stage 4 — don't put
> an unfinished look on a real venue TV). Do not treat the current layout as final.
>
> Original session-57 note: the operator first judged the layout "too plain"; the
> session-73 pass was the response, still not the final article.

The venue big-screen (`/display/TOKEN`) — a TV-targeted, PIN-gated, white-labelled
live scoreboard for **all** competitions at a venue, updating in real time off the
existing `venue_live` broadcast. Built in four committed stages.

- **Product decisions (operator):** new `apps/display` app (not a venue route);
  **venue-scoped** on a new `venues.display_token` (never the admin token);
  **client-side** PIN lockout (PIN never leaves the server); **confirmed + live
  provisional** standings both shipped; venues **configure panels now**; default
  **composite "Live-led split"** layout (multi-zone, supersedes single-panel cycle).
  See DECISIONS.md (session 57).
- **Stage A — server (migs 164–167, `4c0f08b`):** `venues.display_token` +
  `display_config` + read indexes; `get_display_state` (lifts the proven standings
  engine + a live pass folding in-progress scores; top scorers; live fixtures;
  today's upcoming/recent; goals ticker; returns `live_channel_key`, never the PIN);
  `check_display_pin` (read-only); `venue_update_display_config` (operator write).
  rpc-security-sweep + ephemeral-verify + casual-regression all PASS.
- **Stage B — `apps/display` (`c3087e8`):** standalone Vite SPA. Client PIN gate
  (3 wrong → 30-min localStorage lockout); `get_display_state` + `venue_live`
  realtime (verified: a ref goal flipped the score live with no reload) +
  auto-reconnect + 60s fallback + screen wake-lock. **Broadcast-grade UI** (Sky
  Sports / UCL bar): Bebas Neue scoreboard numerals, floodlight vignette + grain,
  team-colour accents, Framer Motion (score-flip, standings reorder physics, live
  card enter/exit, goals marquee). Live-led split layout; confirmed↔amber
  provisional standings w/ position deltas; golden-boot scorers; white-label;
  non-removable "Powered by In or Out".
- **Stage C — `apps/venue` settings (`2e1a9c4`, mig 168):** Dashboard ▸ "Reception
  display" modal — copyable display link, PIN set/clear, panel enable+reorder,
  Smart/Cycle/Fixed mode + interval, custom message. `venue_get_state` additively
  exposes `display_token`/`display_config`. UI save verified end-to-end.
- **Operator owes (hard-rule #13):** the **real-device test on an actual 1920×1080
  TV / large tablet** — wake-lock holds (screen doesn't sleep), auto-reconnect after
  a Wi-Fi drop, PIN flow + lockout, white-label colours. Browser smoke at 1920×1080
  passed (PIN, live broadcast score-flip, provisional standings); the physical-TV
  pass is the gate the static/browser checks can't cover.
- **Deferred:** Form column in standings (no RPC yet); display-token rotation
  (kill-switch); enterprise white-label removal of the "Powered by" mark; deploying
  `apps/display` to its own Vercel project + setting `VITE_DISPLAY_APP_URL` in
  apps/venue so the copied link is fully-qualified.
- **Testbed:** demo_venue `display_token='demo_venue_display_token'`, `display_pin='1234'`.

---

## LEAGUE MODE — PHASE 6 CYCLE 6.5: HQ preview token (session 60, 2026-05-29)

Scope 6D — the commercial hook ("show your HQ what's possible → they buy the tier").

- **What ships:** `hq_generate_preview_token(company)` (mig 175, write; **super_admin only**) +
  `get_hq_preview_state(token)` (read, **anon** — token is the secret; validates + 7-day expiry +
  stamps `accessed_at` on first open). `hqGeneratePreviewToken`/`getHqPreviewState` wrappers.
  apps/hq **PreviewView** at `/hq/preview/TOKEN` (or `/preview/TOKEN`) — no login, watermarked,
  read-only company snapshot (summary + venue health grid; no drill-down/incidents/tokens) +
  a header **Share preview** button (super_admin) that generates + shows the copyable link.
- **Decision:** generating is super_admin-only (sharing company data externally is privileged);
  "notify the generator on open" is **deferred** (no company-admin push/email channel yet) —
  `accessed_at` is the visible signal until then.
- **Verified:** rpc-security-sweep (generator anon-denied; preview anon-allowed — intended) ·
  ephemeral-verify (rolled back): generate · public read+snapshot+accessed_at · invalid+expired
  rejected · analyst/regional/stranger denied — all PASS · **end-to-end UI smoke against live DB**
  (anon, no OAuth): `/preview/<token>` rendered the watermarked snapshot; accessed_at stamped.
- **Operator owes:** authed Share-preview button render (behind OAuth, with the /hq pass).

## LEAGUE MODE — PHASE 6 CYCLE 6.4: live activity feed (session 60, 2026-05-29)

The scope-6B centre column — a cross-venue live feed.

- **What ships:** `hq_get_activity(company)` (mig 174, read) — tonight's fixtures with live
  scores + status, soonest upcoming when none today, a recent-goals ticker (match_events), and
  per-venue `live_channel_key`s. `hqGetActivity` wrapper. apps/hq **ActivityFeed** (centre column
  by default; selecting a venue swaps in the VenueDetail drill-down + a back button).
- **Realtime:** one subscription per venue channel (`venue_live:<key>`, mirroring apps/venue /
  mig 121) → debounced refetch on any goal/card/result broadcast, **+ a 30s poll fallback** so the
  board stays fresh even if a broadcast is missed. (Decision: subscribe-per-venue + poll backstop,
  vs. a single firehose — keeps it simple and self-healing.)
- **Verified:** rpc-security-sweep PASS (read-only → no ephemeral-verify); functional read
  (live=0 today, upcoming=3, goals=13, channels=2); apps/hq builds clean.
- **Operator owes:** live render + realtime correctness during an actual in-progress fixture.

## LEAGUE MODE — PHASE 6 CYCLE 6.3: composable analytics dashboard (session 60, 2026-05-29)

Layer A of the operator's customisable-dashboard idea — HQ picks from a registry of cards
(or applies a preset) and the layout is saved per-admin. Deterministic; the Phase 7 AI layer
will later compose over the *same* registry (grounded, never raw SQL).

- **Decision:** HQ analytics is **composable, not fixed tabs** (supersedes the scope-6C fixed
  Overview/Comparison/Engagement/Season tabs). A card registry + saved layout (mirrors Phase 4's
  `display_config` pattern); presets are named starting layouts. The **AI-composition layer (Layer
  B) is deferred to Phase 7** — built only after the registry exists, so the AI selects from safe
  cards rather than improvising against the schema. Cards use **only confirmed data sources** —
  "% opened app" / standings deferred (no clean source; not faked).
- **What ships:**
  - **mig 172** — `company_admins.dashboard_config jsonb` (per-admin layout; NULL = default preset).
  - **mig 173** — `hq_get_analytics(company, from?, to?)` (one read: 6 datasets + caller's layout +
    meta; role/region scoped; optional date filter) + `hq_set_dashboard_config(company, config)`
    (write; filters cards to the known 6 keys; persists the caller's own row).
  - **packages/core** wrappers `hqGetAnalytics`/`hqSetDashboardConfig`.
  - **apps/hq** — Dashboard|Analytics tab + AnalyticsView: 6 cards (Overview KPIs, Venue
    comparison, Top scorers [match_events goals], Discipline [cards], Open incidents, Billing),
    edit mode (preset / toggle / reorder / Save), presets Operations·Commercial·Performance.
- **Verified:** rpc-security-sweep (both SECDEF/single-overload/search_path/anon-denied) ·
  ephemeral-verify (rolled back): read=6 datasets/venues=2/goals=35 · config write filters bogus
  key→3 cards + keeps preset + persists + round-trips · bad_config rejected · regional-South
  scoping venues=1 · stranger denied — all PASS · apps/hq builds clean.
- **Operator owes:** live signed-in Analytics render (behind OAuth, with the 6.1 pass).
- **Deferred:** 6.4 live activity feed · 6.5 preview token · Phase 7 AI composition (Layer B) ·
  more cards as data sources firm up (player engagement, standings).

## LEAGUE MODE — PHASE 6 CYCLE 6.1: HQ dashboard foundation + drill-down + incident resolve (session 60, 2026-05-29)

The first net-new operator surface — a company-level, cross-venue HQ at `/hq`. "Data flows
up but the operator's screens didn't"; this reads it. Built as a "fuller" cycle (6.1 + 6.2
folded) with the full role model.

- **Decisions (operator, session 60):** new **apps/hq** app (not the clubmanager stub — that
  name collides with the misnamed `platform-clubmanager` Vercel project that serves inorout);
  **OAuth + company_admins** (auth.uid(), no token — scope 6A), with **regional_admin built now**
  (added `venues.region`); **fuller cycle** (foundation + venue drill-down + incident resolve);
  demo company seeded (live DB had 0 companies). Display redesign slots after.
- **What ships:**
  - **migs 169–171** — `venues.region`; demo company `company_demo` (Demo Sports Group: demo_venue
    North + venue_demo_south South, tarny super_admin, 2 open incidents); 5 RPCs
    (`resolve_company_caller`, `company_admin_whoami`, `hq_get_company_state`,
    `hq_get_venue_detail`, `hq_resolve_incident`) + `audit_events.actor_type`+='company_admin' +
    `notify_venue_change` whitelist+='incident_resolved'. Role scoping: super_admin all /
    regional_admin own region / analyst read-only (resolve rejected).
  - **packages/core** wrappers `companyAdminWhoami`/`hqGetCompanyState`/`hqGetVenueDetail`/`hqResolveIncident`.
  - **apps/hq** (React+Vite, OAuth gate mirroring superadmin): Venue Health Grid (🟢🟡🔴 + counts),
    Venue Detail drill-down (incidents w/ inline resolve, fixtures, leagues), Alerts/Actions rail.
- **Verified:** rpc-security-sweep 6/6 (SECDEF, single overload, search_path, anon denied) ·
  **ephemeral-verify** (rolled back): super_admin read + health states + drill-down + resolve
  (ok+audit, team_id=venue) + analyst rejection + regional South scoping + cross-region denial +
  stranger not_authorized — all PASS · bug caught pre-commit (audit_events.team_id NOT NULL →
  store venue_id) · apps/hq builds + sign-in screen renders clean (preview smoke).
- **Operator owes:** live signed-in `/hq` load as super_admin (real Google OAuth) · apps/hq Vercel
  deploy + `VITE_SUPABASE_*` env · the casual two-token browser smoke.
- **Deferred to 6.x:** analytics tabs (6.3) · live activity feed centre column (6.4) · HQ preview
  token (6.5) · HQ weekly digest (rides 6.x). regional_admin region-filtering UI polish.

## LEAGUE MODE — PHASE 9 (cont.): SMS/WhatsApp transport core + league reminder crons (session 59, 2026-05-29)

Continues Phase 9 per the session-58 build order (9→6→11). Two independent pieces,
**no DB migration, no `apps/inorout/src` or `packages/core` change** (casual flow
byte-identical; casual-regression not triggered — both files live in `apps/inorout/api/`).

- **Decisions (operator, session 59):** provider = **Twilio** (one API does SMS + WhatsApp).
  SMS/WhatsApp scope this cycle = **transport core only, wired to nothing** — the per-player
  push→email→SMS fallback model + contact-capture/preference UI are deferred (players have
  `phone`/`notification_channel` columns from mig 056 but nothing captures a phone yet, so
  player SMS can't deliver). Reminder crons = **48h availability + ~2h near-kickoff reminder,
  competitive only**. Quiet hours = **default 22:00–08:00 UK, queue + flush** (inherited from
  the existing push path). The Phase 9 **HQ weekly digest** stays deferred to ride with Phase 6.
- **What ships:**
  - `api/_sms.js` — Twilio transport, no-op-safe until `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`
    set (mirrors `_mailer.js`). `sendSms` / `sendWhatsApp` (one client; WhatsApp uses the
    `whatsapp:` address prefix), a `TEMPLATES` registry keyed by the same type names as later
    consumers, `sendTemplated(type, channel, to, ctx)`, and a `pickChannel(preferred, contacts)`
    helper stub for the future fallback router. **Not imported anywhere yet.** `twilio` added to
    `apps/inorout/package.json`.
  - `api/cron.js` — two new jobs on the existing 15-min dispatcher (no new pg_cron job):
    **`availabilityRequestJob`** (UK 9am window; selects scheduled/allocated `fixtures` where
    `scheduled_date = today+2`; pushes both squads' active players to mark availability) and
    **`fixtureReminderJob`** (fires ~2h before kickoff via the `(105,135]`-min band; nudges only
    still-unmarked `status='none'` players). Both close the loop Phase 5 left open: competitive
    availability reuses the casual board (Cycle 5.5) but nothing pushed the squad. Delivery via
    `/api/notify` direct mode (PUSH only this cycle), deduped on `notification_log`
    (`team_id`,`type`,`game_date`) via a new `alreadyLogged()` guard. New helpers `nowInUkFull()`
    + `addDaysIso()` + `fmtUkDate()` keep all timing UK-wall-clock to UK-wall-clock (DST-safe).
    New push types: `leagueAvailability48h`, `leagueFixtureReminder2h`.
- **Verified (no device):** build clean · no src/core diff · live-DB dry-run — at simulated
  today=06-02 the 48h job selects exactly the two 06-04 democomp fixtures, both sides resolve to
  real squads (FC 8 active/7 unmarked, Rovers/City/Athletic 5/5), dedup table empty (0 rows), and
  the 2h band fires at 18:00 (120 min) but not 17:00/19:00.
- **Operator owes (hard-rule #13):** real-device **push** delivery test for both reminders —
  needs a real device subscribed on a competitive squad (`dc_subs=0` today) AND a fixture 48h/2h
  out. No SMS delivery to test (transport unwired; `TWILIO_*` env unset → `_sms.js` no-ops).
- **Deferred to later 9.x:** wiring `_sms.js` (refs via `match_officials.preferred_channel`;
  player fallback + contact-capture UI); HQ weekly digest (rides Phase 6); AI `pre_match_briefing`
  (overlaps Phase 7).

## LEAGUE MODE — PHASE 9 CYCLE 9.1 SHIPPED (session 56, 2026-05-29)

Transactional **email** (Resend) — the sender several features were blocked on (booking
confirms to off-system venues, registration outcomes, ref assignments). Email-only this
cycle; the web-push chain is untouched. SMS/WhatsApp (Twilio) is a later 9.x cycle.

- **Decisions (operator):** channel = **email + existing push** (push→email fallback model;
  SMS/WhatsApp deferred); provider = **Resend** (new dedicated account, root `in-or-out.com`
  verified, DNS at GoDaddy); first wave = **onboarding/ops loop**.
- **What ships (mig 163 + `6d73345`):**
  - `notification_log` gains `channel`/`entity_id`/`recipient` (additive) + a partial
    email-dedup index.
  - `api/_mailer.js` — Resend transport + a `TEMPLATES` registry (the reusable core a later
    SMS/WhatsApp router shares). No-ops safely until `RESEND_API_KEY` is set.
  - `onboardingEmailJob` in the existing 15-min cron dispatcher: polls `audit_events` and
    emails the right persona — **team_registration_submitted → venue admin**,
    **team_approved / team_rejected → team admin**, **fixture_ref_assigned → referee**.
    Recipients resolved server-side (auth.users via team/venue_admins; `match_officials.email`
    for refs) — no player-preference plumbing needed. Deduped via `notification_log`.
- **No new RPC, no UI, no `apps/inorout/src` change** (casual flow byte-identical).
- **Verified:** schema-sync clean · module load/template smoke (resend resolves + constructs;
  no-key path returns `skipped`) · resolver SQL proven on the testbed (`team_dc_fc` →
  tarnysingh@gmail.com; demo venue has an official w/ email) · dedup DO-block PASS + leak 0 ·
  build clean.
- **LIVE — verified end-to-end (2026-05-29).** `RESEND_API_KEY` + `EMAIL_FROM`
  (`In or Out <notifications@in-or-out.com>`, root `in-or-out.com` verified) + `REF_APP_URL`
  (`https://platform-ref.vercel.app`) set in the inor-out Vercel project; redeployed. Live test:
  a `team_approved` event resolved to the Competitive FC admin, Resend sent, `notification_log`
  logged `channel='email'`, and the email **landed in the inbox**. Dedup confirmed (second tick
  no resend); test rows cleaned up. `VENUE_APP_URL` left unset (venue app not yet deployed →
  registration-pending email omits the link). `team_registration_pending` still needs a **real**
  venue to exercise (demo venue has no linked `venue_admins` row).
- **Deferred to later 9.x:** SMS/WhatsApp; player notification-preference UI + contact setters;
  fixture-reminder/availability crons; HQ weekly digest; the AI `pre_match_briefing` (overlaps Phase 7).

**Carried into Phase 4/6 from 5.7:** the double-registration *resolution* surface. 5.7
hard-blocks a double-reg at submit and writes a `lineup_double_registration_blocked`
audit row; the two-sided league-admin confirm UI (scope §1148) + any ref-kickoff gate
land when apps/venue gains a per-player view. Also unbuilt: a discipline surface that
*sets* `player_registrations.status='suspended'` — 5.7 enforces suspension but nothing
writes it yet (arrives seeded/manual until that phase).

**Data flows up; the venue operator's *screens* don't yet — by design.** Everything built
(registrations, fixtures, ref results, teamsheets) writes to the shared schema the venue/HQ
layer reads. Cycle 5.6 also started populating `player_registrations` for real teams
(previously empty — only seeded). But `apps/venue` does NOT yet surface:
(a) **registered players per competition**, (b) **submitted teamsheets** (`fixture_lineups`
— the *ref* sees them; the operator can't), (c) **live standings / results / top scorers**.
These are the convergence points scheduled for **Phase 4 (reception)** and **Phase 6 (HQ)** —
tracked forward via hard-rule #14 consumer notes in RPCS.md. Nothing is dead-ended; the
operator-facing view is simply unbuilt until those phases.

---

## LEAGUE MODE — PHASE 5 CYCLE 5.7 SHIPPED (session 56, 2026-05-29) — PHASE 5 COMPLETE

Eligibility enforcement. Turns the 5.6 non-blocking teamsheet warnings into real gates,
both server-authoritative and surfaced in the UI. Built in two independently-verified,
independently-committed stages + docs.

- **Product decisions (operator, session 56):**
  - **Suspended/ineligible** → **override-with-confirmation**: submit blocks by default; the
    admin proceeds only by explicitly acknowledging each suspended player; the override is
    audited (`metadata.override_player_ids`). (scope §1147)
  - **Squad size** → new nullable `league_config.min_starting` / `max_subs`, set per-league
    by the venue/league (5 starters for 5-a-side, 7 for 7-a-side; bench cap 3, or 15…).
    Govern the **matchday sheet**; **hard block** outside bounds; `NULL = unbounded`.
  - **Double-registration** → **hard block now + audit**; picked player registered to another
    team in the comp can't be submitted. Two-sided league-admin confirm UI deferred to
    Phase 4/6 (apps/venue has no per-player view yet).
- **Stage A — server (migs 161–162, `b0b1aa0`)**: `league_config.min_starting`/`max_subs`
  (NULL-safe, no backfill); `team_admin_check_eligibility` (read — per-player
  suspended/double-reg/in-squad flags + bounds); `team_admin_submit_lineup` rewritten as the
  authoritative gate (all checks before any write). Also fixed a **latent 5.6 VC bug** — submit
  and `get_team_next_fixture_lineup` resolved via plain `teams.admin_token`, so a Vice Captain
  on `/p/<vc_token>` got `invalid_admin_token`; both now use `resolve_admin_caller` (session-49
  dual-lookup).
- **Stage B — UI (`bbf8f31`)**: `TeamsheetScreen` badges players ('AT ANOTHER TEAM' red hard
  block; 'SUSPENDED — TAP TO OVERRIDE' → 'OVERRIDDEN' amber), shows squad-size hints in the
  count bar (red when out of bounds), gates submit, and maps the new RPC error codes.
- **Verified**: schema-sync clean · rpc-security-sweep PASS (SECDEF, search_path pinned, 1
  overload each, anon+authenticated, no PUBLIC) · **ephemeral-verify 9/9 PASS** (eligible ·
  check-clean · check-flags · too_few_starters · too_many_subs · double_registered ·
  suspended-block · suspended-override · vc-path) + leak-check clean · hygiene 7/7 · build
  clean · casual-regression PASS (static — competitive-only screen, RPC can't fire on a casual
  token). Real-iPhone walk (hard-rule #13) on Competitive FC operator-owed.

---

## LEAGUE MODE — PHASE 5 CYCLE 5.6 SHIPPED (session 55, 2026-05-29)

Team-admin teamsheet: the manager submits a confirmed line-up (starting XI + bench) for
the next league fixture, and the ref pre-match screen shows that line-up instead of the
full registered squad. Built in **three independently-verified, independently-committed
stages** (the highest-risk cycle: new table + RPCs + a change to the live ref RPC).

- **Selection mechanic** (locked with operator): players tap IN on the 5.5 board; the
  manager opens a **dedicated Teamsheet screen** (NOT casual Make Teams — no A/B split in
  league) whose pool is the IN players, and assigns each to Starting/Bench. Maybe/no-
  response shown lower so one can be pulled in. **Pick-from-squad; submit registers** —
  submitting auto-upserts `player_registrations(active)` for picked players, so the ref
  view + fixture detail finally show real players for real teams.
- **Stage A — server foundation (mig 159, `eab2d4c`)**: `fixture_lineups` table
  (UNIQUE fixture_id+team_id, RLS no-policy); `team_admin_submit_lineup` (validates squad
  membership, auto-registers, soft squad size, non-blocking suspended/other-team warnings,
  audits); `get_team_next_fixture_lineup` (read). Nothing live read it yet → zero impact.
- **Stage B — ref RPC lineup-aware (mig 160, `68d9480`)**: recreated
  `get_fixture_state_by_ref_token` to return starting+bench (tagged `lineup_role`, lineup
  shirt overriding `players.shirt_number`) when a lineup exists, else the full
  `player_registrations` squad **exactly as before** + `lineup_role:null` (additive,
  hard-rule #12). Squad logic in an internal helper `_fixture_squad_json` (granted to
  nobody) so home/away can't diverge. apps/ref PreMatch shows a Starting/Bench split.
- **Stage C — admin Teamsheet UI (`743bc9b`)**: `TeamsheetScreen.jsx` + a gated
  "Teamsheet" card in AdminView (competitive teams only). `submitTeamLineup` /
  `getTeamNextFixtureLineup` wrappers.
- **Verified**: each stage rpc-security-swept + ephemeral-verified (Stage B's LOAD-BEARING
  backward-compat: no-lineup → full squad unchanged). Live end-to-end on the testbed
  (Competitive FC): UI submit → ref RPC returns Tarny(starting)/Marcus(bench), then
  reverted to full 8-player squad after cleanup. Casual regression: casual admin shows NO
  Teamsheet card; casual flow byte-identical. Real-iPhone test (hard-rule #13) operator-owed.
- **Deferred to 5.7**: hard suspension blocks, double-registration resolution, min/max
  squad size. Player `FixtureDetailCard` unchanged (picked players appear once registered).

---

## INOROUT — "Join another team" in MY SQUADS (session 55, 2026-05-29)

A signed-in player can now add a team from inside the app. A **"+ Join another team"**
row at the bottom of the MY SQUADS accordion reveals a paste box; on Enter/JOIN it
extracts the join code from a pasted invite link (`/join/<code>`, or a bare code) and
navigates to `/join/<code>`, handing off to the **existing** join flow — which already
gates auth, dedupes existing members (`App.jsx:641-660`), and runs the name step.

- **Single-file UI addition** (`apps/inorout/src/views/MySquads.jsx`). No new RPC,
  wrapper, App.jsx, or barrel change. Styled with `tokens.css` vars (DM Sans / Bebas
  Neue / Phosphor `weight="thin"`) to match the accordion.
- **Reuse over new plumbing**: mirrors the landing-page paste pattern (`App.jsx:1054`)
  and the in-file navigation idiom (`MySquads.jsx:152`).
- **Verified**: hygiene 7/7, build clean, Playwright proof (tap → paste invite link →
  navigates to `/join/demo` → existing join screen renders), zero new console errors on
  a casual token. Commit `249dc12`. Real-iPhone home-screen test (hard-rule #13)
  operator-owed on live.

---

## LEAGUE MODE — A LEAGUE TEAM IS ALWAYS A SEPARATE SQUAD (session 55, mig 158)

Closed the global-`players.status` dual-context must-fix **structurally**.
`join_register_team` (mig 098) previously promoted a casual team in place
(`UPDATE teams SET team_type='competitive'`); mig 158 removes that — a casual
`existing_team_id` is rejected (`casual_team_cannot_register`), and an `existing_team_id`
is accepted only when already competitive (cup reuse, Phase 11). A casual group joining
a league creates a NEW squad (own `team_id`, LEAGUE pill, second MY SQUADS entry), so a
casual `team_id` can never enter a competition and the mig-157 trigger can only touch
competitive squads.

- **Verified**: data safety check (no real casual team was ever promoted — all
  competitive teams are testbed/demo); ephemeral-verify 3 paths PASS + leak-check clean;
  rpc-security-sweep PASS (also stripped a stale anon EXECUTE grant); build clean; no JS
  changed (casual flow byte-identical). Commit `7103267`. RPCS.md now catalogues the
  Phase 2 registration trio (`72f47ea`). See BUGS.md (RESOLVED) + DECISIONS.md (session 55).

---

## LEAGUE MODE — PHASE 5 CYCLE 5.5 SHIPPED (session 54, 2026-05-29)

Per-fixture availability — **by reusing the casual IN/OUT board**, not a new system.
Decision (with operator): a competitive team's player marks in/out for their next
league fixture using the *same* board casual players use. This means the admin
make-teams / manage-squad / who's-in screens need **zero change** (they already read
`players.status`). A separate availability table would have forced them to change.

- **No new table, no new write RPC.** Availability stays `players.status`, written by
  the existing `set_player_status` (mig 011). The board header is driven by the next
  upcoming fixture (opponent + date + venue + time); buttons are live whenever an
  upcoming fixture exists; the board auto-rolls to the next fixture as completed ones
  leave the upcoming set.
- **"Start fresh each game" (mig 157)** — a trigger on `fixtures`
  (`reset_team_status_on_fixture_played`, SECURITY DEFINER, search_path locked):
  when a fixture goes `scheduled → completed/walkover/forfeit/void`, both teams'
  players reset to `status='none'` + `notify_team_change(...,'schedule_updated')` so
  open apps refetch. One trigger captures every completion path (ref/venue/walkover)
  without editing those shipped RPCs.
- **Client**: `PlayerView` lifts the fixtures fetch, derives the next fixture, and
  overlays an *effective schedule* (gameIsLive=true + fixture date/venue/time) only
  when a fixture exists; `PageHeader` gains an optional `opponentLabel`;
  `CompetitionFixturesCard` accepts `fixtures` as a prop (shared fetch).
- **Casual untouched**: all competitive behaviour gates on "an upcoming fixture
  exists" — casual teams have none, so `schedule` is the unmodified prop and the
  board is byte-identical. Trigger never fires for casual (no fixtures).
- **Edge — RESOLVED (session 55, mig 158)**: the dual-context worry is closed
  structurally. A league team is now ALWAYS a separate squad — `join_register_team`
  rejects a casual `existing_team_id` (no in-place casual→competitive promotion), so a
  casual `team_id` can never be in a competition and the mig-157 trigger can only ever
  touch competitive squads. (The original "global per player / cross-team" framing was
  also inaccurate — one `players` row per (user,team) already scopes status per team.)
  See BUGS.md (RESOLVED) + DECISIONS.md (session 55).
- **Verified**: trigger ephemeral-verified in rollback txn (FC + opponent players
  reset to none on completion; Rovers/casual untouched; broadcast reason whitelisted);
  applied live; trigger SECURITY DEFINER + search_path confirmed; hygiene + build
  clean. PWA on-device test (board shows "vs Demo Athletic", tap IN persists, rollover
  clears) operator-owed (hard-rule #13).

---

## LEAGUE MODE — PHASE 5 CYCLE 5.4 SHIPPED (session 54, 2026-05-29)

Fixture detail + opposition intel. A fixture row in `CompetitionFixturesCard`
now taps to expand an inline `FixtureDetailCard` (one open at a time), which
shows the matchup/scoreline, kickoff countdown (upcoming), goal events
(completed), both teams' LIVE registered squads, and a nested tap-to-load
`OppositionIntel` block (H2H all-time + this-season, both teams' last-5 form,
per-team top scorers, last meeting).

- **Two new RPCs (mig 156)** — `get_player_fixture_detail(p_token, p_fixture_id)`
  + `get_fixture_opposition_intel(p_token, p_fixture_id)`. Both SECURITY DEFINER,
  search_path locked, anon+authenticated. **Stricter than the ref RPC**: a player
  may only open a fixture in one of their OWN active competitions that one of their
  OWN teams plays in — any other fixture id raises `fixture_not_visible`.
- **No `goals` table** — scorers derive from `match_events` (event_type='goal').
  Form/H2H from fixture scores. Walkover/forfeit → W/L only (no phantom 3-0).
- **Squads are the LIVE registered roster** (read fresh each expand) — a team may
  confirm late; the per-fixture confirmed XI arrives in 5.6 (`fixture_lineups`).
  Detail RPC return shape leaves room for 5.5 availability fields (added then with
  a same-commit mapper update, hard-rule #12).
- **Designed-for consumers (hard-rule #14)**: detail → Phase 4 reception + Phase 7
  AI briefings; intel → Phase 7 AI Gaffer. Recorded in RPCS.md.
- **Verified**: rollback pre-flight of both RPCs incl. refusal assertions (casual
  token + fake fixture both raise); applied live + schema reload; live re-check
  (detail opp=Demo Rovers, Tarny 3 goals; H2H P1/W1 3-1, FC form [W,W], Rovers
  [L,L]); rpc-security ×2, hygiene, build clean; each raw RPC name once in
  supabase.js. Casual my-view untouched (card self-gates). On-device confirm
  operator-owed.
- **Post-ship polish** (`7252126`, `47acb28`) — goal events split into per-team
  columns (home left / away right-half), left-aligned within each column to match
  the squad layout exactly. Pure display; no RPC/data change.

---

## LEAGUE MODE — PHASE 5 CYCLE 5.3 SHIPPED (session 54, 2026-05-28)

Competition fixtures on the player screen. New `CompetitionFixturesCard.jsx`
rendered in PlayerView's my-view directly below the standings card: a collapsible
list grouped UPCOMING (scheduled) then RESULTS (most-recent-first), each row showing
opponent (`vs`/`@`), week/round + date (+ kickoff for upcoming), score, and a
W/D/L result chip (green/grey/red) from the player's team perspective.

- **New RPC `get_player_competition_fixtures(p_token, p_filter)`** (mig 155) —
  SECURITY DEFINER, search_path locked, anon+authenticated. Token → player → active
  competitions → that team's fixtures. `p_filter` ∈ upcoming/past/all (forgiving
  fallback to all). Per-row player perspective (is_home, opponent_name, my_score,
  result). Walkover/forfeit reported as status truthfully (no phantom 3-0 — standings
  owns that). Designed once for: this card + Phase 4 reception + Phase 6 HQ (RPCS.md).
- **Self-gating**: casual token → `fixtures: []` → card renders `null`; casual flow
  untouched. Rows not yet tappable — Cycle 5.4 wires inline fixture detail.
- **Verified**: rollback-transaction pre-flight (Tarny 2W+1 upcoming, casual []),
  applied live + schema reload, live re-check (Tarny 3 / casual 0), rpc-security ✓,
  hygiene ✓, build ✓, raw RPC name once in supabase.js. On-device confirm operator-owed.

---

## PITCH BOOKING — backend + casual UI complete (session 52, 2026-05-28)

B2C casual pitch booking + the unified occupancy guard. Full plan, stage table,
and commit hashes in **PITCH_BOOKING_HANDOFF.md**. Built this session:

- **Occupancy guard** (`pitch_occupancy`, partial GiST EXCLUDE) — a casual booking
  and a competitive fixture can never double-book the same pitch+time; maintenance
  blocks both. Priority: maintenance > fixture > block > ad-hoc.
- **Fixtures + maintenance** auto-project into occupancy via triggers; the venue
  fixture-write RPCs auto-yield un-confirmed bookings and gate on confirmed clashes.
- **Booking lifecycle** — request → confirm/decline, walk-in create, cancel (single +
  series), all through the guard + audit + realtime on both channels.
- **Casual UI** — Match Settings "Book a Pitch": venue discovery, one-off + weekly
  block, length picker, confirm w/ cancellation policy, live Requested→Confirmed
  badge + cancel.
- **demo_venue** enabled for testing (reversible).

**Stage 6 venue UI — done (session 53, mig 150 + commits `df7764f`/`7503d11`/`6378c40`):**
venue dashboard Bookings surface — requests inbox (block series grouped), colour-coded
resource-timeline calendar (desktop) / single-pitch agenda (mobile), tap-empty walk-in,
tap-block detail with cancel/confirm/decline, settings (bookings toggle + cancellation
policy + per-pitch booking-windows editor), `venue_live` subscriber refetching occupancy
on the 5 booking reasons. Hardening pass (`202d16a`): casual bookings list now refreshes
live on venue broadcasts; BookPitchModal date off-by-one (toISOString/UTC) fixed.

**Stage 7 — done (session 53, migs 151–152 + commits `b398b05`/`9dd953e`/`ca4a174`/`aca0cd4`):**
renewal right-of-first-refusal (a series ending ≤21d auto-holds the next block for the team
via `create_renewal_holds` cron at 09:00 UK; team "Keep slot" → `confirm_renewal` flips
holds→requested for venue re-approval; unconfirmed holds auto-expire via `expire_renewal_holds`
after a 7-day grace) + push to team admins for renewal-held/expired and for fixture-superseded
bookings (`supersededPushJob`, polls `superseded_at`). All gated (ephemeral-verify +
rpc-security-sweep). **Booking initiative complete.**

**Remaining:** deferred push-on-confirm; transactional email (Phase 9). **Payment OFF but
schema-wired.** **Operator owes** a real-squad + real-device test of the casual + venue flows
(auth-dependent) incl. the three booking pushes (GO_LIVE §6).

---

## LEAGUE MODE — PHASE 5 CYCLE 5.2 SHIPPED (session 54, 2026-05-28)

Competition standings on the player screen. New `CompetitionStandingsCard.jsx`
rendered in PlayerView's my-view (below MySquads): a collapsible league table
(Pos/Team/P/W/D/L/GF/GA/GD/Pts) with the player's own team highlighted gold.

- **Pure client UI** — reuses the existing `get_league_standings_for_player` RPC +
  `getLeagueStandingsForPlayer` wrapper (migs 087/104). No server/migration/wrapper change.
- **Self-gating**: a casual token returns no competitions → card renders `null`, so the
  casual flow is untouched (no `is_competitive` prop needed). Form column omitted (not in
  the RPC shape — later enhancement, would need a server change).
- **Verified in-browser** against the live competitive testbed: Competitive FC top on 6pts,
  own row highlighted, columns correct, clears the fixed nav; casual token shows no card
  (DOM-checked). Build + hygiene clean. Naming `Competition*` to avoid the StatsView
  `PlayerLeagueTable` clash. On-device confirm operator-owed (hard-rule #13).
- Demo competitive testbed (mig 154): **Competitive FC** (Tarny team admin) + 3 opponents
  in a Demo Competitive League; admin link `/admin/democomp_fc_admin_token`; remove via
  `154_..._down.sql` (rollback-verified safe).

---

## LEAGUE MODE — PHASE 5 CYCLE 5.1 SHIPPED (session 54, 2026-05-28)

First Phase 5 cycle — competitive surfaces *inside* `apps/inorout`, additive +
render-gated (casual flow untouched). Cycle 5.1 is the foundation: detect which
squads are competitive + a `LEAGUE` pill on MySquads.

- **mig 153** — `player_get_teams_by_token` (mig 072) extended with an
  `is_competitive boolean` (squad has an ACTIVE registration in a `league`-type
  competition). Return-type change → DROP+CREATE; search_path aligned to
  `public,pg_temp`; grants unchanged (anon+authenticated). No new RPC, no N+1, no
  wrapper change (field flows through `getPlayerTeamsByToken`).
- **MySquads.jsx** — `LEAGUE` pill (purple token) on every competitive squad
  (current + other active rows), beside the existing CURRENT/ADMIN pills via a flex
  wrapper. Casual squads unchanged.
- **Verified:** ephemeral rollback proof (competitive→true, casual→false, 0 rows
  persisted); rpc-security-sweep (secdef/search_path/overload=1/grants); RPC-ref +
  hygiene clean on changed files; casual-regression in-browser against the real
  Finbars token (no LEAGUE pill on casual squads; CURRENT/ADMIN intact; no
  regression). **On-device visual confirm operator-owed** (hard-rule #13, MySquads
  in PWA scope).
- **Locked for later cycles (from this session's discussion):** league availability
  is two-stage (players signal "who's in" → admin confirms the lineup → submitted to
  the league); players + admin override; reuse the familiar in/out tile look; **no
  Team A/B split for league** (you play an external opponent — the casual Group
  Balancer never runs for a league fixture). Governs cycles 5.5/5.6.
- Decisions/full plan: `~/.claude/plans/continuing-phase-3-of-steady-falcon.md`.

---

## LEAGUE MODE — PHASE 3 COMPLETE (session 51, 2026-05-27)

All six Phase 3 cycles shipped + Vercel deployment. The ref view is
now feature-complete and live: a referee can open the link on their
phone at the pitch, see both squads, hold Start, log goals / cards /
subs / period changes, work offline if signal drops, confirm full
time, and see a read-only post-match summary. Venue admins can
override results via the venue dashboard's RPC (UI to follow).

**What shipped in session 51 (this session):**
- **Cycle 3.3 — LiveMatch screen (commit `da89740`)**. Sticky clock+score
  bar, two-team player rows with ⚽/🟨/🟥/↕️ tap targets, long-press
  goal → own goal, second yellow auto-prompts red, sub picker modal,
  half-time / start-2H / full-time period actions, 30s undo toast
  wired to `ref_undo_event`, full-time confirm dialog. Optimistic UI
  with revert-on-error throughout.
- **Cycle 3.4 — Offline event queue (commit `7ce2bac`)**. Every event
  tap persisted to IndexedDB BEFORE the RPC call. Drain loop replays
  pending rows on mount / `online` event / manual Retry. Idempotent
  by client_event_id (mig 120 ON CONFLICT DO NOTHING) so duplicate
  replays are server-side no-ops. Sticky amber "Offline · N queued"
  / green "Syncing · N pending" banner. beforeunload guard on
  pending-count > 0. No service worker (deliberate — avoids the
  session-50 SW failure family entirely).
- **Cycle 3.5 — Score materialisation + standings cascade (verified, no commit)**.
  End-to-end ephemeral fixture via Supabase MCP: ran ref_start →
  9 events → ref_confirm_full_time → asserted score 3-1 / completed
  / standings W=1 GF=3 GA=1 PTS=3 / undone-goal correctly excluded /
  own-goal correctly credited to opposite team. Discovered: no
  cascade trigger exists — standings are computed on-read by
  `get_league_standings_for_player` (mig 087/104), so the cycle
  shipped nothing because no code needed adding. Verified clean.
- **Cycle 3.6 — Post-match summary + venue result override (commit `563201b`)**.
  - New mig 127: `venue_update_fixture_result(venue_token, fixture_id, home, away, reason)` —
    SECURITY DEFINER, token-gated via `resolve_venue_caller`, requires
    fixtures in `status='completed'`, non-empty reason, audit-logs
    previous + new scores + reason, broadcasts `result_corrected` to
    both teams + venue + league.
  - **Side-effect fix in mig 127**: `notify_venue_change` had silently
    regressed in mig 121 (whitelist shrank 26 reasons → 3, every
    Phase 2 RPC calling it has been logging WARNINGs for the past
    week). Restored full Phase 2 list + added new Phase 3 reasons
    while rewriting the function body. Plus `notify_league_change`
    gained `fixture_result_corrected`.
  - New `apps/ref/src/views/PostMatch.jsx`: read-only summary with
    scorers, cards, subs, "Share result" button (copies plain-text
    summary to clipboard). Footnote: "Need a correction? Ask the
    venue admin." App.jsx routes status='completed' → PostMatch.
  - Verified end-to-end against ephemeral fixture: bad inputs
    rejected with correct error codes, 1-1 → 2-3 override worked,
    standings reflect override, second override (0-0) worked, audit
    rows + metadata correct. Zero leak.

**Vercel deployment for apps/ref**:
- New Vercel project `platform-ref` (id `prj_akoL30MbOSlO7DSrT7f1OYagWbE0`)
  linked to this monorepo's main branch, root directory `apps/ref`.
- Env vars set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (production + development; preview skipped due to a CLI bug with
  `--yes` for "all preview branches" — can add later when needed).
- Live at `https://platform-ref.vercel.app` and the auto-generated
  branch aliases. First production build: 11.5s, clean.
- GitHub auto-deploy connected — future `main` pushes auto-deploy.
- Custom domain `ref.in-or-out.com` NOT yet set up (separate task;
  needs DNS record at the user's registrar).
- Side-finding: discovered the `platform-clubmanager` Vercel project
  is in fact the `apps/inorout` production deployment serving
  `in-or-out.com` — name is a leftover that should be renamed
  `platform-inorout` (housekeeping, separate cycle).

**Phase 5 plan approved**:
- Roadmap saved at `/Users/tarny/.claude/plans/continuing-phase-3-of-steady-falcon.md`.
- Locked architectural decisions:
  1. Trigger: per-SQUAD (not per-player). League surfaces only show
     when the player has a competitively-registered squad selected
     as their active context.
  2. UI placement: collapsible cards inside existing tabs (no new
     NavBar tabs). MySquads gets a `LEAGUE` pill on competitive
     squads.
  3. Teamsheet IS source of truth for ref pre-match — Cycle 5.6
     adds `fixture_lineups` table + RPC + backward-compatible update
     to `get_fixture_state_by_ref_token`.
  4. Naming discipline: new components use "Competition" not
     "League" to avoid collision with existing intra-squad
     `PlayerLeagueTable`.
- 7 landable cycles (5.1–5.7), one cycle per session, each with its
  own plan-mode pass.

**Skills framework hardened (commit `cc9e711`)**:
- `Skills/casual-regression.md` — mandatory for any Phase 5+ cycle
  touching `apps/inorout/src/` or `packages/core/`. Codifies the
  "casual is sacred" constraint as a procedure: 20-surface
  inventory, two-token smoke test, console diff, screenshot diff,
  real-device test.
- `Skills/ephemeral-verify.md` — mandatory for any new write RPC.
  Reusable DO-block-with-RAISE-EXCEPTION-rollback template +
  leak-check query. Codifies the pattern we hand-wrote in Cycles
  3.5, 3.6, mig 127.
- CLAUDE.md: hard-rule #14 added (forward-consumer tracking in
  RPCS.md). Skills directory + situation-specific triggers updated.
  Two new "never commit without…" gates added.
- RPCS.md: new "Consumers — forward dependency tracking" section.
- Skills/audit.md + Skills/post-incident.md extended.
- SessionStart hook lists both new skills so they auto-load every
  new chat.

**Tomorrow's safe-deploy plan**:
- Everything that needed to deploy this session has deployed
  (cycles 3.3/3.4/3.6 committed to main → auto-deployed to
  platform-ref.vercel.app; mig 127 applied via MCP).
- Tomorrow's real-world test: open
  `https://platform-ref.vercel.app/ref/<demo-token>` on a real
  iPhone, walk through a Start → events → full time flow,
  observe.
- Next coding session: Cycle 5.1 (smallest, lowest risk — RPC for
  competitive context detection + LEAGUE pill on MySquads).

**Latent items flagged**:
- `Skills/` vs `skills/` directory case mismatch (macOS-only
  passable, breaks on Linux).
- `platform-clubmanager` Vercel project → should rename to
  `platform-inorout`.
- The dead `inor-out` Vercel project (linked to a separate old
  GitHub repo) should be deleted.
- Vercel preview env vars not set for platform-ref (only production
  + development) — CLI bug workaround needed.

---

## LEAGUE MODE — PHASE 3 CYCLE 3.2a SHIPPED (session 50, 2026-05-27)

**Small follow-on to 3.2.** The 3.2 ref RPCs broadcast to both teams'
`team_live:*` channels — fine for inorout team-admin tabs (which
subscribe), useless for the venue admin watching from the office on
the venue dashboard (different surface, different token, never
subscribed). This cycle wires venue-level broadcasts so the
operator's dashboard updates live too.

Shipped:
- **Migration 121** adds `notify_venue_change(p_venue_id, p_reason)`
  helper — mirror of `notify_team_change` but uses
  `venues.live_channel_key` and publishes on `venue_live:<key>`
  channel (public, same private=false pattern). Whitelist starts with
  the 3 Phase-3 reasons (`match_started`, `match_event_recorded`,
  `match_result_saved`) and can grow.
- Tiny private helper `_ref_venue_id_for_fixture(p_fixture)` walks
  competition → season → league → venue. Both helpers explicitly
  revoked from anon + authenticated (Supabase auto-grant gotcha).
- All 7 ref RPCs re-created with an extra
  `PERFORM notify_venue_change(<venue_id>, <reason>)` call right
  after the home/away team broadcasts. Bodies otherwise byte-identical
  to mig 120.
- `apps/venue/src/App.jsx` now imports the `supabase` client and adds
  a useEffect that opens `venue_live:<live_channel_key>` once the
  venue state loads. On any broadcast it re-fetches `venueGetState`.
  Cleanup via `supabase.removeChannel(ch)` on unmount/dep-change.
  The channel key is delivered to the client via the existing
  `venue_get_state` response shape — no new RPC needed.

End-to-end verified: opened `/venue/demo_venue_token_DO_NOT_USE_IN_PROD`
in a browser, fired `ref_start_match` + `ref_record_goal` from the
SQL editor against a demo fixture; console showed
`[venue] subscribed to venue_live:demo_ven…` then two
`[venue] live update` messages (one per RPC), each triggering a
re-fetch. Smoke fixture reset back to `allocated` after.

What's NOT in this cycle (still deferred):
- Phase 4 reception display channel — **RESOLVED (session 57)**: reuses
  `venue_live:<live_channel_key>` (every ref RPC already broadcasts there);
  `apps/display` subscribes. No separate `display:<token>` channel needed.
- Push notifications for any ref event — by design, this stays
  silent/in-tab only.

Files touched:
- `rls_migrations/121_phase3_ref_venue_broadcasts.sql` (+ `_down.sql`)
- `apps/venue/src/App.jsx` (+13 lines for the subscriber)

---

## LEAGUE MODE — PHASE 3 CYCLE 3.2 SHIPPED (session 50, 2026-05-27)

**Cycle 3.2 — Server side of the live match (RPCs only, no UI)** —
medium risk; second of six Phase 3 cycles per plan
`~/.claude/plans/plain-english-please-jazzy-spring.md`.

Built the entire ref-side write surface in one migration. UI ships in
Cycle 3.3.

**Shipped:**

- **Migration 120** (`120_phase3_ref_match_writes.sql`):
  - Schema additions:
    - `match_events.client_event_id uuid UNIQUE` — every ref tap
      generates a client UUID; `ON CONFLICT DO NOTHING` on insert
      makes offline replay strictly idempotent (no double-counted
      goals).
    - `fixtures.actual_kickoff_at timestamptz` — server-recorded
      kickoff moment, lets the ref tab compute a live MM:SS timer
      that survives reloads + offline gaps.
    - `audit_events.actor_type` CHECK extended to include `'referee'`.
  - `notify_team_change` whitelist extended with two new reasons:
    `match_started` and `match_event_recorded` (same-commit-as-callers
    discipline per §6.3 lesson — mig 049 retro-fix taught us this).
  - Private helper `_ref_resolve_fixture(p_ref_token)` — token →
    fixture lookup, raises `invalid_ref_token` on miss. Explicitly
    revoked from anon + authenticated (Supabase auto-grants every
    public-schema function; `REVOKE FROM PUBLIC` alone doesn't catch
    those roles — a hidden gotcha we'd never hit before).
  - Updated `get_fixture_state_by_ref_token` to return
    `actual_kickoff_at` (additive, no consumer breakage).
  - **Seven SECURITY DEFINER ref RPCs**, all token-gated via the
    helper, all writing an `audit_events` row per hard-rule #9, all
    firing `notify_team_change` for home + away after every successful
    insert per hard-rule #10:
    - `ref_start_match(ref_token, client_event_id, local_timestamp)` →
      flips `status='allocated'/'scheduled' → 'in_progress'`, records
      `actual_kickoff_at`, inserts a `period_change` event with
      `period='1H'`. Broadcasts `match_started`.
    - `ref_record_goal(ref_token, player_id, minute, period,
      client_event_id, own_goal, local_timestamp)` — resolves scorer's
      team via `player_registrations`. `own_goal=true` stores
      `event_type='own_goal'` with `team_id = scorer's own team`
      (counts for the OTHER team in score materialisation).
    - `ref_record_card(ref_token, player_id, minute, period, colour,
      client_event_id, local_timestamp)` — `colour ∈ {yellow,red}`.
    - `ref_record_substitution(ref_token, on_player_id, off_player_id,
      minute, period, client_event_id, local_timestamp)` — both
      players must be on the same team's roster.
    - `ref_set_period(ref_token, period, client_event_id,
      local_timestamp)` — `period ∈ {HT,2H,ET1,ET2,PEN}`; inserts a
      `period_change` event.
    - `ref_undo_event(ref_token, client_event_id)` — DELETE by
      `client_event_id`; idempotent (treats missing row as no-op).
      Server enforces only that the fixture is still `in_progress`;
      the 30-second undo window is a client-side decision.
    - `ref_confirm_full_time(ref_token)` — materialises scores from
      `match_events`:
        - `home_score = goals(home_team) + own_goals(away_team)`
        - `away_score = mirror`
      Transitions `status='in_progress' → 'completed'`. Broadcasts
      `match_result_saved` (already on whitelist). Standings are
      derived on-read by `get_league_standings_for_player`; no
      separate cascade needed.
  - **Demo seed**: 5 players per demo team registered into the demo
    competition with shirt numbers 1–5 backfilled. Idempotent
    (`ON CONFLICT (player_id, competition_id) DO NOTHING`). Without
    this Cycle 3.1's PreMatch + 3.2's event RPCs both ran against
    empty squads — squads now populated for end-to-end smoke testing.

- **JS wrappers** added to `packages/core/storage/supabase.js`
  exported via the barrel: `refStartMatch`, `refRecordGoal`,
  `refRecordCard`, `refRecordSubstitution`, `refSetPeriod`,
  `refUndoEvent`, `refConfirmFullTime`. Each raw snake_case RPC name
  appears in exactly one `supabase.rpc()` call (hard-rule #7
  satisfied).

**Realtime wiring (the bit the user flagged risk on):**

The audit found `notify_team_change` already exists (mig 062 +
049 + 117), already publishes to `team_live:<live_channel_key>`,
already public-channel-not-private, and `apps/inorout/src/App.jsx`
lines 786–827 already subscribe + re-fetch on broadcast. **Zero new
realtime infrastructure required** — every ref event simply fans
out two `notify_team_change` calls (home + away), and both team
admin tabs update without any client-side change.

Whitelist hygiene: the two new reasons (`match_started`,
`match_event_recorded`) were added to the function body in the
SAME migration as the calling RPCs, avoiding the §6.3 drift bug
(mig 049 had to retro-fix `player_account_deleted` after the fact).

**Smoke-tested end-to-end** against the demo fixture
`Alpha United vs Delta FC`:
- Start match (status → in_progress), 3 regular goals, 1 own-goal,
  1 yellow card, 1 substitution, HT, 2H, 1 goal-then-undo, full
  time confirm.
- Final score: 2–2 (math checks: 2 home goals + 0 own_goals from
  away = 2; 1 away goal + 1 own_goal from home = 2).
- 12 audit rows by `referee`, 9 surviving match_events (undone
  event correctly deleted), idempotent retry of a goal RPC with
  the same `client_event_id` was a clean no-op.
- Zero `unknown reason` warnings in postgres log during the run —
  whitelist extension worked.
- Fixture reset back to `allocated` so Cycle 3.3 has a fresh slate.

**RPC security sweep**: all 7 RPCs pass — SECURITY DEFINER, search
path locked to `public, pg_temp`, `EXECUTE` granted to `anon` +
`authenticated`, no overloads, helper properly private.

**Files touched:**
- `rls_migrations/120_phase3_ref_match_writes.sql` (+ `_down.sql`)
- `packages/core/storage/supabase.js` (+7 wrappers, +read-RPC update)
- `packages/core/index.js` (+7 exports)

**What's next:** Cycle 3.3 — the live match UI in `apps/ref/`
(LiveMatch.jsx) wiring the buttons to the 7 RPCs. Online-only first;
the offline queue is the standalone Cycle 3.4.

---

## LEAGUE MODE — PHASE 3 CYCLE 3.1 SHIPPED (session 50, 2026-05-27)

**Cycle 3.1 — Pre-match: ref logs in and sees the squads** (low risk,
pure read + UI; first of six Phase 3 cycles per the plan
`~/.claude/plans/plain-english-please-jazzy-spring.md`).

Shipped:
- **Migration 119** (`119_phase3_ref_get_fixture_state.sql`) — new
  `get_fixture_state_by_ref_token(p_ref_token)` SECURITY DEFINER RPC.
  Returns one fixture + competition + venue + league + pitch +
  official + both teams + both squads (derived from
  `player_registrations` joined to `players`, ordered by
  shirt_number) + any existing `match_events` for resume. Single-
  fixture access only — token grants access to nothing else.
  Grants: `anon, authenticated`.
- **JS wrapper** `getFixtureStateByRefToken(refToken)` in
  `packages/core/storage/supabase.js`, exported from the barrel.
- **New app `apps/ref/`** (Vite + React, port 5180) — mirrors
  `apps/venue/` shape: `package.json`, `vite.config.js`,
  `index.html`, `vercel.json` (catch-all → index.html),
  `src/main.jsx`, `src/App.jsx`, `src/styles.css`.
- **Visual baseline**: shares Geist + coral accent with apps/venue
  but strips glass effects, drifting orbs, and shimmer — refs need
  outdoor-readable contrast and large tap targets, not flourish.
  Auto light/dark via `prefers-color-scheme`. Min 56px buttons.
- **`PreMatch.jsx` view**:
  - Header eyebrow (venue · competition · week)
  - Kickoff strip (time + date / pitch + ref)
  - Two squad cards (team swatch from primary_colour, shirt number
    + player name + suspension flag if `suspension_until` future)
  - Empty squad state ("No confirmed squad yet")
  - Terminal-state banner (`completed` / `void` / `postponed` /
    `walkover` / `forfeit`) — surfaces final score, replaces Start
    Match with a Refresh
  - **Start Match button**: enabled within 15 min of kickoff; outside
    that window, requires a 3-second pointer hold to override (RAF-
    driven progress fill on the button, countdown hint underneath)
  - The actual `ref_start_match` RPC ships in Cycle 3.2 — the tap
    handler currently surfaces an alert pointing forward.
- **Smoke-tested** at 390×844 against two real demo fixtures:
  a completed fixture (4–2 Alpha United vs Bravo Athletic, Wed 13
  May) shows the terminal-state path; a future allocated fixture
  (Wed 3 Jun, Alpha United vs Delta FC) shows the gated Start
  Match with "Unlocks in 7 days" hint.

**RPC security sweep passed**: `security_definer: true`,
`search_path: public, pg_temp`, EXECUTE granted to both `anon` and
`authenticated`, no overloads.

**Demo seed gap noted**: `player_registrations` rows aren't seeded
for the demo teams, so squads render as empty in the current demo.
Not a blocker for Cycle 3.1 (squad rendering verified empty + non-
empty paths work); will be addressed when Cycle 3.3 needs live
squads for event entry, or sooner via a dedicated seed cycle.

**Files touched**:
- `rls_migrations/119_phase3_ref_get_fixture_state.sql` (+ `_down.sql`)
- `packages/core/storage/supabase.js` (+wrapper)
- `packages/core/index.js` (+export)
- `apps/ref/` (new app)

**What's next**: Cycle 3.2 — server-side event-write RPCs +
`client_event_id UNIQUE` column on `match_events` + realtime
broadcasts (so Phase 4 reception display can subscribe later).

---

## LEAGUE MODE — PHASE 2 COMPLETE (session 48, 2026-05-27)

All 8 cycles shipped. The venue admin can now, from a single
browser window: onboard the venue, define one or more leagues,
create a season, generate fixtures across multiple competitions,
approve incoming team registrations, assign pitches + refs to
fixtures, change fixture statuses (postpone / void / walkover /
forfeit), withdraw or expel mid-season teams (with cascade), and
maintain pitches + officials. Demo venue (`demo_venue_token_DO_NOT_USE_IN_PROD`,
league code `DEMO0001`) exercises every surface end-to-end.

**Cycles** (in shipped order):
- **2.1** Foundation + operator-led onboarding — migs 083–085 + 088 hotfix
- **2.2** Read RPCs — `venue_get_state`, `league_get_state`,
  `join_get_league_by_code`, `get_league_standings_for_player` —
  migs 086–087 + 089 hotfix
- **2.3** Engines (round-robin + cup) + `venue_create_season` +
  `venue_generate_fixtures` — migs 090–091 + 092 hotfix
- **2.4** Fixture management RPCs (`venue_assign_pitch`,
  `venue_assign_ref`, `venue_update_fixture_status`) + forfeit
  columns — migs 093–096
- **2.5a** Team registration via `/join/CODE` —
  `join_register_team`, `venue_approve_team_registration`,
  `venue_reject_team_registration` — migs 097–100
- **2.5b** Mid-season failures (`venue_withdraw_team`,
  `venue_expel_team`) + standings cascade incl. forfeit — migs 101–104
- **2.6** Refs + pitches CRUD + maintenance-window enforcement —
  migs 105–109
- **2.7a** Demo venue seed + upcoming-filter hotfix + date
  relativisation — migs 110–112
- **2.7c** Venue dashboard scaffold — new `apps/venue/` Vite+React app
- **2.7d** Dashboard write surfaces + teams directory — mig 113
- **2.8** Season-setup wizard (5-step modal-over-dashboard) —
  mig 114

**Phase 2 leftovers** (carved out deliberately during the cycles —
each small enough to be a single sub-cycle when picked up):
- 2.7b email dispatcher
- 2.9 visual overhaul (drawers + numbered panels + toasts + Framer
  Motion, per the design-tool mockups)
- 2.10 dedicated sub-routes (Fixtures detail / Results / Teams /
  Players / Officials / Pitches / Incidents / Registrations /
  Reports / Settings)
- 2.11 Google OAuth for venue admin
- 2.12 fixture detail page + per-fixture notes

**Remaining phases** (per LEAGUE_MODE_SCOPE.md):
- Phase 3 — Ref view (5 days, "most complex single feature")
- Phase 4 — Reception display (3 days)
- Phase 5 — Player + team-admin competitive (5 days)
- Phase 6 — HQ dashboard (6 days)
- Phase 7 — AI layer / Ask the Gaffer evolved (8 days, largest)
- Phase 8 — Billing + self-serve (5 days, deferred to year 2)
- Phase 9 — Notifications + comms (3 days)
- Phase 10 — Public league pages (2 days, smallest / highest leverage)
- Phase 11 — Cups + knockouts polish (4 days)

Total remaining nominal estimate: ~41 days, plus the ~5 days of
carved-out Phase 2 leftovers.

---

## LEAGUE MODE — PHASE 2 CYCLE 2.8 SHIPPED (session 48, 2026-05-27)

Season-setup wizard. The operator's path from "I want to run a new
season" to "fixtures are persisted and live on the dashboard" is now
a single 5-step flow.

- **mig 114** — `venue_list_active_teams(p_venue_token)` — venue-scoped
  team directory (wider than `venue_get_state.teams` which is
  competition-scoped). Returns every competitive team registered
  into any competition under the caller's venue.
- **`SeasonWizard.jsx`** — single-file multi-step wizard with 5
  inline step components: Basics / Competitions / Teams / Preview /
  Confirm. Modal-over-dashboard, launched from a "Set up new season"
  topbar button.
- Reuses existing engines (`generateRoundRobin`,
  `generateCupBracket`) for client-side fixture preview, and
  existing RPCs (`venueCreateSeason`, `venueGenerateFixtures`) for
  persistence.
- Engine `pitch_index` → `playing_area_id` translation in the submit
  handler, mapping through `season.pitches[index]`.
- Modal extended with a `wide` prop (880px max-width) for the
  wizard layout.

Visual mockups from external design tool reviewed this session but
deliberately NOT adopted — user direction was "build first,
redesign later." Mockup adoption tracked as Cycle 2.9 leftover.

---

## LEAGUE MODE — PHASE 2 CYCLE 2.7d SHIPPED (session 48, 2026-05-26)

Venue dashboard write surfaces. Five action paths from UI through
to live RPCs.

- **Modal pattern** (`Modal.jsx`) — generic dialog reused across
  every write surface. Backdrop blur, Esc-to-close, header/body/foot.
- **Approve/Reject team registration** — Open Issues panel.
  Approve = 1-click. Reject = modal with required reason.
- **Assign pitch** — fixture row → modal → dropdown with
  maintenance-window blocked options pre-disabled.
- **Assign ref** — fixture row → modal → ref dropdown with
  channel + rating shown inline.
- **Change fixture status** — fixture row → modal with status
  picker that branches required fields (postpone/void → reason;
  walkover → winner; forfeit → both).
- **Add/Edit pitch** — sidebar "+ Add" + per-row "Edit" → modal
  with dynamic maintenance-window editor + active/is_available
  toggles.
- **Add/Edit ref** — same pattern; channel + employment_type
  dropdowns; rating numeric.

**mig 113** — `venue_get_state` adds top-level `teams` directory
keyed by team_id (closes the team-name-as-raw-id shortcut from 2.7c).

End-to-end verified via Playwright against the live demo venue:
clicked Approve on a seeded pending registration → DB state flipped
+ audit row written + dashboard refreshed with the row gone.

**Polish deferred to an external design-tool pass** (Framer Motion
animations, optimistic UI, toast notifications) — brief sent to
user this session, written in Vite+React+vanilla-CSS constraints.

**Phase 2 remaining:** Cycles 2.7b (email dispatcher), 2.8 (wizard
UI for season setup).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.7c SHIPPED (session 48, 2026-05-26)

First clickable Phase 2 surface. New `apps/venue/` React app
(10 files: package.json, vite config, vercel config, index.html,
main.jsx, styles.css, App.jsx, Dashboard.jsx, FixtureCard.jsx,
Sidebar.jsx).

- Token-from-URL auth (`?token=` query param or `/venue/TOKEN` path).
- Six-panel responsive layout: Tonight / This Week / Open Issues
  / Recent / Upcoming / Sidebar (pitches + refs).
- Powered entirely by `venue_get_state` (1 round trip per load).
- Score branching covers completed / walkover / forfeit. Status
  pill labels: "Needs pitch" / "Needs ref" / "All set" / "Result"
  / "Walkover" / "Forfeit" / "Postponed" / "Void".
- Maintenance windows surface as a count badge in the sidebar
  pitch list.
- Read-only — no buttons mutate state yet.

Verified end-to-end via Playwright against the live demo venue
(`demo_venue_token_DO_NOT_USE_IN_PROD`). All panels render with
real data; zero console errors apart from missing favicon.

**Known shortcut**: fixture team names render as raw IDs because
venue_get_state doesn't include a team-name directory. Cycle 2.7d
will fix.

**To deploy**: add `apps/venue/` as a new Vercel project + set
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars
(operator action).

**Phase 2 remaining:** Cycle 2.7d (write surfaces — approve/reject
buttons, fixture mgmt modals, pitch/ref CRUD forms), 2.7b (email
dispatcher), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.7a SHIPPED (session 48, 2026-05-26)

End-to-end demo venue seed driving every Phase 2 RPC (migs 110–112).

- **mig 110 — demo venue seed.** Idempotent DO block: venue + league
  + 2 pitches (one with future MW) + 3 refs + season + competition
  + 4 teams + 6 round-robin fixtures (3 completed, 1 walkover, 2
  allocated upcoming) + 1 player. Dates are CURRENT_DATE-relative.
- **mig 111 — venue_get_state + league_get_state upcoming filter
  fix.** Latent bug surfaced by the seed: allocated fixtures were
  excluded from the upcoming bucket, so a pitched fixture would
  vanish until kickoff day. Fix: include 'allocated' alongside
  'scheduled' and 'postponed'.
- **mig 112 — date reshuffle.** One-off live-data fix for the
  initially seeded hardcoded dates (mig 110 source now uses
  current_date-relative arithmetic so future re-seeds are correct
  from the start).

Cycle 2.7 originally scoped as frontend + email + demo together;
split into sub-cycles 2.7a–2.7d. This is a.

**Phase 2 remaining (post Cycle 2.7c):** Cycle 2.7d shipped — see
above. Remaining: 2.7b (email dispatcher), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.6 SHIPPED (session 48, 2026-05-26)

Refs + pitches CRUD plus the maintenance-window enforcement deferred
from Cycle 2.4 (migrations 105–109). Backend half of Phase 2 complete.

- **mig 105** — `venue_add_pitch` — create row with optional
  surface, capacity, sort_order, is_available, maintenance_windows.
- **mig 106** — `venue_update_pitch` — partial update via jsonb;
  soft-delete via active=false; broadcast switches to `pitch_closed`
  on the true→false flip.
- **mig 107** — `venue_add_ref` — create row; preferred_channel +
  employment_type defaulted; table CHECKs enforce enum values.
- **mig 108** — `venue_update_ref` — partial update mirror.
- **mig 109** — `venue_assign_pitch` rewrite — enforces
  `maintenance_windows` overlap against fixture's `scheduled_date`,
  rejects with `pitch_in_maintenance`. Skips check when no date set.

**Phase 2 remaining:** Cycles 2.7 (frontend + email dispatcher + demo
venue seed), 2.8 (wizard UI). All backend RPCs now live.

---

## LEAGUE MODE — PHASE 2 CYCLE 2.5b SHIPPED (session 48, 2026-05-26)

Mid-season team-exit flows + standings cascade for forfeit
(migrations 101–104).

- **mig 101** — `competition_teams.expulsion_reason` + extends
  `notify_venue_change` / `notify_league_change` whitelists with
  `team_expelled` and `fixtures_cascaded`.
- **mig 102 — `venue_withdraw_team`** — pending/active → withdrawn,
  cascade remaining fixtures (walkover to opposing team; void on
  phantom byes). Idempotent.
- **mig 103 — `venue_expel_team`** — active → expelled, same cascade.
  Distinguishable from withdrawal via `void_reason` / status.
- **mig 104 — `get_league_standings_for_player`** rewritten — now
  counts forfeit fixtures (3-0 to forfeit_winner_id, mirror of the
  existing walkover branch). Withdrawn/expelled teams stay in
  standings with accumulated pre-exit points.

Pitch close (maintenance windows) → Cycle 2.6. Ref no-show already
supported via Cycle 2.4's assign_ref(NULL)+reassign.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.5a SHIPPED (session 48, 2026-05-26)

Self-serve team registration backend for `/join/CODE` — three RPCs +
one schema add (migrations 097–100).

- **mig 097** — `competition_teams.rejection_reason text` (additive).
- **mig 098 — `join_register_team`** — authenticated-only public RPC.
  Creates a competitive team OR promotes an existing casual one,
  claims caller as `team_admin`, inserts `competition_teams(status=
  'pending')`. Guards duplicate registration on same team_id.
- **mig 099 — `venue_approve_team_registration`** — pending→active,
  idempotent on already-active.
- **mig 100 — `venue_reject_team_registration`** — pending→rejected
  with required reason captured in `rejection_reason`.

Squad collection deferred: the team admin uses the existing
AdminView SquadScreen post-approval. Notification delivery to team
admin (push/email) deferred to Cycle 2.7 — RPCs emit audit + broadcast
hooks so the dispatcher can subscribe.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASE 2 CYCLE 2.4 SHIPPED (session 48, 2026-05-26)

Fixture management RPCs for the operator dashboard. Three single-row
mutating RPCs + a forfeit-storage schema addition (migrations 093–096).

- **mig 093** — `fixtures.forfeit_winner_id` (text FK → teams ON
  DELETE SET NULL) + `fixtures.forfeit_reason`. `fixtures_status_check`
  expanded additively to include `'forfeit'`. Caught proactively by
  the new `pg_constraint` sweep mandate.
- **mig 094 — `venue_assign_pitch`** — sets/clears
  `fixtures.playing_area_id`. Auto-bumps scheduled↔allocated. Validates
  pitch is active + is_available + in caller's venue.
- **mig 095 — `venue_assign_ref`** — sets/clears `fixtures.official_id`.
  Audit/broadcast distinguishes assigned / changed / cleared.
- **mig 096 — `venue_update_fixture_status`** — drives the four
  operator-initiated terminal transitions (postpone, void, walkover,
  forfeit) with per-status validation + winner/reason metadata.

Standings update for forfeit (and the team-withdrawal cascade)
deferred to Cycle 2.5b, per the deferral already documented in mig 087.

**Phase 2 remaining:** Cycles 2.5a (team registration), 2.5b
(mid-season failures + standings cascade), 2.6 (refs+pitches CRUD),
2.7 (frontend + email + demo venue), 2.8 (wizard UI). ~3–4 days.

---

## LEAGUE MODE — PHASE 2 CYCLES 2.1–2.3 SHIPPED (session 48, 2026-05-26)

The first half of Phase 2 (League Mode customer-visible surfaces) is
live as DB + JS modules. Cycles 2.1, 2.2, 2.3 shipped end-to-end with
matching `_down.sql` files and proactive in-flight CHECK-constraint
hotfixes.

**Cycle 2.1 — Foundation + operator-led onboarding (commit `03bd4be`):**
- Migs 083–085: `venues.live_channel_key`, `leagues.league_code` (8-char
  alphanumeric) + `live_channel_key` + `squad_mode` + `squad_mode_locked_at`
  + `standings_visibility`, `match_officials.employment_type` +
  `overall_rating`, `playing_areas.is_available` + `maintenance_windows`,
  `competition_teams.status` DEFAULT flipped to `'pending'`.
- Resolver helpers: `resolve_venue_caller`, `resolve_league_caller`.
- Realtime publishers: `notify_venue_change` (25 reasons),
  `notify_league_change` (11 reasons) — separate
  `venue_live:`/`league_live:` channels from `team_live:`.
- **Primary onboarding tool**: `superadmin_create_venue` RPC +
  `/superadmin/venues/new` form on `apps/superadmin`. Self-serve
  signup (original Phase 8) deferred to year 2 per DECISIONS.md.

**Cycle 2.2 — Read RPCs (commit `f940c32`):**
- `venue_get_state` — full venue dashboard payload with fixtures
  bucketed tonight / this_week / upcoming / recent.
- `league_get_state` — narrower deep-link, falls back to league-pick
  prompt when caller is a venue admin.
- `join_get_league_by_code` — public `/join/CODE` landing.
- `get_league_standings_for_player` — W/D/L/GF/GA/GD/Pts across every
  competition the player is in; walkovers default to 3-0; top scorers
  stubbed until Phase 3 `match_events`.

**Cycle 2.3 — Engines + season setup (commit `71b8aab`):**
- `packages/core/engine/roundRobin.js` — circle method with home/away
  balance, pitch×slot allocation, doubleRound mirror, excludeWeeks.
- `packages/core/engine/cupBracket.js` — single elim (byes to top
  seeds + bracket placeholders) + group stage (snake-seeded).
- `venue_create_season` RPC — creates season + competitions, validates
  league ownership + date order + types.
- `venue_generate_fixtures` RPC — bulk-persists engine output, validates
  everything (competition ownership, no existing fixtures, every team
  active, every date in season, every pitch in venue), **one audit
  row** per generation.

**In-flight CHECK-constraint hotfixes** (migs 088/089/092 — full
detail in BUGS.md): `competition_teams.status` enum, RPC body
references to non-existent `incidents.status` + invalid
`'registration_open'`, `audit_events.actor_type` whitelist. Pattern
captured in DECISIONS.md "SCHEMA-SYNC MUST SWEEP `pg_constraint`".

**Customer-visible impact: zero (Phase 2 frontend lives in Cycle 2.7).**
Backend ready for the wizard UI; superadmin onboarding form ships
but pending the `apps/superadmin` env-var fix in BUGS.md.

**Decisions captured in DECISIONS.md (session 48):**
- Operator-led onboarding for year 1, Phase 8 deferred.
- `/league/TOKEN` merges into `/venue/TOKEN`.
- Existing casual teams stay venueless forever.
- Squad mode per-league, locked at first fixture.
- Bulk-RPCs audit one row, not N.

**Phase 2 remaining (post Cycle 2.7a):** Cycles 2.7b (email
dispatcher), 2.7c/d (venue dashboard frontend), 2.8 (wizard UI).

---

## LEAGUE MODE — PHASES 0 + 1 SHIPPED (session 40, 2026-05-25)

Two phases of `LEAGUE_MODE_SCOPE.md` landed end-to-end:

**Phase 0 — Foundation (migrations 050–054):**
- `league_config` table + `useLeagueConfig` hook + multi-sport posture
- `matches.match_type`, `teams.team_type`, `player_match.match_type` columns
- `notify.js` channel abstraction (dry-run by default; Phase 9 plugs Twilio)
- `company_domains` table + AuthCallback hook
- `create_team` RPC extended with `p_team_type` (default 'casual')
- `player_career` split into casual_*/competitive_*/total_* + `sync_player_career` RPC

**Phase 1 — Core data model (migrations 055–057):**
- 20 new tables: companies, company_admins, billing_events, clubs, venues,
  venue_admins, `playing_areas` (multi-sport rename of `pitches`),
  `match_officials` (multi-sport rename of `referees`), leagues, seasons,
  competitions, club_teams, competition_teams, team_name_history,
  cup_rounds, fixtures, match_events, player_registrations, incidents,
  hq_preview_tokens
- 13 new columns on existing tables (teams, matches, players, player_match)
- Phase-0 FK constraints retroactively added; `get_company_by_domain`
  extended to JOIN companies

**Multi-sport posture recorded in DECISIONS.md (session 40).** Zero
renames of existing identifiers; all new identifiers generic; future
sport-specific stats go into a `sport_stats jsonb` column when sport #2
lands.

**Customer-visible impact: zero.** Spine in place; Phase 2 will be the
first phase that builds customer-facing surfaces on top.

**Also this session:** MyView double-count hotfix (PlayerView.jsx — was
adding ledger balance + this-week's price for a phantom £10 instead of
the real £5). Commits `a8dd46d` + `ab6484f`.

---

---

## PHASE 1 — COMPLETED

| Feature | Status | Notes |
|---|---|---|
| Rotate Supabase keys | ✅ | New key in CONTEXT.md INFRASTRUCTURE |
| PlayerView redesign | ✅ | Session 6 |
| StatsView rebuild | ✅ | IO Statbook |
| HistoryView rebuild | ✅ | Results screen |
| AdminView rebuild | ✅ | Session 6 |
| player_match + player_career tables | ✅ | Session 6 |
| player_injuries table | ✅ | Session 6 |
| Teams confirmed view | ✅ | Form dots, POTM trophy, bibs indicator |
| Demo environment | ✅ | team_demo, 25 players, 22 matches, /demoadmin, auto-reset |
| POTM + Results display text | ✅ | POTM not MOTM, Results not History in UI |
| My IO screen | ✅ | MyIOView.jsx, useIOIntelligence.js — session 8 |
| POTM voting system | ✅ | Modal, cron jobs, push, admin tiebreak — session 10 |
| ScoreScreen | ✅ | 6-stage progressive flow, score_type, last_goal_scorer — session 11 |
| Admin view consistency | ✅ | Sticky heroes, 5-tab admin nav, Gaffer disabled — session 12 |
| Player League Table | ✅ | PlayerLeagueTable.jsx + getPlayerLeagueTable — session 20 |
| Admin screens redesign | ✅ Done | ScheduleScreen ✅ (s13), TeamsScreen ✅ (s21), SquadScreen ✅ (s22), BibsScreen ✅ (s28) |
| Vice Captain system | ✅ | VC toggle, PlayerProfile ROLES, HeroCard ADMINS, access gating — sessions 22–23 |
| Payments admin screen | ✅ | PaymentsScreen.jsx — 4-section layout, ledger dedup — session 22 |
| Stats rewrite (player_match) | ✅ | All leaderboards from player_match via getPlayerLeagueTable — session 22 |
| Payment ledger dedup | ✅ | createLedgerEntry resilient insert, partial-index-aware — sessions 22–23 |
| Head to Head card | ✅ | 5-section, 5-verdict chemistry, period selector — sessions 22–23 |
| Pre-launch /create + /join audit | ✅ | user_id propagation, protocol fix, iOS-only redirect gate — session 23 |
| Onboarding redesign | ✅ | SetupLoadingScreen + SquadReady, AddPlayers removed — session 27 |
| JoinSuccess install screen | ✅ | Platform-detected (iOS/Android/desktop) — session 8 |
| RLS + security hardening | ✅ | 47 SECURITY DEFINER RPCs, all 19 tables locked — session 24 |
| /create auth gate | ✅ | Hard auth gate + ioo_pending_route sessionStorage — session 24 |
| team_admins table | ✅ | Written by create_team RPC — session 24 |
| link_player_to_user RPC | ✅ | Authenticated-only, migration 022 — session 24 |
| All player_match reads via RPC | ✅ | get_team_state_by_player_token extended — session 25 |
| Multi-team player switcher | ✅ | player_get_teams RPC, MySquads.jsx — session 26 |
| is_vice_captain cross-team fix | ✅ | Migrated to team_players, migration 026 — session 26 |
| Live board POTM + bibs + form dots | ✅ | lastMatchMeta + playerForm via RPC — session 25 |
| Teams confirmed realtime | ✅ | confirmedThisSession ref, teamsConfirmedRef — session 25 |
| POTM voting RLS fix | ✅ | submit_potm_vote + get_potm_voting_state RPCs — session 25 |
| Join/login redesign | ✅ | Full JoinTeam.jsx rebuild — session 27 |
| Dead code cleanup | ✅ | Pre-RLS direct writes removed — session 28 |
| Manage Squad redesign | ✅ | Modern card-row, status-ring avatars, inline rename, per-row icon toggles, overflow ⋯ menu, filter chips, stagger fades — session 34 |
| Guest-only add bar | ✅ | Regulars self-onboard via invite link; admin add bar is now single-line guest-only — session 34 |
| Admin manual status (in/out/maybe/reserve) | ✅ | Status pills inside ⋯ menu; sets admin_locked_in so player can self-decline but not self-restore IN; server-side squad-cap gate on both admin and player paths; injury-override confirm modal. Migration 038. — session 34 |
| AdminView/index.jsx extraction | ✅ | PlayerProfile, POTMTiebreakModal, AnnounceModal split into own files; 1,544 → 976 LOC. Latent pendingTiebreak ReferenceError fixed in flight. — session 35 |
| PaymentsScreen redesign | ✅ | Inline £X PAY pill (1-tap mark paid), ⋯ overflow menu (Reset/Waive/Open Ledger), status-ring avatars, section glow, glass cards, pop-flash on just-paid, stagger fade-in. Backend untouched. — session 35 |
| ScheduleScreen + TeamsScreen polish | ✅ | Glass form sections, gold-glow titles, hardcoded radii (8/10/12/20) replaced with token vars. No interaction change. — session 35 |
| Player self-profile screen | ✅ | New unified PlayerProfile.jsx. Avatar overlay top-left on PageHeader (also recentred IN OR OUT logo). Three lazy-load sections: Stats / Payment History / Injuries. Migration 039 (get_my_payment_history + get_my_injuries). — session 35 (PROFILE_SCOPE A) |
| Leave squad (self) | ✅ | Two-tap confirm. Refuses with `debt_owed:<amount>` if owes > 0. Detaches team_players + push_subscriptions; preserves player row + history. Migration 040 (leave_squad RPC). — session 35 (PROFILE_SCOPE B) |
| Delete account (self) | ✅ | Typed-DELETE modal. Anonymises players row (name → "Deleted player") preserving FKs; detaches all teams; deletes push_subscriptions + player_career; revokes admin grants; calls auth.admin.deleteUser via /api/delete-account edge function. Refuses with `last_admin:<csv>` if user is sole admin of any team. Migration 040 (delete_my_account RPC). — session 35 (PROFILE_SCOPE B) |
| PlayerProfile admin mode merge | ✅ | Single file serves both modes behind isAdminView prop. Admin mode adds "Admin view" pill, branched RPCs (admin paths), ROLES with VC toggle, Admin Actions card (Rename/Copy/Reset link/Mark injury), Remove from squad with has_history guard surfaced. AdminView/PlayerProfile.jsx (374 LOC) deleted. — session 35 (PROFILE_SCOPE C) |
| First-time-use tooltips | ✅ | New `FirstTimeHint` primitive (framer-motion + localStorage, chained via `prerequisite` key, `ioo-hint-dismissed` event syncs duplicate mounts). 12 hints across AdminView (live-toggle global, key preserved), Squad invite link, Teams (tiles → SMART → CONFIRM chained), Payments unpaid section, Bibs holder, PlayerView status grid, StatsView league table (H2H discovery), HistoryView first match, PlayerProfile leave button. Pre-execute audit confirmed zero DB/RPC/auth/env touched. — session 38 |
| Pre-Beta launch fix: player_join_team token | ✅ | Migration 044. New-player INSERT branch now generates a player token. Pre-fix, first-time joiners landed with NULL token → JoinSuccess.jsx fell back to `/`. Caught and fixed in the audit before the real team's invite link went out. — session 39 |
| Super-admin dashboard Phase 1+2 (read-only) | ✅ | New `apps/superadmin` app at `https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app`, Vercel SSO-gated. Three tabs: Activity (audit_events tail), Teams (sortable list), Team Detail (drilldown). Migrations 045 (platform_admins + is_platform_admin + superadmin_whoami) + 046 (3 read RPCs). All RPCs gated by global cross-team auth helper. Phase 3 (token rescue) + Phase 4 (data fix) write tools deferred. — session 39 |
| Workspace-deps guard hook | ✅ | New `Skills/scripts/check-workspace-deps.sh`. Validates every `@platform/*` dep in every `apps/*/package.json` + `packages/*/package.json` maps to a real workspace package — wired into the pre-commit build gate. Sub-second jq check. Makes the "fake-alias-as-dep" bug class (which broke platform-clubmanager's CI when superadmin shipped) structurally impossible going forward. Plus `@platform/supabase` alias eliminated entirely; 22 source files migrated to import from `@platform/core/storage/supabase.js`. — session 39 |
| Push notification pipeline operational | ✅ | Three-layer fix: VAPID env vars set with real values (were stored as empty strings since the original platform-clubmanager deploy 13 days prior), all 6 pg_cron jobs rewritten apex → www (apex 307s strip the Authorization header at the redirect → 401), pg_cron job 5 syntax error fixed. Verified end-to-end at the 19:45 UTC cron tick: 4× HTTP 200 vs 4× HTTP 401 at 19:30 baseline. Migration 049 adds `player_account_deleted` to `notify_team_change` whitelist. **In-app subscribe flow not yet exercised on a real device** — proof-on-device deferred. — session 39 |
| Defense-in-depth: admin_save_teams scoping | ✅ | Migration 048. Adds `team_players` scope to the two `UPDATE players SET team='A'/'B'` statements in admin_save_teams (the CLEAR was already scoped). Closes a cross-team write surface where a legit admin for team X could pass team Y player_ids in p_team_a/p_team_b and flip their team column. Verified live with adversarial + happy-path tests inside rolled-back transactions. — session 39 |

---

## PHASE 1 — BLOCKED

| Feature | Blocker |
|---|---|
| Stripe Connect | Needs Stripe platform account setup |
| Apple Sign In | Needs Apple Dev account £79 |

---

## PHASE 2 — TARGET MAY 26 (Stage 2)

| Feature | Status | Notes |
|---|---|---|
| **Bug fixes (Pre-UAT)** | ✅ All cleared session 28 | No Pre-UAT blockers remaining |
| **Mid-game team switches** | ✅ Done session 28 | ScoreScreen new stage, team_switches jsonb, final team → W/L/D. See DECISIONS.md for spec. |
| **Most Faced Opponent card** | ✅ Done session 32 | Unlocks at 4+ games. Amber badge, computed client-side via `computeDeeperIntel`. |
| **Reliability Ranking card** | ✅ Done session 32 | Unlocks at 5+ games. Cyan badge, shows top reliable + your rank, min 3 squad games to be ranked. |
| **IO deeper-intel cards rewired** | ✅ Done session 32 | Most Played With, Team Impact, Nemesis, Best Partnership were dead UI (hook nulled keys, no upstream computation). Now powered by `packages/core/engine/deeperIntel.js`. See BUGS.md B7. |
| **Monday Footy onboarding** | 🔲 Pending | Stage 2 addition — if Stage 1 week 1 clean |
| owes double-increment guard | ✅ Done session 26 | carryForwardDebts removed; updatePlayerRecords is sole path |
| Multi-team player switcher | ✅ Done session 26 | MySquads.jsx |

---

## PHASE 2 — BACKLOG (pre-broader-beta ~Jun 9)

| Feature | Notes |
|---|---|
| BibsScreen fix under RLS | See BUGS.md #1 |
| CreateTeam email pre-fill | ✅ Done session 29 |
| "Make game live" new admin hint | ✅ Done session 29 |
| Install screen on create flow (SquadReady) | ✅ Done session 30 — shared `InstallSection` extracted from JoinSuccess, inlined into SquadReady with sticky "Go to my team" CTA. Desktop copy-link targets admin URL. |
| Last goal scorer in IO Intelligence | `last_goal_scorer` field on matches — just wire into a card |
| Bib streak insight | Consecutive bib games — data in `bib_history` |
| WhatsApp share text update | Update share copy in HistoryView |
| BibsScreen RLS write fix | BibsScreen redesigned ✅; standalone write still broken — see BUGS.md #2 |
| **Smart Teams TeamsScreen redesign** | ✅ Session 31 — full live-board rewrite. Auto-Smart fires on entry when no teams set; LiveBoard mirrors PlayerView's confirmed-teams tile (Team A \| B grid with chips); tap-to-move between teams; SMART panel open from start with Group 1 + Group 2 seeded; BUILD TEAMS contextual CTA only when groups dirty; prediction recomputes on every manual move; prediction chip hides when one side is empty; PLAYERS row list removed entirely; bottom CONFIRM TEAMS button (was ambiguous "DONE"). |
| **Smart Teams adoption analytics** | ✅ Session 31 — `team_confirmed` PostHog event as analytical anchor + `team_drafted_auto` / `team_player_moved` / `team_regenerated` / `team_cleared`. Tracks manual_moves_before/after, regenerate_count, was_ai_picked_as_is, is_recommit. Single-filter answers to "is the algorithm being trusted?" |
| **Admin home polish** | ✅ Session 31 — cancel-then-relive bug fixed via new `admin_reopen_week` RPC (creates fresh match, cancelled stays in history). Game-live toggle: "Make this week's game live" when off; collapses to a "LIVE" badge when on (no toggle, admin uses Cancel This Week). This Week tiles moved up to immediately after the toggle. Notifications block removed from Match Settings (duplicate of Notifications tab, demo confusion). |
| **Player status tile rework** | ✅ Session 31 — weekday now derives from admin-configured `dayOfWeek` first (was deriving wrong day from drifted `gameDateTime`). Locked-in banner slide-fades after 5s. Pre-response prompt nudges with "Tap below ↓"; collapses to date+kickoff after response. Status row pulses gold while unresponded; flashes status-matched colour on tap (in→green, out→red, maybe→amber, reserve→purple). Haptic tap-tick (Android only — iOS Safari no-ops). Banners suppressed on page refresh. |
| **Smart Teams** (internal: Group Balancer) | ✅ Built + live session 30 (May 22). Schema + 2 new RPCs (`admin_set_player_group`, `admin_clear_all_groups`) + 3 modified RPCs applied via migration `031_group_balancer_stage_1b`. Pure algorithm `packages/core/engine/groupBalancer.js` (sample-200 for big groups, lower-headcount odd-extra rule, win-rate-nudged splits within 5% noise floor). UI: tap-to-move panels, inline labels, IO Prediction card, Needs Group amber banner, ADD/× empty panels (panel persists once populated — × dismisses only when empty). HistoryView prediction chip (null-safe, forward-only). Replaces Fisher-Yates; no feature flag — always on. PostHog `posthog.group('team', teamId)` identification added (enables per-team analytics + future flag targeting). Deferred to Phase 2: `teams_draft` group snapshot (predicted_winner is already saved at confirm so the accuracy stat works without it). |
| **Ask the Gaffer — Phase 1 (AI agent layer)** | First production phase of the platform's AI agent layer — not a chatbot. Grounded football-operations agent (every output backed by a Supabase query, never invents facts). Phase 1 surfaces: team summary, payment summary, attendance risk, matchday briefing, Q&A panel. Provider locked in (Vercel AI Gateway → Anthropic `claude-sonnet-4-6`); data-access pattern locked in (`gaffer_get_context_*` RPCs + `ai_briefings` audit table); awaiting AI Gateway credits / Anthropic key signup before live build. Full spec: `GAFFER.md`. |
| **Marketing landing page** | Conditional render at root (Option A) for beta — unauth + no token → landing, else app shell. See DECISIONS.md. |

---

## PHASE 3 — MONTH 2+

| Feature | Notes |
|---|---|
| iOS + Android native | Capacitor |
| Apple Sign In native | After Dev account |
| Apple Watch goal logger | ~28h. Requires Capacitor iOS first + Apple Dev account |
| Venue white-label | After user numbers |
| Booking integration | Needs venue API |
| WhatsApp Business API | Phase 3 notifications |
| Club Manager | Second product, B2B |
| Grassroots app | Full stats: assists, cards, ratings |
| In or Out Ltd | Companies House £12 |
| Trademark | ~£170 UK |
| Super admin dashboard | Read-only, Tarny only. Required for PUBLIC launch. |
| IO Wrapped | End of season shareable card |
| Monthly summary notifications | End of month push |
| Streak notifications | 3/5/10 game streaks |
| Random player signup | Postcode, availability |
| Admin find a random | Radius search, ping system |
| Player profile cross-team | Career stats, player_career table |

---

## PHASE 4 — LEAGUE MODE (superseded — now active)

Previously parked as a future sales pitch ("run your league free for one season"). Superseded by the active **League Mode** programme — Phases 0 + 1 already shipped (see top of file). Phase 2 onwards in `LEAGUE_MODE_SCOPE.md`.

---

## ASK THE GAFFER — AI AGENT LAYER

**This is the platform's AI agent layer, not a chatbot.** Grounded
football-operations agent. Every output backed by a Supabase query
(`context_snapshot` jsonb on every `ai_briefings` row). LLM narrates and
patterns — it never invents facts. Four-phase trust-graduated rollout.
Full spec lives in `GAFFER.md` — read that before any Gaffer work.

**Provider + data-access pattern (locked in):**
- LLM: Vercel AI Gateway → Anthropic `claude-sonnet-4-6`
- Context: per-surface `gaffer_get_context_*` RPCs (SECURITY DEFINER)
- Runtime: Vercel edge function `apps/inorout/api/gaffer.js`
- Audit: `ai_briefings` table — every output row links to its context snapshot
- Cost: ~£0.004 per briefing, £20/month covers ~5000 briefings

**Sequencing:** Phase 1 lands after Group Balancer (done s30). Group
Balancer's `generateBalancedTeams` becomes a building block for Phase 2
fair-team suggestions.

| Phase | Capability | Status |
|---|---|---|
| 1 — Read-only assistant | Q&A panel, team summary, payment summary, attendance risk, matchday briefing | 🟡 Scaffold + DB complete session 33. Migrations 033–037 applied to live DB via MCP and smoke-tested against `team_demo` (all four RPCs return real data). Edge function `/api/gaffer`, prompts, `GafferCard`, admin Q&A panel, JS wrappers all shipped. Awaiting: Anthropic key confirm on Vercel + AdminView wire-up (canary on one team first). See GAFFER.md "IMPLEMENTATION STATUS". |
| 2 — Recommendations | Fair team suggestions, reserve recs, payment chase drafts, weekly match summary, player insight explanations | 🔲 Not built |
| 3 — Confirmed actions | "Send chase", "Notify reserves", "Use these teams", "Post match summary", "Confirm payment reminders" — admin one-tap approve, all via existing SECURITY DEFINER RPCs | 🔲 Not built |
| 4 — Semi-autonomous | Auto-detect short squads, auto-draft notifications, auto-suggest reserve pings, auto-produce weekly admin report. Player-visible actions still require approval (hard rule). | 🔲 Not built |

---

## IO INTELLIGENCE — UNLOCK GRID

| Games | Unlocks |
|---|---|
| 1+ | Goals, POTM, W/L/D, Attendance ring, Reliability, Form strip |
| 2+ | Win Rate card ✅ built |
| 3+ | Current Run card ✅ built |
| 4+ | Most Faced Opponent ✅ built |
| 5+ | Reliability Ranking ✅ built |
| 6+ | Most Played With card ✅ built |
| 7+ | Team Impact card ✅ built |
| 8+ | Nemesis, Best Partnership, Advanced Chemistry cards ✅ built |
| 16+ | Legacy Insights ✅ built |
