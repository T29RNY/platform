# Venue Setup Wizard — Scope & Handoff

> **STATUS 2026-07-07 — ✅ COMPLETE (W1–W9 ALL SHIPPED + LIVE).** The wizard is fully built.
> Core (W1–W5): shared registry + web SetupHub + native /hub OperatorSetup + details/hours/dismissal
> setters + Stripe Connect + the go-live auto-flip/enforcement/takedown. Migrations 485/486/488
> applied+merged (W5 = PR #313, squash `a008700`, mig 488; W3 = mig 486; W1 = mig 485). Venue +
> superadmin consoles deployed & prod-verified.
>
> **Optional cards (steps 7–9): ✅ SHIPPED + LIVE 2026-07-07 (PR #315, squash `486e649`).** Booking
> rules / cancellation policy, membership plans, equipment hire — 3 feature-gated `SETUP_STEPS`
> rows in the shared registry + cards on both skins. Tier-1, CLEAR, **no new backend, no migration**
> (reused existing read wrappers + deep-links; native shows "On the web"). Full proof gate green
> (lint/hygiene/build ×2/live-config CLEAR/casual-regression clean/behavioural smoke). QA + Security
> review both CLEAN. Both deploys live + confirmed: platform-clubmanager auto-deployed; **platform-venue
> manually deployed** (dpl `9AkbzfBix3zJ…`, live bundle `index-T8QJhQXS.js` grep-confirmed).
>
> **ONLY WORK REMAINING = human-only verification (no code):**
> - 🚦 **Real-iPhone Hard-Rule-13 walk** of native `/hub` → Setup (owed across the whole native side
>   of the epic incl. the new cards, AND "Go live now"). Automated checks can't catch "tap does
>   nothing" — needs a real device.
> - 👁️ One operator eyeball of the web console: enable memberships + equipment under "What does your
>   venue offer?", confirm the 3 new cards appear, gate correctly, and deep-link.
>
> Safe to close as a development effort — nothing left to build.
>
> *Scoped 2026-07-06. The receiving end of `SELF_SERVE_MULTI_VERTICAL_HANDOFF.md` PR4 — the
> `apps/venue` web console flow the self-serve SSO hand-off deep-links into. Read alongside
> that epic (esp. Decisions #6 shell-now-configure-later, #7 verification_status gate, #10 L2278
> override) and `STRIPE_FULL_BUILD_HANDOFF.md` (the Connect Express stack this reuses).*

---

## WHAT IT IS

Today the self-serve flow ends on a **dead drop**. A user self-creates a `trial`/`pending` venue in
the native app (PR4, `CreateVenue.jsx`), taps "Open venue console," and lands on an **empty Operations
screen** — the console promises "pitches, opening hours, leagues and payouts" but has no flow to deliver
it. This feature is the **missing bridge between that promise and the payoff**: a guided first-run setup
in `apps/venue` that walks the new owner through the heavy configuration PR4's one-thumb native shell
deliberately deferred.

**It is a resumable CHECKLIST HUB, not a linear wizard.** A new `view === 'setup'` page in the venue
Dashboard renders the six setup areas as status cards; each card **routes into the already-built view**
(SpacesView, IntegrationsView, StaffView, LeagueView→SeasonWizard, DisplaySettings) rather than
re-implementing it, and shows a live tick derived from the venue's real state. It reuses the venue
console's entire existing supply — the only genuinely new backend across the whole feature is **one
`venue_update_details` write RPC** (the `venues` branding/address columns exist but nothing writes them)
plus, at the very end and human-gated, the authority to flip `verification_status`.

The hub is deliberately generic — a **config-driven setup-step registry** — because club and gym
self-serve (PR5/PR6 of the parent epic) land the operator in the *same* `apps/venue` console and need the
*same* guided setup. Build it once as a registry; the next vertical is a config row, not a rebuild.

**Why hub, not wizard (the operator asked this explicitly):** a linear wizard's core assumption —
"start at step 1, nobody's done anything" — is false for a superadmin-created venue that arrives 60%
configured, and gets *more* false as pre-config grows; it can't survive the Stripe onboarding redirect
(which navigates the whole document away and loses in-memory state); and it fights the hard requirement
that owners won't finish in one sitting. A hub reads current state, ticks done-steps with no re-entry,
survives redirects and reloads because its state *is* the venue's config, and lets an owner pick the card
matching their intent right now. This is also the settled 2025-26 PLG best practice (checklist/setup-guide
over forced linear tour) for exactly this "won't finish in one sitting, may arrive partial" case.

---

## LOCKED DECISIONS

Assumed product/architecture calls — confirm or adjust at the human review before building.

1. **Container = a resumable CHECKLIST HUB, shipped on BOTH surfaces from the start** — the `apps/venue`
   web console AND the native `apps/inorout` `/hub` operator app. *(Operator: the venue owner should be
   able to run their venue from the app too — and the native operator surface already exists at `/hub`:
   `OperatorBookings/Payments/People/Tournaments/OperationsTonight`, already talking to `venue_get_state`
   via `resolve_venue_caller` Stage-1b.)* The hub is NOT a modal wizard. Each of the 6 areas is a status
   card that deep-links into its existing view/sub-screen and returns to the hub. Linear mini-wizards stay
   *inside* a single self-contained step only where it's genuinely sequential (season setup already is).

1b. **Build the hub LOGIC once in `packages/core`, skin it twice (per-app presentation).** The step
    registry (Decision #7), the `isComplete(state)` predicates, the two progress numbers, and the go-live
    rule live in shared `@platform/core` (presentation-agnostic data + functions). Each app renders its
    own cards with its own components/design system — `apps/venue` (dark Broadcast-Gallery, `<Icon>`) and
    `apps/inorout` `/hub` (the amber `[data-surface="mobile"]` theme). One source of truth for "what are
    the steps and what's done," two skins. This is what makes "both surfaces from the start" cheap rather
    than a double build — and it is the same shared-registry future-proof lever (Decision #7) extended
    across apps.

2. **Progress is DERIVED from live venue state; dismissals are STORED (best-practice, future-proofed).**
   "Done" = the real signal exists (≥1 space via `venueListSpaces`, Stripe via
   `venueGetBillingStatus().stripe.config.charges_enabled`, ≥1 co-admin via `venueListAdmins`, ≥1 league in
   `venue_get_state`, branding via `venue.logo_url`) — honest by construction, can never drift, resumable
   for free. **PLUS** an additive `venues.setup_dismissed_steps jsonb DEFAULT '[]'` (a *dismissal* set,
   never a *completion* set) + one audited setter so an owner can "Skip for now" on an optional step and
   have it persist across sessions. Completion stays derived (never faked); only the deliberate-skip is
   stored. *(Operator confirmed: do the best-practice/future-proofed thing — this is it: derive completion,
   persist dismissal.)*

3. **Two honest progress numbers, never one blended %.** "Go-live progress" (the required set) shown as
   the primary meter; "setup completeness" (all 6, optionals marked *Optional*) shown softer. An owner who
   did the required steps but skipped leagues/staff/Stripe is **done for their needs** — the UI says
   "you're live-ready," not "50%."

4. **Required-to-go-live set = {venue details confirmed · ≥1 pitch or space}. Everything else is
   skippable-and-editable-later.** Opening hours, leagues, and staff are optional (staff *strongly
   nudged* — a single-owner venue is a single point of failure). Stripe is required **only to take
   money**, never to exist or (if free/enquiry bookings are allowed) to be publicly listed. **Stripe
   onboarding stays web-first:** on the native `/hub` the Payments card shows status + a "finish payout
   setup on a computer" nudge (the Stripe hosted flow redirects the whole document out — awkward in a
   WKWebView, stricter under Apple); the real onboarding runs in the web console. Every other step is
   fully doable natively.

5. **Go-live is an OBJECTIVE AUTO-FLIP + a new-signup alert — NOT a manual approval gate.** *(Operator:
   "I don't need to approve; I need an alert to say new sign-up.")* When the venue satisfies the
   server-checked required set (details confirmed + ≥1 pitch/space), a SECDEF RPC re-verifies those
   preconditions and flips `verification_status pending → verified` — the owner cannot flip it by an
   arbitrary button, only by objectively completing setup (so it is not a self-approval trust bypass; the
   server owns the predicate). The platform is kept in the loop by a **new-venue-signup alert** fired at
   self-serve creation (trust-but-monitor, not gate). A superadmin retains a `rejected` **takedown**
   override for post-hoc removal. Taking money stays separately and automatically gated by Stripe Express
   KYC (`charges_enabled`), independent of `verification_status`.

6. **Opening hours are VENUE-LEVEL and independent of pitch hours — add a new `venues.opening_hours
   jsonb` store.** *(Operator: "a venue can be open at different hours to its pitches, so opening times
   cannot be tied to pitches.")* Venue opening hours (reception/staffed/access hours — informational +
   the outer bound a customer sees) are a genuinely different thing from each pitch's `booking_windows`
   (when that specific pitch is bookable). They are NOT two sources of truth for the same fact — they
   describe different facts — so both coexist correctly. Add an additive `venues.opening_hours jsonb`
   (weekly `[{day_of_week 0-6, open_time, close_time, closed?}]`) + a `venue_update_hours` setter
   (or fold into `venue_update_details`). The hours step is optional (not go-live-critical).

7. **The hub is a GENERIC config-driven setup-step registry**, so club/gym self-serve reuse it. Each step
   = `{ id, label, icon, required, gate, isComplete(state), view, verticals[] }`. Mirrors the parent
   epic's Decision #8 Vertical Registry and the console's own config-driven Rail (`navItemVisible`).

8. **Superadmin-created venues degrade by DERIVED STATE, never by `origin`.** A superadmin venue arriving
   `verified` with pitches already seeded sees those steps ticked/collapsed, the go-live step already
   complete, and is **never nagged to re-configure or "go live."** Do not branch behaviour on
   `origin='superadmin'` — branch purely on what's actually done (robust to any config path).

9. **Two design systems, one per surface — do not cross them.** The shared core carries logic only; each
   app skins its own cards. (a) `apps/venue` = self-contained dark "Broadcast Gallery": Manrope, amber
   `--accent #FFC83A`, `styles.css` tokens, inline-SVG `Icon.jsx` (NOT Phosphor), hardcoded hex allowed;
   the inorout hygiene hook does NOT fire here. (b) `apps/inorout` `/hub` = the native amber
   `[data-surface="mobile"]` theme tree; here the **inorout hard rules DO apply and the hygiene hook DOES
   fire** (CSS vars from tokens only, Phosphor `weight="thin"`, no stray hex, no `console.log`). The
   manifest must tell the builder which rules bind which surface, or they'll mix them.

10. **Safeguarding gates at the FEATURE, not the venue — v1 is adult/open only because minors are a
    blocked LEGAL stack, not just more code.** *(Operator asked "is minors U18 much more work?" — yes,
    materially: it is the parent epic's PR5 compliance block — safeguarding attestation, a named welfare
    officer, DOB-consent basis, a DPIA, and Apple 1.2 UGC moderation — which is product/legal sign-off,
    not code, and is currently unbuilt/blocked.)* A bare venue (pitch/space hire) enrols no one and carries
    no gate. The tripwire is the **leagues/classes step *if* it can enrol under-18s**. **v1 limits the
    wizard's league step to adult/open competitions**, so the whole hub ships clear of the safeguarding
    stack; the minor-enrolling path is explicitly deferred until PR5's compliance work lands.

11. **A "what does your venue offer?" opener TAILORS the list, and optional extras are offered without
    bloating the required path.** *(Operator: add more optional setup + a skip→reminder.)* The required set
    stays tiny (Decision #4) — best practice is *fewer* forced steps. So "more setup" = more *optional,
    tailored* setup, never more mandatory steps:
    - **Opener (recommended, the one genuinely new card):** one friendly first question — "what does your
      venue offer?" (pitch/court hire · leagues · classes · memberships · equipment hire). It writes the
      real venue feature flags via the **already-built** `venueSetVenueFeature` (FeaturesView) + reads
      `getVenueFeatureFlags`, and — crucially — **hides the steps that don't apply** (say no to leagues →
      the leagues card disappears). It shrinks the list, it doesn't grow it.
    - **Optional extra cards, feature-gated, all reusing existing write paths (no new backend):** booking
      rules / cancellation policy (`venueUpdateBookingSettings`), membership plans
      (`venue_create_membership_tier`), equipment hire (`venueAddEquipment`). Shown only when the opener
      enabled that feature; clearly marked *Optional*; never block go-live.
    - **Skip → persistent reminder (explicit):** declining any optional step stores a "skip for now" flag
      (`setup_dismissed_steps`, Decision #2); a dismissible **"finish setting up your venue"** reminder
      (banner + hub entry, on BOTH surfaces) persists until the venue is go-live-ready, showing honest
      "N go-live steps left," and ticks itself down / disappears as steps complete (derived from state).
    - **The opener is EDITABLE / reversible, never write-once.** Because it writes real feature flags (not
      a one-shot wizard answer), a past "no" is just a toggle's current position. Turning a feature back on
      (from the hub's always-available **"Edit what your venue offers"** entry, or the existing Features
      screen) **re-reveals its step in the hub AND its item in the console nav** (`navItemVisible` reads
      the same flags) — and clears any prior dismissal. Nothing is baked in; the hub self-heals from state.
    - **Post-go-live "add more to your venue" prompt.** After the venue is live, the hub stays reachable as
      a light **expansion** surface — an "add memberships / leagues / equipment" prompt so growing the
      venue is one tap, not a hunt through the Features screen. Same registry, just shown in
      "already-live" mode (no go-live meter, all cards optional).

---

## WHAT THE WIZARD COVERS — AND WHAT IT DELIBERATELY DOESN'T

*(Operator asked to see exactly what the wizard walks through vs what it leaves out — e.g. staff.)*

**The setup hub walks through 6 areas + a go-live moment** (each a card that routes into the existing
console view; the wizard configures for first-run, it does not replace the day-to-day tools):

| # | Step | Required to go live? | Reuses |
|---|------|----------------------|--------|
| 0 | **"What does your venue offer?" opener** — tailors which steps below show | ⬜ Optional (but first) | `venueSetVenueFeature` / `getVenueFeatureFlags` (built) |
| 1 | **Venue details & branding** — name, address, contact, logo, colours | ✅ Required | new `venue_update_details` + `DisplaySettings` |
| 2 | **Pitches & bookable spaces** — at least one | ✅ Required (≥1) | `venue_add_pitch` (105) · `SpacesView` |
| 3 | **Opening hours** — venue-level, independent of pitches | ⬜ Optional | new `venues.opening_hours` |
| 4 | **Leagues & competitions** — adult/open only in v1 | ⬜ Optional *(if offered)* | `LeagueView` → `SeasonWizard` |
| 5 | **Invite staff & co-admins** — *strongly nudged (single-owner = fragile)* | ⬜ Optional | `AccessView` / `venue_invite_admin` |
| 6 | **Stripe Connect payouts** — needed only to take money | ⬜ Optional (money gate) | `IntegrationsView` (fully built) |
| 7 | **Booking rules / cancellation policy** | ⬜ Optional *(if offered)* | `venueUpdateBookingSettings` (built) |
| 8 | **Membership plans** | ⬜ Optional *(if offered)* | `venue_create_membership_tier` (built) |
| 9 | **Equipment hire** | ⬜ Optional *(if offered)* | `venueAddEquipment` (built) |
| ★ | **Go live** — auto-flips when steps 1–2 done; fires the new-signup alert | — | new flip RPC (W5) |

> *Optional cards 7–9 appear only when the opener (step 0) enabled that feature — so a plain pitch-hire
> venue never sees memberships/equipment. This is how "offer more setup" stays un-bloated: the list is
> tailored, and only details + a pitch are ever required.*

> **Staff IS in the wizard** (step 5) — it's one of the six, surfaced as the co-admin invite (and doubles
> as the single-point-of-failure fix). The wizard is a *launcher* into the real `AccessView`, not a
> re-implementation.

**The wizard deliberately does NOT cover** — these stay in the normal console, reachable any time from the
Rail (the hub is first-run setup, not an ongoing operations shell):

- Day-to-day **bookings / calendar / walk-ins / cancellations / refunds / reconciliation**
- **Members & customers** management, **memberships** plan admin (beyond enabling the feature)
- **Equipment hire**, **room hire**, **classes/sessions** operational running
- **Tournaments / brackets / Event OS**
- **Incident reporting & safeguarding review** (`SafeguardingPanel`)
- **Referees**, **trainers/PT** rotas, **display/reception-screen** deep config (beyond branding)
- **Notifications** and **feature-flag** toggling

Rule of thumb: the wizard covers *"the things a brand-new venue must set up once to become a real,
go-live-ready venue"*; everything you do *repeatedly to run* the venue lives in the console proper — and is
**available on both surfaces** (the web console, and the native `/hub` operator app, which already ships
`OperatorBookings/Payments/People/Tournaments/OperationsTonight`). The setup hub is a non-destructive
first-run overlay: it never gates or hides the Rail — the full toolset is usable before, during, and after
setup, on web and phone alike. The only two gated things are *going publicly live* (auto-flips on
completion) and *taking money* (Stripe KYC).

---

## KEY AUDIT FACTS

Load-bearing facts established during scope — do not re-derive.

- **Next free migration = 485** (highest on disk = `484_self_serve_create_venue`, APPLIED+MERGED PR #302).
  Re-confirm against `main` before numbering (first-come-on-main). W1 = 485 (read-shape), W3 = 486
  (`venue_update_details` + `venues.opening_hours` + `venues.setup_dismissed_steps` + setters), W5 = 487
  (auto-flip + enforcement). W2 (native skin) and W4 (Stripe) likely none.
- **The ONLY genuine new-backend gap is `venue_update_details`.** The `venues` table already has
  `name/slug/address/city/postcode/lat/lng/logo_url/primary_colour/secondary_colour/contact_email/
  contact_phone` (mig 055) but **no RPC writes any of them** — `venue_set_branding` writes
  `tournament_events`, `club_admin_set_branding` writes `clubs`, neither touches the `venues` row. Model
  the new RPC on `venue_update_booking_settings`'s partial-`jsonb`-update pattern (mig 150/183), SECDEF,
  `resolve_venue_caller` + `_venue_has_cap`, audited (HR#9).
- **Every OTHER area already has a venue-token write path — reuse verbatim:**
  | Area | Wrapper (`supabase.js`) | RPC | Migration |
  |---|---|---|---|
  | Pitches | `venueAddPitch` / `venueUpdatePitch` | `venue_add_pitch`, `venue_update_pitch` | **105** (gated `manage_facility`, mig 239) |
  | Bookable spaces | `venueCreateSpace` / `venueUpdateSpace` / `venueListSpaces` | `venue_create_space` | 338/345 |
  | Opening hours | `venueUpdateBookingSettings` (+ per-pitch `booking_windows`) | `venue_update_booking_settings` | 150/177/183 |
  | Leagues | `venueCreateSeason` / `venueCreateClubLeague` (+ PR2 join-by-code) | `venue_create_season`, `venue_create_club_league` | 399, 483 |
  | Staff / co-admins | `venueInviteAdmin` / `venueAddStaff` | `venue_invite_admin`, `venue_add_staff` | 237/238 |
  | Stripe Connect | `POST /api/stripe-connect` (`onboard`/`refresh`) + `venueGetBillingStatus` / `venueStripeDisconnect` | `set_venue_connect_state` (service_role cache), `venue_get_billing_status` | 329/330 |
  > NB the earlier "pitch-create may be a second gap" worry is **resolved** — `venue_add_pitch` exists.
- **Stripe Connect Express is FULLY BUILT and battle-tested (test keys).** `apps/inorout/api/stripe-connect.js`
  creates the Express account (`accounts.create type:'express'`) AND the onboarding URL
  (`accountLinks.create type:'account_onboarding'`), caches status, and `api/stripe-webhook.js` handles
  `account.updated` → `set_venue_connect_state`, so a venue that finishes KYC *after* redirecting away
  still gets its pill flipped async. `IntegrationsView.jsx` is a complete connect/disconnect/status UI.
  The Stripe step is **UI reuse, not a new money path.** Going *live* still needs the Phase-7 config flip
  (live `STRIPE_SECRET_KEY` + live Connect webhook `whsec_`).
- **⚠️ Two real Stripe wiring gaps for the hub (both in PR-W3):**
  (a) `api/stripe-connect.js` authorises via a **`service_role` client + `resolve_venue_caller` by venue
  token**, so `auth.uid()` is NULL and Stage-1b (the `venue_admins`-row path) never resolves — meaning it
  currently only works for the **shared master token**, which a self-serve owner deliberately never holds.
  The endpoint MUST be fixed to forward the owner's JWT (user-scoped client) so `auth.uid()` populates.
  Without this, self-serve Stripe onboarding cannot complete. (b) The Connect `return_url`/`refresh_url`
  land on IntegrationsView's `?connect=done|refresh`; they must be pointed back at the setup hub
  (`view=setup`) and account-links must be re-minted on `refresh` (Stripe account links expire in minutes
  and are single-use).
- **`verification_status` is a DORMANT no-op today, and not even exposed to the client.** Grep confirms it
  exists only in mig 484; nothing reads it as a gate. The public-listing RPC `search_bookable_venues`
  (mig 149) filters `bookings_enabled AND active` only — it does **not** read `verification_status`. And
  `venue_get_state` / `venue_whoami` do **not** return `verification_status` or `origin`. So the hub must
  first **expose** those fields (PR-W1, HR#12 same-commit mapper) before it can gate its own entry or show
  honest go-live progress, and PR-W4 must **build the enforcement** (add `verification_status='verified'`
  to `search_bookable_venues`) or the flag stays cosmetic.
- **Caller model — confirmed safe AND already cross-surface:** every wizard RPC resolves via
  `resolve_venue_caller` Stage-1b (the owner's JWT `auth.uid()` + their `venue_admins` row, mig 237). The
  self-serve owner holds exactly one `venue_admins(role='owner')` row and never the master token (PR3
  Decision #5). Crucially the **native `/hub` operator screens already use this exact path** — a mobile
  operator passes their `venue_id` as the credential and `venue_get_state` resolves Stage-1b with no caps
  needed for reads. So the same RPCs the web hub calls already work, unchanged, from the native app. **Any
  wizard action needing the shared master token is a design red flag.**
- **The native operator surface already exists — the hub slots into it, it is not net-new native app
  scaffolding.** `apps/inorout/src/mobile/` has a full `/hub` operator track:
  `OperationsTonight.jsx` (calls `venueGetState`), `OperatorBookings/Payments/People/Tournaments/More.jsx`,
  under its own `[data-surface="mobile"]` amber theme + `MobileShell`/`nav.js`. The setup hub adds one new
  `OperatorSetup` screen to that nav, rendering the shared-core registry. Route is `/hub` (App.jsx:108/1365),
  auth-gated (`SignIn returnTo="/hub"`).
- **Ship-safety — now TWO surfaces:** (a) `apps/venue` = plain web, no Apple review = CLEAR always, but
  **manual prebuilt-static, does NOT auto-deploy on push** (MEMORY `project_venue_deploy`) — a human runs
  the venue deploy. (b) `apps/inorout` `/hub` = reaches live App-Store users via the Capacitor web bundle
  = **CLEAR dark** provided it touches none of `index.html`/`api/manifest.js`/`capacitor.config.ts`/native
  plugins/the frozen submit redirect (the setup screen touches none — it's a React screen). BUT because it
  edits `apps/inorout/src`, this now triggers **two mandatory gates the web-only version didn't**:
  **casual-regression** (Phase 5+ rule) and a **Hard-Rule-13 real-iPhone native walk**. Shared logic lands
  in `packages/core` (`@platform/core`) — a dependency change → rebuild both apps.
- **Deep-link caveat:** the owner lands from native WKWebView (`app.in-or-out.com`) into `apps/venue` (a
  separate web domain) that does NOT share the localStorage session — v1 accepts **one email-OTP re-auth**
  (the account resolves to the venue via its `venue_admins` row). The hub's first load must tolerate
  "just re-authed, brand-new venue, nothing done yet" as a warm welcome, not a broken dashboard. Owner may
  also follow the link on a phone browser — hub is responsive-tolerant (stack the cards) + a "best on a
  computer" nudge, not a full mobile console rebuild.

---

## ROADMAP — PRs in dependency order

### ✅ PR #1 (W1) — SHIPPED (PR #306, mig 485) — Shared-core setup registry + progress logic + WEB console hub (+ expose `verification_status`/`origin`) — **tier-1 · CLEAR · effort M** 🚦(migration)
Goal: build the reusable spine + the first skin. In `packages/core` add a presentation-agnostic
`setup/setupRegistry.js` (the opener + steps + go-live: `{id,label,icon,required,gate,isComplete(state),
view,verticals,showIf(features)}`) + progress helpers (the two honest numbers, Decision #3) +
dismissal-aware "first incomplete step" selector + the **feature-tailoring filter** (`showIf` hides steps
the opener disabled — Decision #11). Then render the **web** skin: a `SetupHub` as `view === 'setup'` in
`apps/venue` `Dashboard.jsx`, opening on the **"what does your venue offer?" question** (writes
`venueSetVenueFeature`, reads `getVenueFeatureFlags` — both built), then a tailored card list each
reflecting `isComplete(state)` live and deep-linking (`onView(step.view)`) into the existing view; optional
extras (booking policy / memberships / equipment) are registry entries reusing existing editors, shown only
when their feature is on; Payments + Go-live render as locked/"coming up" tiles for now. Entry = auto-open
when the selected venue is `pending`/near-empty + a dismissible **"finish setting up your venue"** reminder
banner + a Rail entry (Decision #11). Small additive **migration 485**: add `verification_status` + `origin`
to the `venue_get_state`/`venue_whoami` returned venue object + same-commit inline mapper (HR#12) —
read-shape only. Web skin uses venue tokens + `<Icon>`.
- Gates: build (core + venue) · hygiene · 🚦 **migration-apply** (485, read-shape) · rpc-columns/security sweep on the modified read RPCs · Playwright (SSO hand-off / `?setup=1` lands in hub; adding a real space returns with that card ticked, progress advanced) · 🚦 **manual venue deploy** · 🚦 real-device-tolerant walk of the deep-link landing.
- 🚦 Gates: migration apply (485) · venue deploy.
- Done-check: a self-serve owner arriving via the hand-off sees the web setup hub, taps "Pitches," adds one in the real SpacesView, and returns with that step ticked and the go-live meter advanced — walked live.

### ✅ PR #2 (W2) — SHIPPED (PR #307) — NATIVE `/hub` OperatorSetup screen (second skin, same shared core) — **tier-1 · CLEAR-dark · effort M** 🚦(native)
Goal: the venue owner runs setup **from the phone too** (Decision #1). Add an `OperatorSetup` screen to the
native `/hub` operator nav (`apps/inorout/src/mobile/`), rendering the SAME `packages/core` registry +
progress logic from W1 — no new backend, no migration. Reuses the mobile operator auth (venue_id →
`venue_get_state` Stage-1b, already wired in `OperationsTonight`). Each card routes to its native operator
screen where one exists (`OperatorPeople` for staff, `OperatorBookings` etc.) or to a native mini-editor
(details/hours land in W3). Payments card shows status + the "finish on a computer" nudge (Decision #4).
Native amber `[data-surface="mobile"]` theme — **inorout hard rules apply here** (Decision #9).
- Gates: build (inorout) · hygiene (inorout rules — hook fires) · 🚦 **casual-regression MANDATORY** (touches `apps/inorout/src`; prove casual byte-identical) · lint (no-undef/rules-of-hooks) · Playwright (open `/hub` → Setup → cards reflect the same state the web hub shows) · 🚦 **Hard-Rule-13 real-iPhone native walk**.
- 🚦 Gates: real-device native walk. No backend/migration.
- Done-check: on a real iPhone, the owner opens `/hub` → Setup, sees the same steps/ticks as the web hub for the same venue, taps "Invite staff" → lands in `OperatorPeople`; casual flow proven unchanged.

### ✅ PR #3 (W3) — SHIPPED (PR #308, migs 486+487) — Details/branding + venue opening-hours + dismissal store (wired into BOTH skins) — **tier-1 · CLEAR (web) + CLEAR-dark (native) · effort M** 🚦(migration)
Goal: fill the real backend gaps + complete the editable steps on both surfaces. **Migration 486** adds:
(a) `venue_update_details(p_venue_token, p_updates jsonb)` SECDEF RPC (writes `venues`
name/address/contact/logo/colours; partial-jsonb; audited) + `venueUpdateDetails` wrapper + a details form
(web + native mini-editor); (b) `venues.opening_hours jsonb` + `venue_update_hours` setter + a weekly-hours
editor — **venue-level, independent of pitch hours** (Decision #6); (c) `venues.setup_dismissed_steps jsonb
DEFAULT '[]'` + an audited dismiss/undismiss setter so "Skip for now" persists (Decision #2). Harden
resumability (both skins resume at first incomplete, non-dismissed step) and **prove superadmin-venue
degrade** — an `origin='superadmin'`/`verified` venue shows satisfied steps done, go-live complete, zero
nagging (Decision #8). All three setters are shared wrappers used by both apps.
- Gates: build (core + venue + inorout) · hygiene (both rule-sets) · 🚦 **rpc-security-sweep** (3 new setters: SECDEF, search_path pinned, single overload, anon REVOKEd, `resolve_venue_caller`+cap, canonical audit insert) · 🚦 **ephemeral-verify** (owner updates own details/hours/dismissals; bystander cannot; leak-check 0) · 🚦 **migration-apply** (486) · 🚦 **casual-regression MANDATORY** · Playwright (web + native: edit details + set hours + skip a step → persist, both skins reflect it; a `verified` superadmin venue renders complete) · 🚦 venue deploy · 🚦 real-iPhone walk.
- 🚦 Gates: migration apply (486) · venue deploy · real-device walk.
- Done-check: an owner sets address + logo + weekly hours and skips "Leagues" on the phone; it persists and the web hub shows the same; a `verified` superadmin venue is shown complete with no nag — proven live on both surfaces. **MVP done = W1 + W2 + W3.**

### ✅ PR #4 (W4) — SHIPPED (PR #309) — Stripe Connect step (web onboarding + endpoint JWT fix + native nudge) — **tier-2 · PROTECTED (money-adjacent) · effort S–M** 🚦
Goal: the Payments card drives the **already-built** `/api/stripe-connect` `"onboard"` action and reflects
`billing.stripe.config.charges_enabled` as honest sub-status (never green until `charges_enabled`).
**Fixes the two Stripe wiring gaps (KEY AUDIT FACTS):** (a) rewrite the endpoint auth to forward the
owner's Supabase JWT (user-scoped client) so `auth.uid()` resolves Stage-1b for a token-less self-serve
owner — the hard blocker; add the inorout origin to CORS if needed; (b) point `return_url`/`refresh_url`
back at `view=setup` and re-mint account links on `refresh`. **Web does the real onboarding; native shows
status + the "finish on a computer" nudge** (Decision #4). Likely **no new migration** — confirm at audit
whether an owner-row Connect path needs new backend (if so, pulls a migration + sweep in).
- Gates: build · hygiene · 🚦 **stripe-best-practices review** · 🚦 **endpoint-auth security review** · rpc-security-sweep + ephemeral-verify **only if** a new owner-row Connect path lands · 🚦 migration-apply only if new backend · casual-regression (inorout touched) · Playwright (web: onboard → redirect → return lands on hub → status truthful, test keys; native: nudge shown, no redirect) · 🚦 venue + inorout-api deploy · 🚦 real-device walk.
- 🚦 Gates: stripe-best-practices review · endpoint-auth security review · venue + inorout-api deploy · real-device walk · (migration only if new backend).
- Done-check: a self-serve owner (venue_admins row only, no master token) starts Stripe onboarding from the web hub, completes Express test-mode onboarding, returns to the hub with Payments reflecting `charges_enabled` — authorised by JWT, not master token; native shows the nudge.

### ✅ PR #5 (W5) — SHIPPED+LIVE (PR #313, mig 488, squash `a008700`) — Go-live auto-flip + new-signup alert + public-listing enforcement — **tier-3 · PROTECTED · effort M 🚦 (LAST, riskiest)**
> *Shipped as: `venue_finalize_setup` (server-owned flip) + `search_bookable_venues` `verification_status='verified'` gate + `superadmin_list_venues` (new-signup alert) + `superadmin_set_venue_verification` (rejected takedown/restore). EV 8/8 + leak 0; QA + go-live-boundary RLS review SHIP-READY; prod-verified (0 casual regression). New-signup alert = the `superadmin_list_venues` surface reading the mig-484 `venue_self_serve_created` audit row (chose the read-surface over a new email/Telegram delivery system — that stays a future lever). Owed: real-iPhone `/hub` go-live walk.*
Goal: make going-live real and self-driving — no manual approval (Decision #5). Build three things:
(1) a `venue_finalize_setup(p_venue_token)` SECDEF RPC that **server-re-checks the required set** (details
present + ≥1 pitch/space) and only then flips `verification_status pending → verified`; the owner cannot
set `verified` arbitrarily — the server owns the predicate, so it is not a self-approval bypass. (2) a
**new-venue-signup alert** to the platform (fired at self-serve creation — reuse the `audit_events` row
`self_serve_create_venue` already writes; channel = the existing ops-notify path / nightly digest / a
Telegram-or-email ping — confirm channel at audit). (3) **enforcement**: add `verification_status='verified'`
to `search_bookable_venues` (mig 149) so a `pending` venue is genuinely not publicly listed until it goes
live. Keep a superadmin `rejected` **takedown** override (`is_platform_admin()`-gated) for post-hoc
removal. The hub's go-live tile turns green when the RPC's objective check passes; a hand-crafted flip that
skips the preconditions is rejected. **Migration 487** (finalize RPC + search filter + rejected-override +
`_down.sql`, HR#11).
- Gates: SQL drafted → 🚦 **migration-apply sign-off** → 🚦 **rpc-security-sweep** (SECDEF, search_path pinned, server-side precondition re-check, anon REVOKEd, canonical audit insert) → 🚦 **ephemeral-verify** (an owner with an INCOMPLETE required set is refused the flip; a complete one succeeds; a bystander cannot flip another venue; a `pending` venue is absent from `search_bookable_venues` until flipped; the rejected-override is `is_platform_admin()`-only; leak-check 0) → 🚦 **RLS / go-live-boundary review** (confirm the auto-flip predicate can't be gamed + the alert fires) → build · hygiene · 🚦 venue + superadmin deploy.
- 🚦 Gates: migration apply (487) · go-live-boundary RLS review · venue + superadmin deploy. *(No manual-approval gate — the flip is objective + monitored by the alert.)*
- Done-check: a self-serve owner who completes details + adds a pitch sees their venue auto-go-live (appears in public search, tile green) and the platform receives a new-signup alert; an owner with an incomplete set is refused; a `pending` venue is invisible to public search until it flips — proven against live DB with rollback, then re-proven post-apply.

---

## 🚦 GATES the loop must stop at

- **Every migration apply** — 485 (read-shape, W1) · 486 (details + hours + dismissal setters, W3) · 487
  (flip + enforcement, W5). SQL drafted + ephemeral-verified, then a human applies. Never auto-apply.
- **W5 tier-3 gate:** migration apply · go-live-boundary RLS review (the auto-flip predicate is
  server-owned and can't be gamed; a hand-crafted flip skipping the required set is refused; the
  new-signup alert fires). No manual-approval gate — go-live is objective + monitored (Decision #5).
- **Native surface (W2 onward): casual-regression MANDATORY + a Hard-Rule-13 real-iPhone walk** on every
  PR touching `apps/inorout/src` — the `/hub` setup screen ships to live App-Store users via the Capacitor
  bundle (CLEAR-dark, but the native gates apply).
- **Stripe (W4):** stripe-best-practices review + endpoint-auth security review; the endpoint JWT-auth
  fix is a hard blocker for self-serve onboarding. Going *live* still needs the Phase-7 Stripe config flip.
- **Manual venue deploy on every web PR** — `apps/venue` is prebuilt-static, does not auto-deploy; the
  merge does not put the web hub live. (The native `/hub` skin ships via the inorout Capacitor bundle.)
- **Safeguarding (only if the league step enrols U18s):** inherits the parent epic's PR5 compliance stack
  (attestation / welfare officer / DOB-consent / DPIA). v1 default limits leagues to adult/open comps to
  avoid it.
- **Real-device-tolerant walk of the deep-link landing** on the PRs that touch the hand-off / redirect
  path (W1, W4) — WKWebView vs venue-domain session (one OTP re-auth accepted).

## DONE =

A self-serve (or superadmin-created) venue owner can run their setup from **both the web console and the
native `/hub` app**, seeing the SAME resumable hub (one shared `@platform/core` registry, two skins) with
honest go-live progress, and can — reusing the already-built views/screens — set venue details/branding,
add pitches & bookable spaces, set venue opening hours, create/join (adult) leagues, invite co-admins, and
connect Stripe Express for payouts (web onboarding + native nudge), each step ticking itself from real
venue state, surviving reloads and the Stripe redirect, degrading gracefully for a partially-configured
superadmin venue, and wired so that **completing the required set auto-flips the venue publicly live
(server-checked, not a self-approval button) while the platform is notified by a new-signup alert** — every
write audited, casual flow proven byte-identical, walked on a real iPhone AND the live web console.
**MVP done = W1 + W2 + W3** (the shared hub live on both surfaces, with the details/hours/dismissal
editors); Stripe (W4) and the go-live auto-flip + alert (W5) layer on behind their gates.

## MISSED / OPPORTUNITY / FUTURE-PROOF / WOW

- **MISSED — the abandoned-trial lifecycle and the single-owner orphan.** Every lens designed the forward
  setup; none designed what happens to a `pending` venue whose owner *never finishes*. Two concrete gaps
  sit between the lenses: (1) an abandoned trial shell lingers forever and counts against the mig-484
  **3-pending-venues-per-user cap** — after three abandoned attempts the user can't create a fourth; the
  hub should surface "delete this draft venue" (a reverse path, echoing the parent epic's own MISSED note)
  and/or an expiry sweep for never-configured trials. (2) The ownership model grants exactly **one** owner
  — a single-owner venue with no co-admin is a single point of failure (lose the account, orphan the
  venue). The staff step must **strongly surface the co-admin invite** (existing `venue_admins` invite),
  not bury it as optional. Add a draft-delete/reverse path and elevate the co-admin nudge — cheap, and
  both are latent support tickets otherwise. A stalled-setup email nudge ("finish setting up {venue}") is a
  further cheap retention lever.
- **OPPORTUNITY — this hub is the substrate for club & gym self-serve (parent epic PR5/PR6), and the
  WHOLE principle carries over unchanged.** Clubs and gyms are also `venue_admins`-owned entities, land the
  operator in the *same* console + `/hub`, and use the *same* editable feature-flag model (`club_features`,
  mig 399). So everything decided here applies to them 1:1: an opener ("what does your **club** offer?"),
  feature-tailored + reversible optional steps, derived honest progress, the skip→reminder, the post-go-live
  "add more" prompt, and both surfaces. Built generic now — steps tagged `verticals: ['venue'|'club'|'gym']`
  reading each vertical's flags — those two verticals become **config rows + their own step set**, not a
  rebuilt wizard. **The one real difference is content, not mechanism:** club/gym add the compliance-gated
  steps venues avoid in v1 (safeguarding attestation, DPA, DOB-consent for minors — the parent epic's PR5
  block), which slot into the same registry as steps with a `gate` tag. Two-to-three epics collapse into one
  hub. Commercially it's the "sign up and be taking bookings in minutes" sales-demo the STRATEGY.md
  self-serve wedge wants — the shell ships now without opening the compliance surface.
- **FUTURE-PROOF — the config-driven setup-step registry (Decision #7).** Of every choice here, this is
  the single highest-leverage / least-cost-now lever: one data structure
  (`{ id, label, icon, required, gate, isComplete(state), view, verticals[] }`) read by the hub cards, the
  progress meter, the go-live gate, and the per-vertical step filter. It generalises the console's own
  config-driven Rail (`navItemVisible`) and the parent epic's Vertical Registry rather than inventing
  anything, and makes the next vertical (a yoga/dance studio already in the `discipline` list) a data edit.
  Build it in PR-W1 while the surface is one vertical and small.
- **WOW — per audience.** *Self-serve indie owner:* the payoff of the go-live gate is a **"your public
  booking page is live" reveal** — the instant the required set clears, surface the real public venue URL
  with a copy-link / QR / "view your live page" action. It's the operator equivalent of Stripe's "you're
  live" and the single highest-dopamine moment; design the whole hub to build toward it. Pair it with a
  persistent **"Preview public page"** button that renders the customer-facing page from current draft
  state at every step (branding/spaces changes visible immediately). *Superadmin-onboarded operator:* the
  quiet wow is **respect** — the hub reads their existing config, shows them 5/6 done and a 30-second
  finish, and never nags; software that doesn't make them redo work they can see is already done.
  *Platform / sales:* the whole flow *is* the 60-second-signup demo. Cheapest net-new wow = the "view your
  live page" reveal when go-live criticals clear (the public page already renders — just land the hub on
  it).

---

## Related

- `SELF_SERVE_MULTI_VERTICAL_HANDOFF.md` — the parent epic; PR4 is this wizard's entry point (Decisions
  #6/#7/#10, KEY AUDIT FACTS on the venue_admins owner row + SSO hand-off). PR5/PR6 (club/gym) reuse this
  hub via the registry.
- `STRIPE_FULL_BUILD_HANDOFF.md` — the Connect Express stack the Payments step reuses; Phase 7 (live keys +
  live Connect webhook) is the remaining go-live config flip.
- `MODULAR_PLATFORM_HANDOFF.md` — the `club_features` flag registry the step registry composes with.
- `CLIENT_ONBOARDING_IMPORT_HANDOFF.md` — the superadmin-side sibling that shares the same create/owner
  RPCs (OPPORTUNITY).
- Key files: `apps/venue/src/views/Dashboard.jsx` (view switch + Rail), `SeasonWizard.jsx` (mini-wizard
  precedent), `IntegrationsView.jsx` (Stripe connect UI + `?connect=` return), `SpacesView.jsx` /
  `StaffView.jsx` / `AccessView.jsx` / `LeagueView.jsx` / `DisplaySettings.jsx` (reused steps),
  `Modal.jsx` / `atoms.jsx` / `PageKit.jsx` / `Icon.jsx` / `styles.css` (design system),
  `apps/inorout/api/stripe-connect.js` (endpoint-auth fix), `packages/core/storage/supabase.js` (wrappers).
- MEMORY: `project_self_serve_multi_vertical`, `project_venue_deploy`, `project_stripe_full_build`,
  `reference_native_app_only_no_pwa`.
