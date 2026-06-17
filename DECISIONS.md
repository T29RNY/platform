# In or Out — Key Decisions Log
*Last updated: Jun 17 2026 (session 138 — URL & accounts architecture decided (NOT yet started): move consumer app `apps/inorout` off the apex onto `app.in-or-out.com`; `in-or-out.com` becomes the marketing landing page with a catch-all 301 of all non-marketing paths → `app.`; other apps to subdomains later; move account ownership (Vercel/Supabase/GitHub/Stripe/Anthropic) off personal Gmail to a company identity. Pre-Capacitor-wrap. Full detailed phased runbook in `DOMAIN_MIGRATION.md`. Critical invariant: payment webhooks + the 7 live pg_cron jobs + 2 DB fns MUST repoint to `app.` BEFORE the apex flip (POSTs don't follow 301s). Phase 1 (GoDaddy `app` CNAME + Vercel attach) is next. session 131 — Native app = Capacitor; WhatsApp/SMS ruled out; payment infrastructure = Stripe Connect + GoCardless for Platforms, 8-phase plan, `venue_integrations` foundation. session 90 — MY VIEW has ONE header. The old `HeroCard` green pitch banner is gone; the floodlit pitch is now the *background* of the single `PageHeader` (via `PitchCanvas.jsx`), which carries the wordmark + one fixture line (day · venue · time · £price) + a thin admins line. The day is printed once. Do NOT re-introduce a separate "this week" hero/banner block above or below the header. session 86 — Equipment Cycle 5 data-product tail: equipment intelligence ships venue-dashboard-first via one read-only RPC `venue_equipment_insights` + Insights tab; the Gaffer narrative surface + HQ multi-venue benchmarking are DEFERRED (Gaffer has no venue path today; pilot is one venue); RPC shaped as the future venue-Gaffer context source per Hard Rule #14. session 82 — `players.paid` is a PER-CURRENT-GAME flag: cleared when a new game opens (mig 243), so a fresh game starts with a clean paid slate; `owes` is the cross-week persistence mechanism and `payment_ledger` is the permanent per-match record. session 80 — post-game lifecycle: a finished game CLOSES on result-save (no more sign-ups to a played match); sign-up window enforced SERVER-SIDE not just client; ALL statuses incl reserves reset on completion; result-save preserves paid for already-paid players; POTM voting window is 2 hours. session 79 — operator analytics: detail on the superadmin DASHBOARD, email digest stays a lean alert layer; notification "reach" = real delivery path; ops analytics scope by team_players NOT players.team. session 76 — reserve "spot opened" stays tap-to-claim, server-side)*

Architectural, product, and design decisions that should inform future work.
Read this before building new features to avoid re-litigating settled questions.

---

## Sparring is a class-type flag, not a new entity (session 145, Gym/Boxing Phase 1)

**Decision (operator-confirmed s145).** A sparring / open-mat night is modelled as a
`venue_class_types.is_sparring boolean` flag — NOT a separate sessions system and NOT a reuse
of `players.status` (that presupposes a football squad with rollover). A class type is **either**
a technical class **or** a sparring session; the operator picks which when creating the type.
Incidental sparring inside a technical class is just mentioned in the session description, never
flagged. The "who's in for Thursday sparring?" In/Out booking reuses the class-session model
**wholesale** — capacity, waitlist, QR check-in, no-show, charges — so Phase 1 added **no new
write RPC**, only threaded `is_sparring` through `venue_create_class_type` (set at create) +
`venue_update_class_type` (jsonb patch) + the two read RPCs for badges. The member surface is a
new `/classes` route (`ClassesScreen`) rendering the existing `ClassesTimetable` for the selected
club's venue, lighting the dormant `ClubNavBar` Classes tab. The Classes tab shows for **non-football
disciplines only** — football clubs keep Sessions·Pass·Profile byte-identical, so the casual flow is
untouched. Where a club spans multiple venues (the s144 sports-centre model), a venue picker appears.
Reasoning: maximum reuse, zero new tables, zero footprint on football. See `GYM_VERTICAL_HANDOFF.md`
Phase 1. Next free mig = 357.

## URL architecture: consumer app → `app.in-or-out.com`, apex → marketing (session 138)

**Decision (planned, not yet executed).** Before the Capacitor native wrap (which bakes
the app's URL in ~permanently), restructure URLs once: the consumer app `apps/inorout`
moves off the apex onto **`app.in-or-out.com`** (its own stable origin, where iOS/Android
deep-link files will live); **`in-or-out.com` becomes the marketing landing page**
(`marketing/index.html` consumer + `marketing/venues.html` operator) with a **catch-all
301** of all non-marketing paths → `app.`; the other apps move to subdomains
(`venue. club. league. ref. display. hq. admin.`) later. Separately, move account
ownership (Vercel/Supabase/GitHub/Stripe/Anthropic) off the personal Gmail to a company
identity (`founder@in-or-out.com`).

**Why subdomains not paths:** lowest risk, each app stays its own deployment, and the
consumer app needs a single clean origin for native deep-linking.

**Hard invariants (audited this session):**
- Additive until ONE stateful cutover (the apex flip). Reversible the whole way.
- **Payment webhooks + the 7 live `pg_cron` jobs + 2 DB fns (`notify_spot_opened`,
  `get_display_landing_code`) MUST be repointed to `app.` BEFORE the apex flip** — they're
  POSTs and do NOT follow 301s; miss one and that background job goes silent. (The live
  `cron.job` table is authoritative; migration files were incomplete — only 1 of 7 was in
  them.) Rotate the weak shared cron bearer (`Liverp00l123?!!*`) while rewriting.
- **0 schema/RLS/token change.** Roles/access derive from JWT/tokens, not domain. Join
  codes/tokens are domain-independent. One re-login per origin.
- Repoint callers of `in-or-out.com/api` (venue `VITE_INOROUT_API_URL`) — never 301 `/api`.

**Full step-by-step phased runbook: `DOMAIN_MIGRATION.md` (repo root).** Status: NOT
started — Phase 1 (GoDaddy `app` CNAME + attach to `inor-out` in Vercel) is the next action.

## Native app = Capacitor; WhatsApp/SMS ruled out in favour of native push (session 131)

**Capacitor** is the native app wrapper for `apps/inorout`. Maximum code reuse — existing Vite/React codebase unchanged; only the push notification layer is replaced. App Store launch (iOS + Android) targeting ~2 weeks from session 131 for the first pilot.

**Push channel migration required before Capacitor ships:**
- `register_push_subscription` needs a `platform` discriminator (`ios`/`android`/`web`) + raw device token column alongside the existing VAPID endpoint
- `/api/notify` server sender rewritten to branch on platform: APNs (iOS), FCM (Android), Web Push (web fallback)
- Apple Developer account + APNs Auth Key (`.p8`) — provision immediately, can't be parallelised with code
- Firebase project + `GoogleService-Info.plist` (iOS) + `google-services.json` (Android) — 15 minutes, do alongside APNs

**WhatsApp/SMS ruled out.** PWA push unreliability was the only real driver for WhatsApp Business API. With Capacitor + APNs/FCM, push delivery goes from ~60% (PWA) to 95%+. WhatsApp adds per-message cost, per-venue Twilio credential management, and removes the incentive to install the app. `_sms.js` stays dormant indefinitely. `pickChannel` routing simplifies to: **push → email only**. Do NOT re-open WhatsApp unless a real pilot tells us members are not installing the app.

## Payment infrastructure — Stripe Connect + GoCardless for Platforms, both offered (session 131)

**Platform never holds money.** Each venue/club connects their own Stripe or GoCardless account. Money flows club↔member directly. Platform orchestrates via API (`Stripe-Account` header for Stripe; per-venue access token for GoCardless). Platform bears zero transaction cost and zero liability.

**Both providers offered** — they solve different problems:
- **Stripe**: card / Apple Pay / Google Pay — one-off and recurring subscriptions. Best for match fees, tournament entries, equipment deposits, and members who prefer card.
- **GoCardless**: Direct Debit from bank account — much lower recurring failure rate (bank accounts don't expire), cheaper per-transaction, and UK sports clubs have collected membership fees via DD for decades. Parents expect it for club memberships.

A venue can connect **both simultaneously**. If both are connected, the member chooses at enrolment. If only one is connected, it is used automatically with no choice shown.

**`venue_integrations` table** is the shared foundation for all third-party credentials (provider, status, account_id, access_token encrypted, config jsonb). Replaces Stripe-specific columns scattered across `venues`/`venue_memberships` in mig 279.

**8-phase build plan (full detail: FEATURES.md — Payment Infrastructure section):**

| Phase | What | Dependency |
|---|---|---|
| 1 | `venue_integrations` table + venue Settings Payments UI | Nothing |
| 2 | Stripe Connect — venue OAuth flow | Phase 1 + Stripe platform creds |
| 3 | Stripe member enrolment + webhooks | Phase 2 |
| 4 | Stripe test lifecycle → live keys | Phase 3 + operator sign-off |
| 5 | GoCardless connect — venue OAuth flow | Phase 1 + GoCardless for Platforms account |
| 6 | GoCardless member mandate + webhooks + reconciliation | Phase 5 |
| 7 | GoCardless test lifecycle → live keys | Phase 6 + operator sign-off |
| 8 | Member payment choice UI (both connected) | Phases 4 + 7 |

Phases 1–4 ship and go live independently of 5–7. Phase 8 requires both.

**Use case mapping (settled):** memberships → either provider; match fees / tournament entries / equipment deposits → Stripe only (one-off, card/Apple Pay).

**Operator actions required before Phase 2:** Stripe platform account + test keys. Before Phase 5: GoCardless for Platforms account.

## `clubs` is the SINGLE canonical club entity — league, membership & attendance all hang off it (session 92, Membership V2 Phase-1 audit)

The Phase-1 audit resolved the open "club vs company" question. A `clubs` table
**already exists** (migration 055, the league layer: `id text, name, short_name,
founded_year` + `club_teams` mapping `club_id ↔ casual team_id`). It is **completely
dormant** — 0 rows, RLS-on, no policies, no RPCs, no JS references; only migs 055/056
mention it.

**Settled:** Membership V2's "club" is **NOT a new entity and NOT `companies`** — we
**extend this one existing `clubs` table** as the canonical real-world org. A club is a
single thing ("Finbar's FC") with multiple *relationships* hanging off it, never multiple
club tables:

```
              ┌─ club_teams   (existing)  → casual teams it fields in leagues
   clubs  ────┼─ club_venues  (NEW, M:N)  → venues where it operates / sells membership
   (one row)  ├─ club_cohorts (NEW)       → age-groups / squads
              └─ memberships  (reframed)  → the people it grants membership to
```

Rationale: (1) **elegance** — one club in the real world = one row; two club-like tables
would force every query to know which id it means and tax every league↔membership join
forever; (2) **futureproof** — the plan banks on club-member-based tournaments later
*consuming the existing cup engine*, which only works if the club holding members is the
same club `club_teams` wires into competitions; (3) **safe now** — the table is empty and
unwired, so we are *defining* its meaning before either consumer is built, the cheapest
this will ever be; (4) **zero-footprint** — membership stays as relationships, not columns,
so a league-only club simply has no `club_venues` rows and carries no membership baggage.
The 2–3 club-level columns added (`id_mandate`, `safeguarding_config`) are nullable and
dormant until membership is switched on. Keeps the `id text` PK house convention
(`club_demo`).

`companies` stays exactly what it is: the **billing/operator rollup that owns venues 1:N**
(`venues.company_id`). A club maps to venues M:N via `club_venues`; the venue still belongs
to a company for billing. Three clean, non-overlapping entities: **company** (operator/
billing) → **venue** (site) ← **club** (membership issuer + team fielder).

⚠️ **Guardrail for future sessions:** do NOT re-fork `clubs` into a separate
league-club vs membership-club. When the league layer is finally built, it consumes this
same `clubs`. Full Phase-1 audit (current-state, schema, threat model, backfill) lives in
`MEMBERSHIP_V2_HANDOFF.md` + `~/.claude/plans/membership-v2-club-os.md`.

## MY VIEW has ONE header — the pitch is the header background, not a separate banner (session 90, commit 4e1ee0d)

MY VIEW used to stack two title blocks: `PageHeader` (IN OR OUT wordmark + `day · venue ·
time` meta + confirmed gauge) and `HeroCard` (the animated green pitch banner repeating the
day + price + admins). Both printed `schedule.dayOfWeek` — a visible duplicate the operator
flagged.

**Settled:** the screen has a **single** header — `PageHeader` — which renders the
floodlit pitch as its *background* (new presentational `PitchCanvas.jsx`), the wordmark,
ONE fixture line (`day · venue · time` + a `£price` pill), and a thin **Admins**
(vice-captain) line. `HeroCard.jsx` is **deleted**.

- Do **not** re-add a separate "This Week" hero/banner block. Any new match-context info
  belongs *inside* `PageHeader`, not as a second stacked card.
- The pitch animation lives in `PitchCanvas.jsx` and is **reduced-motion aware** (single
  static frame under `prefers-reduced-motion`). Its colours are `rgb()/rgba()` strings on
  purpose — `check-hygiene.sh` flags `#hex` literals, so keep canvas colours non-hex.
- Header entrance motion (row stagger + wordmark scale-pop) is gated behind
  `useReducedMotion`; keep that gate on any new header motion.

## ⚠️ MONEY-FLOW GATE — Stripe Connect for memberships (Phase 4 LIFECYCLE PROVEN s137; DORMANT until operator sign-off + live keys in platform-clubmanager)

The full Stripe Connect membership money flow is **built and end-to-end verified**:
- mig 329: `venue_integrations` table
- mig 330: Stripe Connect OAuth flow
- mig 331: Stripe enrolment webhook handler + `apply_membership_subscription_status` state machine
- migs 332/335/336: bugs fixed during Phase 3 E2E verification (s136)
- Phase 4 (s137): all 5 subscription lifecycle scenarios PASS under Stripe test clocks:
  (A) renewal → `payment_state=current`, (B) `past_due` → amber banner, (C) `unpaid` → suspended,
  (D) recovery → current, (E) `canceled` → suspended + `status='cancelled'` (the only Stripe status
  that also flips the membership `status` column). Reconciliation cron proven live at 04:00 BST.

**Architecture (ratified):**

- **Stripe Connect, money → the venue's own account, never ours.** Each venue connects its
  own Stripe account; members are Stripe Customers and memberships are Stripe Subscriptions
  **on that connected account**. We orchestrate via the platform API key + the `Stripe-Account`
  header; we never custody funds. Consistent with the standing "don't sit in the money flow".
- **Stripe is the source of truth; our DB is a cache** repaired by a reconciliation cron.
  `venue_memberships.payment_state` (`current`/`past_due`/`suspended`) is driven by Stripe
  subscription status via `apply_membership_subscription_status`, never by our own timers.
  `payment_state` is a SEPARATE dimension from `status` (the freeze/cancel access dimension).
- **Webhook resilience:** signature-verify → `record_stripe_event` (persist-then-process,
  idempotent on `billing_events.stripe_event_id` UNIQUE) → fetch-fresh from Stripe → act →
  `mark_stripe_event_processed`. Reconciliation cron at 04:00 BST is the safety net for
  any dropped webhook. Test clock events from Express connected accounts have delivery latency
  to the platform webhook; that latency is expected and non-blocking — cron heals it.
- **Grace, not day-one cut:** `active → past_due (grace, access continues) → suspended`.
- **Auto-renewals and receipts:** Stripe billing engine auto-creates renewal invoices and charges
  them. `invoice.paid` fires per renewal. Stripe natively generates invoice objects — no custom
  receipt PDF feature needed from our side.

**Still required from the operator before go-live (HARD BLOCKERS):**
1. Sign-off on this money-flow architecture (ratify this entry — operator must explicitly confirm).
2. Swap Stripe **test** keys for **live** keys. Keys must be added to the **`platform-clubmanager`
   Vercel project** — NOT `inorout`. `platform-clubmanager` is the project that actually serves
   `in-or-out.com` and has `SUPABASE_SERVICE_ROLE_KEY` set. The `inorout` Vercel project only has
   `STRIPE_WEBHOOK_SECRET`; the webhook handler would return 503 from that project.
3. Update `STRIPE_WEBHOOK_SECRET` in `platform-clubmanager` to the live endpoint's signing secret.

**Once live keys land in platform-clubmanager, the system is live.** No code changes needed.

## A drawn casual lineup is frozen at kick-off; the lock point is `schedule.game_date_time` (session 88, mig 268)

Once a casual game has kicked off, the drawn team arrays are **frozen** — no self-service
write may mutate them. This was forced by the SESSION 80 incident (a post-kickoff
injured-toggle silently deleted a player from a locked team).

Settled calls:

- **Kick-off lock point = `schedule.game_date_time`.** Casual `matches` rows carry **no**
  kick-off-time column (`matches.match_date` is a date only). The team's scheduled kick-off
  timestamptz lives on `schedule.game_date_time` (TZ-correct Europe/London since mig 212), so
  that is the single source of truth for "has this game kicked off?". The helper
  `is_lineup_locked(team_id)` encodes it: active schedule + `game_is_live` + `now() >=
  game_date_time`. `game_is_live` alone is insufficient — it stays true from go-live until
  result-save, spanning both before and after kick-off.
- **The lock is lineup-scoped, not a blanket freeze.** Self-service writes are rejected
  (`lineup_locked`) only for a player who is actually on a drawn team (`players.team IN
  ('A','B')`); a non-drawn player (reserve/maybe/late sub) can still change their own status
  after kick-off. Guest-add is unscoped (a new in-guest alters availability for the frozen
  lineup either way).
- **Admins are exempt.** `admin_set_player_injured` is NOT locked — an admin may fix a frozen
  lineup mid-game. The lock is a self-service guard only.
- **`player_match` is the integrity backstop.** Even with the lock, `admin_save_match_result`
  reconciles any `attended=true, result IS NULL` row before the flat W/L/D bump, so the
  source-of-truth table and the convenience columns can never diverge for a dropped player.

## Ref V2 — match-format config is layered, and the clock pause is per-match (session 87, "RefSix-killer")

The referee tool is being rebuilt to make RefSix obsolete: the ref's thumb drives the whole venue
(every tap is live on the reception display + venue dashboard within ~1s), faithful to the
broadcast-dark artifact design (`apps/ref/REF_V2_BUILD_PLAN.md`). Two settled architecture calls:

- **Match-format config is layered: league default → competition override → fixture/ref override.**
  `league_config` holds the league's standing timing (num_periods / period_length / sin-bin); a
  competition may override it (`competitions.config.match_format`, e.g. a cup with ET/pens); a single
  fixture may override per-match (`fixtures.format_override`) — and that per-fixture override is
  **flagged** (`is_overridden` in the resolved `match_format`) so venue/league see the ref deviated,
  for fairness. `get_fixture_state_by_ref_token` returns the resolved answer; the ref clock counts
  toward the period length and prompts half/full time. Built league-level now, competition tier
  structured-in for later (futureproof, not built). The legacy `league_config.has_halves` is kept for
  back-compat; `num_periods`/`period_length_mins`/`period_names` supersede it.

- **The clock pause is PER-MATCH, not platform-wide.** `clock_paused_at`/`clock_paused_ms` live on the
  individual fixture row, so pausing match X freezes only match X wherever it appears; every other
  match keeps ticking. "Platform-wide" only ever meant the *elapsed formula* must be identical in the
  ref app and the display (a shared helper) — never that one pause stops everything. Pause is
  offline-safe: it records a `clock_pause`/`clock_resume` event for idempotency and uses the client
  timestamp, so a queued pause reconstructs the exact frozen duration on drain.

- **Multi-writer rule:** the ref **owns the match while `in_progress`** (all new RPCs guard on it); the
  venue corrects the record only **after full time** (existing `venue_update_fixture_result`).

- **Live fan-out scope:** reception display + venue dashboard are covered now (already on `venue_live`).
  The **public league web app** (apps/league, refresh-only) being live too is parked as a fast-follow
  after the pilot — the pilot-critical live surfaces are the big screen, already done.

## Equipment intelligence ships venue-dashboard-first; the Gaffer narrative + HQ benchmarking are deferred (session 86, Equipment Cycle 5)

The equipment data-product tail (ROI-per-asset, usage, procurement signal) was
built as a single **read-only** RPC `venue_equipment_insights` surfaced in the
venue dashboard's new **Insights** tab — NOT as an "Ask the Gaffer" narrative
surface, and NOT as an HQ multi-venue rollup. Two reasons:

- **Gaffer has no venue path today.** It is casual/`admin_token`-only (inorout app,
  `team_admins`-gated). A venue-facing Gaffer surface is net-new infra (venue
  audience in the edge function, a venue token route, new UI) — a meaningfully
  bigger build than one read RPC + one tab. Operator chose the venue dashboard
  for the pilot (Option A).
- **The pilot is a single venue.** HQ's value is multi-venue benchmarking; with
  one venue there's nothing to benchmark. HQ equipment intelligence stays a
  vision-tier item, unblocked by the clean category data already captured.

The RPC is deliberately shaped as the **future venue-Gaffer context source**:
it returns one jsonb block a future edge function can pass verbatim as
`<context>`, recorded in RPCS.md per Hard Rule #14. So adopting Gaffer later is a
wiring job, not a rebuild — but any change to the RPC's return shape must
re-check that surface. ROI is **lifetime** (purchase cost is one-off); usage and
procurement honour a date range (default trailing 90d). No fabricated
"utilisation %" denominator — honest activity counts only.

## `players.paid` is a per-current-game flag; `owes` persists, the ledger is permanent (session 82)

Settled fixing a user-reported "still shows Paid after the new game opened":

- **`players.paid` (and `self_paid`/`paid_by`/`paid_at`) mean "paid for the game that is open
  right now."** They are **cleared when a new game opens** (`admin_go_live` /
  `admin_go_live_for_team`, mig 243) and recomputed at result-save. A brand-new game starts with
  nobody marked paid — because nobody has paid for it yet.
- **`owes` is the cross-week persistence mechanism, NOT `paid`.** It's an independent accumulator;
  go-live never touches it. The mig-204 comment "payment fields carry over, the Owes balance
  depends on it" was a misread — owes does not depend on the flat `paid` flag carrying over.
- **`payment_ledger` is the permanent, per-`match_id` record of who paid for what.** Clearing the
  flat flags loses no history. Admin reconciliation and any "who paid for game X" question must
  read the ledger, never the flat flag.
- **The flag still persists through the post-game window** (result-save → next go-live) so the
  admin can reconcile the just-played game; go-live is the correct boundary to clear it.

## Post-game lifecycle: a finished game closes, and sign-ups are gated server-side (session 80)

Settled while firefighting a real squad the night a game finished:

- **A played game closes.** `admin_save_match_result` sets `schedule.game_is_live=false` on the
  fresh save. Once the result is in, the match stops accepting sign-ups — you do not leave the
  played game "open" until next week's auto-open. (Before, nothing closed it, so players signed
  IN to a match that had already happened.)
- **The sign-up window is enforced server-side, not just by hiding buttons.** `set_player_status`
  refuses any change unless `game_is_live=true AND NOT is_cancelled` (`game_not_live`). The client
  hiding the In/Out buttons is convenience; the server is the gate. Consistent with the project's
  "never trust the client" rule.
- **Completion resets EVERY status, reserves included.** Reserves/maybes/no-shows are treated like
  any other status and reset to 'none' when a game completes — not carried forward. (The old reset
  only touched players who attended.)
- **Result-save preserves an already-paid player's flag.** It no longer blanket-wipes `paid`; a
  player whose ledger for that match is `paid` stays `paid=true` so My View and the ledger agree.
  Payment-cycle reset still happens (go-live resets status; next week's save keys on next match).
- **POTM voting window is 2 hours** (from when it opens, ≈ end of game), not 1. Set in
  `cron.js potmVotingOpenJob`.
- **When sign-ups are closed, tell the player WHEN they open.** PlayerView shows
  "sign-ups open <opens_day> at <opens_time>" pulled live from the schedule — not a blank gap.

## Operator analytics: dashboard for detail, email for alerts (session 79)

Granular "what's being done and what isn't" lives on the **superadmin dashboard**
(`apps/superadmin` — Engagement + Health tabs); the **email digest stays lean** — headline
numbers + things that need attention (new-and-quiet squads, churn) + the data behind them.
Email and dashboard are different jobs: email is **push** (finds you, good for alerts/deltas,
bad for exploration — dozens of zero-rows read as noise); the dashboard is **pull** (good for
filtering/drill-down/time-ranges). Cramming per-squad × per-category tables into a daily email
was explicitly rejected. The same RPCs back both where useful.

**Notification "reach" = a real delivery path, never the preference.** `players.notification_channel`
defaults to `'push'` for everyone and does NOT mean we can reach them — only 2/21 of the live
active squad actually had a push subscription. "Reachable" counts push-subscription OR phone OR
linked-account-email (the reminder cron's push→email→SMS fallback). The preference field is
deliberately ignored in Health-tab reach metrics.

## Casual squad creation + hand-off from superadmin (session 79, migs 239–240)

Operator-led squad creation mirrors Create Venue. `superadmin_create_team` makes the squad
SHELL only (team + schedule + settings + `admin_token`) — **no members, no team_admins**. The
**`admin_token` IS the hand-off access** (`/admin/<admin_token>`, full admin, no login — the
same model every casual team already has). Account ownership is a SEPARATE, later step:
`claim_my_admin_teams` adopts an unclaimed shell into a user's account when they sign into the
casual app with the email the platform admin set as `admin_email`. Match is by **OAuth/OTP-verified
`auth.email()`** (user provably owns it) and only **unclaimed** shells (no active team_admins) —
so it can never hijack an owned squad; idempotent. Both verified end-to-end with auto-rollback.

## `players.team` is the A/B matchday side, NOT squad membership (session 79 — caused a bug)

Squad membership lives in **`team_players`** (player_id ↔ team_id). `players.team` is the
denormalised **A/B team-sheet assignment** for the live match ('A'/'B'/NULL) — set by
`admin_save_teams`. Any "players on a squad" query MUST go through `team_players`, not
`players.team`. The shipped ops digest (mig 234) initially counted off `players.team` and
reported wrong totals; caught + fixed in mig 234 and again pre-ship in `superadmin_health`
(mig 236*). Filed because it's an easy, recurring trap.

---

## Reserves stay tap-to-claim (no auto-promotion); the "spot opened" alert is reliable + server-side (session 76, mig 230)

When a squad spot frees up, the next reserve is **alerted to claim it** — their status does NOT
auto-flip to `in`. Auto-promotion was explicitly considered and **rejected**: flipping a reserve to
`in` without their tap would commit them to playing and to the match fee/owes without consent, and
reverses the deliberate "Reserve must respond IN to confirm" model (Gaffer spec + the player-facing
"we'll let you know if a spot opens" copy). The reserve queue ordering already auto-adjusts
(append/compact, mig 130); only the *notification* changed.

What DID change: the alert is now **reliable and universal**. It was fired client-side from the
dropping player's own device via the self-toggle only — so it missed admin-marks-out, disable, and
injury, and failed if that device didn't POST. As of mig 230 a DB trigger `notify_spot_opened`
(`AFTER UPDATE OF status, disabled ON players`) detects ANY spot-freeing transition server-side and
pushes to the **next reserve only** (lowest `reserve_priority_order`) via `net.http_post` →
`/api/notify` direct mode. **Recipient rule:** always just the next reserve, at any time (no
>24h/<24h split — operator decision). Chaining is automatic: if that reserve passes/drops, the next
drop is a fresh freeing event that alerts the next in line.

**Why a trigger (not per-RPC or cron):** one place catches all paths (self/admin status, disable,
injury), immediate, and mirrors the proven mig-225 venue-ins "status trigger → notification,
exception-swallowing" pattern. **Anti-spam:** the weekly squad reset sets the whole squad
`status='none'` in one statement; the go-live RPCs set a transaction-local `inorout.bulk_reset`
GUC before the reset and the trigger skips it (proven load-bearing in ephemeral-verify). Delivery
is best-effort (lost if the app is down, no retry) — matches the prior client behaviour. The
separate `squadFull` push stays client-fired (out of scope).

## Venue Phase B is venue-domain-only; cross the venue↔casual RLS wall by counts-only opt-in (session 74)

The venue dashboard's "booker layer" (Cancellations, Customers, Nudge, live ins — migs 222–226)
is built **venue-domain only**: aggregate from venue-side tables (`pitch_bookings`, `venue_charges`,
`venue_payments`, `booking_series`), never SELECT casual `players`/`team_admins` from a venue RPC.
The casual side (player `status`/ins, admin contacts) sits behind RLS and stays there.

Two sanctioned exceptions, both **counts/sends only — no casual identities reach the venue UI**:
- **Live ins (mig 225):** `venue_get_booking_ins` returns in/target COUNTS for booked teams; a
  `players.status` trigger pushes a content-free `booking_ins_changed` broadcast to the venue
  channel. Implemented as a TRIGGER, not edits to the hot `set_player_status`/`admin_set_player_status`
  bodies, and exception-swallowing so it can never break a player toggle.
- **Nudge (mig 224):** `venue_request_nudge` records the ask + returns a recipient COUNT; the cron
  resolves the team-admin contact and sends server-side (venue never sees the address).

**Why:** keeps the boundary intact, no per-feature privacy design, ships fast. **Customer detail**
(mig 226) and the recency-based `nudge_status` follow the same venue-domain rule. Full context in
memory `project_venue_phase_b`.

## An injured player can still be a reserve — but auto-drops to the bottom of the queue (session 73, mig 220)

`status` and `injured` are independent columns, so "injured reserve" is a valid state — an injured
player may still want to offer themselves as cover. The settled rule: when a reserve is marked
injured (by themselves or an admin), they are **automatically demoted to last place** in the reserve
queue (`reserve_priority_order = MAX(others)+1`), and admins can manually re-order them afterward.
They are NOT removed from reserve and NOT forced to `out` (only an *in* player still drops to `out`
on injury, unchanged). Both `set_player_injured` and `admin_set_player_injured` carry this demotion.

Display: the admin reserve list shows injured reserves (with a 🤕 marker) so they can be re-ordered,
*and* they still appear in the admin Injured section (dual-listing is intentional). The player view
already lists injured reserves with an injured badge and now orders them at the bottom.

Prior bug this replaced: the RPCs only reset status when it was `in`, so a reserve marked injured
kept `status='reserve'` at their old position while the client optimistically showed `out` — the DB
and the two screens drifted apart (see BUGS.md session-73 entry).

## Guests are PERSISTENT: dormant-not-deleted, hidden via status not deletion (session 72, PERSISTENT GUESTS S1, mig 216)

A guest (+1) is a first-class, persistent `players` row (`is_guest=true`, `guest_of=host`) that is **never auto-deleted**. The previous model hard-deleted guests on every weekly rollover (and on host-remove) to stop a leftover guest row from hiding the host's "Plus One" button — but that conflated "person exists on the team" with "person is in THIS week", and threw away history + left unresolvable ids in `matches.team_a/team_b`.

The settled model separates those two concerns using the same per-week `status` mechanism regulars already have:
- **On rollover / host-remove a guest goes DORMANT** — `status='none'`, `team=NULL`, `admin_locked_in=false` — not deleted. Its `players` row, `team_players` row, and `player_match`/`payment_ledger` history all persist.
- **The board hides dormant guests** via one shared engine predicate `isDormantGuest(p) = p.isGuest && p.status==='none'` (applied at every current-week render/count surface). A guest with any active status renders normally.
- **"Plus One" keys on an ACTIVE guest** (`status!=='none'`), NOT on "a guest row exists" — so a dormant row never blocks the button. This is the structural fix for the bug mig 207's deletion was papering over.
- **`get_team_state` keeps guests in the squad payload** so the returning-guest picker (S2) reads them from the same array — no parallel fetch (reuse over new systems).

Implementation note: the go-live RPCs didn't need new reset logic — the existing mig-204 bulk status reset already covers guests (they have team_players rows), so S1's DB change was purely *removing* the guest-delete blocks (mig 216 reverses the guest-delete portions of migs 207/209). Stats decision: a guest's games accumulate on their own record only and stay out of the team reliability table + POTM until promoted (S3 flips `is_guest=false`). Full slice plan in FEATURES.md.

**Promotion (S3, mig 218) — two routes, one row.** A guest becomes a permanent member via EITHER (a) admin "make permanent" in the squad (`admin_promote_guest`), OR (b) self-claim: the guest is sent their OWN unique `/p/<token>` link and signs in. Both flip `is_guest=false, guest_of=NULL` on the SAME row, so all accumulated stats + `player_match` history carry over and the player immediately starts counting in reliability/POTM. The self-claim identity problem (a guest has no account to match on) is solved by the **token being the identity** — `link_player_to_user`, called with the guest's token on sign-in, knows exactly which row to promote, so there is no name-matching and no duplicate row. The promote-on-link branch is gated to `is_guest=true`, so a regular player's ordinary first sign-in is unaffected.

## UK timestamps: always `AT TIME ZONE 'Europe/London'` in SQL, never bare `::timestamptz` (session 69)

Any SQL that constructs a UK wall-clock timestamp from a text string (e.g. `'2026-06-09' || 'T' || '20:00' || ':00'`) MUST use `AT TIME ZONE 'Europe/London'`, not a bare `::timestamptz` cast. The bare cast defaults to the server timezone (UTC on Supabase), which is correct in winter (GMT = UTC) but 1hr wrong during BST (late March → late October). This caused every kickoff-relative cron job to fire 1hr late for the entire BST window: `oneHrBefore` at kickoff, `lineupLock` 1hr into the game, `bibs45min` after kickoff.

The same applies in JS on Vercel (also UTC): never use `Date.getHours()` or `Date.getDay()` to check UK local time — use `Intl.DateTimeFormat` with `timeZone: 'Europe/London'` as already established in `cron.js`'s `nowInUkParts()` helper. Applies to any new time-window job added to `cron.js` or `notify.js`.

`AT TIME ZONE 'Europe/London'` and `Intl.DateTimeFormat Europe/London` are both DST-aware and auto-adjust when the clocks change — no manual intervention required year to year.

## PWA resume = reconnect + catch-up re-fetch; not a Capacitor trigger (session 69)

Realtime is two pipes (team_live broadcast + postgres_changes), and both are
ephemeral — events that fire while the app is suspended are **gone forever**, never
replayed. So correctness on resume cannot rely on the socket alone. The settled
pattern, on every foreground (`visibilitychange`/`pageshow`/`focus`):

1. **Catch-up re-fetch, unthrottled** — call the full `refreshTeamData()` so the app
   is correct immediately regardless of what the socket missed. This is the
   load-bearing step.
2. **Reconnect the socket** — `supabase.realtime.connect()` when disconnected (plus a
   short capped `reconnectAfterMs` on the client) so *ongoing* live updates resume.
3. **Auth refresh stays throttled** (5 min); data catch-up must NOT be throttled.

Any future surface that depends on realtime must assume the suspended-window gap and
re-fetch on resume — do not add "live-only" state with no catch-up path.

**Capacitor decision:** the "must close & reopen to see updates" bug was an app-code
gap, NOT a PWA limitation — a native shell suspends the same WebSocket, so Capacitor
would not have fixed it. Capacitor remains the right path for App Store distribution
and native push when we choose to pursue it, but it is decoupled from live-update
correctness. Do not reach for Capacitor to solve realtime/resume issues.

**Deploy/verify note:** the Vercel MCP API reported stale data for the `inor-out`
project (looked frozen at a May build from a dead repo). It is not — the live site
auto-deploys this monorepo. The authoritative check for "what code is live" is to
grep the deployed bundle from www.in-or-out.com for a known string from the change.
The push-only service worker has no `fetch` handler, so installed PWAs pick up new
code on a full close + reopen. See [[project_inorout_deploy_and_pwa_update]].

## Casual result-save pipeline — settled invariants (session 68)

Repairing the post-game cluster (migs 204–206) settled several rules. See
[[project_result_save_invariants]] and RPCS.md.

1. **"First finalisation" is detected by `matches.winner IS NULL`, never by player_match
   existence.** The kickoff lineup-lock cron pre-creates player_match rows, so the old
   row-count freshness check silently skipped the entire end-of-match cascade. Rule:
   **no code path may set `matches.winner` before the admin's first result save.** If an
   early winner is ever needed, add a dedicated `matches.result_saved_at` and switch to it.

2. **Payments carry over week-to-week via `owes`, not via the `paid` flag.** Opening a new
   week (mig 204) resets status/team/admin_locked_in but deliberately **keeps**
   paid/self_paid/paid_by/paid_at/owes. Result-save charges unpaid non-guest attendees into
   `owes` (running debt) **and** writes a `payment_ledger` game_fee/unpaid row (history).
   `owes` is cleared only by self-pay-debt / admin_clear_debt / admin_waive_debt — **not** by
   mark-paid (which settles only the current week). "Outstanding" = sum(players.owes).

3. **Week reset lives in two places on purpose:** go-live (mig 204, only when a new match is
   created) AND result-save (migs 205/206). Both set status='none'/team=NULL/admin_locked_in=
   false. Result-save covers the go-live double-tap reuse path; go-live covers weeks where no
   result was saved. Both setting the same values makes the overlap harmless.

4. **Orphaned-guest "Remove" (host dropped out) un-enters the player (`status='none'`), it does
   not delete the squad row and does not mark them `out`.** Deleting fails on match history and
   loses the player; `out` reads as an active decline. The squad row + guest link are kept.

5. **Casual stats stored as IDs; display resolves id-first, name-fallback.** matches.team_a/
   team_b/scorers/motm/bib_holder hold player IDs (player_match keys on player_id). Every
   consumer (StatsView, HistoryView share, PlayerLeagueTable, Avatar/PlayerView) must resolve
   id-first then name (legacy seed rows stored names). player_match remains stats source of
   truth; players.* flat columns are write-only convenience.

---

## Phase 11.4 group-stage → knockout cups — settled forks (session 66)

The deferred half of Phase 11. Four decisions, all confirmed with the operator before build:

1. **One competition, `format='group_stage'`, owns both phases.** Group round-robin fixtures
   (tagged `fixtures.group_label`) feed the **existing** `cup_ties` knockout machinery —
   `_cup_advance` / `tg_cup_advance` / `ref_*` deciders / `get_cup_bracket` are reused unchanged.
   Only the *seeding* of the bracket is new. Rejected: a season of N "league" comps + 1 "cup" comp
   (more rows, breaks single-competition display rotation, cross-comp bracket read).
2. **Auto snake-seed draw, operator-overridable.** `venue_persist_group_stage` snake-distributes
   active teams across groups in `registered_at` order by default; an optional
   `p_group_assignments {team_id:'A'}` overrides. Writes `competition_teams.group_label`+`seed`.
3. **Manual "Build knockout" trigger** (11.4b), not automatic. The operator taps once every group
   fixture is completed; `venue_seed_knockout_from_groups` seeds the bracket from final standings.
   Gives a confirmation point + room to handle a tie-break edge before committing. Matches the
   existing "operator schedules each round" pattern.
4. **Two sub-cycles.** 11.4a = group stage (schema + persist + standings + group tables on 3
   surfaces). 11.4b = knockout-from-groups (seed RPC reusing an extracted `_cup_build_bracket` +
   Build-knockout UI + `get_cup_bracket` groups extension). Each independently EV-gated/shippable.

**v1 scope (out):** head-to-head / best-3rd-place tiebreaks — group rank is deterministic
pts→gd→gf→seed; a true tie for a qualifying spot is the operator's to resolve before Build knockout.
Also out: double round-robin groups, mid-group re-seeding on withdrawal, two-legged knockout ties.

## HQ weekly digest — template-first, AI rides Phase 7 (session 66)

## HQ weekly digest — template-first, AI rides Phase 7 (session 66)

**The rule:** the HQ weekly digest (the last Phase 9 piece) is a **deterministic, template-
rendered email**, not an AI-narrated one — for now. AI narration of the same dataset is
**deferred to Phase 7** (the Ask-the-Gaffer layer), per the standing 9→6→11→7 ordering.

**Why template-first:**
- The AI layer (`/api/gaffer`) is real and grounded, but **team-scoped only** (admin_token→
  team_id, `audience='admin'`, `gaffer_get_context_*` RPCs). There is **no HQ/company surface**
  in it. Building an AI HQ digest now means pulling Phase 7 forward: a company-scoped context
  RPC, an `'hq'` branch in `gaffer.js` (which hard-resolves admin_token→teams today), company-
  not-team `ai_briefings` scoping, a new `hq_weekly_digest` prompt + canary. That's a phase, not
  a cycle.
- A template ships value now, server/cron-only, zero AI dependency, deterministic + testable.
- **Not throwaway:** the data-assembly RPC built now (`hq_get_analytics_for_company`, mig 190)
  becomes the Phase-7 context RPC. The AI simply narrates the same jsonb later — the cron's
  ctx-builder is the only thing that gets swapped for an LLM call.

**Recipient scope (this cycle):** **super_admins only, company-wide digest.** The service-role
RPC returns company-wide numbers, which is exactly what a super_admin wants. Regional_admins
would expect region-scoped figures — that's a clean follow-up (add a region param + per-recipient
render), not this cycle.

**How to apply:** when Phase 7 lands, add the `'hq'` surface to `gaffer.js` over
`hq_get_analytics_for_company`, and switch `weeklyDigestJob` to call `/api/gaffer` for the body
instead of the `hqWeeklyDigest` template. Keep the template as the no-AI-key fallback.

---

## Phase 11 cups — bracket model + flow (session 65)

Single-elimination shipped end-to-end (migs 184–189); group-stage→knockout deferred. Settled:

- **Server is the bracket source of truth.** `venue_persist_cup_bracket` computes the canonical
  single-elim bracket (textbook mirror seeding, byes as pre-decided ties) and persists `cup_ties`
  (one row per slot, with `home_feeder_slot`/`away_feeder_slot` edges) + round-1 fixtures. The
  client `packages/core/engine/cupBracket.js` engine is now a **cosmetic preview only** — it does
  not define who-plays-whom in round 2+. The DB wins; don't reconcile the engine's pairing with it.
- **Advancement is a DB trigger, not per-RPC.** `cup_advance_after_result` (AFTER UPDATE on
  fixtures) runs the idempotent `_cup_advance(competition_id)` sweep on any terminal cup fixture
  (completed/walkover/forfeit): resolve winner → fill parent slot via feeder edges → mark next tie
  `ready`. Every completion path advances uniformly, no extra wiring. `_cup_advance` only touches
  `cup_ties` (no fixtures recursion). Byes propagate on the first round-1 completion.
- **Tie-break = ref-entered ET and/or penalties** (operator). A level cup tie:
  `ref_confirm_full_time` returns `{needs_decider:true}` (does NOT complete; league unchanged); the
  ref then calls `ref_record_knockout_decider` with typed ET and/or pens + winner. Penalties take
  precedence; winner must match the higher of whichever decider is given. ET is a typed aggregate,
  NOT event-tracked through extra-time periods.
- **Operator schedules each round** (operator). Advancement never invents a date — it marks the tie
  `ready`; `venue_schedule_cup_tie` creates the fixture when the operator picks date/time/pitch.
  Fits multi-week cups; one-day-tournament auto-schedule was explicitly rejected.
- **Bracket is public match data.** `get_cup_bracket(competition_id)` is keyed by competition_id
  (unguessable uuid), anon+authenticated, no token gate — already shown on the no-login display
  board. One read serves venue + player + display; the renderer is duplicated per app (consistent
  with StandingsZone/CompetitionStandingsCard being per-app).

## Phase 9 — player notification channel fallback (session 65)

`players.notification_channel` (push/email/sms/whatsapp, default push) + `players.phone` are
captured via `set_player_contact` (PlayerProfile NOTIFICATIONS section). The 48h/2h reminder crons
route each player via `pickChannel` (push→email→SMS/WhatsApp): push through `/api/notify`, email via
`_mailer`, SMS/WhatsApp via `_sms`. **whatsapp + sms both use `players.phone`** (players have no
separate whatsapp_number — only `match_officials` do); email uses the linked auth email (`user_id`).
The once-per-(team,type,date) `alreadyLogged` guard is kept, so no per-player dedup is needed.

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

## Classes/room-hire analytics: spaces are a SEPARATE utilisation track, and class revenue sums charges not sessions (session 145, Classes+Room-Hire Phase 8, mig 345)

Two rules locked when Phase 8 wired classes + room hire into HQ analytics, so the numbers can't
drift as the activities products grow:

- **`venue_spaces` activity is NOT folded into pitch `used_hours`.** `hq_get_utilisation` is a
  pitch-availability model (30-min buckets from `playing_areas.booking_windows`). `venue_spaces`
  have only capacity — no availability windows — so there is no honest denominator to merge them
  into the pitch %. Class sessions + confirmed room hires are reported in a SEPARATE company-level
  `spaces` block (`class_hours`/`class_sessions`/`room_hire_hours`/`room_hires`/`activity_hours`),
  hours-only. Any future "venue activity" metric must keep the two tracks distinct. (The company
  object is an aggregate query → still 1 row with 0 pitches, so a classes-only venue still reports
  its spaces block.)
- **Class revenue sums CHARGES, never sessions.** A `class_package` purchase = one `class_package`
  charge (revenue once); a session booked against that pass deducts a credit and creates NO charge.
  So `class_revenue_pence` = Σ(`class`)+Σ(`class_package`) charges counts each pound exactly once —
  a pass-funded booking is automatically excluded because it has no charge. Per-type/insights revenue
  is `class`-source only (packages span types). The existing company `revenue` block (sums all
  source_types) is the single company total and is left untouched — `classes` is a drill-down, never
  additive to it. EV 15/15 proved the guard (pass-funded booking counted in fill, absent from revenue).

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
- **Nicknames are squad-local, not per-person.** `players.nickname` sits on the per-team `players` row, and a player gets a *separate* `players` row per squad (`player_join_team` creates a fresh row + token, blank nickname, on each join) — so a nickname set on one squad does NOT follow the player onto another squad, exactly like their name. Display everywhere uses `nickname || name`; the clash check (`nickname_taken`) is scoped to the squad. Player-self edits go through `set_my_nickname(p_token,…)` (mig 233, session 77); admin edits through `admin_update_player_name`. A global-per-person nickname would have to key off `user_id` and copy forward on join — deliberately NOT done.

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

## VENUE LOGIN CREDENTIALS / PER-USER ACCOUNTS (session 77 — flagged, not built)

- **Today:** the venue console (`apps/venue` → platform-venue.vercel.app)
  authenticates by a SINGLE shared `venue_admin_token` per venue
  (`resolve_venue_caller` stage 1). There are NO individual user accounts —
  anyone with the link is "the venue," with no personal identity. The token
  is also the venue's identity in every venue RPC.
- **Consequence (the trigger):** "reported by" on an incident — and every
  other audit field (approved-by on registrations, resolved-by on incidents,
  recorded-by on payments) — can only resolve to the venue, never a person.
  The write RPCs already capture `auth.uid()`, but it's NULL for token
  callers, so attribution is empty. Session 77's incident reporter line
  shows the venue name (`state.venue.name`) as an honest placeholder.
- **Decision:** proper per-user venue accounts are a NEW FEATURE, not a
  bolt-on. Build it like the existing `apps/hq` OAuth layer: each user logs
  in (email/password or OAuth) and is mapped to a venue with a name + role
  (e.g. a `venue_users`/`venue_admins` table keyed on `auth.uid()`).
  `resolve_venue_caller` gains an authenticated-user stage that returns the
  person's identity; the shared token can remain as a fallback/bootstrap.
- **Payoff:** once it lands, `reported_by` / `resolved_by` / `approved_by` /
  recorded-by auto-populate with the actual person (the RPCs already store
  `auth.uid()`), per-person access revocation becomes possible, and the
  audit trail becomes real. Tracked in FEATURES.md (League — Venue).
- **Not bolting on a half-version now:** deliberately avoided adding a
  free-text "reporter name" field, since it would create a parallel, untrusted
  identity path that the real accounts system would have to unwind.

### Session 78 — design settled (build starting)

Worked through the model with the operator. Settled:

- **Sign-in:** **Email OTP primary + "Continue with Google"** — passwordless,
  reuses the casual app's existing `SignIn.jsx` Supabase flow (OTP + Google
  already live there). Not password (reset/breach burden); not OAuth-only
  (would lock out staff without a Google account). Zero new auth infra.
- **No dual-mode — hard cutover.** There are only TWO venues in the system and
  both are demo (`demo_venue`, `venue_demo_south`); ZERO real venues live (the
  31 recent venue_admin audit actions are the two demo tokens = us testing).
  So the transition machinery dual-mode exists to protect (claim-links,
  retire-later) would be built only to be deleted. Staff logins becomes how
  venues work from day one. The shared `venue_admin_token` stays ONLY as a
  hidden dev/demo backdoor (kept in `resolve_venue_caller` stage 1, removed
  from the real UI). The two demo venues get a seeded Owner each. "First owner"
  of a real venue = just the first invite the operator sends at onboarding —
  no migration.
- **Three roles: Owner / Manager / Staff**, enforced **server-side** (the login
  tells each RPC the caller's role; the RPC refuses if too low; the UI just
  hides buttons to match). Default capability matrix:
  - **Always-on for any logged-in member (incl. Staff):** take/confirm/decline/
    cancel bookings; record a payment (cash in); report AND resolve incidents;
    assign ref/pitch to fixtures; nudge a team; **full league & cup admin**
    (seasons, fixtures, approve/reject/expel/withdraw teams, edit scores,
    brackets) — operator explicitly opened league admin to Staff.
  - **Manager+ only (the gated capabilities):** reverse money (refund / undo
    payment / void charge / edit amount owed); booking settings (hours, slot
    length, pricing, on/off); manage pitches & officials roster + reception-
    display/sponsor config; staff contact directory (the address book);
    invite/manage logins (Managers may invite **Staff-level only**).
  - **Owner only (not delegable):** create Managers, transfer ownership, core
    venue settings.
- **Roles are defaults, not a cage — per-person overrides.** On an individual's
  card an Owner (or Manager, for Staff) can toggle a specific gated capability
  ON or OFF for that one person (e.g. grant a trusted Staff member refunds;
  remove league admin from a new hire). Guardrails: (1) you can never grant a
  capability you don't hold yourself; (2) you can only edit people **below**
  you (Manager edits Staff; Owner edits anyone); (3) "create Managers /
  transfer ownership" is Owner-only and is NOT override-able (blocks
  privilege-escalation loops). Chose per-person overrides over editable role
  templates (one edit silently re-permissioning the whole team is a footgun) —
  keeps the 3-tier mental model with a contained escape hatch.
- **Effective capability** = role default ∪ per-person grants − per-person
  denies, capped at the editor's own ceiling.
- **Job-title vs permission-role are separate axes:** the existing `venue_staff`
  table (mig 195: reception/manager/groundstaff/coach…) stays a CONTACT
  directory; the permission role (owner/manager/staff) lives on the new
  `venue_admins` login table. A login may optionally link to a directory row.
- **Model to copy:** `team_admins` (mig 002) — user_id + role + granted_by/at +
  revoked_at/by soft-delete + active-unique index — extended with `email`
  (invite target, matched on first sign-in), `status` (invited/active/revoked),
  and `caps_grant[]`/`caps_deny[]` for the overrides.

Build phases: (1) `venue_admins` table + `resolve_venue_caller` authenticated
stage + `venue_whoami`; (2) reuse SignIn for the venue app; (3) invites + Staff
management screen; (4) per-RPC capability gating; (5) attribution payoff
(named reported/resolved/refunded-by). Phase 1 audit next.

## SPORTS LOOKUP TABLE — REJECTED (session 84, 2026-06-11)

An externally-written strategic brief proposed a `sports` lookup table
(`id`, `name`) with FKs on teams/competitions/fixtures/venues. **Rejected.**
The session-40 MULTI-SPORT POSTURE (mig 050) stands: `sport text DEFAULT
'football'` self-identification on companies/venues/leagues/league_config,
sport-agnostic naming for all new identifiers, per-sport game rules on
`league_config` (per-league, sport as discriminator).

Reasoning:
- **No integrity risk to protect against.** Sport values are written only
  by SECURITY DEFINER RPCs with a default — never user-typed. A FK locks a
  door no one can reach. (Cheap belt-and-braces if ever wanted: a CHECK
  constraint, no joins, no sweep.)
- **No sport-level metadata exists to house.** The table would hold one
  row ("football") with only its own name. When per-sport config DID
  arrive (card_types, formats) it deliberately went on `league_config` —
  the more flexible shape (two football leagues can differ; a sport-level
  table can't express that).
- **Real cost in this repo.** FKs on 4+ production tables ⇒ mandatory
  schema-sync sweep across all migrations, RPC body checks, mapper
  updates — days of change-control for a behaviourally identical end
  state.
- **Future-proofing lives elsewhere.** Multi-sport rebuild risk is
  football baked into identifiers/logic, not sport-as-string. Session 40
  already fixed that (playing_areas, match_officials, naming rule).
- **Reversibility asymmetry.** Text→lookup later is a mechanical
  afternoon migration (`INSERT INTO sports SELECT DISTINCT sport…` + FK);
  pre-building now risks the wrong shape. Deferring is free.

**Re-open trigger:** a second sport is actually onboarding AND needs
sport-level metadata `league_config` cannot express. Strategy context in
STRATEGY.md.

## MULTI-SPORT VENUES — text[], NOT the rejected lookup table (Membership Phase 1, mig 269)

The second membership pilot is a **multi-sport venue** (individuals who
attend across sports). This needs a venue to express the *set* of sports it
offers — but it does **NOT** trigger the session-84 re-open condition above,
and it does **NOT** resurrect the rejected `sports` lookup table.

Settled call: multi-sport-per-venue is modelled as **self-identified text**,
extending the session-40 posture from one-sport-per-venue to a venue's text[]:

- `venues.sports text[] NOT NULL DEFAULT ARRAY['football']` — the offered set.
  `venues.sport` stays the primary/default sport (heavily referenced; left
  untouched). No lookup table, no FKs, no schema-sync sweep.
- `playing_areas.sport text NULL` (NULL = inherit venue primary) scopes a
  pitch/court to a sport.
- Membership tiers' `sports_included text[]` (Phase 3) references these text
  values — same self-identified convention, no FK (optional belt-and-braces
  CHECK only if ever wanted, per the session-84 reasoning).

## CLUB DISCIPLINE — text + CHECK pick-list, not a config engine (Gym/Boxing vertical Phase 0, mig 355, session 144)

The gym/boxing vertical needs a club to declare *what it is* so the member app
shows the right vocabulary (tab labels, booking CTA, rank word). Settled call:
**`clubs.discipline text NOT NULL DEFAULT 'football'` with an 8-value CHECK**
(`football|gym|boxing|martial_arts|yoga|dance|fitness|other`). This is the
session-40/84 posture applied to clubs — self-identified text, fixed list, no
lookup table, no FKs.

Considered and rejected at the operator's prompting (s144):
- **A generic "build-any-sport" config engine** (operator defines sport +
  resource + schedule + progression scheme themselves). Rejected as a no-code
  platform-builder — a far larger, speculative bet designed blind before a real
  second-sport customer. The *engine* (bookable sessions, resources, capacity,
  waitlist, QR, charges) already exists generically and is reused; only the
  thin per-discipline *identity* is added here. Reversibility asymmetry
  (session-84): text→engine later is a clean refactor; engine-now risks the
  wrong shape. Defer.
- **A `sports`/`disciplines` lookup table** — same rejection as session 84.
  `discipline` is written only by `venue_set_club_discipline` (SECURITY
  DEFINER, validated) with a default, so the CHECK is sufficient; a FK locks a
  door no one can reach.

Why CHECK over a Postgres `enum`: a CHECK is a one-line swap migration to
extend; an enum needs `ALTER TYPE ADD VALUE` (can't drop, ordering baked in) —
the wrong kind of rigidity for a list expected to grow.

Why labels in code, not the DB: the member-facing words (`disciplineLabels.js`)
are pure UX copy, not data — never queried, aggregated, or per-tenant. Reporting
keys off the `discipline` column (in the DB, fully reportable); labels are
display dressing, so they live where wording is a code edit not a migration.
Boxing has NO grading (its progression is a fight record, Phase 4); grades/belts
are martial-arts only — captured by `hasGrading`/`hasFightRecord` flags in the
label map.

Why this is NOT a session-84 reversal: the rejection was of a *global `sports`
lookup table with FKs* whose only justification would be sport-level metadata.
Membership needs sport purely as a **tag/scope** — no metadata `league_config`
can't already express. So the cheaper, posture-consistent text[] extension is
correct; the lookup table stays rejected. If a genuine sport-level-metadata
need ever arrives, the session-84 re-open trigger — not this entry — governs.

## QR ONBOARDING ARCHITECTURE (session 84, 2026-06-11)

QR codes are the next net-new build (pilot demo centrepiece — pitch date
2026-06-18, see STRATEGY.md). Verified nothing QR exists today: no
library, no routes, no table; joins are `/join/<code>` (`teams.join_code`)
and `/p/<token>` only.

Settled design — **stable code → mutable destination**:
- **Never QR-encode internal database IDs or direct entity URLs.** A
  printed/laminated QR must survive every future routing change.
- Generic routing layer: `invite_links` table — `code`, `entity_type`,
  `entity_id`, `action`, `active`, `expires_at`, `max_uses`, `use_count` —
  resolved by a `/q/<code>` route that dispatches on `action`.
- **V1 actions:** join-team; venue landing page ("what's on here" + join
  options); QR rendered on the reception display rotation (scan the
  screen → joined in <30s — the demo moment).
- **V2+ (the `action` field already accommodates):** match check-in,
  equipment, payments, registration, tournament access, venue onboarding.
- Rendering library: `react-qr-code`.
- Existing `/join/<code>` mechanic stays as-is; folding it into
  invite_links considered later, not now.

Design decision recorded ahead of build (per the feature-plan → audit →
execute cycle); implementation will follow the RPC + RLS checklists as
normal. Backlog row in FEATURES.md.

### Three surfaces, three audiences (session 84 walkthrough — do not blur)

QR onboarding touches three "venue" surfaces that are easy to confuse:
- **Venue dashboard** (`apps/venue`, platform-venue) — PRIVATE staff ops
  console. Logged in. Where staff *run* the venue.
- **Reception display** (`apps/display`, platform-display) — PUBLIC but
  *passive* big screen. Read-only, no interaction. Shows live scores —
  the "make the venue look elite" spectacle. Where the QR is *rendered*.
- **Venue landing page** (`apps/inorout` `/q/<code>`, action
  `venue_landing`) — PUBLIC and *active* phone page. Where a scan *goes*.
  "What's on here" + join options.

The display and landing page are the two halves of one scan (look at
screen → scan → page opens on phone). The dashboard is a separate,
private surface that merely also belongs to the venue.

### Public-landing privacy rule (settled — never expose private teams)

"Public but passive" (display: showing scores to a room — fine) vs
"public and active" (landing: offering *joining*) are DIFFERENT risk
profiles despite both being "public". The venue landing page must surface
ONLY public/open competitions and registration — **never private/casual
teams**. A casual team is joined by its admin deliberately sharing its
`join_code`; auto-listing it on a public reception-display QR would let
randoms into a private group. Same applies to competitive-team squads
(admin-built, not self-serve). No `venue_id` is added to casual `teams`
for QR onboarding; slice 3 reads public competitions only (reuses the
display's competition/team assembly), zero `teams` schema change.

### "You register a team, not a person" (league-join model)

A league is a competition of TEAMS, not a roster of individuals — there
is no "join a league as a person" path, by design. The only self-serve
league entry is `join_register_team` (mig 098/158): a CAPTAIN registers a
team → `competition_teams` row status `pending` → venue approves. Three
would-be joiners: (A) captain → `join_register_team` (RPC+wrapper exist,
self-serve wizard NOT built in apps/inorout, auth+approval-gated — not a
<30s flow); (B) free agent with no team → NO path exists (capture-
interest at most); (C) squad-filler joining a mate's team → team admin
adds them (`player_registrations` via lineup, admin-driven, not public).
So the venue landing page's "join options" = **register-your-team**
(captain), not individual join.

Registration loop is HALF-built (verified session 84): the CAPTAIN-submit
side (`join_register_team`) has RPC + wrapper but NO UI — slice 3 builds
that form (first-ever UI for it). The VENUE-approve side is COMPLETE —
`venue_approve_team_registration`/`venue_reject_team_registration` (migs
099/100) + wrappers + live UI (`Operations.jsx` pending_registrations list
→ `RegistrationActions.jsx` Approve/Reject). So slice 3 builds ONLY the
captain form; the moment it drops a `pending` competition_teams row, the
venue's existing approval screen lights up automatically.

ONE enrichment to that approval screen IS in slice 3 scope (verified
session 84): the card has never received a real self-serve registration,
and as built it shows ONLY team name — too thin to judge a stranger's
request. `v_pending` (in `venue_get_state`, latest mig 227) carries
`competition_id`, `registered_at`, `team_name` but the card renders only
the name; `admin_email` isn't even selected. Slice 3 enriches: extend
`v_pending` to also select the competition/league NAME (join via the
existing `v_competitions` CTE) + `admin_email` (`registered_at` already
present) → `venue_get_state` REPLACE, return-shape add (hard-rule #12,
consumer = raw-jsonb Operations card) → render
"competition · captain email · registered Xh ago" on the card. Watch-item
(NOT v1 scope): a public QR lets anyone mint `pending` rows — consider
rate-limiting/abuse handling later; the approval card is the gate.

### Two QR types, two speeds (demo note)

- **Team code** (`action='join_team'`, a team admin's own code) → instant
  join one specific team via `playerJoinTeam`. Controlled (admin chose to
  share). THIS is the STRATEGY.md "<30s join" money moment — the demo
  display QR must be a `join_team` code pointing at a demo team.
- **Venue code** (`action='venue_landing'`, public) → "what's on" +
  register-your-team (auth'd, approval-gated — NOT <30s).
Both are v1 actions; `invite_links.action` dispatches between them.

### Separate, NOT part of QR onboarding: venue↔casual-team link

Letting the venue *dashboard* (private) see the casual groups using its
pitches is real future value ("venue as owner of its community") — but
it's about DASHBOARD VISIBILITY, not public joining, and requires schema
+ create-flow changes (casual `teams` have no venue link today; the
casual create flow carries no venue context). It is a SEPARATE feature on
its own cycle, after the pitch — explicitly out of QR-onboarding scope.
Backlog row in FEATURES.md.

---

## EVENT OS ARCHITECTURE (session 114 — planning session, no code written)

Full spec: `/Users/tarny/.claude/plans/what-happens-if-there-zesty-wreath.md`

### Event OS as orchestration layer
A `tournament_events` table acts as an OS container — a time-bounded orchestration layer sitting above casual squad, competition, venue, and club OS layers simultaneously. It borrows pitches from the venue layer, member records from the club OS, and existing competition/ref machinery from the competition layer. It does not replace any of those layers; it coordinates them for the duration of an event.

### Club admins live in the In or Out app, not the venue app
Confirmed: no `club_admin_token` exists. The venue app is venue-operator-only. Club admins use `auth.uid()` → club admin role (Phase 12) and access tournament management via a new Tournaments tab in the In or Out app's club manager section (alongside Sessions and Members). This avoids building a new app or giving club admins venue app access.

### Public tournament URL: `in-or-out.com/tournament/[slug]`
Public tournament pages live at this path. No login required. Supabase realtime powers live score updates. Printed schedule at `/schedule` suffix. This is the spectator and social-sharing surface; the reception display covers the venue screen.

### Sport-agnostic from day one
`ref_ui_config jsonb` on `league_config` (NULL = default football UI) makes the ref app sport-configurable without code changes per sport. `sport_types text[]` on `playing_areas` gates surfaces by sport. `match_events.event_type` is already open text (no CHECK). Any sport using match-based play (racquet, combat, team sports) works immediately. Performance-based sports (athletics, swimming) use a new `performance_events` + `performance_results` model.

### Account relationship routing — four distinct home screen modes
`get_user_relationships(uid)` runs on app load and determines home screen. Four modes:
1. Squad-only player → current In or Out home, unchanged
2. Parent/guardian-only → parent home screen (child schedule, Follow Live, notifications — no squad mechanics)
3. Club athlete only → athlete home (next session, next fixture)
4. Multiple active relationships → unified chronological feed

Adaptive bottom navigation built from active relationship types. Existing squad-only users see zero change.

### Parent / guardian as first-class persona
Not a trimmed-down player view. A completely different emotional register — parenting, not participation. Distinct home screen, Follow Live real-time view during a child's match, notification types specific to parents (bout starting, score update, result). Guardian relationship uses existing Phase 10–12 consent RPCs; missing piece is UI flow and parent home screen.

### Tournament hosting pricing model
Free for clubs already on the platform. Platform takes ~5% of entry fees collected through Stripe (exact % TBC). Hosting club's own team entry waived by default (host-configurable). Completely undercuts Tournify (€40–120/tournament upfront).

### Classification brackets: full position tree
Not just 3rd/4th place — the full position bracket (5th/6th, 7th/8th etc). Host configures how many classification rounds to generate. Modelled in `cup_ties` with new `bracket_type CHECK ('main','classification','loser')` and `source_type = 'loser'` additions.

### Double-elimination: build in full
Added `source_type = 'loser'` to `cup_ties.home_source`/`away_source`. Loser's bracket as a parallel `cup_ties` tree under the same `competition_id`, with grand final and potential bracket reset.

### Yellow card suspension threshold: host-configurable per competition
Not platform-defined. Stored on `competition_teams` or `league_config` extension. Auto-trigger fires in `ref_confirm_full_time` cascade when threshold is hit.

### "In or Out" brand stays as product name; platform identity question deferred
The platform is growing beyond football casual squads. "In or Out" is the casual squad product. The platform name and product name are currently the same; they will eventually need to diverge (a judo parent doesn't relate to "In or Out"). This is a strategic/branding decision deferred — not a Phase 0–1 blocker.

---

## CLASSES + ROOM HIRE ARCHITECTURE (session 134, 2026-06-15)

### venue_spaces is a distinct entity from playing_areas (pitches)

`playing_areas` carries the wrong abstraction for bookable rooms/studios/halls — it has slot
lengths, booking windows, prime-time bands, and sport assignment designed for pitch scheduling.
A hireable room is simpler. New `venue_spaces` table: name, capacity, space_type, is_enquiry_only,
enquiry_contact. Both class sessions AND room hires FK→venue_spaces.

### Shared availability helper built before either product (_space_is_available)

`_space_is_available(space_id, starts_at, ends_at)` is a non-SECDEF internal helper that checks
for overlaps across BOTH `venue_class_sessions` AND `venue_room_hires`. Built in Phase 1 (mig 331)
before either booking product exists. Both `venue_schedule_class_session` and `venue_confirm_room_hire`
call it. Prevents double-booking across product types without needing a unified occupancy table.

### Waitlist = notify-and-claim, not auto-promote

Same pattern as the reserve spot notification (mig 230). On any cancellation, the next person on
the waitlist gets a push notification with a time-limited claim window. They must actively claim
the spot — it is not automatically confirmed for them. Rationale: auto-promote risks charging a
member who no longer wants the spot; tap-to-claim keeps the member in control.

### No-show counter on member_profiles, venue-configurable threshold

`member_profiles.no_show_count int DEFAULT 0` incremented server-side on each no_show mark.
`venues.no_show_suspension_threshold int NULL` — NULL means no policy at that venue. When set,
`member_book_class_session` rejects with `booking_suspended_no_show_limit` when count >= threshold.
Counter never decrements (permanent record of behaviour). Venues choose their own tolerance.

### Classes are member-only; room hire is open to non-members

Class sessions require an active `venue_memberships` row for the caller. Room hire does not —
a non-member can request a private hire or enquire about a function space. Two different RPCs:
`member_request_room_hire` (authenticated) and `public_enquire_room_hire` (anon, enquiry-only
spaces only). Same space, different access model per product type.

### Enquiry-only flag for large/premium spaces

`venue_spaces.is_enquiry_only bool DEFAULT false`. When true, self-serve booking is blocked for
ALL products on that space. Members see a contact form (enquiry_contact_name/email); the request
lands in the venue's Room Hires inbox as `status='requested'` with `booker_type='non_member'`.
Venue confirms manually with a price. Rationale: large spaces often need bespoke pricing and a
human conversation before confirming.

### Equipment hire links to room hires via room_hire_id column

`equipment_bookings.room_hire_id uuid NULL FK→venue_room_hires ON DELETE SET NULL` (additive).
`member_request_room_hire` accepts optional `equipment_ids[]` and creates the `equipment_bookings`
rows linked to the hire. This reuses the entire existing inventory availability check
(`_equipment_peak_committed`), charge recording, and equipment management UI. No new equipment
infrastructure needed.

### Stripe prepay stays dormant; door payment works from Phase 1

`payment_mode` column exists on class sessions and room hires from day one but `member_book_class_session`
returns `payment_method_unavailable` for `prepay` until `venue_integrations` row with
`provider='stripe' AND status='connected'` exists. Door payment recorded via existing
`venue_charges`/`venue_payments` ledger immediately. Same keyless-dormant pattern as merchandise
(mig 309) and Stripe membership scaffold (mig 279).

### Trial class: first_session_free on the class type, not a promo code

`venue_class_types.first_session_free bool DEFAULT false`. When true, `member_book_class_session`
checks whether the caller has ANY prior `venue_class_bookings` at that venue. If none, charge is
waived (`payment_status='waived'`). Simple, no promo code infrastructure needed, one booking per
member per venue. Venue enables it per class type (e.g. intro yoga free, circuit training not).

### Stripe Connect webhooks must be registered as Connect webhooks (Events from: Connected accounts)

Checkout Sessions are created with `{ stripeAccount: accountId }` — the charge happens directly on the
connected account. Events for those sessions (`checkout.session.completed`, `customer.subscription.*`,
`invoice.*`) fire on the connected account, NOT on the platform account. A platform-only webhook
(the default) never receives these events.

**Rule:** The Stripe webhook endpoint for this platform (`in-or-out.com/api/stripe-webhook`) MUST be
registered with "Listen to events on Connected accounts" enabled. This flag is Dashboard-only and
cannot be set via the REST API — `connect=true` in `POST /v1/webhook_endpoints` is silently ignored.
Verified during Phase 3 E2E test (session 136).

**Implication for new webhooks:** If we ever add a second webhook endpoint (e.g. for GoCardless or a
separate environment), it must also be toggled via the Stripe Dashboard, not the API.

### Post-Stripe-redirect UX: fetch passToken from DB on mount, not from state

After Stripe Checkout completes, the browser is redirected back to `/q/{code}?checkout=done`. React
state is fully wiped on this redirect — any token from the enrolment flow is lost. The `MembershipSignup`
component detects the URL param and shows the "done" step, but `passToken` is null, so the
"Open your membership pass" link never renders.

**Solution (mig 336):** Call `member_get_venue_membership_pass(invite_code)` on every `MembershipSignup`
mount. If the user is already enrolled at this venue, the RPC returns their `pass_token` and the
component jumps straight to the done state with the link rendered. This handles both the post-redirect
case and returning already-enrolled members hitting the invite link again.

**Pattern:** Never rely on in-memory state surviving an external redirect. Always re-derive from the DB
on mount for anything that matters post-payment.

### Plus-one approvals: player-added +1s require admin sign-off (mig 346, session 139)

Previously any player could add a plus-one that joined the lineup immediately. Operators asked for a
gate: a player's +1 now enters a PENDING state and takes no squad spot until an admin approves it.

Settled choices:
- **Pending takes no spot.** A pending guest is `status='none', pending_approval=true` — invisible to
  the board (same mechanism as a dormant guest) and excluded from every `status='in'` count. The
  squad-full guard is therefore evaluated at APPROVAL time, not add time. Rationale: a flood of
  unapproved +1s must never lock real players out of the squad.
- **Approve-when-full → reserve, not reject.** If the squad is at `squad_size` when an admin approves,
  the guest is placed on RESERVE rather than refused — the admin's intent was "yes", capacity is a
  separate concern handled by the reserve queue.
- **Admin-added guests auto-approve.** When the add carries a valid admin token (`/admin` route), the
  +1 goes straight in — the admin is the approver, so self-approval is redundant. Distinguished at the
  RPC via the new optional `p_admin_token` arg, not a separate RPC.
- **Decline = dormant, not delete.** Reuses the persistent-guest model so a declined +1 is recoverable
  via the returning-guest picker. Host-cancel of a pending +1 (`remove_guest_player`) also clears
  `pending_approval` so it leaves the admin queue.
- **Notification: in-app now, push plumbed-dormant.** The realtime `notify_team_change` broadcast
  surfaces the top-of-admin approvals banner live (works today). A `guestPendingApproval` push type was
  added to `/api/notify` targeting the team's admins — dormant until admins register push subscriptions.

This is a deliberate behaviour change to the casual +1 flow (operator-approved), not a competitive-mode
leak — the "casual flow is sacred" constraint guards against unintended changes, not requested features.
