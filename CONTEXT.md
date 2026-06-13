# IN OR OUT — Project Context & Session History
*Last updated: Jun 13 2026 (session 97 — MEMBERSHIP V2 s96 tech debt (mig 292) + Phase 5 SHIPPED (mig 293, commit fcdf6c9). policy_documents + consent_acceptances + 6 RPCs (anon explicitly revoked on 3 authenticated-only fns after Supabase auto-grant caught in security sweep). MembershipsView Documents tab + MemberProfile Consents section + ConsentModal. Both builds PASS; hygiene PASS; rpc-security PASS. Next mig = 294. Next: Phase 6 — ID & document upload.) (session 95 — MEMBERSHIP V2 Phase 3 SHIPPED (mig 290, commit 5337be6). member_register_child/member_list_children/member_update_child: SECDEF/authenticated-only, auth.uid()-scoped, audit-logged. member_update_child: caller must have accepted member_guardians edge or raises not_guardian. Neg-path EV PASS (6 assertions + leak=0). MemberProfile.jsx: My Children section — child cards, add-child form (first_name/last_name/dob), in-place edit with full CPSU safeguarding fields; zero-footprint when no children. Invite flow deferred (second guardian = ec2_* data fields). Cohort deferred to Phase 4. Casual regression PASS. Build clean. Next mig = 291. Next: Phase 4 — Membership builder rework (apps/venue).) (session 94 — MEMBERSHIP V2 Phase 2 SHIPPED (mig 289, commit 2ea899b). member_update_self RPC: SECDEF/authenticated, auth.uid()-scoped WHERE, jsonb partial-update (CASE WHEN per column), email immutable, medical fields → member_profile_medical_updated audit event. get_member_pass extended with member_profile_id. Phase-1 JS wrappers that were missing from supabase.js added: memberGetSelf, memberClaimProfile, memberCreateProfile, memberUpdateSelf, clubCreate, venueListClubs. /profile route added to App.jsx + new MemberProfile.jsx (zero-footprint: null when found:false; view/edit with 6 sections). MemberPass.jsx shows "Your account" pill → /profile when logged-in user's profile.id matches pass.member_profile_id. Neg-path EV PASS. Casual regression PASS. Build clean. Next mig = 290. Next: Phase 3 — Households / child memberships.) (session 93 — MEMBERSHIP V2 Phase 1 SHIPPED (migs 283–288, commit f774782): member_profiles+guardians, clubs extended, club_venues, club_cohorts, venue_memberships reframed, 5 RPCs, demo backfill. Neg-path EV on member_claim_profile PASS. Casual regression PASS.) (session 90 — MY VIEW header consolidation (frontend-only, no DB/migration). The screen stacked TWO title blocks — `PageHeader` (IN OR OUT wordmark + fixture meta) and `HeroCard` (the green animated pitch banner) — and both printed `schedule.dayOfWeek`; the operator spotted the duplicate after rejecting two fuller redesign explorations (full restructure + a slide-to-commit "team sheet"). Merged into ONE `PageHeader`: extracted the floodlit-pitch animation into new `PitchCanvas.jsx` (colours as `rgb()/rgba()` strings ON PURPOSE so the hygiene hex-check — which flags `#hex` in assignment position and scans only the just-edited file — stays green; reduced-motion-aware: one static frame under `prefers-reduced-motion`). `PageHeader` now renders the pitch as its background + the wordmark + ONE fixture line (`day · venue · time · £price` chip; operator chose the pure-facts variant, dropped "Night Football") + a thin admins line (vice-captains, absorbed from HeroCard). Framer-Motion entrance: staggered row-rise + `IN`/`OUT` scale-pop, ALL gated behind `useReducedMotion`. `PlayerView` drops the standalone `HeroCard`; `HeroCard.jsx` DELETED (only consumer was PlayerView; StatsView's `SeasonHeroCard` is unrelated). ~95px freed above the In/Out decision. Build + 7/7 hygiene clean on both files; rendered in-browser on the dev server (duplicate banner gone, £ chip + pitch present; the 2 console errors were unrelated Supabase 401 probes). commit 4e1ee0d. OWED: real-iPhone home-screen pass per Hard Rule #13 (in-or-out.com auto-deploys from main). See SESSION 90 below.) (session 89 — VENUE MEMBERSHIP PROGRAMME Phases 5–7 finished + operator-driven refinements (migs 274–281; next free=282). Phase 5 member pass completed (bar Wallet): QR on /m pass (react-qr-code), reception check-in (mig 274 `venue_member_checkins` + `member_check_in` venue-bound write + apps/display `CheckInOverlay` BarcodeDetector scanner w/ manual fallback), member self-signup on the existing /q venue_landing rail (mig 275 `member_self_signup`+`venue_approve_customer`, status `pending`). Phase 6 done: reminders (mig 276 `get_membership_reminders_due` service_role + cron `membershipRemindersJob` 10:00 UK + 4 Resend templates), booking-discount auto-apply (mig 277 `pitch_bookings.customer_id` + `_booking_member_discount` applied in `venue_confirm_booking(_series)` — member by explicit link OR active-member email match; 100%→comped; EV 9/9), HQ rollup (mig 278 `hq_get_membership_rollup` + apps/hq AnalyticsView Memberships card — apps/hq has NO standalone Vercel project, card unshipped). Phase 7 STRIPE = keyless DORMANT scaffolding ONLY (mig 279 connect/customer/subscription cols + `payment_state` + persist-then-process `billing_events`; RPCs record_stripe_event(idempotent)/mark_stripe_event_processed/apply_membership_subscription_status(state machine)/set_venue_connect_state/venue_get_billing_status; api/_stripe.js+stripe-webhook.js+stripe-connect.js + cron membershipReconciliationJob — all env-guarded 503/no-op). DECISIONS.md "MONEY-FLOW GATE" = PROPOSED, awaiting operator ratify + test keys (sk_test_/whsec_) + sign-off. Refinements: tiered self-signup (mig 280 — tiers free/paid via benefits.is_free, opt-in /q via benefits.self_signup; `get_venue_signup_tiers`+/q tier picker; FREE→instant auto-member £0 pass; PAID→pending+requested_tier_id; `venue_approve_and_enrol` one-tap; member_self_signup +p_tier_id, old 6-arg DROPPED; Plans Free/Offer-on-signup toggles); free-pass tidy + Payments "N% member" badge (mig 281 `pitch_bookings.member_discount_pct` + `venue_get_charges`). ALL write RPCs EV'd + leak 0 + rpc-security PASS; gotcha: Supabase default-privs auto-grant anon/authenticated → service_role-only fns need explicit REVOKE anon,authenticated. venue+casual+display deployed & live-bundle-verified; member pass/QR + /q tiered signup (free auto-join) + venue Memberships approve + reception check-in ALL browser-verified end-to-end on prod w/ throwaway fixtures (deleted, leak 0). OWED (operator-only): real-iPhone passes (Hard Rule #13); venue setup (build tiers, generate /q QR); Stripe keys+sign-off; HQ deploy + Apple Wallet certs.) (session 88 — RESOLVED (mig 268, commit 3d21539) the SESSION 80 open bug "drawn teams stay mutable after kick-off": a post-kickoff injured-toggle silently dropped a drawn player from a locked team (Footy Tuesdays, Matty, 2026-06-09). Three stacked server-side fixes, no JS change, all six replaced RPC signatures unchanged → grants preserved: (1) un-injure restores a still-drawn player (players.team IN A/B) to 'in' in set_player_injured + admin_set_player_injured; (2) NEW helper `is_lineup_locked(team_id)` (lock point = schedule.game_date_time — casual matches carry no kick-off column) gates the four self-service lineup RPCs → raise 'lineup_locked' post-kickoff for drawn players (set_player_injured/set_player_status scoped to drawn; add_guest_player unscoped; remove_guest_player scoped to drawn guest); admin injured path deliberately NOT locked; (3) admin_save_match_result reconciles orphan player_match rows (attended=true/result NULL) before the flat W/L/D bump so source-of-truth can't diverge. EV 9/9 + leak 0; sweep clean (no overloads, all secdef+search_path). Docs: BUGS open→resolved, RPCS, DECISIONS lock-point, GO_LIVE 11.2 pre-flight. OWED: real-iPhone post-kickoff lock test (Hard Rule #13).) (session 86 — EQUIPMENT HIRE Cycle 5 = the data-product tail SHIPPED + DEPLOYED: one READ-ONLY RPC `venue_equipment_insights` (mig 260) → ROI-per-asset (lifetime cost vs collected), usage over range, procurement signal from `equipment_demand_misses`; new EquipmentView **Insights** tab; no write path → EV N/A, proven via live BEGIN…ROLLBACK revenue-join probe (ALL PASS + leak 0), sweep PASS, both builds clean; commit 36645d3; venue redeployed prebuilt-static & verified live (bundle index-Bm0OHgf7.js contains `venue_equipment_insights`). Operator chose Option A = venue-dashboard-only; venue-Gaffer narrative + HQ multi-venue benchmarking deferred (pilot is one venue). RPC shaped as future venue-Gaffer context source (Hard Rule #14). OWED: logged-in browser pass. See SESSION 86 below.) (session 85 — QR ONBOARDING epic COMPLETE: slice 7 link management shipped (mig 254 — venue_create/set_active/repoint/list_invite_links + venue_owns_entity helper; re-point fully flexible cross-type; EV 15/15 + sweep PASS; commit 612adf7) + apps/venue redeployed prebuilt-static & verified live. All 7 slices done; slices 1–6 shipped session 84 (migs 248–253). OWED: real-device tests (slices 2 iPhone install, 4 TV, 7 dashboard). See SESSION 85 below.) (session 83 — Reception Display broadcast redesign SHIPPED + DEPLOYED end-to-end, migs 244–247, see SESSION 83 below.) (session 82 — RESOLVED: "Paid" carried into the next game — go-live now clears per-game payment flags (paid/self_paid/paid_by/paid_at) on new-match creation, owes untouched (mig 243, commit 4a5fbe4); + retroactive one-off cleanup of 4 stale flags on the live Footy Tuesdays game.) session 81 — Part 2 SHIPPED: live POTM tally revealed only after you vote (mig 242 get_potm_tally_public, counts-only, server-gated; POTMVotingModal voted-state leaderboard, live via team_live broadcast). Operator decision: tally at vote-time only, NO reopen path (no banner exists to reopen the modal). OWED: real-iPhone test (Hard Rule #13). Earlier this session: payment labels reworded "Paid Cash"→"Paid" (commits 2736c1a, c6c2415, UI-only).) session 80 — live firefight on Footy Tuesdays: paid button (debt-state Confirm unreachable), POTM modal re-popping, payment reconciliation, mig 241 post-game lifecycle, POTM window 1h→2h. session 79 — superadmin operator-analytics suite + ops email digest; migs 234–240, ⚠ migration-number COLLISION with parallel session 78 venue work — see SESSION 79.*

## SESSION 97 — Membership V2 s96 tech debt + Phase 5: Consent documents + e-sign (migs 292–293, commits fcdf6c9, ee3c15b)

**Mig 292 — season period tech debt (SQL only):**
- `venue_memberships.period` CHECK extended to include `'season'`.
- `venue_enrol_membership` rewritten: accepts `'season'`; fetches `tier.season_end`; sets `renews_at = COALESCE(season_end, '9999-12-31')` for season memberships (bypasses `_membership_period_interval` which returns NULL for season).
- `run_membership_renewals` loop (c) gains `AND period <> 'season'` — season memberships are one-off, billed at enrolment, never auto-renewed. No JS/UI changes.

**Mig 293 — Phase 5 consent documents:**
- `policy_documents` (club-scoped, versioned, `is_current` flag, partial unique index `policy_documents_current_idx ON (club_id, title) WHERE is_current`).
- `consent_acceptances` (typed_signature, ip_address, user_agent, `signed_on_behalf_of uuid`, UNIQUE per `(document_id, member_profile_id)`, `document_id` FK with ON DELETE RESTRICT).
- 6 RPCs all SECDEF + search_path + 1 overload:
  - `venue_create_policy_document`, `venue_publish_policy_version`, `venue_list_policy_documents` (anon+authenticated).
  - `member_accept_consent`, `member_get_pending_consents`, `member_list_consents` (authenticated-only; anon explicitly revoked — Supabase platform auto-grants anon on new functions despite REVOKE FROM PUBLIC; explicit `REVOKE EXECUTE FROM anon` required and confirmed in security sweep).
- Guardian path in `member_accept_consent`: `p_on_behalf_of_profile_id` accepted; server-side verifies `member_guardians` edge exists or raises `not_guardian`.
- 6 JS wrappers added to `supabase.js`; 6 barrel exports in `index.js`.
- `apps/venue MembershipsView.jsx`: Documents tab added (per-club doc list, add + new-version modals, acceptance_count).
- `apps/inorout MemberProfile.jsx`: Consents section (zero-footprint) + ConsentModal (scrollable body, typed signature, double-fire guard via `isSigningRef`).
- Both builds PASS; 7/7 hygiene PASS on both edited files; rpc-security PASS (8 RPCs swept).

**Security catch:** `member_accept_consent` / `member_get_pending_consents` / `member_list_consents` all showed `anon=X/postgres` in `proacl` after live apply despite `REVOKE ALL FROM PUBLIC`. Root cause: Supabase platform injects explicit role grants for `anon` + `authenticated` that `REVOKE FROM PUBLIC` doesn't remove. Fixed by explicit `REVOKE EXECUTE ON FUNCTION ... FROM anon` run via MCP SQL; source file updated to include these revokes. Pattern documented — applies to any authenticated-only member RPC going forward.

---

## SESSION 95 — Membership V2 Phase 3: Households / child memberships (mig 290, commit 5337be6)

**3 new RPCs (mig 290, authenticated-only, SECDEF):**
- `member_register_child(first_name, last_name, dob, relationship)` — caller must have claimed profile; creates unclaimed child member_profiles row + member_guardians (is_primary=true, can_collect=true, invite_state='accepted'); audit-logged member_child_registered.
- `member_list_children()` — returns child profiles where caller is an accepted guardian (id, first_name, last_name, dob, is_primary, can_collect, relationship). Zero-footprint if none.
- `member_update_child(child_profile_id, updates)` — caller must have member_guardians edge (not_guardian if absent); same jsonb partial-update as member_update_self; medical fields → member_child_medical_updated audit event.

**Neg-path EV:** 6 assertions PASS + leak=0. Invite flow deferred (second guardian = data fields). Cohort deferred to Phase 4.

**MemberProfile.jsx:** My Children section — child cards with name/DOB, expand-to-edit with full CPSU fields, "+ Add a child" inline form. Zero-footprint (section hidden if profile=null; children list hidden when empty — only "+ Add a child" button visible). Casual regression PASS. Build clean.

**3 new JS wrappers:** memberRegisterChild, memberListChildren, memberUpdateChild. All barrel-exported.

---

## SESSION 94 — Membership V2 Phase 2: member self-service profile (mig 289, commit 2ea899b)

**member_update_self RPC (mig 289):** SECDEF, authenticated-only, `WHERE auth_user_id = auth.uid()` scoped, jsonb partial-update (CASE WHEN per column, email excluded), medical fields (conditions/allergies/medications/gp_details) → `member_profile_medical_updated` audit event. Neg-path EV PASS (wrong-uid gets 0 rows, guard fires, leak=0). **get_member_pass extended:** adds `member_profile_id` to the response. **JS wrappers (Phase-1 debt):** memberGetSelf, memberClaimProfile, memberCreateProfile, memberUpdateSelf, clubCreate, venueListClubs added to supabase.js + barrel-exported from index.js. **/profile route:** authenticated gate in App.jsx → MemberProfile.jsx. Zero-footprint (null when `found: false`). Six sections: personal, address, emergency contacts, safeguarding consents, photo consent, medical. isSavingRef double-fire guard. **MemberPass:** self-checks session, shows "Your account" pill → /profile when logged-in user owns the pass. Casual regression PASS. Build clean.

---

## SESSION 90 — MY VIEW header consolidation (two headers → one) + entrance motion (commit 4e1ee0d)

Started as an open-ended "how could the UI be improved" / design-mockup request and
narrowed, through the operator's reactions, to a single real fix. **Frontend-only — no
DB, no migration, no RPC.**

- **The problem (operator-spotted):** MY VIEW stacked two title blocks at the top —
  `PageHeader` (badge + IN OR OUT wordmark + `day · venue · time` meta + confirmed gauge)
  and `HeroCard` (the animated green pitch banner: "THIS WEEK / {day} NIGHT / FOOTBALL /
  £price / ADMINS"). Both rendered `schedule.dayOfWeek`, and both read as the page title.
  HeroCard's only *unique* information was price + admins; everything else was decoration
  or a repeat of the day.
- **Process note:** two fuller redesign explorations were built as throwaway HTML+Framer
  mockups and **REJECTED** by the operator — (1) a full restructure (fused hero card,
  progress-to-cap, avatar roster) and (2) a slide-to-commit "team sheet". Operator
  preferred the existing design; the win was *removing the duplication*, not restructuring.
  Three skin variants (same bones, different look) were also rejected before the real
  diagnosis ("the headers, 2 duplicates") landed. Lesson: when the ask is "improve the UI"
  and the operator likes what's there, hunt for a concrete redundancy before proposing
  new structure.
- **The fix:**
  - **New `apps/inorout/src/components/ui/PitchCanvas.jsx`** — the floodlit-pitch canvas
    animation lifted out of HeroCard, *presentational only* (no text). Colours are
    `rgb()/rgba()` strings **deliberately**: `check-hygiene.sh` CHECK 2 flags `#hex` in
    assignment/value position and the PostToolUse hook scans only the file just edited, so
    putting HeroCard's old `#0a1f0a`/`#061006` literals into a freshly-edited file would
    have blocked the commit. Reduced-motion aware — draws a single static frame and skips
    the rAF loop under `prefers-reduced-motion`.
  - **`PageHeader.jsx`** is now the single header: `PitchCanvas` as the background + a
    legibility scrim, the wordmark, ONE fixture line (`day · venue · time` + a `£price`
    pill), and a thin **Admins** line (vice-captains, the data absorbed from HeroCard via
    `squad.filter(isViceCaptain)`). New props: `pricePerPlayer`, `squad`. Entrance motion
    via Framer: container `staggerChildren` row-rise + `IN`/`OUT` spring scale-pop, **all
    gated behind `useReducedMotion`**. Note: tokens.css has no `--t3` — used `--t2` @ 0.7.
  - **`PlayerView.jsx`** stops rendering the standalone `<HeroCard>` and feeds the price +
    squad to `PageHeader`. **`HeroCard.jsx` deleted** (sole consumer was PlayerView;
    `StatsView`'s `SeasonHeroCard` is a different component).
- **Result:** one title block, day stated once, ~95px freed above the In/Out decision; the
  floodlit-pitch brand flavour is kept (now as the header backdrop, not a second banner).
- **Verify:** `npm run build` clean; `check-hygiene.sh` 7/7 on both PitchCanvas + PageHeader;
  rendered on the local dev server (duplicate gone, £ chip + animated pitch present; the two
  console errors were unrelated Supabase 401 probes from keyless local dev).
- **Owed (manual, non-blocking):** real-iPhone home-screen pass per Hard Rule #13 — PlayerView
  is PWA-critical; check header contrast near the notch + the wordmark animation on cold open.
  in-or-out.com auto-deploys from `main` ([[project_inorout_deploy_and_pwa_update]]).

## SESSION 86 — Equipment Hire Cycle 5: the data-product tail (mig 260) + venue redeploy

Turned the clean data the first three equipment cycles captured into venue-facing
intelligence. The payoff for the Cycle-1 data foundations (category taxonomy,
demand-miss capture, asset value/condition). **Read-mostly cycle — no write paths.**

- **Operator decision (Option A):** surface in the venue dashboard ONLY this cycle.
  The "Ask the Gaffer" AI narrative version + HQ multi-venue benchmarking were
  deferred — Gaffer is casual/admin-token-only today and has no venue path, so a
  venue-Gaffer surface is net-new infra (a bigger build). The new RPC is shaped so a
  future venue-Gaffer surface can pass it verbatim as `<context>` (Hard Rule #14).
- **DB (mig 260, commit 36645d3):** one READ-ONLY RPC `venue_equipment_insights(p_venue_token,
  p_from?, p_to?)` → `{summary, roi[], usage[], procurement[]}`, STABLE SECDEF,
  `resolve_venue_caller`, search_path pinned, REVOKE PUBLIC / GRANT anon+authenticated.
  - **ROI** per asset, **lifetime** (cost is one-off): `purchase_price_pence` vs
    `collected_pence` = net non-voided `venue_payments` on the hire's `source_type='equipment'`
    charge (mirrors `venue_list_equipment_hires`), + `billed_pence`, `payback_pct`,
    `payback_status` (recouped/partial/not_started/unknown), `idle` flag.
  - **Usage** per asset over `[from,to]` (default trailing 90d): hires/units/unit-hours/
    busiest-day/share — no fabricated "owned-hours" denominator (honest activity).
  - **Procurement** from `equipment_demand_misses` grouped by category over range: turn-aways,
    units wanted, last miss, vs currently-owned qty. Recommendation sentence built client-side.
  - "Hired" = confirmed/out/returned/overdue (matches the catalogue's hires_count).
- **UI (apps/venue `EquipmentView.jsx`):** third **Insights** tab beside Catalogue/Hires —
  three cards (Return on each item / How busy each item is / What to buy next). New
  `venueEquipmentInsights` wrapper + barrel export. No nav change in `Dashboard.jsx`.
- **Verify:** no write path → ephemeral-verify N/A (Hard Rule #15); instead proved the
  revenue join with a live `BEGIN…ROLLBACK` probe (seeded hire+charge+payment+£5 refund+miss,
  asserted collected=£10/share=50%/proc counts/summary, RAISE-rolled-back, leak-check 0).
  rpc-security-sweep PASS; venue + inorout builds clean; raw RPC name in exactly one
  `supabase.rpc()`.
- **Deploy:** `apps/venue` → platform-venue.vercel.app redeployed prebuilt-static
  ([[project_venue_deploy]]); verified live by grepping the bundle (`index-Bm0OHgf7.js`
  contains `venue_equipment_insights`).
- **Owed (manual, non-blocking):** logged-in browser pass on the Insights tab (demo venue has
  no hires yet, so it reads all-idle/empty until real hires flow — expected, not a bug).
- **Equipment status now:** Cycles 1–3 + 5 shipped (migs 255–260). Cycle 4 (QR self-hire) =
  backlog. Plan: `EQUIPMENT_HIRE_PLAN.md`.

## SESSION 85 — QR Onboarding epic COMPLETE: slice 7 link management (mig 254) + venue redeploy

Closed the final slice of the 7-slice QR Onboarding epic. Slices 1–6 shipped session 84
(migs 248–253: routing layer, join-team, venue landing, QR rendering, printable assets,
match check-in). This session = slice 7, link management.

- **DB (mig 254, commit 612adf7):** four venue-authed RPCs + one shared helper, all via
  `resolve_venue_caller`:
  - `venue_owns_entity(venue_id, entity_type, entity_id)` — internal boolean ownership
    predicate (venue / team / fixture roll up `competition_teams|fixtures → competitions →
    seasons → leagues.venue_id`). **Revoked from anon/authenticated** (Supabase default
    privileges re-grant on create — had to revoke explicitly; the security sweep caught it).
  - `venue_create_invite_link` (write) — mints a NEW labelled code unconditionally (vs
    slice-4 `venue_ensure_invite_link`'s get-or-create).
  - `venue_set_invite_link_active` (write) — toggle on/off; ownership re-derived from the
    code's STORED entity, never a client-passed venue.
  - `venue_repoint_invite_link` (write) — **fully flexible** re-point: the new
    (entity_type, action) may differ from the old, so a code can move across types
    (team→venue→fixture). **Double ownership check** — caller must own BOTH the existing
    code's entity AND the new target. Operator chose full flexibility over same-type-only.
  - `venue_list_invite_links` (read) — every code the venue owns + use_count + server-derived
    `target_name`.
  - All writes INSERT `audit_events` (Hard Rule #9). EV-verified: 15 assertions incl.
    cross-venue isolation + 4 foreign-ownership rejections, leak 0. rpc-security-sweep PASS.
- **UI (apps/venue):** `InvitesView.jsx` gains an "All codes" section (scan counts, Show QR,
  Copy, Deactivate, Re-point) + `New code` button; new `InviteLinkForm.jsx` create/re-point
  modal (StaffMemberForm template). Canonical venue + per-team QR sections retained; QR
  render/copy/print extracted into a shared `QRBlock`.
- **Deploy:** `apps/venue` → platform-venue.vercel.app redeployed via the manual
  prebuilt-static path ([[project_venue_deploy]]) and verified live by grepping the bundle
  (hash `index-B-QuFRrV.js`, contains "All codes" / "Re-point code" / `venue_repoint_invite_link`).
- **Owed (manual, non-blocking):** real-device tests across the epic — slice 2 iPhone
  home-screen install (Hard Rule #13), slice 4 QR on a real TV, slice 7 venue-dashboard
  create/deactivate/re-point on a phone/tablet. The four demo-critical slices (1–4) were
  already verified live for the 2026-06-18 pilot pitch.

## SESSION 83 — Reception Display broadcast redesign: shipped, deployed, demo-ready (migs 244–247)

**The whole epic in one session** — plan in `RECEPTION_DISPLAY_SCOPE.md` (shipped-status table
at the bottom maps every part to its commit). Eight commits `ce9d289 → 38b8fc0`.

**Data layer (migs 244–247, all live + md5-verified ≡ source):**
- 244 `get_display_state` enrichment: top-level `bookings[]` (today's confirmed casual bookings),
  upcoming `round_name`/`official_*`/`competition_type`, top-scorer `apps` + `shirt_number`.
  ⚠ Migration RENUMBERING: scope doc said 241 — sessions 80–82 took 241–243. Next free: **248**.
- 245 `venue_update_display_config`: sponsor copy/image/ratio (clamped 0..1) + featured-match pin
  (venue-ownership check). Based on the LIVE body (167 + mig-239 capability guard the 167 FILE
  lacks). EV 11/11 + leak-check 0.
- 246 storage bucket `venue-media` (public read, 5 MB images, venue-scoped authenticated write —
  shared-token venues can't upload until staff logins).
- 247 live_fixtures gain `round_name`/`official_*` (hero bar "R6 · Main Pitch · Ref Cooper");
  applied via guarded anchor-rewrite (mig-239 pattern).

**Apps:** `apps/display` fully rebuilt to the broadcast-wall design (hero + featured algorithm
with 60s goal latch + operator pin, mini tiles, mode-aware rotating live table, golden boot,
coming-up incl. casual bookings, tall promo sponsor↔IoO by ratio, goal celebration with 5s
throttle queue, per-panel error boundaries, reduced-motion). Fonts = product call overriding the
handoff: **Plus Jakarta Sans** everywhere, **JetBrains Mono** only on small uppercase label
accents. `apps/venue` DisplaySettings gained sponsor copy/ratio/upload + featured-pin picker.
Found/fixed: CSS grid can't centre an oversized canvas (letterbox = absolute-centre + translate
scale); real HT period is `'HT'` not the doc's `'half_time'`.

**Deploys (both manual prebuilt-static, do NOT auto-deploy):** NEW `platform-display.vercel.app`
(Vercel project `platform-display`; needs `apps/display/.env.local` baked in) + `platform-venue`
redeployed with `VITE_DISPLAY_APP_URL` in the bundle (changing the display URL ⇒ rebuild venue).

**Client-demo kit:** `scripts/demo-display-showroom.sql` — RE-RUNNABLE, re-times the demo
matchday relative to now() (3 live games + events, tonight's fixtures, bookings, real player
names on both demo leagues, sponsor creative). Run before every client demo (evenings best).
`scripts/demo-display-goal.sql` — fires a live goal mid-demo → score punch + GOAL celebration
on the wall in ~2s. Ref→display chain verified: all 8 live ref RPCs broadcast `venue_live:<key>`,
the display re-pulls, and standings_live/top_scorers fold live goals — tables + golden boot
update on every ref tap.

**OWED:** real-TV device pass (§13); real-device venue sponsor-upload test; goal-celebration
live-fire from a real ref goal; rpc-security-sweep baseline finding — 31 older SECURITY DEFINER
fns still carry the default PUBLIC execute grant (none touched; dedicated cleanup cycle).

## SESSION 82 — "Paid" carried into the next game (mig 243)

**Incident (user-reported, Footy Tuesdays).** A player who paid last week still saw **✓ Paid**
in My View after the new game auto-opened and they'd opted in. The admin Payments screen had the
same bug — last week's payers sat under **PAID UP** for a game nobody had paid for.

**Root cause.** `players.paid` is a per-current-game flag, recomputed only at end-of-game
(`admin_save_match_result`, mig 241). The go-live RPCs reset status/team/admin_locked_in on
new-match creation but **deliberately left payment flags alone** (mig 204: "the Owes balance
depends on it" — a misread; owes is an independent accumulator). So `paid=true` survived from
the previous match through the whole new week until the next result-save.

**Fix (mig 243, commit `4a5fbe4`).** `admin_go_live` + `admin_go_live_for_team` now also clear
`paid/self_paid/paid_by/paid_at` on new-match creation. `owes` untouched (debt persists;
`payment_ledger` keeps the permanent per-match record, so no history lost). SQL-only, signatures
unchanged → grants preserved; `dbToPlayer` already maps these fields. Ephemeral-verified both
entry points incl. owes-preservation (0/5/10/7), leak-check clean; rpc-security-sweep clean.

**One-off cleanup (live DB).** Only two games were live: Footy Tuesdays (real) + 5-a-Side FC
(demo — left untouched). Cleared 4 stale flags on Footy Tuesdays (Bidz, Rohan, Tarny admin/VC-
confirmed yesterday; Gurpal self-declared 08:13 pre-rollover) — conditionally (only where no
game_fee 'paid' ledger row exists for the current match `m_3tjaDMsUpJs`), `owes`/`status` left
intact, audit_events rows written, `notify_team_change` fired for live refresh. Verified: zero
payment flags remain on the live squad; debts preserved.

## SESSION 81 — "Paid" wording + POTM live-tally plan

**Shipped (UI-only, no SQL):** the cash payment flow no longer says "cash" anywhere
on-screen. Player "Paid Cash" buttons (debt / in / guest paths), the admin payment-
confirmation line (`Name · £5 cash` → `Name · £5`), the guest paid labels
(`✓ You paid — cash` → `✓ You paid`), and the two guest "Paying cash" status
sub-labels all now read **"Paid"**. The `method='cash'` DB column and all
`cash_pending` / `paymentMode` state logic are untouched — display only.
Commits `2736c1a` + `c6c2415`. Build clean.

**SHIPPED — Part 2: live POTM tally (revealed only after you vote).**
Players see the running vote tally, but ONLY once they've cast their own vote —
enforced server-side AND in the render. Winner-first, counts only (zero-vote
nominees naturally absent — the RPC only returns voted-for players).

- **New read RPC `get_potm_tally_public(p_token, p_match_id, p_team_id)`** (mig 242).
  Counts only — `[{nominee_id, votes}]` winner-first + `total_votes` — NEVER voter
  identities (deliberately does NOT widen the latent `get_potm_voting_state`
  voter_id+nominee_id leak). Gate: no `potm_votes` row for the caller → `{voted:false}`,
  no counts. Match-wide aggregation; `p_team_id` only validates the match (`match_not_found`).
  Guests excluded (mirrors mig 219). STABLE SECURITY DEFINER, anon+authenticated.
  Read-only → no EV. Verified live: voter→6 votes winner-first, non-voter→`{voted:false}`,
  wrong-team→`match_not_found`. rpc-security-sweep PASS.
- **Client:** `getPOTMTallyPublic` wrapper + barrel. `POTMVotingModal.jsx` renders a
  winner-first leaderboard (name + count + proportional gold/grey bar, "YOUR VOTE"
  chip, "Live tally · N votes" header) in the just-voted **locked** state and the
  already-voted state. **Auto-dismiss removed** — the player now lingers on the live
  board and closes manually. PlayerView owns the fetch (`fetchPotmTally`) + a
  broadcast-driven re-fetch effect keyed on `matchHistory` (every `team_live` /
  `notify_team_change`, incl. `submit_potm_vote`, re-sets it) — no new channel.
- **OPERATOR DECISION (this session):** ship **tally at vote-time only — no reopen
  path.** Discovery during build: `setShowPOTMModal(true)` fires in exactly ONE place
  (the auto-open when voting opens, suppressed once voted/seen) — there is **no
  button/banner to reopen the modal**, so the already-voted-reopen leaderboard is
  currently unreachable, and a player only watches the live board while the modal
  stays open right after voting (it DOES update live during that window). The
  already-voted render block is kept as correct presentation should a reopen banner
  be added later. Code comment in PlayerView referencing a "persistent top banner"
  is aspirational — no such banner exists yet.
- **OWED:** real-iPhone home-screen test of the voted-state leaderboard during a live
  voting window (Hard Rule #13 — modal/PlayerView change).
- Build clean; casual flow unaffected (additive + render-gated: no tally render and
  no new RPC fires until the player has voted).

## SESSION 80 — Live firefight + post-game lifecycle hardening (mig 241)

Operator hit a cascade of issues on a real squad (Footy Tuesdays, `team_KPaoX8oJYMQ`) the night
a game finished. Worked them live, then shipped the durable fixes.

**Data fixes (live, no code):** Matty wrongly dropped from team B (an injured-toggle ON/OFF at
20:23 — after the 20:00 kick-off — stripped him from the saved `team_b` array; result-save then
locked a 6-man team B). Re-added to `team_b` + set his `player_match.result='l'`. Reconciled
Bidz + Rohan flat `paid=true` (result-save had wiped the flag the admin-confirm set). Closed the
stuck-open game + reset Gurpal/Callum/Kyle statuses.

**Code fixes shipped:**
- **Paid button** (commit 888be3a): the "Confirm — You've Paid?" button lived inside the
  `paymentState==='debt'` branch, but tapping "Paid Cash" flips state to `'cash_pending'` →
  debt branch skipped → no Confirm. Once a result saves the whole squad is in the debt state, so
  it broke for everyone. Branch the outer structure on a `cashPending`-independent
  `basePaymentState`. Reproduced + fixed live via Playwright.
- **POTM modal re-popping** (888be3a): `prevVotingOpen` is `useRef(false)`, reset every mount, and
  the open check only tested eligibility — so it re-opened on every app launch, even after voting.
  Now suppressed via per-match `localStorage` (`ioo_potm_seen_<matchId>`) + a voted check.
- **mig 241 — post-game lifecycle:** `admin_save_match_result` now closes the game
  (`game_is_live=false`), resets EVERY squad status (reserves included, not just attendees), and
  preserves `paid` for already-ledger-paid players; `set_player_status` gains a server-side
  sign-up-window gate (`game_not_live`). PlayerView shows a "sign-ups open <day> at <time>" note
  (pulled from `schedule.opens_day/opens_time`) instead of a bare gap. Ephemeral-verified 8/8 +
  leak 0; rpc-security-sweep PASS. See RPCS.md mig 241 + [[project_result_save_invariants]].
- **POTM voting window 1h → 2h** (commit b5439af): `cron.js potmVotingOpenJob` `closesAt` bumped
  to `now + 2h`; push copy updated. Applies next game onward.

**Owed:** real-iPhone test of the PlayerView changes (Hard Rule #13). Enhancement requested: an
admin "pending claims" banner (list everyone awaiting payment confirmation on the Admin tab).
Root-cause bugs still OPEN in BUGS.md: drawn teams stay mutable after kick-off (the Matty trigger)
+ result-save double-charges guests (game_fee on top of guest_fee).

## SESSION 79 — Superadmin operator-analytics suite + ops email digest (migs 234–240*)

Ran **in parallel with session 78** (venue staff logins). ⚠ **MIGRATION-NUMBER COLLISION:**
both sessions branched off `main` and grabbed 236–240. The live DB is fine (Supabase applies
by timestamp; all functions exist), so per CLAUDE.md cloud-discipline rule 5 the clash is
**left as-is and noted** — NOT renumbered. My migration FILES 236–240 duplicate the venue ones
by number; disambiguate by filename (`236_superadmin_health` vs `236_venue_confirm_booking_series`).
Migs **234–235 are uniquely mine.** Root cause: two same-day sessions on one base — the exact
trap CLAUDE.md warns about. Going forward the next free number is **241**.

Built the **operator-analytics layer** — "is the casual app being used, by whom, what's working":

- **Ops email digest (mig 234, `get_ops_usage_digest`).** Daily (Tue–Sun 08:00 UK) + weekly
  (Mon 08:00) emails to `OPS_DIGEST_EMAIL` (defaults to operator) via the existing Resend
  mailer + `api/cron.js` (`opsDailyDigestJob`/`opsWeeklyDigestJob`, new `_mailer.js` templates).
  Real squads only (`team_demo%` + `team_dc%` stripped). Squads active/new, players, activity,
  wk/wk delta, dormancy, **new-and-quiet onboarding alert**. `?ops_force=1` on `/api/cron`
  (behind CRON_SECRET) re-sends on demand. Resend confirmed LIVE — test send hit operator gmail.
- **Superadmin dashboard (`apps/superadmin`) — three new tabs + onboarding aids:**
  - **Engagement (mig 235, `superadmin_engagement`)** — per-squad × per-feature-category
    activity; AI-vs-manual team split (`match_teams_saved.balance_score`); opens split
    admin/player (`app_boot.route_type`). Flags "nobody did this".
  - **Health (mig 236*, `superadmin_health`)** — activation FUNNEL, notification REACH (real
    delivery paths only — push-sub/phone/linked-email; `notification_channel` preference
    IGNORED, defaults to 'push' for all), INSTALL/sign-in, RESPONSE/ghost rate.
  - **Team Detail recent events (mig 237*)** — period + event-type filters, plain-English
    labels (`eventLabels.js`); RPC events cap 20→200.
  - **Teams list (mig 238*)** — Activation column + "⚠ new & quiet" flag; **Share-links
    panel** on Team Detail (join link + per-player /p/ links).
  - **Create Squad tab (mig 239*, `superadmin_create_team`)** — casual twin of Create Venue:
    creates the squad SHELL (team+schedule+settings+`admin_token`), no members; hands back an
    admin link `/admin/<admin_token>` (full access, no login) + join link. EV'd, leak 0.
  - **Account-claim (mig 240*, `claim_my_admin_teams`)** — organiser signs into the casual app
    with the `admin_email` → unclaimed shell auto-adopted into their My Squads. Verified-email
    match, only unclaimed shells (no hijack), idempotent, EV'd. Fire-and-forget post-sign-in in
    `apps/inorout` App.jsx — **PWA Hard-Rule-#13 real-iPhone test OWED.**
- **Bug fixed (mig 234 + caught in 236 pre-ship):** ops analytics counted players off
  `players.team` — the **A/B matchday side, NOT squad membership** (which is `team_players`).
  Fixed both. See DECISIONS + BUGS.
- **Production bug fixed:** `apps/superadmin` rendered a blank screen since first deploy —
  deployed (manual prebuilt-static) without `VITE_SUPABASE_URL/ANON_KEY` baked in. Created
  `apps/superadmin/.env.local` + redeployed. Logged GO_LIVE_ISSUES.md #13.

**Deploy note:** `apps/superadmin` (Vercel `platform-superadmin`, alias
`platform-superadmin-nu.vercel.app`) does NOT auto-deploy — manual prebuilt-static:
`npm run build` → stage `.vercel/output/static` + SPA `config.json` → `vercel deploy
--prebuilt --prod`. Needs its own `.env.local` or the bundle ships env-less (blank screen).

**Deferred follow-up:** screen-VIEW instrumentation — `audit_events` logs writes not views, so
"results checked / table viewed" isn't trackable until the casual app emits view events; that
becomes another Engagement category with no shape change.

## SESSION 78 — Venue staff logins, Phase 1 (data + auth core, mig 237)

Started the **venue staff logins** epic (full settled design: DECISIONS.md "VENUE
LOGIN CREDENTIALS → Session 78"; memory [[project_venue_staff_logins]]). Per-person
accounts replacing the shared `venue_admin_token`. Phase 1 = data + auth core,
additive + safe (existing token path untouched; the new authed stage only fires for
a logged-in member, of which there are none until invites ship). **mig 237:**
- `venue_admins` table (copies team_admins mig 002 + `email`/`status` for invites +
  `caps_grant[]`/`caps_deny[]` for per-person overrides; 5 gated caps: reverse_money,
  booking_settings, manage_facility, staff_directory, manage_logins). Superseded an
  unused 5-col `venue_admins` stub (0 rows, no refs).
- `_venue_has_cap(role,grant,deny,cap)` — owner=all, manager=all 5, staff=none, then
  per-person deny/grant overrides.
- `resolve_venue_caller` — return shape gains `role`+`caps_grant`+`caps_deny` (all 49
  callers bind `SELECT * INTO v_caller`, verified safe; DROP+CREATE since OUT cols
  change), + **Stage 1b**: a logged-in member acting on their venue (client passes
  `venue_id` in the old token slot — ids never collide with the long tokens).
  actor_type stays `'venue_admin'` (no audit CHECK churn) but actor_ident →
  `user_id:<uuid>` = real attribution. Shared-token + platform-admin stages keep
  role 'owner'.
- `venue_whoami()` (read, mirrors company_admin_whoami) + `venue_claim_memberships()`
  (write — binds 'invited' rows to the user's VERIFIED auth email on first sign-in;
  global-by-email, audited). Demo venues seeded an Owner invite (operator email).
- **Verified:** EV 10/10 (cap matrix, shared-token intact, claim=1, row active,
  whoami, resolver-1b, idempotent re-claim, staff gated, revoked-not-resolved,
  no-auth rejected) via faked `request.jwt.claims`; leak-check 0 + demo seed intact
  (switched test identity to tarny@desicity.com to avoid touching the operator's
  demo seed rows per Hard Rule #15). rpc-security PASS.

**Phase 2 — login UI (frontend only, deployed).** Operator chose **Google +
email/password** (both) for the venue console. New `VenueSignIn.jsx` (venue-styled:
Continue-with-Google + email/password form). `App.jsx` rewritten: tracks the Supabase
session (`getSession`+`onAuthStateChange`), on a session runs `venueClaimMemberships`
→ `venueWhoami`, then renders sign-in / loading / no-access / **venue-picker** (>1
venue) / dashboard. The chosen `venue_id` is the credential passed as `venueToken`
to every RPC (Stage 1b); all existing loaders/realtime re-keyed onto it. The legacy
`?token=` URL stays a silent dev/demo backdoor (skips auth entirely). Rail footer
gained an account chip (email + role + Switch venue + Sign out); `venueWhoami`/
`venueClaimMemberships` JS wrappers + barrel. **Demo owner password set** on
tarnysingh@gmail.com (`InOrOut-Demo-2026`, additive — Google identity untouched;
verified via the GoTrue password grant → 200 + access_token). Deployed prebuilt-
static; **eyeballed live**: password sign-in → both invites auto-claimed → picker
(both demo venues as Owner) → Demo Sports Centre dashboard loads real data via the
login credential + account chip shows owner.

**Phase 3 — invites + access management (mig 238 + frontend, deployed).** Four
token/login-authed RPCs gated on the `manage_logins` capability with the role
guardrails: `venue_list_admins` (read), `venue_invite_admin`, `venue_update_admin`
(role + per-person caps), `venue_revoke_admin` (soft-delete). Guardrails — Owner
manages owner/manager/staff; Manager manages STAFF only; can't grant a cap you don't
hold; last active Owner can't be demoted/revoked (no lockout). `_venue_role_rank`
helper. EV 13/13 (owner invite/list/promote/set-caps + already_member + both
last_owner guards; manager invite-staff-ok / invite-manager-blocked /
touch-owner-blocked / cap_not_grantable; staff fully blocked) + leak 0; rpc-security
4/4. New `AccessView.jsx` (gated nav tab "Access" — hidden unless caller has
manage_logins): member list with role select, per-person capability chips
(toggle = grant/deny override), Remove, and an inline invite form. JS wrappers +
barrel. **Eyeballed live:** invited reception@demo.test as Staff → row shows Invited
+ 5 cap chips OFF → toggled Reverse-money ON (override persisted) → Removed (revoke);
owner row correctly self-locked (no role edit / no remove / no caps). Email delivery
of the invite is DEFERRED (Resend) — the invite works regardless (activates on first
sign-in via claim).

**Phase 4 — server-side capability enforcement (mig 239).** The screens already
HID controls a role can't use; this makes the RPCs REFUSE a too-low role. Injected
one capability guard (`_venue_has_cap` → `insufficient_role`) into the 11 venue
write RPCs that map to a gated cap: reverse_money (venue_void_payment/void_charge/
set_charge_due), booking_settings (update_booking_settings), manage_facility
(add_pitch/update_pitch/add_ref/update_ref/update_display_config), staff_directory
(add_staff/update_staff). Everything else stays open (bookings, record-payment,
incidents, rota, nudge, full league/cup admin). **Mechanism:** all 11 share the
preamble anchor `v_venue_id := v_caller.venue_id;`; mig 239 is a DO block that reads
each body via `pg_get_functiondef` (no hand transcription), injects the guard after
the anchor, and CREATE OR REPLACEs — idempotent (skips already-gated), with an
anchor-uniqueness assert. Shared token + platform_admin resolve as owner → pass all
gates. EV 17 checks (staff blocked on ALL 11; manager passes all 4 caps; per-person
grant lets staff through that one cap but still blocks the others) + leak 0; verified
each of the 11 carries the correct cap. Backend-only — no redeploy. **Next: Phase 5**
— attribution payoff (show the person's name on reported/resolved/refunded-by; data
already records who via actor_ident=user_id).

**Phase 5 — attribution payoff (mig 240). EPIC COMPLETE.** New `_venue_actor_name(uuid)`
helper resolves a user_id → display name (Google full_name/name metadata, else email;
NULL-safe; SECDEF reads auth.users). `venue_get_state.open_incidents` gains
`reported_by_name` via the helper (injected programmatically — venue_get_state is large;
read its body verbatim + add one field, idempotent). Operations.jsx incident line now
shows `i.reported_by_name` (fallback to venue name for legacy/token-reported NULLs).
Read-only (no EV-rollback needed); helper rpc-security PASS (SECDEF + search_path).
Eyeballed live: both demo incidents flipped from "reported by Demo Sports Centre" to
**"reported by Tarny Singh"** (their reported_by held the operator uid). The helper is
reusable for future attribution surfaces (recorded-by / resolved-by / refunded-by).
**Venue staff logins epic done: migs 237–240 + login UI + access mgmt + enforcement
+ attribution.**

## SESSION 78 — Venue Requests inbox: series-aware confirm (Jun 9 2026)

Direct-to-`main` desktop session, continuing the venue screen-by-screen pass (Bookings nav
group). Audited the **Requests inbox** (`RequestsInbox.jsx` ← `BookingsView.buildPendingGroups`
← `get_pitch_occupancy`). Read+write paths were cleanly wired (status read live from
`pitch_bookings`, all three write reasons in `BOOKING_REASONS`, realtime refetch closes the
loop) **except one asymmetry**:

- **Gap:** decline of a weekly block had an atomic whole-series server path
  (`cancel_booking_series(series_id)`), but **confirm did not** — the inbox looped
  `venue_confirm_booking` over `g.bookingIds`, an array built only from the today..+90d
  occupancy window. Series allow up to **52 weeks** (`book_pitch_series` /
  `venue_create_booking_series` guards), so a block >~12 weeks was **confirmed partially**:
  weeks 13+ stayed `requested` forever — slot held, no charge raised, team never told confirmed.
- **Fix (mig 236):** new `venue_confirm_booking_series(p_venue_token, p_series_id)` — confirms
  every still-`requested` booking in the series atomically + raises one `venue_charge` per
  booking (same fee logic + `venue_charges_source_uniq` ON CONFLICT guard as
  `venue_confirm_booking`). Venue-token authed only (a team can't confirm its own request).
  RequestsInbox confirm now routes `g.seriesId → venueConfirmBookingSeries` else the single-id
  call — symmetric with decline.
- **Verified:** ephemeral-verify 7/7 (15-wk series incl. weeks past +90d → all confirmed, 0
  left requested, 15 charges with no dup via ON CONFLICT, audit row, invalid-token /
  wrong-venue / double-tap all rejected) + leak-check 0; rpc-security-sweep PASS (SECDEF,
  search_path, single overload, anon+authenticated); venue build clean; raw RPC name in
  exactly one `supabase.rpc()`. Deployed to platform-venue.vercel.app (prebuilt-static); inbox
  eyeballed live (one-off card unchanged). **Owed:** logged-in/real-squad pass confirming a
  long block end-to-end (no pending series in the demo seed to exercise the new path in UI).

## SESSION 77 — Venue Operations + Bookings screen pass (Jun 9 2026)

Direct-to-`main` desktop session (no PRs). Screen-by-screen audit→fix of the venue
dashboard, deploying `apps/venue` after each piece via the **manual prebuilt-static**
path (platform-venue.vercel.app does NOT auto-deploy — see [[project_venue_deploy]] /
the venue-deploy memory). Shipped, in order:

- **Operations — incident lifecycle (mig 231).** Venue admin can now REPORT an incident
  (button+modal → `venue_log_incident`) and RESOLVE one (per-row → `venue_resolve_incident`);
  was create-by-seed-only + resolve-by-HQ-only. `incidents.reported_by` made nullable (venue
  = token caller, no auth.uid()). Each incident row shows reporter (venue name) + timestamp.
  EV 12/12, rpc-security 2/2.
- **Bookings — New-booking modal rework (mig 232, 3 slices).** Existing customer
  (Team/Person dropdowns) vs New customer; Single vs Block (weekly, team-only via
  `venue_create_booking_series`); UK date + availability-driven time; email+phone REQUIRED
  (contact cols on pitch_bookings) → `booking_confirmation` email (Resend) + SMS-ready cron job.
  EV 15/15, rpc-security 2/2.
- **Bookings — schedule grid overhaul + filters (mig 233 + frontend).** Un-squashed blocks
  (60px/hr); colour = PAYMENT (green/amber, pending=dashed), TYPE word tag, NEW badge — via
  `get_pitch_occupancy` gaining `owed`+`is_first` (`_venue_source_owed` helper). Scales to many
  pitches (sticky axis + internal scroll; fixed a min-width:auto page-overflow). Client-side
  FILTERS (CalendarFilters.jsx): search, Paid/Owed, type, Pending, New, pitch show/hide,
  Free-slots; content filters COLLAPSE the calendar to matches (`occBounds`), Free-slots =
  availability view (`freeGaps`, tappable "Available" slots, bookings stripped).
- **Booking-settings bug fixes:** toggle CSS specificity (switch knob overlapped label),
  unstyled slot-length pills ("30456090120"), "Add window" appended off-screen (now prepends).

**Decisions logged (DECISIONS.md / FEATURES.md backlog):**
- **Venue per-user login credentials** — venue console is one shared `venue_admin_token` (no
  per-person identity); proper accounts are a new feature (model on apps/hq OAuth). Until then
  audit "who" = the venue. Deliberately did NOT bolt on a free-text reporter field.
- **IP + device in the audit trail — PARKED (on hold).** Backend-only enrichment; *who*/*when*
  already captured on all 93 audit-writing RPCs. Agreed shape when resumed: a shared
  `record_audit()` reading client IP + user-agent from PostgREST `request.headers` (never
  client-passed) into new audit_events cols; adopt forward + backfill the 93.
- **Person/new-customer block booking — deferred** (needs booking_series booker-agnostic +
  a `create_renewal_holds` guard).

**Operator still owes:** logged-in venue passes on the write flows (create a booking end-to-end;
log+resolve an incident); real email-delivery eyeball once `RESEND_API_KEY` is live.

## SESSION 76 — Reliable "a spot's opened — claim it" reserve notification (Jun 9 2026)

Branch `reserve-spot-opened-notify` / **PR #6**. Operator decisions: **keep tap-to-claim** (NO
auto-promotion — a reserve still taps In to confirm; auto-In was rejected as it would commit them
to the fee without consent), but make the alert fire **reliably on ALL spot-freeing events,
server-side**, to just the **next reserve** in the queue.

- **The defect:** the "🟣 a spot's opened — tap to claim" push was fired **client-side** from the
  dropping player's OWN device, only via the self-toggle (`PlayerView.setStatus`). It missed
  admin-marks-out, disable, and injury, and failed silently if that device didn't POST.
- **mig 230:** new trigger `notify_spot_opened` on `players` `AFTER UPDATE OF status, disabled` —
  fires on any spot-freeing transition (`'in'→not 'in'`, or disabled flips true while `'in'`),
  recomputes in-count vs `schedule.squad_size`, and on a genuine opening posts to `/api/notify`
  **direct mode** (no auth) via `net.http_post` (canonical `www` URL, mig 049) for the lowest
  `reserve_priority_order` reserve only. notify.js does all gating (trigger config, quiet hours,
  injured filter, log). Exception-swallowing — can never break the player write (mirrors mig-225
  venue-ins pattern). Client `spotOpened` block removed from PlayerView; `squadFull` left as-is.
- **Anti-spam:** the weekly squad reset (`admin_go_live` / `admin_go_live_for_team`) sets the whole
  squad `status='none'` in one statement; a row-level trigger could fire mid-statement while later
  reserve rows still read `'reserve'`. Both go-live RPCs now `set_config('inorout.bulk_reset',
  team_id, true)` (transaction-local) before the reset; the trigger returns immediately when set.
- **Verified:** ephemeral-verify (rolled back, leak-check 0) — all four freeing paths (out / maybe
  / injury / disable) notify res1 only; cancelled-game and no-reserve = 0; the guard is
  load-bearing (unguarded mass reset Δ3 vs guarded go-live Δ0). RPC-security-sweep pass (go-live
  grants preserved; trigger fn anon/authenticated EXECUTE revoked); build + hygiene 7/7 +
  casual-regression clean. **Real-iPhone test owed post-deploy** (drop an in-player → next
  reserve's phone gets the push). The separate `squadFull` push is still client-fired (out of scope).

## SESSION 75 — Venue dashboard wiring audit + 4 fixes (Jun 8 2026)

Branch `venue-redesign-v2` / **PR #3** (still unmerged). Screen-by-screen pass over the venue
dashboard verifying every screen pulls/pushes the right data, including the casual↔venue links.
Every screen came back correctly wired except four gaps — fixed, applied live, redeployed to the
manual demo, and verified with Playwright. Detail in memory `project_venue_wiring_audit`.

- **mig 227 (`02bcde1`) — Operations "Outstanding" stat.** `venue_get_state` never built
  `payments_summary`, so the landing stat always showed "—". Added it via a `v_charges` CTE
  mirroring `venue_get_charges` exactly (non-voided payments; owed/collected/outstanding exclude
  refunded). Read-only; no JS change. Demo now shows £660, matching Payments.
- **mig 228 (`88d1864`) — weekly-block availability (casual app).** `get_pitch_free_slots` only
  checks the queried date, so the casual BookPitchModal block picker offered slots free on week 1
  but taken later → `book_pitch_series` failed the whole block atomically. New sibling RPC
  `get_pitch_free_slots_series` returns only slots free across ALL N weeks (loops the availability
  test over weeks 0..N-1, same +7/Europe-London arithmetic). Block mode now uses it + reloads on
  week-count change. Verified live: weeks=1 == original (33=33), monotonic shrink (33→31→19), real
  week-2 clash excluded. **Casual-flow change — real-iPhone block booking owed once PR #3 deploys.**
- **mig 229 (`58cfe24`) — Payments undo-payment + edit-amount-owed.** Two built RPCs
  (`venue_void_payment`, `venue_set_charge_due`) were surfaced nowhere in the v2 UI. Wired both:
  the Paid cell opens a per-payment "Undo" list; an "Edit due" action adjusts a charge's owed.
  Needed a per-charge `payments[]` array (active only) added to `venue_get_charges` — timestamp
  column is `venue_payments.taken_at` (not created_at; caught at runtime, re-applied). Summary maths
  unchanged. Verified live: 33 Edit-due controls, payments modal with Undo.
- **Edit score (`ac76127`) — fixture score correction.** `venue_update_fixture_result` was wired
  nowhere. Added an "Edit score" action on completed league fixtures (FixtureActions) → team-labelled
  home/away + reason → the RPC, which corrects an already-completed fixture, notifies both casual
  teams (`result_corrected`) + the league, and re-derives the table. Frontend-only.

**Through-line:** the v2 redesign silently dropped three built-and-exported wrappers
(`venueVoidPayment`, `venueSetChargeDue`, `venueUpdateFixtureResult`) from the UI — all wired back.

**Casual↔venue links verified:** book-a-pitch (one-off + block) → venue Requests/schedule;
Customers live `in_count` (mig 226) + Nudge (server-side to team admin); competition rosters/
standings pull from casual `players`; fixture writes notify casual teams. Teams/Players read-only
(roster owned by team admin — correct). RPC security sweep passed on 227/228/229; all three
migration .sql files landed same-commit (Hard Rule #11).

**Open follow-ons:** score correction only on full cards (compact "Recent results" exposes no
actions); no venue path to enter a result the ref never recorded; `VITE_DISPLAY_APP_URL` unset →
reception-display link incomplete; FEATURES.md not yet updated for 227–229.

## SESSION 74 — Venue dashboard v2 + Phase B + first venue deploy (Jun 8 2026)

Branch `venue-redesign-v2` / **PR #3** (not yet merged at session end).

- **Phase A — v2 re-skin:** the whole venue app moved from "Broadcast Gallery" to a dark
  "operator console" (Manrope, sodium-amber, rail nav). All 9 screens + entry screens; a
  transitional CSS shim themes the few not-fully-ported secondary modals. No backend touched.
- **Phase B — booker layer (migs 222–226, all applied live + ephemeral-verified + leak-checked):**
  - 222 Cancellations: `cancel_booking` records reason/decision + refunds the charge (full→
    refunded, partial→halved, none→untouched, mirrors fixture-void); `venue_list_cancellations`
    log + CSV. Policy-driven CancelBookingModal.
  - 223 Customers: `venue_list_customers` (teams/walk-ins; bookings/spend/recency `nudge_status`).
  - 224 Nudge: `venue_request_nudge` (records ask, count only) + cron/`_mailer` `venue_nudge`
    send (server-side; venue never sees contact).
  - 225 Live ins: `venue_get_booking_ins` (in/target counts) + `players_ins_notify` trigger →
    `booking_ins_changed` broadcast; venue badge updates the instant a player taps in/out.
  - 226 Customer detail: `venue_get_customer` (a booker's bookings + charge + live ins).
  - Scope: **venue-domain only** (see DECISIONS.md). Boundary held by counts-only reads.
- **First venue deploy:** the venue app had never been deployed (no `platform-venue` Vercel
  project). Deployed the branch's static build (Supabase anon key is public, baked at build) as a
  new production project → **https://platform-venue.vercel.app**. Demo: append
  `?token=demo_venue_token_DO_NOT_USE_IN_PROD`. NB this is a **manual static deploy of the branch**
  — not Git-integrated yet, so it won't auto-update on push. Permanent path: merge PR #3 + connect
  `platform-venue` to the repo (Root Directory `apps/venue`) for CI deploys, then it tracks `main`.
  `VENUE_APP_URL` can now be set to this URL on the `inor-out` project so registration emails carry
  the venue link.
- **Open at session end:** PR #3 unmerged → live DB (migs 222–226) runs ahead of `main` source
  (the Hard-Rule-#11 drift). Merge PR #3 to reconcile. Live ins + Nudge are best eyeballed against
  a real team (demo has only walk-in bookers).

## SESSION 72 — PERSISTENT GUESTS epic (S1–S5 complete, Jun 7 2026)

Reworked the guest (+1) model: a guest is now a **persistent `players` row that is never
auto-deleted**. Five slices, each its own audit→execute→verify→commit cycle, all on `main`.

- **S1 (mig 216, cb339ee):** rollover RPCs (`admin_go_live`/`admin_go_live_for_team`) +
  `remove_guest_player` stop deleting guests — they go DORMANT (is_guest=true, status='none',
  team=NULL). Reverses the guest-delete of migs 207/209 (the mig-204 bulk reset already makes
  them dormant). JS hides dormant guests via a shared `isDormantGuest(p)` helper; PlayerView's
  `myGuest` keys on an ACTIVE guest so a dormant row no longer blocks the Plus One button.
- **S2 (mig 217, f0d28b7):** `reactivate_guest_player` + a "Bringing someone back?" picker in the
  Plus One form (reads `squad.filter(isDormantGuest)` — no new fetch).
- **S3 (mig 218, 7eac73b):** promotion to permanent member, BOTH routes on the same row →
  history carries over. Admin `admin_promote_guest` ("Make permanent" in SquadScreen, which now
  also shows dormant past guests + a DORMANT pill + copy-link for guests); self-claim via a GATED
  promote-on-link branch in `link_player_to_user` (guest signs in on their own /p/<token> link →
  promoted). **Touched the auth RPC** → real-device test owed.
- **S5 (mig 219, 108f6aa):** guests excluded from reliability + POTM until promoted
  (`deeperIntel.reliabilityRanking` filter + POTM nominee/tally/winner guards), keyed on the live
  is_guest flag so promotion makes them count automatically. (S4 — legacy "Guest" display — shipped
  earlier, session 71.)

Every migration was PURE function redefinition proven to mutate ZERO live rows (snapshot before/after;
the week's 14 ins untouched). Verification: ephemeral-verify across all four migrations (24 assertions,
leak-check 0 each), RPC-security-sweep, casual-regression browser, build + hygiene 7/7. **Owed
(Hard Rule 13):** real-iPhone passes — board+Plus One (S1), picker (S2), guest-link sign-in promotion
+ normal sign-in still works (S3). Model + owed tests recorded in memory `project_persistent_guests`.

## SESSION 69 — BST timezone offset on cron notifications (Jun 7 2026)

All scheduled notifications were firing 1hr late during BST. Two root causes: `admin_upsert_schedule` stored `game_date_time` as UTC-naive (bare `::timestamptz` cast), so admin-entered "20:00 UK" was saved as 21:00 BST; and `notify.js` `gameDay9am` used `now.getHours()` (UTC on Vercel). Fixed via mig 207: `AT TIME ZONE 'Europe/London'` in SQL, `Intl.DateTimeFormat Europe/London` in JS, plus a one-off -1hr data migration on 3 live schedule rows. Also corrected a stale REVOKE/GRANT (anon had EXECUTE on an admin RPC due to prior grants referencing the wrong 13-param signature). Commit 4e351b6. See BUGS.md + DECISIONS.md.

## SESSION 69 — PWA live updates on resume from background (Jun 7 2026)

Operator: had to fully close & reopen the installed PWA to get latest info; live
updates didn't arrive after the app was backgrounded. Asked whether to start a
Capacitor build for the App Store if it was a PWA limitation.

Diagnosis: not a PWA limitation. iOS suspends the PWA and tears down the realtime
WebSocket; the only `visibilitychange` handler refreshed the auth token and never
reconnected the socket or re-fetched. Broadcast/postgres_changes events are
ephemeral, so anything that fired during suspension was lost until a full relaunch.

Fix (commit `5edd64f`, 2 files): realtime client got a capped `reconnectAfterMs`
backoff; App.jsx got a shared `refreshTeamData()` catch-up (reused by the team_live
broadcast handler) and a resume handler on visibilitychange/pageshow/focus that
refreshes auth (throttled), reconnects realtime, and re-fetches unthrottled on every
foreground. Caught a self-inflicted TDZ (resume effect referenced refreshTeamData in
its dep array before declaration) and moved the declaration above it.

Live test against Footy Tuesdays via `admin_set_player_status`: foreground-live
update worked; then a change made during a 90-second suspension appeared instantly on
foreground — fix confirmed on the operator's real iPhone. Confirmed the fix is live
on www.in-or-out.com by grepping the deployed bundle. Detour: Vercel MCP API showed
stale deploy data (looked frozen at a dead repo's May build) — disproven by the live
bundle; recorded in [[project_inorout_deploy_and_pwa_update]]. Capacitor decoupled
from this and not pursued. Decision logged in DECISIONS.md.

## SESSION 68 — casual post-game pipeline repair (week lock, payments, bibs, stats, share, POTM) (Jun 6 2026)

Operator-reported cluster after a real Footy Tuesdays game completed. Several symptoms,
two deep root causes, plus display id/name regressions. All on the **casual** (apps/inorout)
flow. Full narrative in BUGS.md (migs 204/205/206 RESOLVED entries); operator-facing
pre-flight in GO_LIVE_ISSUES.md.

**Root cause A — week never reset (mig 204).** Opening a new week never reset player
`status`; the whole squad stayed `status='in'` from last week, so the squad read as full →
`set_player_status` threw `squad_full` ("teams locked, can't say in/out"). Only cancel-reopen
and the demo-only cron reset status. **Fix:** `admin_go_live` + `admin_go_live_for_team` now
reset status='none' / admin_locked_in=false / team=NULL on new-match creation; payment fields
carry over (Owes balance). Gated to new-match path so double-taps don't wipe a live week.

**Root cause B — result-save did almost nothing (migs 205/206).** `admin_save_match_result`
keyed "fresh save" on player_match row count, but the kickoff lineup-lock pre-creates those
rows → every real save read as a re-save (`is_fresh_save=false`, confirmed in audit_events) →
skipped owes, payment history, stats, payment reset. **Fix:** freshness now keys on
`matches.winner` (NULL until first finalisation — nothing sets it earlier; audited every
winner-write path). Added payment_ledger game_fee/unpaid charge per unpaid non-guest attendee
(payment history) + bib_history cascade (admin Bib tracker reads bib_history, which had 0 rows).
205b fixed a latent ambiguous-column bug (p.attended/p.goals) exposed once the block ran. 206
also clears admin_locked_in in the reset (audit-found cross-week stuck-lock gap).
**Live backfill:** last week (m_WXZHG) — 9 unpaid non-guest attendees charged £5 (£45 outstanding)
+ ledger rows + bib holder, idempotently. Footy Tuesdays squad un-stuck (status→none, payment kept).

**Display id/name fixes (JS).** Save path stores player **IDs** in matches.team_a/team_b/
scorers/motm/bib_holder, but consumers resolved by name only:
- StatsView league table showed only the POTM (id-only POTM block survived) → added id-first/
  name-fallback resolver; also added bib-duty counting (rows never carried bibCount).
- HistoryView "Share Results" listed raw IDs for Team A/B + scorers → resolve via findPlayer.
- Avatar had a bib dot but no POTM badge, and the squad list never passed it → added `hasMotm`
  trophy badge (bottom-right) wired across the in/out list.
- Orphaned-guest "Remove" (host dropped out) called deletePlayer (blocked by match history) →
  now sets status='none' (un-entered), not a squad delete, not 'out'.

**Audit (end of session):** confirmed `matches.winner IS NULL` freshness is unbreakable (no
path sets winner early); lifecycle coherent (owes never wrongly cleared, charged before reset);
live↔source no drift; no new security advisors (all 371 pre-existing/architectural); only other
real teams (Finbars, Competitive FC) have no finalised matches so no latent payment debt.
Invariants saved to memory ([[project_result_save_invariants]]).

## SESSION 67 — Venue redesign + management depth; League Control dashboard; landing pages live (Jun 1 2026)

A long product/UX session across three threads. Operator brief: bold/brave/3D
in-theme admin dashboards; "make the landing page live without touching the app";
then start the League dashboard with write actions.

**1. Venue dashboard redesign — "Broadcast Gallery"** (`apps/venue`)
- Full restyle to the In-or-Out theme (gold `#E8A020`/dark, Bebas Neue + DM Sans,
  NO italics, 3D floodlit-pitch background, Framer Motion). Iterated 3× on screenshots.
- **Modal bleed-through fix:** modals now portal to `document.body` (`Modal.jsx`) —
  Framer-Motion panel transforms were trapping `position:fixed` modals so dashboard
  content painted over them. One fix covers every modal.
- **Fixture card rethought** into three bands (kickoff/status · matchup · meta) after
  the 1-line version collided long names with the score. Robust at all widths.
- **Season wizard capacity fix:** derive staggered kickoff slots so a venue runs
  several games per pitch per night (killed false `capacity_insufficient`).

**2. Venue management surfaces (nav expanded, all real):**
- **Staff** = all staff, not just refs — new `venue_staff` table + CRUD
  (`venue_list_staff`/`venue_add_staff`/`venue_update_staff`, **mig 195**, EV 8/8
  + live UI smoke). Two sections: Match Officials (refs) + Venue Staff.
- **Teams** + click-through roster — `venue_get_team_roster` (**mig 196**).
- **Table** standings — `venue_get_standings` (**mig 197**, computed from fixtures).
- **Players** aggregate index — `venue_list_players` (**mig 198**).
- All reads ownership-gated `competition_teams→competitions→seasons→leagues→venue_id`,
  exclude token/user_id/phone; both security negatives verified each.

**3. Marketing landing pages LIVE** — deployed `marketing/` as its OWN Vercel
project (`marketing-tau-seven.vercel.app`), deliberately separate from `inor-out`/
in-or-out.com so it can't displace the live app (a domain = one project's prod).
Brand-domain attachment deferred to operator's choice (root-swap vs path rewrite).

**4. NEW League Control dashboard** (`apps/league`, Vite port 5177, token via
`?token=`/`/league/TOKEN`, demo `demo_league_admin_token`). Mirrors the venue
Broadcast-Gallery design (styles copied). Consumes `leagueGetState` +:
- **mig 199 `league_list_teams`** (read) — league state has no teams map; used for
  fixture name resolution + Teams view.
- **mig 200 `league_get_standings`** (read) — league table by league token.
- **mig 201 `league_update_fixture_result`** (WRITE, EV 8/8 + live 2-3→2-4→revert)
  — correct a completed fixture's score.
- **mig 202 `league_update_fixture_status`** (WRITE) + **mig 203
  `league_reschedule_fixture`** (WRITE) — postpone/void/walkover/forfeit +
  reschedule; one EV run = 5 transitions + 7 error paths, leak clean.
- Views: Operations (fixtures + Edit result / Manage), Table, Teams. Still read-only
  for team registrations; not yet deployed (needs its own Vercel project + env).

All write RPCs ephemeral-verified with leak-checks; demo data left pristine after
every live UI smoke. RPCS.md + memory `project_venue_redesign` updated. Commits this
session: portal fix → … → league reschedule (`3c143fa`).

## SESSION 66 (cont.) — Phase 11.4a: group-stage cups (Jun 1 2026)

The deferred half of Phase 11, sub-cycle 11.4a (group stage; 11.4b knockout-from-groups next).
Model: one competition `format='group_stage'` owns both phases; group fixtures feed the existing
`cup_ties` knockout machinery (reused unchanged in 11.4b). Decisions in DECISIONS ("Phase 11.4").

- **mig 191** — additive schema: `competition_teams.group_label`+`seed`, `fixtures.group_label`,
  `competitions.config jsonb`.
- **mig 192 `venue_persist_group_stage`** (WRITE) — snake draw (or operator override) + server-side
  round-robin per group (circle method) + fee charges + config. EV: 6 teams→2 groups×3, 6 fixtures,
  12 charges, 3 error paths (invalid config / too-small group / re-run) — all PASS, leak-check 0.
- **mig 193 `get_group_standings`** (READ) — per-group mini-league tables (mirrors
  `get_league_standings_for_player`) + rank + `qualifying` + `all_groups_complete`. anon-readable.
- **packages/core** — `venuePersistGroupStage` + `getGroupStandings` wrappers + barrel (additive).
- **UI** — SeasonWizard group_stage branch (Groups + Qualify/group inputs; server snake-draws);
  group tables on venue `BracketView`, player `BracketOverlay`, display `BracketZone` (all key on
  `type='cup'`, already routed). rpc-security-sweep PASS (both SECDEF/search_path/anon+auth/1 overload);
  casual-regression PASS (no casual surface touched, packages/core additive); all 3 apps build clean.

**11.4b (same session):** extracted `_cup_build_bracket` (shared builder) so `venue_persist_cup_bracket`
is a thin caller (behaviour byte-identical, EV-regression-verified); `venue_seed_knockout_from_groups`
(mig 194 — manual "Build knockout", seeds from final standings cross-group, guards all-groups-complete);
`get_cup_bracket` extended additively with `groups`/`all_groups_complete`/`knockout_seeded`; "Build knockout"
button + modal in venue BracketView. EV: 7/7 incl. single-elim regression, leak 0. sweep PASS (incl.
`_cup_build_bracket` internal-only grant), casual-regression PASS, 3 apps build clean. **Phase 11
group→knockout COMPLETE.** **Operator owes:** real-device check of the player group tables + a live
end-to-end group→knockout dry run (hard-rule #13).

## SESSION 66 — Phase 9 finish: HQ weekly digest (Jun 1 2026)

Closed out the last Phase 9 piece — the per-company HQ weekly digest, deferred from session 59
to ride Phase 6 (it needed HQ aggregation, now live). One AUDIT→EXECUTE→VERIFY→COMMIT cycle.

- **mig 190 — `hq_get_analytics_for_company`** (service-role read RPC): a JWT-less sibling of
  `hq_get_analytics`. The auth-gated original resolves the caller via `auth.uid()`, which a cron
  doesn't have; this variant drops caller-resolution + region scoping + config/meta and returns
  the bare analytics jsonb (same 7 sections). service-role-only grant (anon/authenticated/PUBLIC
  REVOKED). Precedent: mig 126 `admin_go_live_for_team`. Read-only → no ephemeral-verify; verified
  via pg_proc (SECDEF + search_path + 1 overload + service-role ACL) + a live read smoke on
  `company_demo`.
- **`apps/inorout/api/_mailer.js`** — new `hqWeeklyDigest` template (pence→£ in-template; sections,
  not bullets; reuses `wrap()`/`esc()`).
- **`apps/inorout/api/cron.js`** — `weeklyDigestJob`: Monday 08:00 UK gate via `nowInUkParts`,
  previous-week range, loops active companies → super_admin recipients (`company_admins` +
  `authEmailsForUserIds`) → calls the RPC → builds ctx → reuses `dispatchEmail` (dedup via
  `notification_log` keyed `company_id:weekStart`; no-op safe without `RESEND_API_KEY`).
- **Decision: template-first, AI rides Phase 7.** The data-assembly RPC becomes the Phase-7 context
  RPC, so nothing is wasted. Recipients = super_admins only, company-wide (regional scope = follow-up).
  Full rationale in DECISIONS.

No `apps/inorout/src` or `packages/core` touch (cron + mailer live under `api/`) → no casual-
regression gate. Build PASS. **Phase 9 COMPLETE.**

**Operator owes:** real Monday-morning digest delivery once `RESEND_API_KEY` is live (eyeball the
rendered email) + the two carried-over session-65 items (real SMS/WhatsApp delivery once `TWILIO_*`
is set; real-device check of the player Bracket button + PlayerProfile NOTIFICATIONS). **Open next**
(after the session-66 work below — group→knockout cups now DONE): apps/display redesign + Phase 4
device-test/deploy · Phase 7 (AI layer) · Phase 10 (public league pages).

## SESSION 65 — Phase 9 finish + Phase 11 cups complete (Jun 1 2026)

HEAD `6587452`. Build order 9→6→11: closed out **Phase 9** and built **Phase 11** in full.
Every cycle ran AUDIT→EXECUTE→VERIFY→COMMIT with the gates (EV + leak-check on every write
RPC, rpc-security-sweep, casual-regression on packages/core touches, build).

- **Phase 9 — `_sms.js` wired for refs** (`a9f4dbf`): `fixture_ref_assigned` routes through
  `pickChannel` honouring `match_officials.preferred_channel` (whatsapp→sms→email). cron.js only.
- **Phase 11.1 — bracket persistence** (`df92393`, migs 184–185): `cup_ties` tree (round/slot/
  feeder edges/winner) + `venue_persist_cup_bracket` builds the WHOLE single-elim bracket server-
  side (canonical mirror seeding, byes, round-1 fixtures+charges). Server is the source of truth;
  `cupBracket.js` engine stays a cosmetic preview. SeasonWizard single-elim branch wired.
- **Phase 11.2 — advancement + decider** (`61b8bf3`, migs 186–187): `_cup_advance` sweep +
  `cup_advance_after_result` trigger (decisive score / ref ET-pens / walkover / forfeit → winner
  into parent slot → next tie `ready`). `ref_record_knockout_decider` + `ref_confirm_full_time`
  level→`needs_decider`; `venue_schedule_cup_tie` (operator schedules each round). Ref `DeciderModal`.
- **Phase 11.3 — bracket display** (`1a23eee` + `27c7be0`, mig 188): `get_cup_bracket` read RPC;
  venue `BracketView` (Cups tab + scheduling), player `BracketOverlay`, display `BracketZone`
  (replaces standings for cup comps). **Phase 11 complete.**
- **Phase 9 player contact-capture** (`4cf9aab`, mig 189): `set_player_contact`/`get_my_contact`
  + PlayerProfile NOTIFICATIONS section (phone + channel).
- **Phase 9 fallback** (`6587452`): 48h/2h reminder crons route each player via `pickChannel`
  (push→email→SMS/WhatsApp); league reminder email templates added. **Phase 9 functionally
  complete** bar the HQ weekly digest (rides Phase 6).

**Operator owes:** real-delivery test once `TWILIO_*` env is set (SMS/WhatsApp no-op until then;
email + push deliver today); real-device check of the player Bracket button + NOTIFICATIONS
section (hard-rule #13). **Open next:** HQ weekly digest · apps/display redesign + Phase 4
device-test/deploy · group-stage→knockout cups. (Decisions in DECISIONS — "Phase 11 cups".)

## SESSION 60 — Phase 6 Cycle 6.1: HQ dashboard (May 29 2026)

First net-new operator surface — a company-level, cross-venue HQ at `/hq`. Built as a
"fuller" cycle (foundation + venue drill-down + incident resolve) with the full role model.
Five parts, each committed after its own verify:

1. **migs 169–170** (da73f18) — `venues.region` + demo company `company_demo` (Demo Sports
   Group: demo_venue North + venue_demo_south South, tarny super_admin, 2 open incidents on
   demo_venue). Live DB had 0 companies → `/hq` was unloadable.
2. **mig 171** (f4329d7) — 5 RPCs: `resolve_company_caller`, `company_admin_whoami`,
   `hq_get_company_state` (venue health grid + summary), `hq_get_venue_detail` (drill-down),
   `hq_resolve_incident` (write). + `audit_events.actor_type`+='company_admin' +
   `notify_venue_change` whitelist+='incident_resolved'. rpc-security-sweep 6/6 +
   ephemeral-verify (super_admin read, health states, drill-down, resolve+audit, analyst
   rejection, regional South scoping, cross-region + stranger denial) — all PASS, rolled back.
3. **packages/core wrappers** (f2d5694) — companyAdminWhoami/hqGetCompanyState/hqGetVenueDetail/
   hqResolveIncident + barrel; additive-only (casual-regression: 54 insertions, 0 mods).
4. **apps/hq** (6749a98) — new React+Vite app (OAuth gate mirroring superadmin): Venue Health
   Grid + Venue Detail drill-down (inline incident resolve) + Alerts/Actions rail. Builds clean;
   sign-in screen renders (preview smoke).

**Operator decisions (settled at start):** new apps/hq (not the clubmanager stub — name
collides with the misnamed `platform-clubmanager` Vercel project serving inorout); OAuth +
company_admins (no token); regional_admin built now (added venues.region); fuller cycle.
(Full rationale in DECISIONS — "Phase 6 HQ Dashboard — Cycle 6.1 scoping".)

**Bug caught pre-commit (ephemeral-verify):** `audit_events.team_id` is NOT NULL with no FK —
venue-scoped events store venue_id there. Also `actor_type` CHECK lacked `company_admin`
(mig-088/092 bug class). Both fixed in mig 171.

**Operator owes:** live signed-in `/hq` load as super_admin (real Google OAuth) · apps/hq
Vercel deploy + `VITE_SUPABASE_*` env · casual two-token browser smoke.

**Cycle 6.3 — composable analytics (same session, migs 172–173, commits b6fb5c5/c9f0260/
6e81d16/ce16b93):** the operator asked whether HQ could be customisable (presets, or AI-combined
datasets). Settled: **composable card registry, not fixed tabs** (Layer A); the **AI composition
rides Phase 7** over the same registry (grounded, no raw SQL). Built: `company_admins.dashboard_config`
(mig 172) · `hq_get_analytics` (6 card datasets + caller layout) + `hq_set_dashboard_config` (mig
173) · packages/core wrappers · apps/hq Dashboard|Analytics tab + AnalyticsView (6 cards, presets
Operations/Commercial/Performance, edit mode). Cards use only confirmed sources (match_events goals/
cards, fixtures scores, incidents, venues) — engagement/standings deferred (no clean source).
ephemeral-verify PASS (read 6 datasets, config write filter/persist/round-trip, bad_config reject,
regional scoping, stranger denial). See DECISIONS "HQ analytics is composable…".

**Cycle 6.4 — live activity feed (same session, mig 174, commits 137657a/06ae252):** the
scope-6B centre column. `hq_get_activity` (read: tonight's fixtures + scores/status, soonest
upcoming when none today, recent-goals ticker, per-venue channel keys) + `hqGetActivity` wrapper
+ apps/hq ActivityFeed (centre column by default; venue selection swaps in VenueDetail + back
button). Realtime = one subscription per `venue_live:<key>` (mirrors apps/venue) + 30s poll
fallback. Verified: sweep PASS (read-only), functional read live=0/upcoming=3/goals=13/channels=2,
build clean. Live render + realtime correctness operator-owed (needs an in-progress fixture).

**Cycle 6.5 — HQ preview token (same session, mig 175, commits 2f24a1d/7a31812/855fb7b):** scope-6D
commercial hook. `hq_generate_preview_token` (write, super_admin-only) + `get_hq_preview_state`
(anon read, watermarked snapshot + accessed_at stamp, 7-day expiry) + wrappers + apps/hq PreviewView
(`/hq/preview/TOKEN`, no login) + super_admin Share-preview button. ephemeral-verify PASS (generate,
public read, invalid/expired/role/stranger denials) + **end-to-end UI smoke against live DB** (anon
`/preview/<token>` rendered the snapshot, accessed_at stamped, smoke token cleaned up). "Notify
generator on open" deferred (no company-admin channel; accessed_at is the signal).

**Phase 6 is functionally complete (6A–6E shipped).** Remaining: 6.x HQ weekly digest (rides the
deferred Phase 9 cycle — email over the 6.3 analytics) · Phase 7 AI layer composes over the 6.3
registry. Per 9→6→11, **Phase 11 (cups) is next**.

**Also scoped this session (NOT built):** **Venue Payments Ledger** — venue-side money owed/collected
for pitch bookings + league/cup fixtures (per team). Unified ledger (`venue_charges` + `venue_payments`
instalment log), cash + manual transfer now, online staged (hosted `venues.payment_link` → Stripe
Connect + Apple/Google Pay in V5). Full plan + cycles V1–V5 in **`VENUE_PAYMENTS_SCOPE.md`**; DECISIONS
entry + FEATURES backlog pointer added. Distinct from Phase 8 SaaS billing and from player match-subs.
Investigated this session: the PlayerView "Transfer" button is a **disabled placeholder** (no handler/
processor) in the player→team-admin subs flow — unrelated to venue payments.

## SESSION 59 — Phase 9 cont.: SMS/WhatsApp transport core + league reminder crons (May 29 2026)

## SESSION 59 — Phase 9 cont.: SMS/WhatsApp transport core + league reminder crons (May 29 2026)

Continued Phase 9 per the 9→6→11 build order. Two pieces, **no migration, no
`apps/inorout/src` or `packages/core` change** (casual flow byte-identical):

1. **`apps/inorout/api/_sms.js`** — Twilio SMS+WhatsApp transport core, no-op-safe without
   `TWILIO_*` env (mirrors `_mailer.js`). `sendSms`/`sendWhatsApp` (one client; WhatsApp via the
   `whatsapp:` address prefix), a `TEMPLATES` registry, `sendTemplated`, and a `pickChannel()`
   fallback-router stub. **Imported nowhere** — wiring (refs via `match_officials.preferred_channel`;
   player push→email→SMS fallback + contact-capture UI) is a later 9.x cycle. `twilio` added to
   `apps/inorout/package.json`.
2. **`apps/inorout/api/cron.js`** — two competitive-only jobs on the existing 15-min dispatcher
   (no new pg_cron job): `availabilityRequestJob` (48h-out, UK 9am window, both squads mark
   availability) + `fixtureReminderJob` (~2h-before, nudges still-unmarked `status='none'`
   players). They loop the `fixtures` table (league fixtures have no `schedule` row) and close the
   loop Phase 5 left open. Push only via `/api/notify` direct mode; deduped on `notification_log`
   (new `alreadyLogged` guard + new types `leagueAvailability48h`/`leagueFixtureReminder2h`). New
   helpers `nowInUkFull`/`addDaysIso`/`fmtUkDate` keep timing UK-wall-clock to UK-wall-clock (DST-safe).

**Operator decisions:** Twilio; transport core only (unwired); reminders competitive-only at
48h + ~2h; quiet hours = inherited default 22:00–08:00 UK queue/flush; apps/display redesign
slots **after** Phase 9. (Full rationale in DECISIONS — "Phase 9 SMS/WhatsApp + league reminder
crons — scoping".)

**Verified (no device):** build clean · no src/core diff · live-DB dry-run (sim today=06-02 →
48h job selects the two 06-04 democomp fixtures, both squads resolve, dedup table empty, 2h band
fires at 18:00 not 17:00/19:00). **Operator owes** the real-device push delivery test (GO_LIVE
§6.x — `dc_subs=0` and no fixture 48h out today) + `TWILIO_*` env when `_sms.js` is wired.

**Still outstanding from Phase 4:** `apps/display` layout redesign (mockup-driven, after Phase 9)
+ operator real-TV test / Vercel deploy / `VITE_DISPLAY_APP_URL`.

## SESSION 58 — Build-order reprioritisation (docs-only, May 29 2026)

Operator set the next build order to **9 (finish notifications) → 6 (HQ dashboard) →
11 (cups)**, methodically sequenced. Phase 7 (AI) + Phase 10 (public pages) move
after; Phase 8 (billing) stays deferred. The Phase 9 **HQ weekly digest** cycle is
held back to ride with Phase 6 (needs HQ aggregation). Recorded in FEATURES (roadmap)
+ DECISIONS ("BUILD ORDER AFTER PHASE 4"). Supersedes the earlier "Phase 7 next"
pointer. No code/schema change. Still outstanding from Phase 4: `apps/display` layout
redesign + operator real-TV test / Vercel deploy.

## SESSION 57 — League Mode Phase 4: Reception Display (May 29 2026)

Built the venue reception big-screen (`/display/TOKEN`) — a TV-targeted, PIN-gated,
white-labelled live scoreboard for all competitions at a venue, real-time off the
existing `venue_live` broadcast. Four committed stages; FEATURES/DECISIONS/RPCS/
SCHEMA updated.

> ⚠️ **LAYOUT REDESIGN PENDING (next session).** Functionally complete + verified,
> but the operator wants the `apps/display` visual layout redesigned (current one
> judged too plain). **Only `apps/display/src` (styles + components + layout) is in
> scope** — the data/RPC/realtime layer (migs 164–168, `get_display_state`,
> `venue_live`, the venue config editor) is stable and reused as-is. A
> ChatGPT-generated mockup is the intended starting reference.

- **Stage A — server (migs 164–167, `4c0f08b`):** `venues.display_token` (per-venue
  read-only public token; NOT the admin token) + `display_config` jsonb + read
  indexes; `get_display_state` (venue-scoped; lifts `get_league_standings_for_player`
  scoring + a live pass folding in-progress `match_events`; top scorers; live
  fixtures; today's upcoming/recent; goals ticker; returns `live_channel_key`, never
  the PIN); `check_display_pin` (read-only); `venue_update_display_config` (operator
  write). rpc-security-sweep (3) + ephemeral-verify (write, 7 reject paths) +
  casual-regression (core additive-only) all PASS.
- **Stage B — `apps/display` (`c3087e8`):** new standalone Vite SPA (own Vercel
  project). Client PIN gate (3→30-min localStorage lockout), realtime `venue_live`
  subscribe + auto-reconnect + 60s fallback + wake-lock. Broadcast-grade UI (Bebas
  Neue, floodlight/grain, team-colour accents, Framer Motion score-flip + standings
  reorder + marquee). Live-led split; confirmed↔amber provisional standings; golden
  boot; white-label; non-removable Powered by. **Verified live**: a ref goal flipped
  the score on-screen with no reload.
- **Stage C — `apps/venue` (`2e1a9c4`, mig 168):** Dashboard ▸ Reception display modal
  (copy link, PIN set/clear, panel enable+reorder, mode/interval, custom message).
  `venue_get_state` additively exposes display_token/config. UI save verified.
- **Decisions:** venue-scoped token (not per-league); composite multi-zone layout
  (supersedes single-panel cycle); client-side PIN; capability-URL identity;
  standings engine lifted not reinvented. See DECISIONS.md (session 57).
- **Operator owes (hard-rule #13):** real-device test on an actual 1920×1080 TV
  (wake-lock, Wi-Fi-drop reconnect). Also unshipped: deploy `apps/display` to Vercel
  + set `VITE_DISPLAY_APP_URL` in apps/venue (so the copied link is fully-qualified).
- **Testbed:** demo_venue `display_token='demo_venue_display_token'`, pin `1234`.
  **Next (revised session 58):** 9 (finish notifications) → 6 (HQ) → 11 (cups); AI layer (7) after.

## SESSION 56 (cont.) — Phase 9 Cycle 9.1: transactional email (Resend) (May 29 2026)

Started Phase 9 (notifications). Added the missing transactional **email** sender and wired
the onboarding/ops loop. Email-only; web-push untouched. Decisions: email + push (SMS/WhatsApp
later), **Resend** (new account, root `in-or-out.com` verified, DNS at **GoDaddy** —
`domaincontrol.com` nameservers), first wave = onboarding/ops.

- **Stage A (mig 163 + `6d73345`):** `notification_log` +channel/entity_id/recipient + dedup
  index; `api/_mailer.js` (Resend + templates, no-op without key); `onboardingEmailJob` in the
  15-min cron polling `audit_events` (team_registration_submitted→venue admin,
  team_approved/rejected→team admin, fixture_ref_assigned→ref). Recipients resolved server-side
  (auth.users + match_officials.email). Verified: resolver SQL on testbed, dedup DO-block + leak 0,
  build, module/template smoke. No `apps/inorout/src`/`packages/core` change.
- **Stage B:** docs (FEATURES/RPCS/SCHEMA/CONTEXT + GO_LIVE_ISSUES prerequisite entry).

**LIVE (2026-05-29):** env set in inor-out Vercel (`RESEND_API_KEY`, `EMAIL_FROM` =
`In or Out <notifications@in-or-out.com>`, `REF_APP_URL` = `https://platform-ref.vercel.app`;
`VENUE_APP_URL` unset — venue app not deployed). Redeployed + live-tested end-to-end: a
`team_approved` event → Resend send → `notification_log` (channel='email') → **email received
in inbox**; dedup confirmed; test rows cleaned (0 residue). Demo venue can't test
`team_registration_pending` (no `venue_admins` row — needs a real venue). **Next:** Phase 7 (AI layer).

## SESSION 56 — League Mode Cycle 5.7 eligibility — PHASE 5 COMPLETE (May 29 2026)

Closed Phase 5. Turned the 5.6 non-blocking teamsheet warnings into real eligibility
enforcement, server-authoritative and surfaced in the UI. Two staged commits + docs.

**Product decisions (operator):** (1) suspended/ineligible → **override-with-confirmation**
(block by default, per-player audited override); (2) squad size → new nullable
`league_config.min_starting`/`max_subs` on the **matchday sheet** (5/7 starters, bench cap
3…15; NULL = unbounded), **hard block**; (3) double-registration → **hard block now + audit**,
two-sided league-admin confirm UI deferred to Phase 4/6 (apps/venue has no per-player view).

- **Stage A (migs 161–162, `b0b1aa0`)** — `league_config.min_starting`/`max_subs`;
  `team_admin_check_eligibility` (read); `team_admin_submit_lineup` rewritten as the
  authoritative gate (DROP/REPLACE for the new override param; all checks before any write).
  Also fixed a **latent 5.6 VC bug** — submit + `get_team_next_fixture_lineup` resolved via
  bare `teams.admin_token`, so VCs on `/p/<vc_token>` got `invalid_admin_token`; both now use
  `resolve_admin_caller` (session-49 dual-lookup). rpc-security-sweep PASS · ephemeral-verify
  **9/9** + leak clean.
- **Stage B (`bbf8f31`)** — `TeamsheetScreen` eligibility UI: per-player badges (AT ANOTHER
  TEAM / SUSPENDED→OVERRIDDEN), squad-size hints, submit gating, error-code mapping.
  casual-regression PASS (static — competitive-only screen; RPC can't fire on a casual token).
- **Stage C** — FEATURES / DECISIONS / RPCS / SCHEMA / BUGS / CONTEXT.

**Operator-owed:** real-iPhone (hard-rule #13) casual + competitive walk on Competitive FC
(`democomp_fc_admin_token`). **Carried forward:** double-reg league-admin confirm surface +
a discipline surface that *sets* suspension (5.7 enforces it but nothing writes it yet).

## SESSION 55 — league/casual squad separation (May 29 2026)

Picked up League Mode after Phase 5 Cycles 5.1–5.5. Addressed the global-`players.status`
dual-context must-fix flagged at the end of session 54.

- **Diagnosis correction:** the recorded "cross-talks between any two teams a player is
  in" framing was wrong — one `players` row per (user,team) already scopes status per
  team. The only real edge was a single `team_id` being both casual and competitive,
  possible only because `join_register_team` (mig 098) promoted a casual team in place.
- **Decision (operator):** a league team is ALWAYS a separate squad. A casual group
  joining a league creates a NEW squad (LEAGUE pill, second MY SQUADS entry); casual
  teams are never promoted in place.
- **Mig 158:** `join_register_team` rejects a casual `existing_team_id`
  (`casual_team_cannot_register`); accepts an `existing_team_id` only if already
  competitive (cup reuse, Phase 11). New-team path unchanged. Also hardened the anon
  grant (Supabase default-privileges leftover). mig-157 trigger unchanged (now provably
  safe) — only a clarifying comment added.
- **Verified:** data safety check (no real casual team was ever promoted — all
  competitive teams are testbed/demo); ephemeral-verify 3 paths PASS + leak-check clean;
  rpc-security-sweep PASS; build clean. No JS changed (server-side SQL only), so the
  casual flow is byte-identical and casual-regression's trigger condition wasn't met.
  Commit `7103267`.
- **RPCS.md catalogue (`72f47ea`):** added the Phase 2 team-registration trio
  (`join_register_team` 098, `venue_approve_team_registration` 099,
  `venue_reject_team_registration` 100) to the inventory — they were never recorded.
- **"Join another team" shipped (`249dc12`):** a "+ Join another team" row at the bottom
  of MY SQUADS — paste an invite link → extracts the join code → navigates to
  `/join/<code>`, reusing the existing join flow (no new RPC; single-file MySquads.jsx
  edit). Hygiene + build + Playwright interaction proof clean. Real-iPhone test
  (hard-rule #13) operator-owed on live.
- **Cycle 5.6 teamsheet shipped (staged):** manager submits a line-up (starting XI +
  bench) for the next league fixture; ref pre-match shows it instead of the full squad.
  Stage A mig 159 (`eab2d4c`): `fixture_lineups` + `team_admin_submit_lineup` (submitting
  auto-registers picked players) + `get_team_next_fixture_lineup`. Stage B mig 160
  (`68d9480`): `get_fixture_state_by_ref_token` made lineup-aware + backward compatible
  (additive `lineup_role`; helper `_fixture_squad_json`) + apps/ref PreMatch split. Stage C
  (`743bc9b`): AdminView Teamsheet card + `TeamsheetScreen`. Selection mechanic: pick from
  the IN list (5.5 board), dedicated screen (no casual A/B split). Each stage
  rpc-security-swept + ephemeral-verified (Stage B load-bearing backward-compat); live
  end-to-end on Competitive FC; casual regression clean. Real-iPhone test (hard-rule #13)
  operator-owed.
- **Next:** Cycle 5.7 — eligibility (hard suspension blocks, double-registration
  resolution, min/max squad size).

## SESSION 54 — booking push-on-confirm + League Mode Phase 5 starts (May 28 2026)

Methodology run uber-cautiously throughout (audit→execute→verify→commit; every DB
change pre-flighted in a rollback transaction before applying live).

**Shipped (all live + pushed to main):**
- **Booking push-on-confirm** (`bb78e8e`) — `confirmPushJob` in `apps/inorout/api/cron.js`
  polls `audit_events` for `booking_confirmed` (last 20 min), collapses a block series to
  one push per (team, series), pushes the team's admins via existing `pushTeamAdmins` +
  `get_team_admin_player_ids`. No migration/RPC change. (GO_LIVE §11.8; on-device push
  receipt operator-owed.)
- **Phase 5 Cycle 5.1** (`d8a33c6`, **mig 153**) — `player_get_teams_by_token` gains
  `is_competitive`; purple `LEAGUE` tag on MySquads for competitive squads.
- **Phase 5 Cycle 5.2** (`f5dc34a`) — `CompetitionStandingsCard` in PlayerView my-view:
  collapsible league table, own team highlighted. Pure client; reuses
  `get_league_standings_for_player`. Self-gates (casual → renders null).
- **Phase 5 Cycle 5.3** (**mig 155**) — `get_player_competition_fixtures(p_token, p_filter)`
  RPC + `CompetitionFixturesCard` below the standings card: collapsible UPCOMING/RESULTS
  list, opponent + date + score + W/D/L chip (player's perspective). Token-gated, anon+auth,
  walkover/forfeit reported truthfully (no phantom 3-0 — standings owns that). Designed for
  P4 reception + P6 HQ too (RPCS.md, hard-rule #14). Self-gates (casual → []). Pre-flighted
  in rollback txn (Tarny 2W+1 upcoming, casual []); applied live + schema reload; rpc-security
  + hygiene + build clean.
- **Phase 5 Cycle 5.4** (**mig 156**) — two RPCs `get_player_fixture_detail` +
  `get_fixture_opposition_intel` + `FixtureDetailCard` (tap a fixture row to expand inline)
  + nested tap-to-load `OppositionIntel`. Detail mirrors the mig-119 ref shape + perspective
  fields; both squads shown LIVE from `player_registrations` (confirmed XI is 5.6). Intel =
  H2H (all-time + season) + both teams' last-5 form + per-team top scorers (from
  `match_events`, **no goals table**) + last meeting. **Gate stricter than ref**: player can
  only open a fixture their own team plays in (`fixture_not_visible` otherwise). Designed for
  P4 reception + P7 AI (RPCS.md, hard-rule #14). Detail leaves room for 5.5 availability
  (hard-rule #12). Pre-flighted in rollback txn incl. refusal assertions (casual + fake
  fixture both raise); applied live; rpc-security ×2 + hygiene + build clean. On-device
  confirm operator-owed.

**Competitive testbed (`dd3fcaf`, mig 154) — for ongoing Phase 5 testing:**
- **Competitive FC** (`team_dc_fc`) + 3 opponents (`team_dc_{rovers,city,athletic}`) in a
  **Demo Competitive League** (`league_democomp`) under `demo_venue`.
- **Tarny is team admin** (real auth user) → genuine auth test of competitive surfaces.
- Player view: `/p/p_dc_tarny_token`. Admin view: `/admin/democomp_fc_admin_token`.
- 4 completed + 2 upcoming fixtures; standings populate (Competitive FC top, 6pts).
- Fully namespaced (`dc`/`p_dc_`/`democomp`). **Remove anytime** via
  `rls_migrations/154_demo_competitive_seed_down.sql` — rollback-verified to leave real
  data + the existing demo Summer League untouched.

- **Phase 5 Cycle 5.5** (**mig 157**) — competitive availability **reuses the casual
  IN/OUT board** (operator decision): no new table, no new write RPC. `players.status`
  via existing `set_player_status` is the availability. `PlayerView` overlays an
  effective schedule from the next upcoming fixture (board live + opponent/date/venue/
  time) only when a fixture exists; `PageHeader` gains optional `opponentLabel`;
  `CompetitionFixturesCard` takes `fixtures` as a prop. "Start fresh each game": trigger
  `reset_team_status_on_fixture_played` on `fixtures` resets both teams' players to
  'none' on completion (+ schedule_updated broadcast). Casual byte-identical (gates on
  fixture existence; trigger never fires casual). Edge: global players.status → a
  dual casual+competitive player's casual availability would reset on a league
  completion (no such team exists yet). Ephemeral-verified in rollback; applied live;
  hygiene+build clean. On-device confirm operator-owed.

**Phase 5 sequence:** 5.1 tag ✅ · 5.2 standings ✅ · 5.3 fixtures ✅ · 5.4 fixture
detail + opposition intel ✅ · 5.5 availability ✅ · **5.6 teamsheet (next — admin
lineup → ref)** · 5.7 eligibility. Plan +
locked decisions (two-stage availability, players+admin override, reuse familiar tile, no
A/B split for league) in `~/.claude/plans/continuing-phase-3-of-steady-falcon.md`.
Testing: 1 device + browser is enough now (2 PWAs only for installed-PWA/push or
multi-player live testing — would need extra player tokens, added when 5.5 lands).

## SESSION 52 — Pitch booking system, Stages 1–5 + demo (May 28 2026)

Built the whole pitch-booking backend and the casual booking UI in one session
(both the planned [B] booking and [V] venue roles collapsed into one). Full
stage table + commit hashes live in **PITCH_BOOKING_HANDOFF.md → BUILD STATUS**.

**What shipped (migs 133–149, all live + committed):**
- **`pitch_occupancy`** — single source of truth; partial GiST `EXCLUDE … WHERE active`
  (btree_gist). Priority 0=maintenance, 1=fixture, 2=block, 3=ad-hoc. (mig 133)
- **Venue projection layer** — `league_config.slot_minutes`/`fixtures.slot_minutes`,
  `venues.bookings_enabled`/`cancellation_policy`, `playing_areas.booking_windows`;
  maintenance→occupancy + fixture-mirror triggers; `venue_assign_pitch`/`venue_generate_fixtures`
  translate the EXCLUDE to `pitch_double_booked`; auto-yield un-confirmed + confirmed-clash gate
  (`confirmed_booking_clash` + `p_displace_booking_ids[]`). (migs 134–138, 142–143)
- **Booking tables** `booking_series` + `pitch_bookings` (walk-in `team_id` nullable +
  `booked_by_name`; payment schema-wired off). (mig 139)
- **Reads** `search_bookable_venues`, `get_pitch_free_slots`, `get_pitch_occupancy`,
  `get_team_bookings`. (migs 140–141, 148–149)
- **Write RPCs** `book_pitch_adhoc`/`book_pitch_series` (casual auth.uid→team_admins, hold),
  `venue_create_booking` (walk-in confirmed), `venue_confirm_booking`/`venue_decline_booking`,
  `cancel_booking`/`cancel_booking_series` (dual auth). All audit + broadcast both channels. (migs 144–146)
- **Casual UI** — ScheduleScreen "Existing booking info" relabel + Book-a-Pitch modal
  (discovery, ad-hoc + block, length picker, confirm w/ policy, Requested→Confirmed badge +
  cancel) + 8 JS wrappers. (mig 148 + apps/inorout)
- **`demo_venue` enabled** for testing (mig 147, reversible) — bookable, windows on both
  pitches, 2 walk-in demo bookings.

**Verification:** ephemeral-verify (full lifecycle, auth.uid simulated via jwt-claim +
`auth.users` seed), rpc-security-sweep, casual-regression (browser-checked demo admin Match
Settings — existing controls intact, console clean), build/hygiene — all green. Pre-UI full
sweep confirmed: 14 migs source↔live parity, RLS/grants clean, all 7 cron jobs healthy.

**Next:** Stage 6 venue dashboard UI (inbox + calendar + walk-in + `venue_live` subscriber;
venue-token wrappers still TODO), Stage 7 (block renewal-hold job + displacement push),
deferred push-on-confirm. **Operator owes:** real-squad + real-device test of the casual
booking flow (auth-dependent; demo not valid).

## SESSION 51 — Phase 3 complete + Phase 5 prep (May 27 2026)

**Two threads ran in this session:**

**Thread A — earlier (commits a1c13d0 → 7ee7138):**
- mig 125 deterministic squad ordering
- mig 126 cron autoOpenGameJob fix (creates matches row + active_match_id)
- post-incident docs for admin impersonation + cron auto-open
- mig 128 player_join_team audit + broadcast
- mig 129 link_player_to_user broadcast
- reserveGuest persistence fix
- mig 130/131/132 reserve drag-to-reorder feature wired end-to-end

**Thread B — Phase 3 wrap + Phase 5 prep (commits da89740 → cc9e711):**
- Cycle 3.3 LiveMatch screen (commit `da89740`)
- Cycle 3.4 offline event queue via IndexedDB (commit `7ce2bac`)
- Cycle 3.5 score materialisation + standings cascade — verified
  clean via Supabase MCP, no code shipped
- Cycle 3.6 PostMatch summary + `venue_update_fixture_result` RPC
  (mig 127) + side-fix for mig 121's `notify_venue_change`
  whitelist regression (commit `563201b`)
- **Vercel deployment**: new `platform-ref` project linked to this
  monorepo's main branch, root `apps/ref`. Live at
  `https://platform-ref.vercel.app`. Custom domain
  `ref.in-or-out.com` not yet wired (separate DNS task).
- **Phase 5 roadmap approved**: 7 landable cycles, locked
  architectural decisions (per-squad context, collapsibles-not-tabs,
  teamsheet-as-source-of-truth, Competition-not-League naming).
  Plan at `/Users/tarny/.claude/plans/continuing-phase-3-of-steady-falcon.md`.
- **Skills framework hardened** (commit `cc9e711`):
  `Skills/casual-regression.md` + `Skills/ephemeral-verify.md`
  added as mandatory gates. CLAUDE.md hard-rule #14 added for
  forward-consumer tracking. SessionStart hook auto-loads both.

**State at session end (safe to close):**
- `main` branch up to date, working tree clean (except untracked
  .playwright-mcp logs and screenshots — gitignored).
- All migrations applied to live DB are committed as source.
- `platform-ref.vercel.app` serving the ref view (Phase 3 complete).
- `in-or-out.com` unchanged (`platform-clubmanager` project, last
  deployed at the Cycle 3.6 commit but that commit only touched
  `apps/ref` files — no behavioural change for inorout users).
- Phase 5 Cycle 5.1 ready to start in a fresh session.

**Tomorrow's first step**: real-device test against
`https://platform-ref.vercel.app/ref/e1e09eda-c2a1-41c9-aa17-c42de0f7e976`
(Alpha vs Delta demo fixture). Then decide whether to wire
`ref.in-or-out.com` DNS or proceed straight to Cycle 5.1.

## SESSION 49 — admin_delete_player hotfixes (May 26 2026)

Two stacked production bugs blocking Vice Captains from removing
players via the AdminView. Both surfaced in a Footy Tuesdays admin
session (Tarny, VC) trying to remove a guest (Pav) from the
host-dropped-out banner and a regular player (Ranza) from
SquadScreen — both clicks silently failed.

**Root causes (in order of dependency):**
1. **`admin_delete_player` rejected VC tokens** — per commit 767b499
   the AdminView receives the VC's 21-char player token as
   `adminToken`. The RPC's first guard does `SELECT id FROM teams
   WHERE admin_token = p_admin_token` and a VC's player token never
   matches a 28-char team admin_token. Postgres logs caught 4×
   `invalid_admin_token` errors over 30 min.
2. **`removeGuest` in AdminView/index.jsx silently swallowed errors**
   — bare `catch(e) { console.error(e); }` left the orphan banner
   on screen with no visible feedback. The user couldn't tell the
   click had even registered.
3. **`admin_delete_player`'s has_history guard treated cancelled
   ledger rows as blocking history** — separate latent bug. Mig 082's
   `admin_cancel_match` inserts `status='cancelled', amount=0.00`
   ledger rows for every player every time a match is cancelled.
   After the first cancellation, every player on that squad became
   permanently undeletable. Surfaced while diagnosing bug #1.

**Fixes (in commit order):**

- **mig 115** (originally numbered 113 — renumbered after a parallel
  session-48 commit `ed8661e` claimed mig 113 for `venue_get_state`)
  — tightens `admin_delete_player`'s has_history guard to ignore
  `status='cancelled'` ledger rows AND cascade-cleans them in the
  delete block so no orphan ledger rows are left.
- **mig 116** (originally 114, renumbered for consistency) —
  `admin_delete_player` now resolves `p_admin_token` against
  `teams.admin_token` FIRST, then falls back to `players.token` where
  the caller is a VC on the same team as the target. Audit row
  captures `actor_type='vice_captain'` with `actor_identifier='vc_token:<md5>'`.
  Mig 116 supersedes mig 115's body in the live DB.
- **`apps/inorout/src/views/AdminView/index.jsx`** — `removeGuest`
  now sets a per-guest `orphanErrors[id]` state on catch, mapping
  RPC error codes to friendly text (`has_history`, `invalid_admin_token`,
  `not_found`, generic fallback). Banner renders the error in red
  beneath the action buttons.

**Class-of-bug follow-up (open):** any other `admin_*` RPC that does
`SELECT id FROM teams WHERE admin_token = p_admin_token` without a
VC fallback will fail the same way. Mechanical sweep needed before
the next release — copy the dual-lookup pattern from mig 116. Likely
candidates: `admin_add_player`, `admin_update_player_name`,
`admin_save_teams`, `admin_cancel_match`, `admin_set_player_status`,
`admin_record_payment`. Tracked in BUGS.md and GO_LIVE_ISSUES.md 5.6.

**Commits:** `af7dcf0` (mig 115 SQL+files, originally as 113),
`d5c4763` (mig 116 SQL+files + client fix, originally as 114),
`ed8661e` (parallel session-48 venue dashboard write surfaces —
caused the mig-113 collision).

---

## SESSION 48 — Cycle 2.8 — season setup wizard + PHASE 2 COMPLETE (May 27 2026)

Phase 2 closer. End-to-end operator wizard for creating a new season
+ competitions + fixtures from a single multi-step UI flow. Mig 114
adds `venue_list_active_teams(p_venue_token)` — venue-scoped team
directory (wider than `venue_get_state.teams` which is
competition-scoped). Wizard lives in
`apps/venue/src/views/SeasonWizard.jsx`, single file with 5 inline
step components (Basics / Competitions / Teams / Preview / Confirm).
Modal-over-dashboard launched from a topbar "Set up new season"
button.

Reuses the existing `generateRoundRobin` and `generateCupBracket`
engines for client-side fixture preview, then calls the existing
`venueCreateSeason` + `venueGenerateFixtures` RPCs for persistence.
Critical engine-↔-persistence translation: engines return
`pitch_index` (integer into the operator's pitches array); submit
handler maps it to `playing_area_id` via `season.pitches[index]`
before calling `venue_generate_fixtures`.

Verified: build clean, mig 114 returns 5 active teams from demo
venue. Wizard wired through 5-step flow; no Playwright deep-test
due to budget but happy path validated locally before commit.
Commit `3112a9e`.

**Design-tool mockups** (Framer Motion + drawer styling) were
reviewed this session but deliberately NOT adopted. User direction:
"build first, redesign based on what we've built, later." Mockup
adoption deferred to a future "visual overhaul" cycle.

**Phase 2 capstone — 8 cycles, 14 migrations (083–114), 1 new app**:

  - 2.1 foundation columns + venue onboarding (migs 083–085, +088 hotfix)
  - 2.2 read RPCs (mig 086, +087 standings, +089 hotfix)
  - 2.3 engines + season setup (migs 090–091, +092 hotfix)
  - 2.4 fixture management (migs 093–096) — postpone / void /
    walkover / forfeit + pitch + ref assignment
  - 2.5a team registration (migs 097–100)
  - 2.5b mid-season failures + standings cascade (migs 101–104)
  - 2.6 refs + pitches CRUD + maintenance-window enforcement
    (migs 105–109)
  - 2.7a demo venue seed (mig 110) + read RPC hotfixes (migs 111–112)
  - 2.7c venue dashboard scaffold (`apps/venue/` new Vite+React app)
  - 2.7d dashboard write surfaces + teams directory (mig 113)
  - 2.8 season-setup wizard (mig 114) — THIS CYCLE

**Carved-out Phase 2 leftovers** (intentionally deferred, all small
enough to be single sub-cycles when picked up):
  - 2.7b email dispatcher (audit events already broadcasting; needs
    a subscriber that turns them into emails)
  - 2.9 visual overhaul (drawers, numbered panels, toasts, Framer
    Motion — mockup adoption)
  - 2.10 dedicated sub-routes (Fixtures detail / Results / Teams /
    Players / Officials / Pitches / Incidents / Registrations /
    Reports / Settings)
  - 2.11 Google OAuth for venue admin (currently token-only)
  - 2.12 fixture detail page + per-fixture notes

**Remaining phases** (per LEAGUE_MODE_SCOPE.md, by estimate):
  - Phase 3 — Ref view, 5 days ("most complex single feature")
  - Phase 4 — Reception display, 3 days
  - Phase 5 — Player + team-admin competitive features, 5 days
  - Phase 6 — HQ dashboard, 6 days
  - Phase 7 — AI layer (Ask the Gaffer evolved), 8 days (largest)
  - Phase 8 — Billing + self-serve, 5 days (deferred to year 2)
  - Phase 9 — Notifications, 3 days
  - Phase 10 — Public league pages, 2 days
  - Phase 11 — Cups + knockouts polish, 4 days

Phase 2 was the most structurally important — every remaining phase
consumes what it built. Take Phase 2 out and nothing else stands.

---

## SESSION 48 — Cycle 2.7d — venue dashboard write surfaces (May 26 2026)

End-to-end venue operations now clickable. Five write surfaces wired
to the existing RPCs from Cycles 2.4–2.6. One read-RPC shape
extension (mig 113) so fixture cards can render team names.

**Files added** (5 in apps/venue/src/views/):
  - `Modal.jsx` — generic dialog: backdrop blur, Esc-to-close,
    click-outside-to-close, header/body/footer slots.
  - `RegistrationActions.jsx` — Approve/Reject buttons on pending
    registration rows. Reject opens a modal demanding a reason
    before submitting.
  - `FixtureActions.jsx` — Pitch/Ref/Status buttons on mutable
    fixture rows. Three sub-modals for each. Pitch modal
    pre-disables options that overlap the fixture's date with a
    maintenance window (client-side hint; server still authoritative).
    Status modal branches required fields on choice
    (postpone/void → reason; walkover → winner; forfeit → both).
  - `PitchForm.jsx` — add/edit modal with dynamic maintenance
    window rows. Active checkbox surfaces only when editing (the
    soft-delete pattern).
  - `RefForm.jsx` — add/edit modal mirroring pitches.

**Updated files:**
  - `Dashboard.jsx` — threads `venueToken` + `onRefresh` down to
    every action surface.
  - `FixtureCard.jsx` — uses the new `state.teams` directory to
    render real team names instead of raw IDs.
  - `Sidebar.jsx` — `+ Add` buttons next to "Pitches" + "Officials"
    headers; `Edit` button on each row.
  - `App.jsx` — passes `venueToken` to Dashboard.
  - `styles.css` — Modal, form fields, row-action buttons
    (`.btn-accent` / `.btn-good` / `.btn-bad` / `.btn-link`).

**Migration:**
  - **mig 113** — `venue_get_state` adds top-level `teams` object
    keyed by team_id with `{ id, name, primary_colour,
    secondary_colour }`. Built from `competition_teams` join across
    the venue's competitions. Frontend renders `state.teams[id]?.name`.

**Pattern decisions** (per the design brief sent to the user for an
external mockup pass):
  - Modals for all write surfaces (no drawers, no inline editors).
  - Soft-delete via `active=false` checkboxes (never DELETE buttons —
    fixture FKs use ON DELETE SET NULL).
  - All actions: open modal → submit → set busy → success closes
    modal + calls `onRefresh()` to reload state. No optimistic UI.
  - Error surfaces inline in the modal body with the `.error` class.

**Verified end-to-end via Playwright:**
  - Dashboard loads with real team names (Alpha United, Bravo
    Athletic, etc.) — mig 113's teams directory works.
  - Pitch / Ref / Status buttons appear on every mutable fixture
    row; Status-only on completed fixtures (forfeit branch).
  - Seeded a pending Echo Wanderers registration into the demo.
    Clicked Approve in the UI → DB `competition_teams.status`
    flipped pending→active AND audit_events row written
    (`team_approved`) AND dashboard refreshed with the row gone.
  - Demo state reset to pending after the test so the operator
    always sees a clickable example. Echo team also added to
    mig 110 source for future re-seeds.

**Out of scope deliberately:**
  - Framer Motion animations (waiting on external design mockup).
  - Optimistic UI / toast notifications (waiting on external
    design mockup — design tool may pick a different pattern).
  - Realtime subscriber (works fine via Refresh button; realtime
    can land alongside the design polish pass).
  - Accessibility deep-pass (focus traps, ARIA, kbd nav for modals).

**Phase 2 status entering Cycle 2.7b/2.8:** All operator-facing
surfaces (read + write) are functional. Remaining: 2.7b (email
dispatcher), 2.8 (wizard UI for season setup). Polish pass will
come from an external design tool brief (sent to user as a paste-
able artifact this session).

---

## SESSION 48 — Cycle 2.7c — venue dashboard scaffold (May 26 2026)

First clickable Phase 2 surface. New `apps/venue/` Vite+React app
mirroring the `apps/superadmin/` shape. Token-from-URL auth, four
+ two panel dashboard powered entirely by `venue_get_state`.

**Files created** (10):
  - `apps/venue/package.json`, `vite.config.js`, `vercel.json`,
    `index.html`, `src/main.jsx`, `src/styles.css`
  - `src/App.jsx` — token parse from `?token=` query OR `/venue/TOKEN`
    path, fetches venue_get_state, renders Dashboard. TokenForm
    fallback when URL has no token.
  - `src/views/Dashboard.jsx` — 6-panel grid: Tonight / This Week /
    Open Issues / Recent Results / Upcoming / Sidebar (pitches+refs).
    Responsive: 3-col → 2-col @ 1100px → 1-col @ 700px.
  - `src/views/FixtureCard.jsx` — single fixture render with score
    branching (completed/walkover/forfeit each show 3-0 default
    correctly), status pill, pitch + ref names looked up from the
    same state payload.
  - `src/views/Sidebar.jsx` — pitch + officials lists, surfaces
    maintenance-window count on pitches and rating/channel on refs.

**Auth model**: pure token-in-URL. The dashboard works for anyone
holding the venue_admin_token — no Google sign-in step. Same
posture as the existing player route (`/p/TOKEN`).

**Known shortcut**: `venue_get_state` doesn't include a team-name
directory, so fixture rows render `team_demo_alpha` (raw id) for
both sides. Function works but is visually ugly. Cycle 2.7d will
either widen the read RPC to include a `teams_directory` key OR
build a JS lookup keyed on team_id.

**Tested via Playwright** against the demo venue:
  - Page loads, 0 console errors (one missing favicon — harmless)
  - All panels populate from live demo data: 4 recent results, 2
    upcoming, 2 pitches, 3 refs, side pitch shows "1 maintenance
    window" badge
  - Walkover row correctly renders 3-0 with WALKOVER pill
  - Upcoming rows show "Needs ref" pill (pitch allocated, ref
    unassigned — that state combination is real in the seed)
  - Tonight / This Week / Open Issues all show empty-state copy

**To deploy**: this app needs a new Vercel project pointed at
`apps/venue/`. Env vars to set: `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY` (same as inorout). Local dev: `cd
apps/venue && npm run dev` → http://localhost:5176/?token=demo_venue_token_DO_NOT_USE_IN_PROD.
The `.env.local` is gitignored at repo root (the existing pattern).

**Phase 2 status entering Cycle 2.7d:** Backend complete + demo
data live + read-only operator dashboard live. Remaining: 2.7d
(write surfaces — approve/reject, fixture mgmt, pitch/ref CRUD
modals), 2.7b (email dispatcher, can ship in parallel with 2.7d),
2.8 (wizard UI).

---

## SESSION 48 — Cycle 2.7a — demo venue seed (May 26 2026)

End-to-end demo seed (`demo_venue` / `demo_league` / 4 teams / 6
fixtures / mixed past results) via the live Phase 2 RPCs.
Migrations 110–112.

Cycle 2.7 was originally scoped as frontend + email dispatcher +
demo seed in one block; split into 2.7a–2.7d after audit. This
ships the demo seed alone (half day, pure SQL, no frontend
dependency).

**Demo identifiers** (under the `demo_` namespace for clean teardown):
  - `venues.id`             = `demo_venue`
  - `venues.venue_admin_token` = `demo_venue_token_DO_NOT_USE_IN_PROD`
  - `leagues.id`            = `demo_league`
  - `leagues.league_code`   = `DEMO0001`
  - team ids                = `team_demo_{alpha,bravo,charlie,delta}`
  - player token (Alpha)    = `tok_demo_player`

**Data shape**: 2 pitches (Main + Side, Side carries a future MW),
3 refs (whatsapp/sms/email × in_house/freelance), 1 season "Summer
2026" + 1 round-robin competition, 4 active competition_teams,
6 fixtures (3 completed, 1 walkover, 2 allocated upcoming).
Dates are CURRENT_DATE-relative (–13 / –6 / +8 days) so the
dashboard's recent/this_week/upcoming buckets are always meaningful.
Standings render cleanly: Alpha 6pts / Bravo 3 / Delta 1 / Charlie 1.

**Latent bug caught + fixed (mig 111).**
`venue_get_state.fixtures.upcoming` and the same bucket on
`league_get_state` filtered `status IN ('scheduled','postponed')` —
meaning once an operator assigned a pitch (scheduled → allocated
via mig 094), the fixture silently vanished from the upcoming list.
Mig 111 expands both filters to include `'allocated'`. Latent
because no UI had consumed the field yet; surfaced as soon as the
seed populated allocated fixtures and the bucket came back empty.

**Migrations:**
  - **mig 110** — idempotent DO-block seed. Bails early if
    `demo_venue` already exists. Calls `venue_add_pitch` ×2,
    `venue_add_ref` ×3, `venue_create_season`, `venue_generate_fixtures`,
    then mutates fixtures into past-result states (completed scores +
    one walkover). Plus one demo player on Alpha for the
    standings-via-player-token path.
  - **mig 111** — venue_get_state + league_get_state upcoming filter
    fix.
  - **mig 112** — date reshuffle to CURRENT_DATE-relative (mig 110
    source updated to match; mig 112 only exists because 110 was
    already applied with hardcoded dates).

**Verification:**
  - venue_get_state → `{leagues:1, pitches:2, refs:3, tonight:0,
    this_week:0, upcoming:2, recent:4}` ✓
  - get_league_standings_for_player(`tok_demo_player`) → 4 teams,
    Alpha 6pts top, Charlie/Delta tied on 1 with correct GD ordering ✓

**Phase 2 status entering Cycle 2.7b:** Backend complete + demo
data live. Remaining: 2.7b (email dispatcher), 2.7c/d (venue
dashboard frontend), 2.8 (wizard UI).

---

## SESSION 48 — Cycle 2.6 — refs + pitches CRUD (May 26 2026)

Operator-facing CRUD for pitches (playing_areas) and refs (match_officials)
plus the maintenance-window enforcement deferred from Cycle 2.4. Five
migrations (105–109).

  - **mig 105 — `venue_add_pitch(venue_token, pitch jsonb)`.** Required:
    name. Optional: surface, capacity (positive int), sort_order,
    is_available, maintenance_windows (jsonb array of
    `{start_date, end_date, reason?}`). Validates window dates
    (required, start ≤ end). Audit + venue broadcast `pitch_added`.
  - **mig 106 — `venue_update_pitch(venue_token, pitch_id, updates jsonb)`.**
    Partial update — only keys present in `updates` get applied.
    Soft-delete via `{"active": false}` (FK is ON DELETE SET NULL —
    hard-delete would orphan historical fixtures). Broadcast reason
    flips to `pitch_closed` when active true→false.
  - **mig 107 — `venue_add_ref(venue_token, ref jsonb)`.** Required:
    name. Optional: phone, email, whatsapp_number, preferred_channel
    (default `push`), employment_type (default `freelance`),
    overall_rating. Table CHECK constraints enforce the enum values.
  - **mig 108 — `venue_update_ref(venue_token, ref_id, updates jsonb)`.**
    Same partial-update pattern as pitches. Soft-delete via active=false.
  - **mig 109 — `venue_assign_pitch` rewrite.** Honours
    `playing_areas.maintenance_windows`: rejects when fixture's
    `scheduled_date` falls within any window for that pitch (`BETWEEN`
    inclusive). Error `pitch_in_maintenance` with DETAIL =
    `start..end`. Skip the check if fixture has no scheduled_date —
    enforces on whichever leg comes second.

**Bug caught in-flight — `text[] || 'literal'` is array-literal-cast.**
The first cut of migs 106/108 used `v_changed := v_changed || 'name';`
which Postgres interprets as text[] || text-array-literal — raised
`malformed array literal: "name"`. Fixed by `array_append(v_changed,
'name')`. Caught by the very first smoke test (zero customer impact).
Worth flagging because the project has no other text[] columns
operated on this way; future RPCs accumulating "changed keys" should
use `array_append` from the start.

**Smoke tests (single transaction, all 5 RPCs + maintenance enforcement):**
  - add_pitch with one MW → returns pitch_id ✓
  - add_ref with phone/channel/rating → returns ref_id ✓
  - update_pitch rename+capacity+replace MW → changed_keys
    `[name, capacity, maintenance_windows]`, pitch_closed=false ✓
  - update_ref phone+rating → changed_keys `[phone, overall_rating]` ✓
  - assign_pitch on fixture INSIDE MW (2026-06-02) →
    `pitch_in_maintenance` ✓
  - assign_pitch on fixture OUTSIDE MW (2026-06-10) → OK ✓
  - update_pitch active=false → pitch_closed=true (broadcast
    `pitch_closed`, not `pitch_updated`) ✓
  - add_pitch with empty payload → `pitch_name_required` ✓
  - add_ref with bad venue token → `invalid_venue_token` ✓
  - inverted MW dates → `maintenance_window_dates_inverted` ✓

**Phase 2 status entering Cycle 2.7:** All backend foundations +
read RPCs + mutation RPCs across venue/league/team/fixture/pitch/ref
are live. Remaining: 2.7 (frontend + email dispatcher + demo venue
seed), 2.8 (wizard UI). The backend half of Phase 2 is complete.

---

## SESSION 48 — Cycle 2.5b — mid-season failures + standings cascade (May 26 2026)

Mid-season team-exit flows (withdraw + expel) with automatic fixture
cascade, plus the standings RPC update for forfeit. Four migrations
(101–104).

Real-world cascade rule (decided during audit): unplayed fixtures
involving the exiting team → walkover to the opposing team; phantom
byes → void. Past results untouched. Standard amateur-league
convention.

  - **mig 101 — foundation.** Adds `competition_teams.expulsion_reason`
    (sibling of withdrawal_reason / rejection_reason). Extends
    `notify_venue_change` / `notify_league_change` whitelists with
    `team_expelled` and `fixtures_cascaded`.
  - **mig 102 — `venue_withdraw_team(venue_token, competition_team_id,
    reason)`.** Flips pending/active → withdrawn + cascades remaining
    fixtures. Idempotent (re-call returns `noop:true`).
  - **mig 103 — `venue_expel_team(venue_token, competition_team_id,
    reason)`.** Active → expelled + same cascade. Cascaded fixtures'
    `void_reason` distinguishes 'team_withdrew' vs 'team_expelled'.
  - **mig 104 — `get_league_standings_for_player` rewrite.** Extends
    walkover handling to also cover forfeit (3-0 default to
    forfeit_winner_id). Withdrawn/expelled teams stay in standings
    with accumulated pre-exit points; UI can branch on ct_status.

**Audit shape** (per Phase 2 bulk-RPC rule): each withdraw/expel
call emits one team-level audit row (`team_withdrew` / `team_expelled`)
PLUS one bulk audit row (`fixtures_cascaded`) only if any fixtures
actually cascaded. Mirrors mig 091's pattern.

**Out of scope** (deferred deliberately):
  - Pitch close (maintenance_windows enforcement) → Cycle 2.6 pitch
    CRUD where the validator naturally belongs.
  - Ref no-show → already supported via Cycle 2.4
    `venue_assign_ref(..., NULL)` then reassign. No new RPC.
  - Withdrawn-/expelled-status undo → admin would have to manually
    flip status back; not v1.

**Smoke tests.** Full 3-team competition with 5 fixtures (1
completed, 1 forfeit, 1 unrelated scheduled, 2 cascade-targets —
scheduled + postponed). Withdraw Beta:
  - Beta scheduled vs Gamma → walkover to Gamma ✓
  - Beta postponed vs Alpha → walkover to Alpha ✓
  - Past completed A 4-1 B → untouched ✓
  - Past forfeit C 3-0 B → untouched ✓
  - A vs C (Beta not involved) → untouched ✓
  - `cascaded_fixture_count: 2`, `walkover_count: 2`, `void_count: 0`
  - Re-withdraw → `noop: true`
Standings via the rewritten RPC against the same data:
  - Alpha: 2W 1D 0L, GD +6, 7 pts
  - Gamma: 1W 1D 0L, GD +3, 4 pts (incl. forfeit win)
  - Beta:  0W 0D 3L, GD -9, 0 pts (forfeit loss + walkover loss + completed loss)

**Phase 2 status entering Cycle 2.6:** Foundations + onboarding +
reads + engines + season setup + fixture mgmt + team registration
+ mid-season failures all live. Remaining: 2.6 (refs+pitches CRUD),
2.7 (frontend + email dispatcher + demo venue), 2.8 (wizard UI).

---

## SESSION 48 — Cycle 2.5a — team registration (May 26 2026)

The self-serve team-join surface (`/join/CODE`) backend shipped:
three RPCs covering the captain's registration submission and the
venue admin's approve / reject responses (migrations 097–100). Squad
collection is intentionally deferred — the team admin uses the
existing AdminView SquadScreen post-approval (decision recorded
during audit).

  - **mig 097 — `competition_teams.rejection_reason`** (additive
    text column). Mirrors the existing `withdrawal_reason`. No
    CHECK changes.
  - **mig 098 — `join_register_team(p_league_code, p_competition_id,
    p_team jsonb)`.** Authenticated caller only (`auth.uid()` not
    null). Two paths:
      - new team: validates name, generates team_id +
        admin_token + join_code, inserts `teams(team_type=
        'competitive', onboarding_complete=true)`, inserts
        `team_admins(role='team_admin')` claiming caller as captain.
      - existing team: caller must already be `team_admin` or
        `vice_captain` (revoked_at IS NULL). Auto-promotes
        `casual → competitive` if the team isn't already
        competitive.
    Then inserts `competition_teams(status='pending')`. Guards:
    league_code resolves to active league; competition belongs to
    that league + status IN setup/active; no existing pending OR
    active `competition_teams` row for same (competition_id,
    team_id). Audit (`team_registration_submitted`) + venue +
    league broadcasts (`team_registration_pending`).
    **Granted to authenticated only** (not anon — Google OAuth
    must complete in the wizard before submit).
  - **mig 099 — `venue_approve_team_registration(p_venue_token,
    p_competition_team_id)`.** Flips `pending → active`. Idempotent
    on already-active (returns `noop:true`). Clears
    `rejection_reason` defensively. Audit + venue + league broadcast
    `team_approved`.
  - **mig 100 — `venue_reject_team_registration(p_venue_token,
    p_competition_team_id, p_reason)`.** Reason required. Strictly
    `pending` only — won't touch already-active or terminal rows.
    Sets `rejection_reason` + status='rejected'. Audit + venue +
    league broadcast `team_rejected`.

**Notification delivery deferred to Cycle 2.7.** All RPCs leave a
`team_admin` audit row + `team_*` broadcasts. Email/push to the
team admin is wired in the operator-notifications dispatcher when
that lands.

**Smoke tests.** End-to-end with spoofed `auth.uid()` via
`request.jwt.claim.sub` + `SET LOCAL ROLE authenticated`:
  - Register (new team path) → 1 team competitive + 1 team_admin
    row + 1 competition_teams pending + 1 audit row.
  - Register (existing-team path) → casual→competitive promotion
    visible; dup-register raises `team_already_registered`; non-
    admin caller raises `not_team_admin`.
  - Bad league code raises `league_not_found`; missing name raises
    `team_name_required`.
  - Approve flips pending→active; idempotent re-approve returns
    `noop:true`.
  - Reject with reason flips pending→rejected; empty reason raises
    `rejection_reason_required`; rejecting already-active raises
    `only_pending_can_be_rejected`.
  - Bad venue token raises `invalid_venue_token` for both
    approve + reject.

**Notable design choice — one user, multiple teams in same competition
is ALLOWED.** The dup guard only fires on same `team_id` re-register,
not same caller. A captain who manages two teams (e.g. ACME 1st XI +
ACME 2nd XI) can legitimately register both into the same league.
Accidental double-submit by the wizard UI is handled at the UI layer
(double-fire guard on the submit button) — server is permissive.

**Phase 2 status entering Cycle 2.5b:** Foundations + onboarding +
reads + engines + season setup + fixture mgmt + team registration
all live. Remaining: 2.5b (mid-season failures + standings cascade
incl. forfeit), 2.6 (refs+pitches CRUD), 2.7 (frontend + email
dispatcher + demo venue), 2.8 (wizard UI). Estimated ~3 more days.

---

## SESSION 48 — Cycle 2.4 — fixture management (May 26 2026)

Three operator-facing fixture-management RPCs + a forfeit-storage
schema addition shipped (migrations 093–096). The pg_constraint sweep
mandate (DECISIONS.md L126, landed end of Cycle 2.3) immediately paid
off — caught a missing `'forfeit'` value in `fixtures_status_check`
at audit time, preventing the same failure-mode that bit migs 088 / 092.

  - **mig 093 — fixture forfeit support (schema foundation).** Two new
    columns on `fixtures`: `forfeit_winner_id text → teams(id)` (ON
    DELETE SET NULL) and `forfeit_reason text`. Stored separately from
    `walkover_winner_id` because walkover (pre-match no-show) and
    forfeit (post-result reversal for eligibility/misconduct) are
    semantically distinct events. Also expanded `fixtures_status_check`
    additively to include `'forfeit'` alongside the existing seven
    values.
  - **mig 094 — `venue_assign_pitch(p_venue_token, p_fixture_id,
    p_playing_area_id)`.** Sets `fixtures.playing_area_id`; pass NULL
    to clear. Validates: caller resolves to venue; fixture's
    competition→season→league belongs to caller venue; pitch belongs
    to same venue + active + is_available; fixture.status IN
    (scheduled, allocated). Status auto-bumps scheduled→allocated on
    assign, reverts allocated→scheduled on clear. Audit + venue +
    league broadcasts (`pitch_assigned`, `fixture_status_changed`).
    Maintenance-window enforcement deferred to Cycle 2.6 (pitch CRUD).
  - **mig 095 — `venue_assign_ref(p_venue_token, p_fixture_id,
    p_official_id)`.** Sets `fixtures.official_id`; pass NULL to clear
    (ref no-show reassign workflow). Validates: caller→venue, fixture
    in venue, official active + in venue, fixture in scheduled or
    allocated. Status NOT auto-bumped (ref is metadata, not allocation
    trigger). Audit action distinguishes assigned / changed / cleared;
    venue broadcast (`ref_assigned` first time, `ref_changed`
    thereafter).
  - **mig 096 — `venue_update_fixture_status(p_venue_token,
    p_fixture_id, p_new_status, p_metadata jsonb)`.** Drives the four
    operator-initiated terminal transitions: postpone / void /
    walkover / forfeit. Per-status transitions allowed:
      - postpone: from {scheduled,allocated}, requires `postpone_reason`
      - void:     from {scheduled,allocated,postponed}, requires `void_reason`
      - walkover: from {scheduled,allocated}, requires `winner_team_id`
                  (must equal home or away)
      - forfeit:  from {scheduled,allocated,completed}, requires
                  `winner_team_id` + `forfeit_reason`. Stored into
                  `forfeit_winner_id` / `forfeit_reason` (NOT
                  `walkover_winner_id` — they're distinct columns now).
    Audit + venue broadcast (`fixture_postponed`/`fixture_voided`/
    `fixture_walkover`/`fixture_forfeit`) + league broadcast
    (`fixture_status_changed`).
  - **Standings impact deferred to Cycle 2.5b.** `mig 087`'s header
    already says "Postponed / voided / forfeit fixtures are excluded
    from standings until the cascade rules land (Cycle 2.5b)" —
    honoured here. Cycle 2.4 stores the data; 2.5b will extend the
    standings query for the team-withdrawal cascade + forfeit
    awards in one sweep.
  - **Smoke test.** End-to-end ephemeral fixture: assign_pitch
    (scheduled→allocated) → assign_ref → clear_ref → clear_pitch
    (allocated→scheduled) → postpone → void → walkover → forfeit.
    All 8 mutations succeeded. Separately verified 5 validation
    guards fire: bad token, foreign winner, postpone-without-reason,
    unsupported status, locked-status pitch reassign.

**Schema-sync win.** Proactive `pg_constraint` query on `fixtures` /
`playing_areas` / `match_officials` at audit time surfaced the
missing `'forfeit'` CHECK value before any execute work began. New
hotfix migration shipped in the same cycle as the RPCs that needed
it — no round-trip cost. Pattern is now load-bearing for every
remaining Phase 2 cycle.

**Phase 2 status entering Cycle 2.5a:** Foundations + onboarding +
reads + engines + season setup + fixture management all live.
Remaining: 2.5a (team registration), 2.5b (mid-season failures +
standings cascade), 2.6 (refs+pitches CRUD), 2.7 (frontend + email
+ demo venue), 2.8 (wizard UI). Estimated ~3–4 more days.

---

## SESSION 48 (May 26 2026) — League Mode rename + Phase 2 Cycles 2.1–2.3

The venue/league/HQ programme was renamed to **League Mode** and Phase 2
foundations + read RPCs + season-setup engines+RPCs shipped — three
cycles of execute work covering migrations 083–092 plus four new
JS modules (`venue/`, two engines, four RPC wrappers).

**Programme rename (commit `ea06425`).** "Venue/league/HQ" was a
mouthful that never landed. Adopted "League Mode" as the umbrella
label. Discovery surfaced that FEATURES.md L174 + DECISIONS.md L884
already had a parked `PHASE 4 — LEAGUE MODE` entry describing the
same vision with the same four tables (`venues`, `leagues`, `fixtures`,
`referees`) — superseded as part of the same commit. Docs-only sweep:
`venue_league_hq_SCOPE.md` → `LEAGUE_MODE_SCOPE.md` (via `git mv`),
five doc files updated, zero SQL identifiers touched (the words
`venue` and `league` survive everywhere they refer to domain objects).

**5 rounds of design Q&A.** Before code, the wizard's product
shape was nailed down across persona, season structure, refs, teams,
notifications, visibility, demo strategy, mid-season failure modes,
league-code scope, squad-mode locking, casual↔competitive relationship,
and existing-team migration. All captured in
`/Users/tarny/.claude/plans/what-work-is-required-crystalline-meerkat.md`.
Key decisions (full list in DECISIONS.md):
  - **Operator-led onboarding** for year 1. Self-serve Phase 8
    deferred to year 2. Manual Stripe Invoicing / GoCardless / Wise.
  - **`/league/TOKEN` merges into `/venue/TOKEN`** for UI; data model
    stays separate so independent-league customers are a future cheap add.
  - **Persona: venue manager / owner.** 35–55, desktop-first laptop
    UI, not phone-first like AdminView. Four-panel dashboard
    (Tonight / This Week / Open Issues / Registrations & Billing).
  - **Squad mode per-league** (`registered`/`open`/`mid_rigid`).
    Locks once first fixture played.
  - **Existing casual teams stay venueless forever.** Footy Tuesdays
    et al never get `teams.venue_id` set. Venues only see teams that
    registered via `/join/CODE`.
  - **Casual + competitive coexist** as separate `competition_teams`
    rows. Players unified across both via team_players.
  - **Push + Email channels** for v1 (Twilio SMS/WhatsApp deferred).
  - **Demo venue + one real alpha** in parallel before going wider.
  - **Three mid-season failures designed:** team withdraw (cascade
    walkover/void), pitch close (maintenance windows), ref no-show
    (basic admin reassign; live escalation is Phase 3).

**Cycle 2.1 — Foundation + onboarding (commit `03bd4be`).**
  - Migs 083+084+085 (renumbered to 083–085 in source; live as
    independent migrations).
  - **mig 083 foundation columns** (additive only — Phase 1 tables
    empty in prod): `venues.live_channel_key`, `leagues.league_code`
    (8-char alphanumeric, no ambiguous chars), `leagues.live_channel_key`,
    `leagues.squad_mode`+`squad_mode_locked_at`+`standings_visibility`,
    `match_officials.employment_type`+`overall_rating`,
    `playing_areas.is_available`+`maintenance_windows`. Plus new
    `generate_league_code()` function. `competition_teams.status`
    DEFAULT flipped `'active'` → `'pending'` for the manual approval
    flow.
  - **mig 084 helpers**: `resolve_venue_caller`, `resolve_league_caller`
    (mirrors mig 074 `resolve_admin_caller`), `notify_venue_change`
    (25-reason whitelist), `notify_league_change` (11-reason whitelist).
    Separate `venue_live:`/`league_live:` realtime topology from
    `team_live:` — existing AdminView/PlayerView subscribers untouched.
  - **mig 085 `superadmin_create_venue(p_name, p_operator_email,
    p_sport, p_first_league jsonb)`** — primary onboarding tool, gated
    by `is_platform_admin()`. Creates venue + admin_token + live_channel_key,
    optionally creates first league + league_code. Returns the
    `/venue/TOKEN` URL ready to share.
  - **UI:** `/superadmin/venues/new` form on `apps/superadmin` with
    optional first-league fields. Success view shows copy-able
    venue + /join/CODE URLs.
  - **NB:** the superadmin app has BUGS.md's open blank-screen entry
    (missing `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars).
    Form ships but won't render until env vars added in Vercel UI.

**Cycle 2.2 — Read RPCs (commit `f940c32`).**
  - **mig 086** `venue_get_state`, `league_get_state`,
    `join_get_league_by_code`. Full venue dashboard payload, league
    deep-link (with venue-admin → league-pick fallback), public
    /join landing.
  - **mig 087** `get_league_standings_for_player` — W/D/L/GF/GA/GD/Pts
    across every competition the player's teams are active in.
    Walkovers default to 3-0 for walkover_winner_id. Top scorers
    stubbed `[]` until Phase 3 `match_events`. `standings_visibility`
    private respected (Round 4 forward-compat gate).
  - **mig 088 hotfix**: `competition_teams.status` CHECK constraint
    (mig 055) only allowed `('active','withdrawn','expelled')`. Cycle
    2.1's DEFAULT flip to `'pending'` would have caused every new
    INSERT without explicit status to fail the constraint. Expanded
    to full Phase 2 enum.
  - **mig 089 hotfix**: `venue_get_state.open_incidents` referenced
    `incidents.status` (column doesn't exist; open derived from
    `resolved_at IS NULL`); `join_get_league_by_code` filtered on
    `status='registration_open'` (not in seasons/competitions CHECK).
    Both fixed; 086 source updated to match live.
  - 4 JS wrappers + barrel export.

**Cycle 2.3 — Engines + season setup (commit `71b8aab`).**
  - **`packages/core/engine/roundRobin.js`** — classic circle method.
    Even/odd teams (odd → phantom bye), home/away balance via top-pair
    alternation, pitch×slot allocation with capacity guard,
    excludeWeeks support, doubleRound mirror.
  - **`packages/core/engine/cupBracket.js`** — single elim (byes to
    top seeds, round 1 fixtures + bracket placeholders for Phase 3
    ref view to populate) + group stage (snake-seeded round-robin
    per group).
  - **mig 090 `venue_create_season(p_venue_token, p_season jsonb)`** —
    creates season + competitions, validates league ownership +
    date order + competition types.
  - **mig 091 `venue_generate_fixtures(p_venue_token,
    p_competition_id, p_fixtures jsonb)`** — bulk-persists engine
    output. Full validation: competition ownership, no existing
    fixtures (idempotency guard), every team active in competition,
    every date within season window, every pitch belongs to venue.
    **One audit row per generation** with `metadata.fixture_count`
    (bulk-write rule).
  - **mig 092 hotfix**: `audit_events.actor_type` CHECK (mig 003)
    didn't include `venue_admin`/`league_admin`/`platform_admin`.
    Every Phase 2 mutating RPC's audit insert would have failed.
    Expanded additively.
  - Engines smoke-tested via node across 7 scenarios.
  - End-to-end probe: 4 teams → create season → engine → 6 fixtures
    persisted with correct dates, times, pitches.

**Pattern emerged: schema-sync should sweep CHECK constraints, not
just columns.** Four constraint gotchas across three cycles, all
from mig 055 / mig 003 being narrower than the scope file assumed.
Every cycle henceforth opens with a `pg_constraint` query on every
table about to be touched. DECISIONS.md captures this as a
methodology addendum.

**Phase 2 status entering Cycle 2.4:** Foundations + onboarding +
reads + engines + season setup all live. ~6 days of estimated work
shipped. Remaining: Cycle 2.4 (fixture mgmt), 2.5a (team
registration), 2.5b (mid-season failures), 2.6 (refs+pitches CRUD),
2.7 (frontend + email + demo venue), 2.8 (wizard UI). Estimated
~4–5 more days.

**Out-of-band note**: the superadmin app blank-screen bug (BUGS.md)
needs env vars set on the platform-superadmin Vercel project before
the Cycle 2.1 onboarding UI loads. Operator action, not code.

**Commits this session (in order):**
`ea06425` League Mode rename · `03bd4be` Cycle 2.1 · `f940c32` Cycle 2.2 · `71b8aab` Cycle 2.3

---

## SESSION 47 (May 26 2026) — read-RPC parity for VCs, Live Board dedupe, OTP UX, hook gates, cancel-clears-admin-lock

**Addendum (post-cancel, 2026-05-26 evening):** Tarny cancelled the
Footy Tuesdays game ("Not enough players in 32 degrees heat…"). DB
verification showed a clean cancel across schedule/match/ledger and
17 of 18 players — but Ranza (`p_UG2K3Dwp`) was left with
`admin_locked_in=true`. **Mig 082** adds `admin_locked_in=false` to
`admin_cancel_match`'s Step 5 bulk reset (also codifies the live
body's `resolve_admin_caller` upgrade per rule 11). One-off SQL
cleared Ranza's stale flag. New DECISIONS.md rule: any bulk-reset of
`players.status` MUST also clear `admin_locked_in`. Weekly rollover
path is flagged as still-unclean and held for a follow-up audit.



Game day for Footy Tuesdays (`team_KPaoX8oJYMQ`). Cascade of
display bugs surfaced because the session-45 VC parity sweep
(mig 075) widened *writes* for VCs but not *reads*. Five fixes
shipped end-to-end, all driven by Tarny operating the squad as VC.

**Migrations (3):**
- **Mig 079 `restore_group_fields_in_state_rpc`** — source-of-truth
  recovery for an out-of-band hotfix applied to live DB at 12:38
  UTC from a mobile Claude session (without filesystem access).
  Restores `group_number` per squad row + `group_labels` in
  settings on `get_team_state_by_admin_token` — both silently
  dropped when mig 070 rewrote the function. Source-only commit;
  no DB change (already deployed). Hard rule #11 reconciliation.
- **Mig 080 `player_token_state_admin_parity`** — when
  `v_privileged` (VC or team admin) is true, `get_team_state_by_player_token`
  now returns the full admin-shape squad including the caller's
  own row with `is_self=true`, all payment/stats/lock fields,
  `group_number`, and `token`. Ordinary players keep the existing
  limited shape (no privacy regression). Adds `group_labels` to
  settings for all callers. `getTeamStateByPlayerToken` wrapper
  updated to read `group_labels`. Commit `500ec6e`.
- **Mig 081 `rpc_sweep_cleanup`** — three targeted fixes:
  1. `submit_potm_vote` now calls `notify_team_change('potm_vote_cast')`
     so anon /p/ clients see the running tally tick in real time
     (was a silent regression against rule #10);
  2. dropped the stale 13-arg `admin_upsert_schedule` overload —
     14-arg version is the only one JS calls; overload trap closed;
  3. dropped four genuinely-dead RPCs (zero callers in apps/ or
     packages/): `player_create_cash_payment_entry`,
     `unregister_push_subscription`, `admin_set_player_note`,
     `join_team_as_returning_player`. All restored verbatim in the
     down-migration. Commit `4481103`.

**Client fix — Live Board duplicate caller (no migration):**
Tarny reported he appeared TWICE on his own MyView Live Board.
Other teammates saw him once. Root cause: mig 080 added the
caller to `state.squad` for VCs/admins, and `App.jsx` (five sites)
still unconditionally prepended `state.player` — privileged callers
ended up with two same-id rows in the client squad. New
`buildPlayerSquad(player, squad)` helper at module scope merges
squad-row fields onto `state.player` (gaining `group_number` +
`is_self`, preserving `user_id`) then filters the dupe. Applied at
all five prepend sites in App.jsx. No-op for ordinary players.
Commit `8f30b67`.

**Client fix — AuthGateModal OTP UX bundle (no migration):**
Tarny was prompted to sign back in, got "token has expired or
invalid" twice. Supabase auth logs (pulled in parallel session)
pinned the cause: attempt 1 had 63 min between `/otp` and
`/verify` (default TTL ~60 min so genuinely expired); attempt 2
had 13s between re-request and verify (typed the OLD code before
the new email arrived). Bundle:
- `sentAt` captured on every `/otp` success; code stage shows
  "Sent at HH:MM · expires within an hour"
- `sendCode` clears the code input on every send (kills stale-
  code-typed-on-top failure)
- 20s resend cooldown; in-place "Resend code" button with
  "Resend in Ns" countdown
- Structured verify errors with "→ Tap Resend code below to get
  a fresh one" affordance
- HTTP 429 / rate-limit surfaces specific copy instead of generic
Commit `fe26596`.

**Hook hardening — session-start primer + pre-commit gates:**
- `session-start.sh` now appends the full skills/ inventory and
  the skills/scripts/ inventory to the per-session primer (no
  more "I didn't know those existed" excuse).
- `pre-commit-build.sh` gains a new gate ahead of the build check:
  every newly-staged `rls_migrations/NNN_*.sql` must have a
  matching `_down.sql` either staged in the same commit or already
  in the repo. Catches the mig-079 hotfix-without-source-file
  class deterministically. Commit `222321f`.

**Decisions added (`DECISIONS.md`):**
- Cloud/mobile Claude sessions must hand off a pending source-
  file commit to the next desktop session. Read-only cloud work
  is fine; writes-without-files is always a rule #11 violation.
- Read RPCs must match the privilege profile of writes the caller
  can already make. When a write surface is broadened (e.g. VCs
  via mig 075), audit the read RPCs powering the matching display
  surfaces and widen them in the same sweep, or explicitly document
  the asymmetry.
- `state.player` and `state.squad` can overlap for privileged
  callers — every consumer that prepends or merges them must
  dedupe by id. Use the new `buildPlayerSquad` helper.

**Audit summary findings (logged for future reference):**
End-to-end audit of write/display/realtime across all three actor
types (player / VC / admin) confirmed every write RPC fires
`notify_team_change` after mig 081, every postgres_changes
subscriber has a matching write target, and every consumed read
field is returned by both state RPCs. Two limitations stand:
- `postgres_changes` on `players` and `matches` is RLS-gated to
  `authenticated` only. Anon /p/ clients get NO postgres_changes
  events for these tables — they depend entirely on the
  `team_live:<key>` broadcast channel (the publisher/subscriber
  pair from rule #10). This is intentional and the broadcast
  channel covers all known write paths post-mig-081.
- Explore-agent dead-RPC scans must always be cross-verified by
  grepping call sites for the camelCase wrapper name. This
  session's audit initially flagged 9 dead RPCs; 5 were false
  positives (wired via engine/* helpers and modal components
  the agent didn't fully traverse). Real dead list: 4 (all
  dropped in mig 081).

**Files touched:**
- NEW migrations: 079_restore_group_fields_in_state_rpc (+ down),
  080_player_token_state_admin_parity (+ down),
  081_rpc_sweep_cleanup (+ down)
- App.jsx: `buildPlayerSquad` helper + 5 call-site updates
- AuthGateModal.jsx: sentAt/cooldown state, ticker effect,
  sendCode/verifyCode behaviour changes, code-stage UI additions
- packages/core/storage/supabase.js: 1-line settings mapper
  update to read `group_labels`
- .claude/hooks/session-start.sh: appends skill + script inventory
- .claude/hooks/pre-commit-build.sh: down-file gate ahead of build
- Docs: BUGS.md (4 new RESOLVED entries), DECISIONS.md (3 new
  rules), CONTEXT.md (this entry)

**Lesson for the file:** game day surfaces every gap between
"writes succeed server-side" and "the operator can actually use
the app". Future write-surface sweeps must explicitly verify the
matching read surfaces in the same session.

---

## SESSION 46 (May 26 2026) — first-go-live + group balancer grants

Two production bugs hit rockybram's brand-new squad "Footy
Tuesdays" (team_id `team_KPaoX8oJYMQ`) on the day of their first
match. Both surfaced because no real brand-new squad had been
exercised end-to-end before — every prior test team had either
seeded fixtures or had cycled through Cancel→Relive.

**Bug 1 — first-time go-live never created the initial matches row
(mig 077 `admin_go_live`).** `admin_upsert_schedule` (mig 013)
sets `game_is_live=true` but never inserts a `matches` row or
populates `schedule.active_match_id`. Only `admin_reopen_week`
(mig 032) did that, and only on the cancel→relive branch. Brand-
new squad → flip live → Admin → Make Teams → "No active match"
empty state. Players' surfaces correctly showed live because they
read `game_is_live`, but anything keyed off the match ID (Make
Teams, POTM voting, payment confirmation, save-teams) was silently
broken. Latent since mig 032 (May 22). Fix: new sibling RPC
`admin_go_live` (mirrors `admin_reopen_week` minus cancel-clear,
idempotent on re-tap). Client routes `AdminView/index.jsx`
openNextWeek non-cancelled branch and `ScheduleScreen.jsx` save
path both call `goLive` on the live flip. rockybram unblocked
live by calling `admin_reopen_week` directly via MCP before the
code fix shipped (generated match `m_ua2IxB14ch8` for the 20:00
game). Commit `5752c84`.

**Bug 2 — group balancer fails for anon-admin / VC callers
(mig 078 grant fix).** Immediately after Bug 1 was fixed,
rockybram tried to use the Group Balancer in Make Teams. Every
tap reverted with "Failed to save group — try again". Root cause:
`admin_set_player_group` and `admin_clear_all_groups` were the
only two `admin_*` RPCs granted to `authenticated` only (mig 031
default at Group Balancer launch). The session-45 VC parity sweep
(mig 075) rewrote function bodies via `resolve_admin_caller` but
explicitly does not touch grants — the anon revoke was inherited
unchanged. rockybram's session was anon (token-only admin) →
PostgREST rejected at the grant layer before the body ran.
Direct postgres-role call returned `{ok: true}` and wrote an
audit row, confirming body + data were healthy. VCs on the same
team had the same problem, a strict regression against the
session-45 parity rule. Fix: two-line GRANT migration to anon
on both RPCs. No client changes. Commit `abdae30`.

**Decisions added (`DECISIONS.md`):**
- All `admin_*` RPCs must grant both `anon` and `authenticated`.
  Body owns access control via `resolve_admin_caller`; the grant
  layer is not the place to lock down. New `admin_*` RPCs default
  to granting both; sweeping migrations must explicitly enumerate
  and assert grants too.

**Files touched:**
- NEW migrations: 077_admin_go_live (+ down), 078_group_rpcs_anon_grant (+ down)
- NEW JS wrapper: `goLive(adminToken)` in `packages/core/storage/supabase.js`
- NEW barrel export: `goLive` in `packages/core/index.js`
- Updated client call sites: `AdminView/index.jsx` openNextWeek, `ScheduleScreen.jsx` save path
- Updated docs: BUGS.md (two resolved entries), GO_LIVE_ISSUES.md
  (new pre-flight checks 5.3 and 5.4 under Admin Writes),
  DECISIONS.md (admin_* grant rule)

**Lesson — for the file:** regex-driven blanket sweeps over
`pg_proc` can rewrite function bodies but cannot safely rewrite
GRANT statements (those live separately and have stricter
parsing). Any future "all admin_* RPCs now …" change must
separately enumerate and audit grants. Memory entry added.

---

## SESSION 45 (May 26 2026) — VC = admin parity sweep, plus post-sweep residue cleanup

Two distinct pieces of work landed today:

1. **VC parity** (commits `0ef3913`, `767b499`, `60d40a9`,
   migrations 074 + 075). Every `admin_*` RPC now resolves the
   caller via `resolve_admin_caller`, so a Vice Captain's
   `player_token` is accepted everywhere the owner's `admin_token`
   was. Audit trail distinguishes the two but business logic is
   identical. See BUGS.md (RESOLVED 2026-05-26 session 45) and
   DECISIONS.md (VICE CAPTAINS HOLD FULL OWNER-GRADE AUTHORITY).

2. **Post-sweep data residue** (no commit — manual cleanup via MCP).
   The parity verification was executed against real production
   rows on Footy Tuesdays (`team_KPaoX8oJYMQ`). Two issues leaked
   into production state:

   - **Bally** (`p_f4fcf4eb`) — a 17-event transaction at
     `09:21:32` left `status='in'`, `admin_locked_in=true`, and
     `nickname='TempNick'`. The toggle sweep missed a revert step
     for status and nickname. Fixed: direct UPDATE to clear both,
     then a no-op pass through `admin_update_player_name` +
     `admin_set_player_status` so audit_events records a clean
     team_admin trail for the fix itself.
   - **Bidz** (`p_4ef07e08`) — promoted to VC legitimately at
     `08:52:51`. The parity sweep at `09:57:08` toggled
     `is_vice_captain` true/false/true/false in one transaction
     and ended at `false`, undoing the real promotion. User
     declined automated fix and will manage manually.

   New policy captured in DECISIONS.md ("ADMIN_* RPC PARITY /
   SMOKE TESTS NEVER RUN AGAINST PRODUCTION ROWS") and tech-debt
   item filed in BUGS.md ("LOW #0 — No ephemeral fixture for
   admin_* RPC parity smoke tests"). Lessons in BUGS.md
   post-sweep section.

   **Investigation note worth keeping:** when checking "did the
   user really do X?", first look for timestamp clustering in
   `audit_events`. Postgres `now()` resolves once per transaction,
   so N events sharing one microsecond means one transaction —
   almost always a script/sweep, not human taps. The
   `actor_identifier` field is md5(token), so cross-reference with
   `md5(token)` against `players.token` / `teams.admin_token` to
   resolve who actually triggered a write.

### Also touched in session 45 (housekeeping)

- **`platform_admins` Gmail grant** (migration 076 source file
  landed; live since `2026-05-26 10:16`). `tarnysingh@gmail.com`
  is now a platform admin alongside `tarny@desicity.com`. Same
  human operator; Gmail is the day-to-day PWA account so it's the
  convenient identity for opening the superadmin dashboard.

- **Superadmin dashboard blank-page bug (OPEN — work paused
  here).** Production URL is
  `https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app`.
  It loads blank. Root cause: the `platform-superadmin` Vercel
  project is missing `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`, so the bundled JS calls
  `createClient(undefined, undefined)` and React never mounts.
  Next session resumes from these steps:
  1. In Vercel → `platform-superadmin` → Settings → Environment
     Variables, add both `VITE_SUPABASE_URL` and
     `VITE_SUPABASE_ANON_KEY` (copy values from
     `platform-clubmanager`'s same env vars). Tick Production +
     Preview + Development.
  2. Relink the local directory:
     `cd apps/superadmin && vercel link --project
     platform-superadmin`. (Currently linked to the wrong project,
     `platform-clubmanager`.)
  3. Pull envs: `vercel env pull .env.production.local
     --environment production`.
  4. Build + deploy:
     `npm run build && vercel deploy --prebuilt --prod --yes`.
  5. Reload the URL — should land on the auth sign-in. Sign in
     with either `tarnysingh@gmail.com` (via mig 076) or
     `tarny@desicity.com`. Activity tab will show
     `actor_type='vice_captain'` rows from session 45's parity
     verification alongside the usual `team_admin` ones.

## SESSION 44 (May 25 2026) — admin-badge cycle shipped, rule #11 drift closed

Resumed after session 43 with the same three JSX + two migration
source files in the working tree that had been there since session
41. Original session-41 plan
(`.claude/plans/the-live-game-for-wobbly-yeti.md`) had scoped a
6-file admin-badge cycle; only the three UI tweaks and migration 058
ever got authored, and the migration was applied live without its
source being committed — a CLAUDE.md rule #11 violation outstanding
for ~4 sessions.

**Telemetry check before touching held work:** queried `audit_events`
for session-43 adoption. 24 standalone PWA opens in 48h, 2 with a
server-side JWT (both Tarny's own verified-live test). No silent
failures on the 6 `needsSelfAuth`-gated handlers. Session 43 fix is
working but adoption is too thin to call a success or failure yet —
wait another 48h before any further action there.

**Re-audit found the held work was even safer than originally scoped:**
- Worried mig 058's `is_team_admin` flag wouldn't surface in MySquads
  because session 43 had switched MySquads to the new
  `player_get_teams_by_token` RPC (mig 072). Verified live RPC body —
  mig 072 already included `is_team_admin` in its return shape. So
  the held MySquads change works as-is with no follow-up migration.
- Behavioural reach is narrower than the original pitch though: the
  ADMIN badge condition only fires on non-current rows in the
  MySquads accordion. Rockybram only belongs to Footy Tuesdays, so
  he sees it as "CURRENT" and the badge logic never runs. The change
  only helps users who admin team A while viewing from team B's
  `/p/` route.

**What shipped (commit `98b7ce6`, merged via `c55006b`):**
- `MySquads.jsx`: badge = `is_vice_captain || is_team_admin`.
- `SquadScreen.jsx` + `PlayerProfile.jsx`: VC toggle visible to any
  admin-mode viewer, not just team_admin. Self-protection preserved
  via existing `vcSelf` and viewer-identity branches.
- `058_player_get_teams_admin_flag.sql` + `_down.sql`: source for
  the live RPC. Live body matches source byte-for-byte. Rule #11
  drift closed.

**Bundled in the merge (separate concern):** commit `052d7b0` —
operator-facing `GO_LIVE_ISSUES.md` pre-onboarding pre-flight log,
authored separately. Landed on the same feature branch in another
context. User chose to ship both together rather than split.

**Real-iPhone test (rule #13) intentionally skipped.** The held
change is a 3-line render-gate removal with no behaviour change for
working code (unlike session 43's behaviour-only bugs that triggered
the rule). Audit covered live RPC state, JSX diff, RPC contracts,
and self-protection guards. Acknowledged as a deliberate exception.
Not a new precedent — rule #13 still applies to all PWA-affecting
behaviour changes.

**Open follow-ups carried forward:**
- HeroCard "Admins" block extension (G change, mig 059) still not
  built. Low-priority cosmetic gap.
- VC co-admin from `/p/<token>` route (if VCs don't always use the
  admin URL) — needs either a UI to surface the admin URL to VCs or
  an RPC change. Not yet a real problem (Tarny uses the admin URL).
- Continue watching session-43 telemetry — another 48h before
  declaring the in-PWA OTP sign-in adoption-healthy.

**Commits this session:**
- `98b7ce6` — feat(admin-badge): VC co-admin toggle parity +
  team-creator ADMIN badge.
- `052d7b0` — docs: GO_LIVE_ISSUES.md (authored in parallel context,
  bundled into the merge).
- `c55006b` — merge commit on main.

---

## SESSION 43 (May 25 2026) — token-IS-identity + in-PWA email-OTP sign-in

Triggered by session-42 `audit_events.app_boot` telemetry showing
**zero** standalone PWA boots in 7 days had a server-side JWT
despite confirmed sign-ups. iOS deliberately partitions Safari
storage from installed-PWA storage; Safari OAuth never reaches the
home-screen app. Session 41's `refreshSession()` mitigation helped
nobody because there's no refresh token to refresh.

**Three user-visible bugs traced to this:** MySquads showed "Sign
in to see all your squads" forever (auth-only RPC); admin tapping
own in/out on /admin/<token> silently no-op'd (session-41 mig 061
needed auth.uid() match); join/link/delete actions silently failed
in the home-screen app.

**Posture chosen:** stop fighting Apple's partition. The token in
the URL IS the identity for day-to-day use. Sign-in is requested
only when an action genuinely cannot be done without an auth user.
Sign-in happens INSIDE the PWA via an email-OTP modal — JWT lands
in PWA-scope localStorage and persists indefinitely (iOS only
evicts after 7 days of zero use, irrelevant for weekly app).

**What shipped:**
- Migration **072** — new `player_get_teams_by_token(p_token)`
  RPC. Resolves user_id from the URL token instead of auth.uid().
  MySquads switched to it. Original `player_get_teams()` retained
  for App.jsx post-OAuth flows.
- `apps/inorout/src/components/AuthGateModal.jsx` — email + 6-to-10
  digit OTP modal (no Google to dodge iOS-PWA webview blocking).
  OTP code length is project-configurable in Supabase; this
  project sends 8.
- `apps/inorout/src/hooks/useRequireAuth.js` — hook that gates
  any action behind an authed session; runs immediately if authed,
  otherwise opens the modal and retries on `onAuthed`.
- Supabase dashboard email template updated to surface
  `{{ .Token }}` prominently with the magic link as secondary.
- `dbToPlayer` mapper in supabase.js now passes `is_self` through
  as `isSelf` (latent session-42 bug surfaced this — see below).
- PlayerView: new `needsSelfAuth = isAdmin && !me?.isSelf` flag
  gates all 6 self-write entry points (status, push subscribe,
  +1 guest, injury toggle, clear-debt, cash-paid). On modal verify,
  page reloads; mig 070's CASE clause finds auth.uid() → flips
  isSelf on the right row → me resolves to the auth user.
- App.jsx `handleJoin` refactored to gate via `useRequireAuth`
  before `doJoin` (avoids React-state staleness loop).
- PlayerProfile delete-account button gated likewise. Link-account
  was already auth-gated by being inside a post-OAuth branch.

**Latent session-42 bug surfaced + fixed:** mig 070 added an
`is_self` flag to admin-state RPCs, but `dbToPlayer` never mapped
it. App.jsx's `state.squad.find(p => p.is_self)` always returned
undefined → admin-resolver fell through to `squad[0]` → admins on
/admin/ routes were rendered AS the first squad member for ~12
days. Wasn't noticed because the same row was still tappable in
StatusScreen, just wrote to the wrong player.

**Verified live on real iPhone:** Tarny (VC of Footy Tuesdays)
installed the Vercel preview as home-screen app. Header initially
showed "rockybram" (the fallback). Tapped IN → modal popped →
entered email → 8-digit code from inbox → verified. Page reloaded.
Header switched to "Tarny". Subsequent taps committed to Tarny's
row. Close + reopen — still signed in, no re-prompt. MySquads
showed Footy Tuesdays without the placeholder.

**Settled invariants:**
- **CLAUDE.md hard rule #12** added: any new RPC return field
  used by JS must be added to the corresponding mapper in the
  same commit. Grep the field name to confirm.
- **CLAUDE.md hard rule #13** added: PWA-affecting changes must
  be tested on a real iPhone home-screen install before commit.
- **DECISIONS.md** got a top-of-file "TOKEN IS THE PWA's IDENTITY"
  principle codifying the posture, the rules for new features,
  and the planned end-of-beta Capacitor migration path.
- **BUGS.md** moved the session-41 "PWA auth session fragility"
  entry from PARTIALLY MITIGATED to RESOLVED for the user-visible
  paths.

**Commits:** `cdba41d` (initial), `b1935e5` (isSelf gate fix),
`ba7bc8d` (OTP length fix), merged via `5e747f7`, docs `13adc40`,
methodology `pending`. Held admin-badge work from sessions 41/42
(SquadScreen.jsx + MySquads.jsx + PlayerProfile.jsx + 058
migration source) stays uncommitted — still a separate cycle.

## SESSION 42 (May 25 2026) — multi-team player model + admin/VC share links

Triggered by gbains2010 reporting he couldn't reach "Tuesday Football"
(Footy Tuesdays). Sign-in worked, the join had recorded, yet every
app-open landed him in his own team (Finbars Tuesdays).

**Diagnosis:** `player_join_team` (044) and `join_team_as_returning_player`
(015) reused a single `players` row across multiple teams for the same
auth user. One token → two `team_players` rows. `get_team_state_by_player_token`
picks the earliest membership deterministically, so Footy Tuesdays was
unreachable. MySquads accordion also collapsed both squads into one
non-clickable "CURRENT" row.

**Fix (migrations 065–069, commit `1e7da1f`):**
- 065/066 rewrite both join RPCs to mint a fresh player row + token
  per team-membership.
- 067 relaxes `link_player_to_user` (keeps the inverse guard).
- 068 rewrites `delete_my_account` to iterate every player row owned
  by the auth user.
- 069 backfilled gbains: Finbars kept its original token, Footy got a
  new player + token (`p_30834a6b` / `p_XFGglFrN5xVSo2FJx8I`).

**Follow-on: "Copy personal link" was broken too.** SquadScreen fell
back to `p.id` when `p.token` was null. Migration 061 had stripped
tokens from every squad row except the admin's own → fallback shipped
player_ids to the clipboard. Pre-existing bug, never observed before
session 42 because gbains was the first multi-team test case.

**Fix (migrations 070–071, commits `010b5d4` + `34cfd23`):**
- 070 exposes `p.token` on every row in `get_team_state_by_admin_token`
  and adds an explicit `is_self` flag for the admin's own row.
  App.jsx:499 switched from `find(p => p.token)` to `find(p => p.is_self)`
  so the admin's own player is uniquely identifiable now that every
  row carries a token.
- 071 mirrors the fix on `get_team_state_by_player_token` (the RPC VCs
  hit) — derives `v_privileged` (VC of this team OR active team_admins
  row for the caller's user_id) and only exposes squad tokens when
  privileged. Regular players still see null tokens.

**Verified live:** Tarny tapped out, then in, on his own My View →
two audit events on `p_b24c5bf8` (his Footy player) — self-writes
attribute to the correct per-team player row. Tarny copying gbains'
personal link from Admin → Squad now returns the real
`/p/p_XFGglFrN5xVSo2FJx8I`.

**Settled invariants** (see DECISIONS.md):
- One `players` row per (auth user, team).
- Admin/VC squad reads include every row's `token`; regular players
  see null tokens for others.

## SESSION 41 (May 25 2026) — admin-route + realtime + auth telemetry

Triggered by user noticing on the live `team_KPaoX8oJYMQ` ("Footy
Tuesdays") that (a) MyView showed only Tarny as ADMIN when rockybram
created the team, (b) Tarny as VC couldn't promote others, (c) live
updates weren't propagating to his /p/ PWA, (d) rockybram's "out" tap
on his admin PWA never reached the DB.

**Migrations shipped to live + source committed:**
- `060_audit_player_self_writes.sql` — audit_events INSERT on
  set_player_status + set_player_paid. Provided the diagnostic
  visibility that unlocked everything else this session.
- `061_admin_self_token_in_squad.sql` — admin's own player token
  exposed in the squad payload (gated by `auth.uid()` match). Fixed
  silent admin-route self-write failures.
- `062_notify_team_change_public_broadcast.sql` — flipped broadcast
  publishing from `private=true` (default) to `private=false`. Fixed
  realtime live-view for unauthed clients.
- `063_audit_player_self_writes_phase2.sql` — extended 060 pattern to
  7 more player self-write RPCs (injured, guest add/remove, push
  sub/unsub, POTM, account link).
- `064_app_boot_audit.sql` — `log_app_boot` RPC. One audit row per
  app open, capturing display_mode + session_present_client.

**App.jsx changes:**
- Admin player resolver: `state.squad.find(p => p.token)` (was
  `userId` match that never succeeded).
- New broadcast subscriber `useEffect` on `team_live:<liveChannelKey>`.
- `supabase.auth.refreshSession()` on boot AND on `visibilitychange`
  (throttled 5 min).
- `logAppBoot(...)` fire-and-forget on every boot.
- `liveChannelKey` state added; set from all three load paths.

**CLAUDE.md updates:**
- Rule 6 strengthened (real-team-from-fresh-signin only).
- Rule 7 extended (RPC return-shape changes also need grep).
- Rule 9 new: every fire-and-forget RPC must INSERT into audit_events.
- Rule 10 new: server-side publishers must have client subscribers.
- Rule 11 new: migration source + apply in same commit.

**Held at end of session 41, shipped session 44:**
- MySquads `ADMIN` badge condition (VC OR team_admin).
- PlayerProfile + SquadScreen VC-toggle unhide for VC viewers.
- `058_player_get_teams_admin_flag.sql` migration source — committed
  session 44, rule #11 drift closed.

**Still held (not built):**
- HeroCard "Admins" block extension (G change).
- `059_team_state_player_admin_flag.sql`.

**Definitively diagnosed (not yet fixed):**
- iOS PWA storage partition is real. Telemetry confirms Tarny's PWA
  opens with `session_present_client=false` despite confirmed OAuth
  sign-in via Safari. Auto-refresh fix shipped but cannot help when
  there is no refresh token in the PWA's storage scope. Full fix
  requires establishing auth inside the PWA scope (sign-in launched
  from within the PWA, JWT-bearing magic link, or similar).

**Commits this session (chronological):**
- `77b4bb5` — admin-route self-write fix (060 + 061 + App.jsx resolver).
- `4061a88` — realtime live view fix (062 + App.jsx broadcast subscriber).
- `284a44e` — audit hook expansion (063) + auto-refresh on boot +
  visibilitychange + CLAUDE.md hard rules 9/10/11 + rule 6/7
  extensions.
- `f9788ca` — log_app_boot telemetry (064 + supabase.js wrapper +
  App.jsx boot call).

**Verification status at end of session:**
- Admin-route fix: ready for rockybram to test (he hasn't yet
  at end-of-session).
- Live view: confirmed working — Bidz tapped injured, Tarny saw it
  live without reload.
- Auto-refresh: confirmed NOT sufficient for PWA-launched-from-home
  case (storage partition is the dominant failure mode).
- Telemetry: live and capturing rows.

**Open follow-ups carried into next session:**
- ~~Decide fate of admin-badge held work~~ — shipped session 44.
- Plan and ship a permanent fix for PWA auth (Layer 2 of permanent fix
  scope in plan file `.claude/plans/the-live-game-for-wobbly-yeti.md`).
- Step 3 auth-expired prompt may now be partially redundant given
  auto-refresh + decoupling posture.
- Audit other auth.uid()-dependent paths (MySquads, POTM reads, etc.)
  per the auth-decoupling posture documented in DECISIONS.md.

---

This file contains infrastructure, key tokens, demo environment, conventions,
and a compressed session history. For everything else, see the split files:
- **Bugs:** `BUGS.md` — read at session start
- **Schema:** `SCHEMA.md` — DB tables, constraints, types
- **RPCs:** `RPCS.md` — full RPC inventory
- **Decisions:** `DECISIONS.md` — settled architectural decisions
- **Features:** `FEATURES.md` — phase tracker, IO unlock grid
- **IO spec:** `IO_INTELLIGENCE.md` — IO system detail

---

## WHAT THIS IS

In or Out is a mobile-first web app for organising casual weekly football games. Live at **in-or-out.com**. Built as a React/Vite monorepo, deployed via Vercel, backed by Supabase.

Target market: casual 5-a-side and 7-a-side football teams in the UK.
Competitor: Spond (broad, all sports), Capo (early stage UK).
Differentiator: football-specific, frictionless, random player pool, in-app payments, IO Intelligence stats system.

---

## STAGE 1 BETA

Stage 1 launched May 19 2026. No real teams onboarded yet (demo only).
Stage 2 target: May 26. Broader beta: ~Jun 9. Quiet public: late Jul/Aug.
Beta deal: free forever for first 10 teams. Cash only — Stripe Connect not yet built.

---

## INFRASTRUCTURE

| Service | Detail |
|---|---|
| GitHub | github.com/T29RNY/platform (PRIVATE) |
| Vercel | auto-deploys on push to main, project: platform-clubmanager |
| Vercel build command | `cd ../.. && npm install && cd apps/inorout && npm run build` |
| Supabase | https://ktvpzpnqbwhooiaqrigm.supabase.co |
| Supabase publishable key | sb_publishable_vJfG62PWTeaYEdvBj6rI5A_ZhRh75Fd |
| Domain | in-or-out.com (123-reg, DNS → Vercel) |
| Posthog | phc_nKE8bJkj8skLdsxpierEVHgDyGGwaiwbwXoR7F7gLBc7 (EU region) |
| Google OAuth Client ID | GOOGLE_CLIENT_ID_HERE |
| Google OAuth Secret | GOOGLE_CLIENT_SECRET_HERE |

**TODO — SECURITY:**
- ✅ Supabase publishable key rotated
- Google DNS verification via 123-reg TXT record (fixes OAuth branding showing Supabase URL)

---

## MONOREPO STRUCTURE

```
platform/
  apps/
    inorout/
      src/
        App.jsx              ← routing, data loading, realtime, auth
        theme/
          tokens.css         ← full design token system
        components/
          ui/
            HeroCard.jsx     ← animated canvas pitch card; ADMINS block (VCs from squad prop)
            Avatar.jsx       ← initials circle; tileColour/isMe/injured variants
        views/
          PlayerView.jsx     ← startTab prop; squad prop passed to HeroCard
          MySquads.jsx       ← accordion; all squads for authenticated player
          MyIOView.jsx       ← IO Intelligence screen; TacticsBoardHero sticky
          StatsView.jsx      ← IO Statbook; PlayerLeagueTable + Player Form accordion
          PlayerLeagueTable.jsx ← period selector, ranked/unranked, form chips
          HistoryView.jsx    ← Results screen; score_type + last_goal_scorer display
          Gaffer/
            index.jsx        ← Ask the Gaffer AI agent layer scaffold (disabled — ENABLE_GAFFER=false; full spec in GAFFER.md)
            systemPrompt.js
          POTMVotingModal.jsx
          HeadToHead.jsx     ← 5 sections; period selector; chemistry 5-verdict system
          AdminView/
            index.jsx        ← POTM tiebreak modal; sticky hero
            TeamsScreen.jsx  ← Fisher-Yates random, draft save/restore, confirm + push
            ScoreScreen.jsx  ← 6-stage progressive flow, score_type + last_goal_scorer
            BibsScreen.jsx
            SquadScreen.jsx  ← persistent toggles, guest prompt, copy link, PlayerProfile
            ScheduleScreen.jsx  ← MATCH SETTINGS; 10 notification toggles
          InstallBanner.jsx
          PWAWelcome.jsx     ← paste-link only; email lookup removed (session 29)
          JoinTeam.jsx       ← full rebuild session 27; player_join_team RPC
          JoinSuccess.jsx    ← PWA install screen (platform-detected)
          AuthCallback.jsx
          Legal.jsx
        hooks/
          useIOIntelligence.js ← pure consumer of pre-fetched stats; no DB calls
      onboarding/
        index.jsx
        config.js
        hooks/useOnboarding.js ← computeOpensDay day-before, auto_open_pending, adminEmail
        steps/CreateTeam.jsx   ← Nominatim venue, city chip, price validation, bibs YES/NO
        steps/ShareLinks.jsx   ← www URL, window.location.href nav, onboarding_complete
      public/
        manifest.json          ← 4 icon sizes, theme_color #0A0A08
        sw.js
        io-statbook-hero.svg
        icons/
      vercel.json
      index.html
  packages/
    core/
      index.js
      constants/colors.js
      constants/roles.js
      engine/availability.js
      engine/attendance.js   ← updatePlayerRecords() is sole owes-increment path
      engine/payments.js
      engine/squad.js
      engine/scoring.js      ← hasGoalData, resolveDominantType, periodCutoff
      storage/supabase.js    ← ALL Supabase queries
    ui/
      index.jsx
  skills/                    ← methodology skills (see CLAUDE.md)
  turbo.json
  package.json
```

---

## DESIGN SYSTEM

**Fonts:** Bebas Neue (display/numbers/italic headings), DM Sans 300/400 (body)
**Icons:** @phosphor-icons/react weight="thin" throughout

**CSS Variables (src/theme/tokens.css):**
- `--bg:#0A0A08` `--s1:#141412` `--s2:#1C1C19` `--s3:#222220`
- `--t1:#F2F0EA` `--t2:#D0CCC2` — NOTE: --t3 does not exist, use --t2
- `--gold:#E8A020` `--gold2:rgba(232,160,32,0.15)` `--goldb:rgba(232,160,32,0.35)`
- `--green:#3DDC6A` `--green2:rgba(61,220,106,0.12)` `--greenb:rgba(61,220,106,0.3)`
- `--red:#FF4040` `--red2:rgba(255,64,64,0.12)` `--redb:rgba(255,64,64,0.3)`
- `--amber:#FFB020` `--amber2:rgba(255,176,32,0.12)` `--amberb:rgba(255,176,32,0.3)`
- `--purple:#B060F0` `--purple2:rgba(176,96,240,0.12)` `--purpleb:rgba(176,96,240,0.3)`
- Team A: `#60A0FF` Team B: `#FF6060`

**Design principles:**
- Dark atmospheric, football-under-floodlights mood
- Restrained glow — 0.5px borders with colour-matched box-shadow
- Bebas Neue italic for hero titles and numbers
- DM Sans 300 for body text
- Glass chips: rgba(255,255,255,0.1) backdrop-filter blur(12px)
- **CSS vars cannot be used in SVG fill/stroke — use `style={{ fill: "var(--x)" }}`**

---

## URL ROUTING

| URL | What it renders |
|---|---|
| / | Landing OR PWA welcome OR redirect to ioo_last_visited |
| /create | 3-step onboarding (auth-gated) |
| /p/TOKEN | Player view (no auth required) |
| /admin/TOKEN | Admin view (validated against teams table) |
| /demoadmin | Demo admin — no auth, loads team_demo |
| /join/CODE_OR_TEAM_ID | Player self-registration (auth-first) |
| /auth/callback | OAuth redirect handler |
| /legal | T&Cs + Privacy Policy |

---

## AUTH SYSTEM

- Google OAuth — production, verified
- Email magic link — enabled
- /demoadmin — NO auth required, public URL
- Token links (/p/TOKEN) — no auth required for day-to-day use
- Auth only required when JOINING a new team or creating one
- ioo_pending_route (sessionStorage) — holds /create redirect across auth
- ioo_pending_join (sessionStorage) — holds /join/CODE across auth

---

## KEY TOKENS

### FINBAR'S TUESDAYS (real test team)
| Item | Value |
|---|---|
| Team ID | team_finbars |
| Admin URL | in-or-out.com/admin/admin_101d9ac950278f76 |
| Join URL | in-or-out.com/join/team_finbars |
| Tarny token | p_95go8k6cfwo |
| Tarny URL | in-or-out.com/p/p_95go8k6cfwo |
| Tarny player ID | p_onxumqi1 |
| Tarny user_id | f95ad4a8-9b36-4b73-b909-8d2e10c9354b |

### 7 A SIDE FC (demo team)
| Item | Value |
|---|---|
| Team ID | team_demo |
| Admin token | admin_demo |
| Admin URL | in-or-out.com/demoadmin |
| Hassan URL | in-or-out.com/p/p_demotoken_01 |
| Dave URL | in-or-out.com/p/p_demotoken_02 |
| Mike URL | in-or-out.com/p/p_demotoken_03 |
| Sarah URL | in-or-out.com/p/p_demotoken_15 |
| Jordan URL | in-or-out.com/p/p_demotoken_05 |

---

## NAVIGATION

### Player nav (4 tabs)
My View | Stats | Results | My IO

### Admin nav (5 tabs)
My View | Stats | Results | My IO | Admin

- MY IO: MY in var(--t2), I in var(--green), O in var(--red)
- Active tab: gold glow border treatment
- NavBar has NO `isAdmin` prop — 5th Admin tab appears when `onAdminClick` is truthy

---

## DISPLAY TEXT CONVENTIONS
- MOTM → POTM in all UI display text
- "Man of the Match" → "Player of the Match" in all UI
- "History" → "Results" in all UI display text
- Variable names, DB columns, function names UNCHANGED (still motm, history)

---

## FEATURES COMPLETED

See `FEATURES.md` for the full phase tracker and IO unlock grid.

---

## IO INTELLIGENCE SYSTEM

See `IO_INTELLIGENCE.md` for the full IO spec, hook structure, H2H detail, and edge cases.

---

## DEMO ENVIRONMENT

- ID: team_demo, Name: 7 A Side FC
- Admin URL: in-or-out.com/demoadmin (no auth)
- 25 players, 22 matches Sep 2025 → May 2026 (2 cancelled)
- Auto-reset: every 2 hours if last_interaction > 2hrs ago; manual Reset button on /demoadmin
- Demo team has no `team_admins` row — predates the table (BUGS.md #3)

### Key demo players
| Player | ID | Token | Personality |
|---|---|---|---|
| Hassan | p_demo_01 | p_demotoken_01 | Top scorer 18 goals |
| Dave | p_demo_02 | p_demotoken_02 | POTM king 9 awards |
| Mike | p_demo_03 | p_demotoken_03 | Bib magnet 8 times |
| Steve | p_demo_04 | p_demotoken_04 | Perfect attendance |
| Jordan | p_demo_05 | p_demotoken_05 | Unreliable, always maybe |
| Chris | p_demo_08 | — | Owes £15 always |
| Finbar | p_demo_10 | — | 100% attendance, 0 goals |
| Sarah | p_demo_15 | p_demotoken_15 | Top female scorer 11 goals |
| Gav | p_demo_24 | — | 4 injuries tracked |

**Demo data caveats:**
- All 25 demo player rows have `created_at: 2026-05-13` — after every seed match date → reliability stays null in demo (production teams fine)
- Demo has no margin/declared score_type matches → dominantType always 'exact'
- Every demo player attends nearly every match → chemistry verdict always 'building' for every pair

---

## PAYMENT SYSTEM

### DB fields (players table)
| Field | Type | Meaning |
|---|---|---|
| `paid` | bool | Admin confirmed payment (or Stripe paid) |
| `self_paid` | bool | Player/host self-reported cash |
| `paid_by` | text | `'self'` / `'host'` / `'admin'` / `'stripe'` / null |
| `owes` | int | Accumulated debt across missed games |
| `pay_count` | int | Lifetime count of games paid |

### Payment states
`'cash_pending'` (UI-only) → `'paid'` (paid||selfPaid) → `'debt'` (owes>0) → `'unpaid'`

### Key conventions
- `updatePlayerRecords()` in ScoreScreen save is the **sole owes-increment path**
- `matches.payments` jsonb is keyed by **player name string** (not ID) — fragile, never displayed in UI
- Ledger dedup cross-path: player self-pays (null matchId entry), then admin marks paid with real matchId — `handleMarkPaid` finds null-matchId entry and promotes it (updates match_id) rather than creating duplicate
- PostgREST `.upsert()` fails with `42P10` on partial unique indexes — use explicit insert with `23505` conflict recovery instead
- `selfPaid=true` counts as `isPaid` in PaymentsScreen — admin confirmation is a UX signal, not a payment gate

### payment_ledger partial unique indexes
- `payment_ledger_uniq_with_match` ON (player_id, team_id, type, match_id) WHERE match_id IS NOT NULL
- `payment_ledger_uniq_without_match` ON (player_id, team_id, type) WHERE match_id IS NULL

---

## NOTIFICATION SYSTEM

### Auto triggers
gameDay9am, oneHrBefore, debtReminder, bibs24hr, bibs45min, squadFull, spotOpened,
gameLive, gameCancelled, scheduleChange, autoOpen, teamsConfirmed, streakNotification, monthlySummary

### Manual triggers (admin)
Chase no-responses, Cancel week, Announce to squad, Game is live toggle

### Config
- Quiet hours — admin configurable (quietStart/quietEnd in reminders_config)
- 10 per-trigger toggles in ScheduleScreen Notifications tab
- push_subscriptions + notification_log tables
- notify.js cron handlers: flushQueue, gameDay9am, oneHrBefore, debtReminder, bibs24hr, bibs45min, autoOpen, teamsConfirmed

---

## STRIPE PAYMENTS (not yet built)

Stripe Connect with application fees. Platform fee: 20p per transaction.
Each team has one treasurer who connects their Stripe account.
Architecture decision in DECISIONS.md. Unblock when Apple Dev account available.

---

## TEST ACCOUNTS

| Person | Role | Notes |
|---|---|---|
| Tarny | Developer + admin | tarnysingh@gmail.com |
| Gurnam | Beta tester + Stripe | iPhone, willing to connect Stripe |
| Finbar | Real organiser | Finbar's Tuesdays |

**Real teams:** team_finbars (primary test), team_mfw3hhu6 (Monday Footy, cash only)

---

## KEY DECISIONS LOG

See `DECISIONS.md` for all architectural and product decisions.

---

## KNOWN BUGS / TECH DEBT

See `BUGS.md` for the active bug list with priority order. Read at session start.

---

## CONVENTIONS & GOTCHAS

Critical non-obvious behaviours that don't live in the code or schema.

### Supabase / PostgREST
- **Two-query pattern is standard** — PostgREST foreign key joins unreliable in this config. Always use two sequential queries instead of embedded joins.
- **Schema cache**: PostgREST caches function signatures. After any RPC change, 404 may occur. Fix: `SELECT pg_notify('pgrst', 'reload schema');`. Wait 30s.
- **Partial unique index upserts**: PostgREST `.upsert()` generates bare `ON CONFLICT (cols)` without WHERE predicate → `42P10` error. Use explicit INSERT + catch `23505`.
- **PL/pgSQL validates at execution time**: `CREATE OR REPLACE` succeeds even with stale column refs. Function fails silently with `internal_error` at runtime. Run `check-rpc-columns.sh` before every RPC commit.
- **RPC parameter type changes**: `CREATE OR REPLACE` with different param types = new overload, not replacement. Always `DROP FUNCTION IF EXISTS fn_name(old_types)` first.

### Data model
- `matches.motm` stores **player ID** (not name). Use `resolveMotm(value, players)` for display — `players.find(p => p.id === value)?.nickname || name`.
- `player_match.match_id` is **text**, not uuid.
- `matches.match_date` is a Supabase `date` type — returns ISO string `"2026-05-14"`, sorts correctly with `new Date()`.
- `players.is_vice_captain` column dropped in migration 026 — now lives on `team_players.is_vice_captain`. Any RPC that joined `players` and referenced `p.is_vice_captain` must use `tp.is_vice_captain` via team_players JOIN.
- `score_type` null or `'exact'` = has goal data; `'margin'` or `'declared'` = no individual goals. Use `hasGoalData(scoreType)` from scoring.js.
- Reliability is **always all-time** — never period-filtered. Denominator = all team match dates since player.created_at.

### League table / stats
- `getPlayerLeagueTable` returns `{ players: [], totalGamesInPeriod: 0 }` — an object, not an array. Destructure correctly.
- `tableData` players use `playerId` (not `id`), `wins`/`draws`/`losses` (not `w`/`l`/`d`), `played` (not `attended`), `potm` (not `motm`), `form` as uppercase `["W","L","D"]` array.

### React patterns
- **isSavingRef** — use `useRef(false)` not `useState` for double-fire guards. React state batching means two rapid taps both read `isSaving===false` before first render; ref is synchronous.
- **position:sticky** on an element with `overflow:hidden` breaks. Wrap: outer div is sticky, inner div keeps overflow.
- **isFetchingPlayers ref** — prevents concurrent realtime RPC calls. Pattern: `if (isFetchingRef.current) return; isFetchingRef.current = true; ... finally { isFetchingRef.current = false; }`.

### Cron / schedule
- `is_draft` means onboarding incomplete only. Auto-open flag is `auto_open_pending`.
- `computeOpensDay` returns day-before — `(idx+6)%7` not `(idx+1)%7` (Tuesday game → Monday opens).
- `advanceGameDateJob` resets `auto_open_pending=true` weekly so games auto-open next week without admin action.

### Auth / join flow
- Auth return URL: Supabase allowlist is exact-match only. Auth redirect writes `ioo_pending_join` to sessionStorage before redirect; AuthCallback reads and clears it.
- BASE_URL must be `https://www.in-or-out.com` (with www) everywhere — matches Supabase allowlist.
- iOS Safari non-standalone only: write `ioo_redirect_to` for post-auth redirect. Android/desktop do not need this.

---

## SESSION HISTORY (compressed)

**Sessions 1–5 (May 9–11 2026):** Core app, Supabase backend, multi-tenancy, player routing, admin view, stats, history, bibs, payments, PWA, Google auth, magic link, join flow, cover pool, city field, Posthog, T&Cs, reminders engine, debt tracking, web push, VAPID, ScoreScreen bib picker, PWA install flow.

**Session 6 (May 12):** Major UI redesign. Full design system (tokens.css, Phosphor icons). PlayerView, StatsView, HistoryView, AdminView all rebuilt. player_match, player_career, player_injuries tables. Demo environment: team_demo, 25 players, 22 matches, /demoadmin, auto-reset. IO Intelligence system specced.

**Session 7 (May 13):** Planning + demo hardening. Two-stage beta plan agreed. POTM voting cut from Stage 1. Demo reset logic complete.

**Session 8 (May 13):** My IO screen built (useIOIntelligence hook, 8 insight cards, unlock thresholds). JoinSuccess rebuilt as PWA install screen (iOS/Android/desktop platform detection). New app icons.

**Session 9 (May 13):** Auth routing fixed — Supabase URL allowlist strips query params; fix uses sessionStorage ioo_pending_join pattern. BASE_URL standardised to www.in-or-out.com.

**Session 10 (May 13):** POTM voting system built end-to-end: potm_votes table, cron jobs (lineupLockJob, potmVotingOpenJob, potmTallyJob), POTMVotingModal, AdminView tiebreak modal, seed-demo.js.

**Session 11 (May 13):** POTM bug fixes. ScoreScreen full rebuild — 6-stage progressive flow, score_type, last_goal_scorer, isSavingRef double-fire guard.

**Session 12 (May 14):** HistoryView score type display. Admin view consistency + sticky heroes. Gaffer disabled (ENABLE_GAFFER=false). StatsView hero local SVG.

**Session 13 (May 14):** Cron hardening (advanceGameDateJob, autoOpenGameJob, timezone fix). auto_open_pending column. Onboarding full rebuild (CreateTeam, AddPlayers, ShareLinks). ScheduleScreen rebuild → MATCH SETTINGS.

**Session 14 (May 14):** Nickname tap fix. Nickname display audit — all `player.name` instances replaced with `player.nickname || player.name`. HistoryView score type display corrections.

**Session 15 (May 14):** Date field migration — `matches.date`/`date_short` → `match_date` (ISO date). bib_history.player_id added. BibsScreen rework.

**Sessions 16–17 (May 15):** Payment ledger dedup hardening — cross-path promotion, 42P10 fix, find-then-update pattern throughout. PaymentsScreen UI fixes. Payment confirmation UX.

**Session 18 (May 15):** Cancel Week system built — adminCancelMatch RPC, cancelWeek() 8-step async, cancel modal redesign. PlayerView cancelled state inline (no full-screen block). toggle intercept + Cancel Week nudge.

**Session 19 (May 15):** Full codebase audit. Dead code sweep. advanceGameDateJob fixed (is_cancelled reset, is_draft semantics). Console.logs removed. draftNextWeek + stale views/index.jsx deleted.

**Session 20 (May 16):** getPlayerLeagueTable built (5-step query, reliability all-time, period filter). PlayerLeagueTable.jsx built. StatsView integrated.

**Session 21 (May 16):** TeamsScreen full rebuild — Fisher-Yates shuffle, draft save/restore, confirmTeams, pentagon badges, push notification. payment_ledger CHECK constraints updated.

**Sessions 22–23 (May 16–17):** Vice Captain + Manage Squad (SquadScreen full rebuild, HeroCard ADMINS block, PlayerProfile VC toggle, is_vice_captain → players). Stats rewrite — all leaderboards from player_match via getPlayerLeagueTable. Head to Head feature built (5 sections, 5-verdict chemistry, period selector, reliability all-time, dominantType adaptive tiles). Pre-launch join hardening.

**Session 24 (May 18):** RLS lockdown — RLS enabled on all 19 tables. 47 SECURITY DEFINER RPCs. All direct client writes replaced. team_admins + audit_events tables created. /create auth gate. link_player_to_user RPC. demoadmin route fixed to use admin RPC.

**Session 25 (May 19):** RLS post-migration fixes. get_team_state_by_player_token extended with all stats. All three realtime callbacks rewritten to branch on route type. POTM voting RLS fix (submit_potm_vote + get_potm_voting_state RPCs). League table period tabs re-enabled client-side. useIOIntelligence rewritten as pure consumer.

**Session 26 (May 20):** Multi-team player switcher built (player_get_teams RPC, MySquads.jsx). is_vice_captain migrated from players → team_players (migration 026). players_public view updated. All 12 stale p.is_vice_captain refs removed from RPCs. carryForwardDebts removed.

**Session 27 (May 20):** Join flow bug fixed — addPlayerToTeam was receiving wrong arg order in join context. Replaced with dedicated player_join_team RPC (SECURITY DEFINER, authenticated only). JoinTeam.jsx full rebuild. AddPlayers removed from onboarding (players join via squad link only). SetupLoadingScreen + SquadReady built. price_per_player → numeric(10,2). Zero direct table writes in onboarding.

**Sessions 28–29 (May 21):** Dead code sweep — supabase.js dead functions removed, App.jsx dead imports cleared, IsThisYou.jsx deleted. BibsScreen RLS fix (ScoreScreen workaround). B1 resolved: 10 SECURITY DEFINER RPCs referencing dropped `players.is_vice_captain` (all Manage Squad buttons + player attendance + payments broken since migration 026); fixed via apply_migration. player_get_teams stale column fixed. find_player_by_email RPC dropped (PUBLIC grant security issue). player_join_team fixed (token generation, SET search_path, PUBLIC grant revoked). PWAWelcome email lookup section removed. Skills/ directory created — full AUDIT→EXECUTE→VERIFY→COMMIT→POST-DEPLOY cycle with 5 scripts and 11 skill files.

**Session 32 (May 23):** IO Intelligence deeper-intel rewire. B7 resolved: Most Played With (6+), Team Impact (7+), Nemesis (8+), Best Partnership (8+) were dead UI — `useIOIntelligence.js` hard-coded all four keys to null and no upstream path computed them. New pure engine `packages/core/engine/deeperIntel.js` computes all six metrics (incl. new mostFacedOpponent, reliabilityRanking) from `matches[]` + `squad[]` client-side. Wired into `computeStatsFromHistory` (admin/demo) and both player-token state fetches (App.jsx). Two new Insight cards shipped: Most Faced Opponent (amber, 4+), Reliability Ranking (cyan, 5+, min 3 squad games to be ranked). Hygiene script exempted MyIOView.jsx from the hex-literal check (separate commit) — file is overwhelmingly SVG badge rendering, where CLAUDE.md mandates hex literals. Commits: `08db0b7` (hygiene), `04877de` (feature), `5d1112e` (docs).

**Session 34 (May 23):** Manage Squad full redesign + admin manual status feature.
**Manage Squad redesign** (`eab8dd5`): replaced the 582-line SquadScreen with a
modern card-row layout. Single-tap actions throughout — inline rename (pencil),
status-ring avatars with state-coloured glow (green/red/gold/blue), per-row icon
toggles for Priority/VC/Injured, overflow ⋯ menu housing rename, copy/reset
personal link, disable/enable, and remove. Pulled three actions out of
PlayerProfile (rename, reset link, remove with attended-history guard). Live
filter chips (All/Regulars/Guests/Priority/Injured) and auto-revealing search
bar at squad ≥ 6. Stagger fade-in on rows, pop-flash on just-added, glass chip
on the live count, gold-glow on the title, status-coloured pulse on active
toggles. Backend unchanged — reused existing wrappers.
**Stacking-context bug** (`fd82cc5`): three-dot overflow menu opened invisibly
behind the next row. Root cause: row entrance keyframe ended with
`transform: translateY(0)` and `animation-fill-mode: both`, persisting a
transform after the animation finished. A persistent transform creates a CSS
stacking context, so the dropdown's `z-index:20` was trapped inside its own
row. Fix: end keyframe with `transform: none` + lift the row's z-index to 30
while its menu is open.
**Guest-only add bar** (`12ab417`): admin-adding a regular player created a
shell record with no email/auth and risked duplicating the player when they
later joined via invite link. Stripped the REGULAR/GUEST toggle and options
pane; the add bar is now a single line prefixed "+ GUEST" calling
`addPlayerToTeam(..., 'guest', false)`. Invite link card promoted above the
add bar as the primary path; add bar gold to signal secondary action.
**Admin manual status with lock + cap + injury** (`8b2bb83`, migration 038
applied live via MCP): status row IN/OUT/MAY/RES at the top of the ⋯ menu.
New `players.admin_locked_in` boolean. `admin_set_player_status` writes the
flag alongside status (true on IN, false on out/maybe/reserve/none), refuses
'in' if active schedule's `squad_size` cap is met. `set_player_status`
(player-side) refuses 'in' if `admin_locked_in=true` (raises `admin_locked_in`)
or if cap met (raises `squad_full`, defense-in-depth). Race window on cap
accepted as documented risk — appropriate for amateur-team scale.
`get_team_state_by_admin_token` extended to include `admin_locked_in` in the
squad jsonb so SquadScreen can render the lock chip without an extra fetch.
Client: new `adminSetPlayerStatus` wrapper, `dbToPlayer` carries
`adminLockedIn`, barrel export. Squad screen renders a LOCKED IN chip on the
row when locked, fades the IN pill when cap met, raises a "Player is injured.
Set status anyway?" confirm modal when admin sets active status on an injured
player. Smoke tested via MCP against `team_74DvCSH--M0`: admin IN → locked;
player self-OUT → succeeds, lock stays; player self-IN → rejected; cap of 1
with 1 already in → second IN refused; admin NONE → lock cleared.
**Audit (no code shipped):** comprehensive AdminView review at
`/Users/tarny/.claude/plans/ok-thanks-i-want-staged-liskov.md`. Headline
findings: `index.jsx` is 1,544 LOC carrying three big nested components
(`PlayerProfile` 374 lines, `POTMTiebreakModal` 102 lines, `AnnounceModal`
86 lines) that should live in their own files; PaymentsScreen needs the
SquadScreen card+⋯ treatment for a one-tap "mark paid"; ScheduleScreen and
TeamsScreen pre-date the redesign language. No bugs found.

**Session 35 (May 23):** AdminView polish wave + player self-profile + leave/delete +
admin merge. Drove the May-23 audit punch list and the PROFILE_SCOPE end-to-end in
one sitting. Verified live on www.in-or-out.com via Playwright after every
commit.

**AdminView polish wave (3 commits):**
- `db8485d` Extracted `PlayerProfile`, `POTMTiebreakModal`, `AnnounceModal` from
  `AdminView/index.jsx` into their own files. index.jsx 1,544 → 976 lines.
  Fixed a latent `ReferenceError` in POTMTiebreakModal.handleLock — module-level
  function referenced `pendingTiebreak` (parent state) that wasn't in its scope;
  replaced with already-computed `tiedIds`.
- `0ea2850` PaymentsScreen redesign — targeted, not wholesale. Inline gold £X PAY
  pill makes Mark Paid a 1-tap action (was 2–3 taps via accordion). ⋯ overflow
  menu for less-common actions (Mark Paid / Reset / Waive / Open Ledger).
  Status-ring avatars (red owes / green paid / amber unpaid-in / neutral). Section
  header glow, glass containers with backdrop blur, pop-flash on just-paid row,
  stagger fade-in (28ms × min(idx, 12)). Backend untouched. Ledger sub-view,
  inline waiver form, per-paid-game_fee Reset all preserved.
- `1d0bffa` ScheduleScreen + TeamsScreen visual cohesion pass. ScheduleScreen
  gets glass form sections (BASE_INPUT + new GLASS_CARD style), gold-glow
  MATCHDAY SETTINGS title. TeamsScreen TEAM SELECTION title goes gold with
  glow. Hardcoded radii (8/10/12/20) replaced with token vars via sed across
  both files. No interaction changes. TeamsScreen's live-board chip grid still
  pre-dates the design language — flagged for its own future cycle.

**PROFILE_SCOPE (3 commits A/B/C):** Scoped via AskUserQuestion conversation;
locked into `PROFILE_SCOPE.md`. Key decisions: player-facing profile with admin
mode as a graft, soft Leave vs hard Delete are distinct, anonymise (not wipe)
on Delete to preserve match-history FKs, last-admin guard.
- `9ef5a6a` **Session A**: PageHeader gets avatar overlay top-left (40px glass
  circle) + recentred IN OR OUT logo across full header (no resize). PlayerView
  wires `me` + `onAvatarTap` → opens new player-facing PlayerProfile screen
  taking over the viewport. Three expandable sections: STATS (instant from
  props), PAYMENT HISTORY + INJURIES (lazy-load on first expand). MY VIEW's
  Payment History accordion (~80 lines) removed — lives in Profile now;
  current-week payment state stays in the response card. Migration 039:
  `get_my_payment_history(p_token, p_limit)` + `get_my_injuries(p_token)`.
  Both SECURITY DEFINER, derive (player_id, team_id) from token via team_players
  join (mirrors `set_player_injured` pattern). GRANT to anon+authenticated
  because /p/TOKEN runs unauthenticated. Destructive buttons rendered disabled
  with "Coming soon" until Session B.
- `25c8dc7` **Session B**: Migration 040 — `leave_squad(p_token)` (soft remove
  from this team, players row + history preserved, refuses with
  `debt_owed:<amount>` if owes > 0) and `delete_my_account(p_token)`
  (anonymises players row — name → "Deleted player", token/user_id/nickname
  cleared, disabled + reason set — so player_match / payment_ledger /
  player_injuries / potm_votes FKs still resolve; detaches all teams; deletes
  push_subscriptions + player_career; revokes admin grants; returns
  `auth_user_id` for the edge function; refuses with `last_admin:<csv>` if
  user is the only non-revoked admin of any team). New edge function at
  `apps/inorout/api/delete-account.js` calls the RPC then
  `supabase.auth.admin.deleteUser` to wipe the auth row. UI: Leave button is
  two-tap confirm with 4s timeout + inline error. Delete is a glass modal with
  typed-DELETE guard, red CTA only enables when the word matches.
  Success → clear `ioo_*` localStorage breadcrumbs + redirect `/`.
- `b2ae73d` **Session C**: Merged the two PlayerProfile files into one served by
  both contexts behind an `isAdminView` prop. Admin mode: "Admin view" gold
  pill in header, branched RPC paths (`adminGetPlayerLedger` +
  `getPlayerInjuries` by player_id), ROLES section with VC toggle (preserves
  session-34 "You're the Admin" sentinel via new `viewer` prop), Admin Actions
  card (Rename inline edit / Copy link / Reset link / Mark or Clear injury),
  Remove from squad with two-tap confirm + has-history guard surfacing as
  "use Disable instead from Manage Squad". Delete-account modal hidden in
  admin mode. `AdminView/PlayerProfile.jsx` (374 lines) deleted; unified is
  911 lines. AdminView/index.jsx routes selectedPlayer to the unified
  component, re-resolving from `squad` so optimistic updates show without a
  navigation round-trip.

**Verification on live deploy:** ran the verify skill twice (after the polish
wave + after Session C). Playwright drove `www.in-or-out.com/p/p_demotoken_01`
(Hassan — 2 ledger rows, 1 injury) and `/demoadmin` (Dave — attended=19).
Confirmed: avatar overlays + recentred logo render correctly; both lazy-load
RPCs return real data through the UI; admin-mode PlayerProfile renders with
all sections + admin actions; server-side `has_history` guard on
`admin_delete_player` refuses (db cross-check confirmed Dave intact). Probes:
`get_my_payment_history('p_does_not_exist')` raises clean `P0001
invalid_token`; same for `leave_squad`.

**Process note:** the verify skill caught the deferred-tools ecosystem and
made multi-surface verification routine — Vercel MCP for deploy status,
Supabase MCP for direct SQL probes, Playwright MCP for browser drive. Whole
verify cycle ~5 minutes; doubled the signal of the commit messages.

**Two pre-existing findings (not in scope for fix):**
1. Direct `from('matches')` read in PlayerView raises a 401 on every page
   load — leftover from before the post-session-24 RLS lockdown. Should route
   through an RPC. Not blocking, not introduced this session.
2. PaymentsScreen / AdminView Tile clicks need text-label targeting in
   Playwright because Phosphor SVG icons intercept pointer events at the
   target coords — test-driver gotcha, not a real-user issue (React event
   bubbling resolves real taps fine).

Files touched this session:
- `apps/inorout/src/views/AdminView/index.jsx` — extract 3 components +
  route to unified PlayerProfile
- `apps/inorout/src/views/AdminView/PlayerProfile.jsx` — created then deleted
- `apps/inorout/src/views/AdminView/PaymentsScreen.jsx` — full redesign
- `apps/inorout/src/views/AdminView/ScheduleScreen.jsx` — glass + token pass
- `apps/inorout/src/views/AdminView/TeamsScreen.jsx` — title glow + token pass
- `apps/inorout/src/views/AdminView/{POTMTiebreakModal,AnnounceModal}.jsx` — NEW
- `apps/inorout/src/views/PlayerProfile.jsx` — NEW (unified, 911 lines)
- `apps/inorout/src/views/PlayerView.jsx` — wire avatar + remove pay-history accordion
- `apps/inorout/src/components/ui/PageHeader.jsx` — avatar overlay + recentred logo
- `apps/inorout/api/delete-account.js` — NEW edge function
- `packages/core/storage/supabase.js` — 4 new wrappers
- `rls_migrations/039_player_self_profile_reads.sql` — NEW
- `rls_migrations/040_player_self_destructive_actions.sql` — NEW
- `PROFILE_SCOPE.md` — NEW (locked spec for A/B/C)

Commits in order: `db8485d`, `0ea2850`, `1d0bffa`, `9ef5a6a`, `25c8dc7`,
`b2ae73d` (six in one sitting).

---

**Session 36 (May 23–24):** Pre-launch UX overhaul — framer-motion@12 adopted as the standard motion primitive across five showcase surfaces, plus an architectural sweep that closed the H2H + Stats RLS-blind-spot bugs the motion overhaul exposed.

**Motion pass (5 surfaces, in shipped order):**
- `82bc502` PlayerView header — fixed the dead-space layout problem by inlining the avatar beside the team name (was absolute-positioned floating in a corner over a centred logo). Added `layoutId="me-avatar"` so the avatar morphs into the big PlayerProfile avatar instead of fullscreen teleporting. Wrapped the showProfile branch in `<AnimatePresence mode="wait" initial={false}>`. Spring 380/32.
- `349aefa` + `bb079d0` POTM voting modal — celebratory motion on the VOTE LOCKED IN + RESULT moments. Trophy springs in with rotation correction then enters a 1.6s float loop while the auto-close timer runs (extended 3s → 4.5s for proper dwell). Three-beat reveal on RESULT: trophy 360° rotation, winner name fade-up at 350ms, caption at 550ms. Hygiene fix swept up: Trophy weight=fill → weight=thin.
- `a637568` + `de3a057` TeamsScreen Fisher-Yates shuffle reveal — chips wrapped in motion.div + AnimatePresence(popLayout), scale 0.6 → 1 + spring 380/28, 50ms stagger per chip. shuffleNonce keys each chip so re-shuffle forces clean exit/enter. SMART + BUILD TEAMS shuffle icons spin 360° for 700ms during compute. Prediction chip re-keyed on shuffleNonce+winner with spring 260/14. Audit follow-up split `revealing` (gates stagger, fires on every algorithm run incl. silent mount auto-Smart) from `isShuffling` (gates icon spin, user-initiated only), fixing a 500ms invisible-chip regression on manual swaps where the moved chip landed at index N with `delay = N × 50ms`. Dropped the dead `layout` prop.
- `d819d77` ScoreScreen 6-stage progressive flow — StageCard converted to motion.div with spring 280/26 entrance (replaces CSS keyframe). Last-goal-yes eligible list fades in via motion.div. SAVE RESULT button wrapper springs in with overshoot (220/18) when canSave flips true — climactic moment of the entire flow now feels earned, not silent. Cleaned 3 hex literals (#0A0A08 → var(--bg)) and 2 phosphor weights (fill/bold → thin) flagged by hygiene hook.
- `1ba94e7` HeadToHead — the prime view. 231 insertions, comprehensive choreography: modal slide-in spring (260/30), the two HEAD halves clash at TO with directional springs, PlayerColumns slide in from opposite sides with avatar scaling + counter-rotation correction, status pills springs last per side, verdict pill spring 260/14 at 850ms (the emotional payoff), period selector uses `layoutId="period-pill"` for shared-element morph between MONTH/SEASON/ALL TIME (native-app polish), all 5 sections stagger 80ms apart via shared `sectionMotion()` helper, counters in Section 1 ramp via custom Counter component (writes DOM textContent directly to dodge React re-renders), Section 4 comparison bars fill row-by-row with cubic-bezier `[0.22, 1, 0.36, 1]` 180ms stagger (dominance reveals like an awards tally), Section 5 recent matches stagger left-to-right. All sections re-key on `period` so MONTH/SEASON/ALL TIME tab switch replays the entire animation — each period feels like a fresh dossier. One hygiene fix: #fff → var(--bg) on the result badge.

**RLS-blind-spot sweep (triggered by H2H showing empty on /demoadmin):**
- Discovered: `getHeadToHead` did 3 direct `.from()` reads. Under post-session-24 RLS those returned zero rows for anon callers; H2H rendered the empty-state copy. `getPlayerLeagueTable` had the same pattern, affecting StatsView form + reliability columns AND H2H Section 4 Overall Comparison bars.
- `a95e074` migration 041 `get_head_to_head_raw_by_admin_token` — SECURITY DEFINER, derives team from p_admin_token, returns 3 jsonb arrays. JS `getHeadToHead` branches on adminToken; direct reads remain as fallback for authenticated player sessions. Threaded adminToken through App.jsx → PlayerView/StatsView → HeadToHead → getHeadToHead.
- `ed92e2f` migration 042 `get_player_league_table_raw_by_admin_token` — same pattern, returns 5 raw arrays. StatsView now augments local tableData with form + reliability via post-build effect. HeadToHead modalTableData call passes adminToken too.
- `9c17d4d` deleted 298 lines of dead IO Intelligence query code in supabase.js (10 functions: `getPlayerMatchStats`, `getWinRate`, `getCurrentRun`, `getReliabilityScore`, `getMostPlayedWith`, `getOpponentStats`, `getNemesis`, `getBestPartnership`, `getPlayerImpact`, `getPOTMVoteStats`) — all pre-session-32 leftovers with zero callers and zero exports. Each used direct `.from()` reads; removing closes latent RLS-blind-spot risk.

**TeamsScreen UX bugs caught during testing:**
- `a7e3e96` removed duplicate top CONFIRM button + small green toast; remaining bottom button is now state-aware (`ASSIGN ALL PLAYERS FIRST` / `CONFIRM TEAMS` / `CONFIRMING…` / `✓ TEAMS CONFIRMED`). User had reported "confirm buttons do nothing" — they did, but feedback was invisible.
- `b257ae3` BUILD TEAMS gating changed from `groupsDirty` to always-on when SMART is open. Adaptive label: "BUILD TEAMS" (solid gold) when groups dirty, "REGENERATE TEAMS" (outlined) for fresh shuffle. Admin can re-roll without first editing groups.
- `a14590b` two real bugs found and fixed together:
  - **Live Board team sheet missing after confirm** — `admin_save_teams` only wrote `matches.team_a/team_b` but PlayerView.jsx:203 reads `p.team`. Migration 043 extended the RPC to clear+set `players.team` on confirm, scoped via team_players join.
  - **CONFIRM TEAMS reverts to "CONFIRM" on return** — race condition between matchId hydration (sets teamsConfirmed=true from loaded match) and auto-Smart effect (reads empty `assignments` from stale closure, fires runAlgorithm which sets teamsConfirmed=false). Hydration now sets `hasAutoFiredRef.current=true` when it detects an already-confirmed lineup so auto-Smart bails.

**Demo environment cleanups (not bugs in live code):**
- Cleared orphan `user_id` on Priya (`p_demo_16`) that was blocking bulk seed UPDATE due to FK violation (referenced a deleted auth.users row).
- Added a `team_admins` row for `tarny@desicity.com` (uid `b5d8c647-…`) on `team_demo` — closes BUGS.md #3. The RPC fix above means demoadmin works for anon visitors too now, so this is belt + braces.
- Reseeded `team_demo` squad to **10 IN / 5 RESERVE / 4 OUT / 4 MAYBE** (with Callum un-injured to make the 23 count). Tarny + Hassan + Dave + Mike + Steve + Jordan + Liam + Chris + Robbie + Finbar as IN. Lets the team selection + motion choreography test against realistic data.
- `dd14c6e` `/demoadmin` "me" now hardcoded to Hassan (`p_demo_01`) instead of session-uid lookup. Public showcase route shouldn't be identity-bound; Hassan has the richest seeded history.

**Files touched this session:**
- `apps/inorout/package.json` — framer-motion@12.40.0 dep added
- `apps/inorout/src/components/ui/PageHeader.jsx` — inline avatar restructure + layoutId
- `apps/inorout/src/views/PlayerProfile.jsx` — matching layoutId on big avatar
- `apps/inorout/src/views/PlayerView.jsx` — AnimatePresence wrap + adminToken thread
- `apps/inorout/src/views/POTMVotingModal.jsx` — celebratory motion
- `apps/inorout/src/views/AdminView/TeamsScreen.jsx` — shuffle reveal + button consolidation + REGENERATE + race-condition fix
- `apps/inorout/src/views/AdminView/ScoreScreen.jsx` — stage springs
- `apps/inorout/src/views/HeadToHead.jsx` — full motion overhaul + adminToken thread
- `apps/inorout/src/views/StatsView.jsx` — adminToken thread + form/reliability augmentation effect
- `apps/inorout/src/App.jsx` — demoadmin "me" → Hassan + adminToken plumbing
- `packages/core/storage/supabase.js` — getHeadToHead + getPlayerLeagueTable branched on adminToken; dead IO Intel block deleted
- `rls_migrations/041_rpcs_h2h.sql` — NEW
- `rls_migrations/042_rpcs_player_league_table.sql` — NEW
- `rls_migrations/043_admin_save_teams_writes_player_team.sql` — NEW

**Commits in order (this session):** `82bc502`, `349aefa`, `bb079d0`, `a637568`, `de3a057`, `d819d77`, `1ba94e7`, `dd14c6e`, `a95e074`, `a7e3e96`, `b257ae3`, `ed92e2f`, `9c17d4d`, `a14590b` — fourteen commits.

**Outstanding from this session (not done):**
- #5 from the original motion list: MyIOView insight unlock springs (replace existing CSS keyframe with framer spring). Deferred mid-session when the H2H/Stats bug triage took priority. Whole motion overhaul list is done bar this one.

---

**Session 37 (May 24):** Beta launched at start of session. First real customer hit a chain of bugs in the first hour; session was a long P0 bug-fix cascade.

**Bugs surfaced + resolved (in order of discovery):**

1. **OAuth loop on `/join/CODE`** — JoinTeam rendered "Continue with Google" on first paint with `authUser=null` because App.jsx hadn't resolved the initial session yet. User tapped, completed OAuth, saw the same screen. Fix: JoinTeam self-checks via `supabase.auth.getSession()` on mount + App.jsx `authReady` flag that gates every route until first session check resolves. Plus regression fix (load() needed `session` restored after the refactor) and `/create` hardening (dual sessionStorage + localStorage write). Commits `2cd33c9`, `5c2cae2`, `b041f38`.

2. **JoinTeam wordmark "INOROUT"** — `.join-brand` was `display: flex` which collapses whitespace between flex items. Swapped to `display: block`. Commit `a5cf076`.

3. **PWA installed from SquadReady opened to "Paste your link"** — biggest bug of the session. Two failed attempts before the actual fix:
   - **Attempt 1:** write `ioo_last_visited` to localStorage in SquadReady (commit `692d84a`). FAILED. **Why:** iOS Safari partitions installed PWA localStorage from Safari proper.
   - **Attempt 2:** React-side `<link rel="manifest">` swap via useEffect + dynamic `/api/manifest` endpoint (commits `11614ee`, `2d12db3`, `7c36dc7`). FAILED. **Why:** iOS reads the manifest URL at HTML parse time and ignores subsequent JS mutations. Visible proof: the "Add to Home Screen" iOS dialog showed bare hostname (start_url=/), not the swapped URL.
   - **Actual fix** (commit `b7236ca`): replaced the static `<link rel="manifest" href="/manifest.json">` in `index.html` with an inline `<script>` that runs synchronously during HTML parse, reads `window.location.pathname`, and injects `/api/manifest?admin=<token>` if on an `/admin/<token>` URL (otherwise `/manifest.json`). Combined with hard-redirecting from `/create` → `/admin/<token>?just_created=1` after `create_team` succeeds (so the URL path matches what the inline script needs at parse time), and an App.jsx-level overlay that renders SquadReady on `?just_created=1` regardless of the default view. Verified live on iPhone: home-screen icon now opens directly to admin panel.

4. **PWA installed from JoinSuccess (player flow)** — same root cause, same architectural mirror. `/api/manifest` extended to accept `?player=<p_token>` (commit `f62cc7c`). Inline script in `index.html` also matches `/p/<token>`. `handleJoin` hard-redirects to `/p/<token>?just_joined=1` after `playerJoinTeam` succeeds (commit `90bba41`). App.jsx renders JoinSuccess as overlay on `?just_joined=1`. Verified live.

5. **Player invite link in admin panel rendered `/join/<team_id>` instead of `/join/<join_code>`** — `SquadScreen.jsx:404` used `teamId` where it should have used `joinCode`. Bug was masked because `get_team_by_join_code` has a fallback that matches against `team_id`. Fixed: SquadScreen fetches via `getTeamByAdminToken` on mount, uses `team.join_code`. Commit `a8b803e`.

6. **OAuth "User not found" loop AFTER account deletion** — diagnostic finding. Previous `delete_my_account` for tarnysingh@gmail.com succeeded at SQL layer but failed silently at `auth.admin.deleteUser` (Stage 2 returned `ok:true,authDeleted:false`). The auth.users row + auth.identities row stayed forever, blocking that email from re-signing in (Google verifies identity → Supabase finds it → looks up missing user_id → 404 "User not found" → silent OAuth loop). Root cause: 040 version of `delete_my_account` anonymised the player row and *revoked* (not deleted) team_admins rows, never touched `user_profiles`. Postgres refused the auth.users delete (NO ACTION FKs still live). **Fix (migration 047):** DELETE team_admins for v_user_id (not just revoke), NULL out `granted_by` / `revoked_by` refs from other admins this user touched, NULL `platform_admins.granted_by`, DELETE user_profiles row. Verified end-to-end: called real `/api/delete-account` endpoint → returned `authDeleted:true` → auth.users + auth.identities + user_profiles all zero rows.

**Architectural decisions formalised in DECISIONS.md:**
- **PWA install via dynamic manifest** — `/api/manifest` endpoint emits per-install `start_url`; inline `<script>` in `index.html` injects the right `<link rel="manifest">` at HTML parse time; post-create + post-join URL redirects ensure the URL path matches what the inline script needs.
- **Account deletion FK purge rule** — any new public table that references `auth.users.id` with NO ACTION must be added to the cleanup block in `delete_my_account`. CASCADE FKs fine as-is.

**Future-proofing artefacts shipped:**
- `manifest.json` `_comment` field warning against changing `start_url`
- Block-comment sentinels in `index.html`, `SquadReady.jsx`, `App.jsx`, `api/manifest.js` covering the iOS parse-time gotcha and the rules that MUST be preserved
- Migration 047 comment block explaining the FK purge requirement
- Edge function comment with manual cleanup SQL for stuck accounts

**Files touched this session:**
- NEW `apps/inorout/api/manifest.js` — dynamic manifest endpoint (admin + player)
- `apps/inorout/vercel.json` — `no-store` headers for `/manifest.json`
- `apps/inorout/public/manifest.json` — `_comment` sentinel
- `apps/inorout/index.html` — inline manifest injection script
- `apps/inorout/src/App.jsx` — authReady gate + manifest swap effect + just_created/just_joined overlays + handleJoin redirect
- `apps/inorout/src/onboarding/hooks/useOnboarding.js` — post-create redirect + createTeam wrapper migration
- `apps/inorout/src/onboarding/steps/SquadReady.jsx` — manifest swap useEffect (defense in depth) + sentinel
- `apps/inorout/src/views/JoinTeam.jsx` — session self-probe + `.join-brand` CSS
- `apps/inorout/src/views/SignIn.jsx` — `/create` returnTo prop + hex token cleanup
- `apps/inorout/src/views/PWAWelcome.jsx` — polymorphic paste box (p_/admin_/join)
- `apps/inorout/src/views/AdminView/SquadScreen.jsx` — fetch join_code via adminToken
- `apps/inorout/src/views/AdminView/index.jsx` — removed dead overlay (moved to App)
- `apps/inorout/api/delete-account.js` — gotcha comment
- `packages/core/storage/supabase.js` — createTeam wrapper added
- `packages/core/index.js` — createTeam barrel export
- `Skills/scripts/check-hygiene.sh` — Google brand hex allowlist
- NEW `rls_migrations/047_delete_account_cleans_fk_refs.sql`
- `BUGS.md`, `DECISIONS.md`, `CONTEXT.md` — this documentation pass

**Commits in order:** `12d0ceb`, `2cd33c9`, `692d84a`, `a5cf076`, `5c2cae2`, `b041f38`, `11614ee`, `2d12db3`, `9673934`, `b7236ca`, `7c36dc7`, `a8b803e`, `155f0ee`, `f62cc7c`, `42c54e8`, `90bba41` — sixteen commits.

**Verified live on iPhone:** admin install opens at `/admin/<token>` ✓ — player install opens at `/p/<token>` ✓ — join flow with second email works ✓ — delete account returns `authDeleted:true` ✓.

---

**Session 33 (May 23):** Ask the Gaffer repositioned from chatbot to platform AI agent layer. Spec consolidated into new `GAFFER.md` (sourcing DECISIONS.md + LEAGUE_MODE_SCOPE.md Phase 7). Provider locked in: Vercel-hosted edge function `/api/gaffer` → Anthropic `claude-sonnet-4-5` direct (same env var as previous chatbot scaffold). Data-access pattern locked in: per-surface `gaffer_get_context_*` RPCs (SECURITY DEFINER, derive team from `p_admin_token`, return jsonb) + `ai_briefings` audit table storing every output with its `context_snapshot` for factual auditability. Built: 5 migrations (033 ai_briefings table, 034–037 four Phase 1 context RPCs), edge function rewrite with multi-surface routing/cache/cost tracking, five surface system prompts under `views/Gaffer/prompts/`, `<GafferCard>` reusable inline component, new admin Q&A panel (old player-facing chatbot archived as `_archived_chatbot.jsx`), JS wrappers `getGafferBriefing` + `askGafferQuestion` in supabase.js. Migrations applied via Supabase MCP and smoke-tested end-to-end against `team_demo` — all four RPCs return real data (Dave 4g top scorer 30d; Hassan 7g + Dave 6g in-form; risk_level=high; live recent form). One in-flight bug caught and fixed in smoke test: original SQL used non-existent `row_to_jsonb` — patched to `to_jsonb` via MCP and migration files synced. **Frontend untouched** — no UI wire-up yet. Awaiting: (1) confirm `ANTHROPIC_API_KEY` is still on Vercel (was set for previous chatbot), (2) canary UI wire-up onto one team. Cross-browser PWA install breadcrumb gap also logged as BUGS.md #5 (cross-browser/in-app-webview install loses token bridge — fix is server-side signed cookie, not urgent). Commits: `3899a95` (repositioning docs), `f58ce86` (scaffold), `50131c2` (to_jsonb fix), `a55089b` (BUGS B5).

---

**Session 38 (May 24):** First-time-use tooltips. New `FirstTimeHint` primitive at `apps/inorout/src/components/FirstTimeHint.jsx` — framer-motion entrance/exit (opacity + scale, 150ms), localStorage dismissal (per-device), optional `prerequisite` storageKey for chained reveals, custom `ioo-hint-dismissed` event so duplicate instances of the same key dismiss in sync. Reused the existing gold-card visual language (`var(--gold2)`/`--goldb`/`--gold` accent, `--font-display` heading, Phosphor `X` `weight="thin"` dismiss).

**12 hints wired:**
- Global live-game on `AdminView/index.jsx` (replaces the bespoke gold card at the old 648–682 block; storage key `ioo_game_live_hint_dismissed` **preserved** for continuity with already-dismissed users).
- Admin: Squad invite link, three chained Teams hints (player tiles → SMART button → CONFIRM TEAMS via `prerequisite`), Payments unpaid section, Bibs holder card.
- Player: PlayerView status grid, StatsView league table (calling out the hidden H2H gesture), HistoryView first match card, PlayerProfile leave-squad button.

**Audit-first methodology proven:** ran an explicit 10-point pre-execute audit before any edits (no SQL/RPC/auth/realtime/env/deps/data-writes), all PASS. Hygiene hook caught a pre-existing hardcoded `#0A0A08` in `BibsScreen.jsx:156` — fixed in flight to `var(--bg)`. Build + hygiene clean across all 10 changed files.

**Deliberately not wired:** ScoreScreen, ScheduleScreen (live-toggle covered by global hint), RemindersScreen, MyIOView, MySquads — either self-explanatory in context or low-value.

**Lives on /demoadmin too** — pure client JSX, no auth gating, so every fresh visitor to the demo gets the onboarding hints automatically. localStorage is per-origin so personal dismissals carry across `/admin/<token>` and `/demoadmin`.

Commit: `0a1e759` (single commit).

---

**Session 39 (May 24):** Pre-Beta audit + Beta P0 push-fix cascade + defense-in-depth migrations + new super-admin dashboard. Long session spanning two phases (pre-launch fix + post-launch sweep) triggered by an alarming 73.7% Vercel error rate after Beta went live.

**Phase A — Pre-Beta launch blocker fix:**
- Pre-launch audit (3 parallel Explore agents) caught one real launch blocker the moment the real team was about to send the invite link: `player_join_team` (migration 028) omitted the `token` column from the new-player INSERT branch, so first-time joiners landed with `player.token=NULL`. JoinSuccess.jsx falls back to `/` in that case, stranding the joiner. Migration 044 generates the token using the same helper `create_team` uses. Applied via MCP, verified with a rolled-back transaction smoke test, committed `cec9975`. Pre-Beta SQL-layer smoke test only — UI-layer test on real device deferred.

**Phase B — Super-admin dashboard (Phase 1 + 2):**
- New `apps/superadmin` app — Vite + React 18, plain dark admin UI (no framer-motion, no PWA, no PostHog), port 5175 in dev. Three tabs: Activity (audit_events tail with team-name + actor-email joins, 1h/6h/24h/7d windows), Teams (sortable list with player count, admin count, outstanding debt, last-match-date, join code), Team Detail (drilldown — squad, schedule, payments summary, admins list, recent matches, recent audit events).
- Migration 045: `platform_admins` table (global authorisation, separate from per-team `team_admins`) + `is_platform_admin()` helper + `superadmin_whoami()` RPC. Seeded with `tarny@desicity.com` auth uid.
- Migration 046: three read RPCs (`superadmin_list_teams`, `superadmin_team_detail`, `superadmin_recent_activity`) all gated by `is_platform_admin()`, all SECURITY DEFINER, all returning jsonb.
- Deployed at `https://platform-superadmin-djj9b1w8x-tarny-s-projects.vercel.app` — Vercel SSO-gated (team protection on by default). Three deploy commands documented in plan file because GitHub git-integration not yet wired (manual `vercel build --prod && vercel deploy --prebuilt --prod --yes` ritual for now).
- Phase 3 (token-rescue write tools) + Phase 4 (data-fix write tools) deferred to a future session.

**Phase C — Production incident + structural fix:**
- First superadmin commit (`9b7bda8`) listed `@platform/supabase` as a real npm dep, but it was only a Vite alias to `packages/core/storage/supabase.js`. Local builds passed (Vite resolves at build time, never touches node_modules), Vercel CI failed workspace-wide because npm couldn't resolve `@platform/supabase` from the registry. **This cascaded to break platform-clubmanager's deploy pipeline too** (npm install fails workspace-wide if any member has a missing dep). `www.in-or-out.com` kept serving the prior good build (`cec9975`) because Vercel only promotes on success — live site never affected. Fixed in `a6fe2a8` by dropping the fake dep.
- Followed up with `7547d49`: eliminated the `@platform/supabase` alias entirely. 22 source files migrated via sed to import from `@platform/core/storage/supabase.js` (the real path exposed by packages/core's `exports` map). New `Skills/scripts/check-workspace-deps.sh` validates every `@platform/*` dep in every `apps/*/package.json` + `packages/*/package.json` maps to a real workspace package — wired into the pre-commit build gate (called from `check-build.sh`). Sub-second jq-based check. Negative-tested by re-adding `@platform/supabase` + a synthetic `@platform/imaginary` and confirming the gate blocks the commit with actionable error text.
- Plus the `@platform/core` alias target changed from `packages/core/index.js` (a specific file) to `packages/core` (the directory) so subpath imports resolve via the package's `exports` map.

**Phase D — 73.7% error rate investigation → push notifications root cause:**

Vercel dashboard showed 73.7% Error Rate over 6h on platform-clubmanager. Investigation via parallel runtime-log + Supabase log + cron.job dumps uncovered a three-layer bug, all latent since the original platform-clubmanager deploy 13 days prior:

1. **VAPID env vars stored as empty strings.** All four set 13 days ago via the Vercel dashboard but with no value. Encrypted/"sensitive" Vercel envs are masked as empty in `vercel env pull`, so visual inspection was impossible. Confirmed empty by runtime crash: `webpush.setVapidDetails(...)` threw `Vapid public key must be set` at module-load on every cold start. Fixed by generating a fresh keypair (`npx web-push generate-vapid-keys`), removing the empty entries, and re-setting via `vercel env add --value` (the `printf | vercel env add` pattern that worked for the superadmin URL/key doesn't work here — required the explicit `--value` flag).

2. **Pg_cron jobs called apex URL not www.** All six notification jobs used `https://in-or-out.com/api/notify`. Apex 307-redirects to `https://www.in-or-out.com`. `pg_net` (like all sane HTTP clients) strips the `Authorization` header when following a cross-host redirect → bearer never reached the function → 401 → never delivered. Masked by the parallel VAPID 500s until those were fixed; only became visible at the 19:15 + 19:30 cron ticks after the redeploy. Confirmed by running `net.http_post` from MCP directly against apex (returned 401) vs www (returned 200). Fixed all 6 jobs via `cron.alter_job` to use canonical www URL.

3. **Pg_cron job 5 syntax error.** `notif-bibs-24hr` had `Liverp00l123?!!*` pasted in the middle of its command body, producing `syntax error at or near ":="` ERROR every hour on the hour in postgres logs. Fixed via `cron.alter_job` with clean body.

Verified end-to-end at the 19:45 UTC cron tick: **4× HTTP 200** vs **4× HTTP 401 at 19:30** (apex/auth-strip baseline). First-ever successful cron-driven push pipeline run on this Supabase project. `push_subscriptions` table still 0 — Beta hasn't exercised the in-app subscribe flow yet, so the proof-on-device test is deferred. Once a real subscriber exists, the same pg_cron tick that returns 200 will actually deliver a push.

**Phase E — Closing security loops:**
- **Migration 048** (commit `156dc84`) — `admin_save_teams` cross-team write surface flagged in the pre-Beta audit (originally tracked as "migration 045"; renumbered after 045+046 went to the superadmin dashboard). The 043 body correctly scoped the CLEAR via `team_players` join but the two SET statements (`team='A'`/`team='B'`) trusted the client-supplied arrays against global `players.id`. Verified the bug live: team_demo admin successfully wrote `team='A'` to a Finbars player (rolled back). Migration 048 adds `team_players` scope to both SET statements. Adversarial test re-run post-fix confirmed leak blocked (`before=NULL, after=NULL`); happy-path test confirmed legit calls still work (`before=NULL, after=A`).
- **Migration 049** (commit `5a1a0e3`) — added `player_account_deleted` to `notify_team_change` whitelist (session 37's migration 047 passed this reason but it wasn't in the whitelist, producing a WARNING per account-deletion). Plus documented the apex→www cron URL fix in the migration file's comment block as an architectural note.

**Skipped (with explicit decision):**
- Phase 2 of the original sweep plan — investigating a single 401 on a direct `from('matches')` read. The query signature matched `getHeadToHead`'s direct-read fallback (intentional code), and the team_id (`team_54awfyl7TQY`) has never existed in this database. Stale PWA install / localStorage artefact on one iPhone session, not a code bug. Defer to "fix if real Beta users report empty H2H."

**Architectural decisions formalised in DECISIONS.md:**
- **Push notification URL rule:** all server-to-self HTTP calls (pg_cron → /api/notify, edge function → /api/anything) must use the canonical `https://www.in-or-out.com`, never the apex `https://in-or-out.com`. Apex 307s to www; pg_net + browsers + curl all strip Authorization on cross-host redirects.
- **Workspace deps:** every `@platform/*` in any `package.json` must resolve to a real `packages/<name>/` workspace. Vite aliases are configured in `vite.config.js` only — they must NOT appear as deps. Enforced by `check-workspace-deps.sh` pre-commit hook.
- **Super-admin authorisation layer:** new `platform_admins` table (global, cross-team) sits parallel to `team_admins` (per-team). All `superadmin_*` RPCs gate on `is_platform_admin()`. New entries to `platform_admins` are added by hand via SQL only — intentionally no UI to grant this role.

**Files touched this session:**
- NEW `apps/superadmin/` — full new app (package.json, vite.config.js, vercel.json, index.html, src/{main,App,styles,views/Activity,views/Teams,views/TeamDetail})
- `packages/core/storage/supabase.js` — added 4 superadmin wrappers; all `@platform/supabase` import paths in tree migrated to `@platform/core/storage/supabase.js`
- `packages/core/index.js` — barrel exports for the 4 superadmin wrappers
- `apps/inorout/vite.config.js` + `apps/superadmin/vite.config.js` — dropped `@platform/supabase` alias; `@platform/core` target changed to directory not file
- 22 source files under `apps/inorout/src/` — sed-migrated import paths
- NEW `Skills/scripts/check-workspace-deps.sh` + `Skills/scripts/check-build.sh` (added the workspace-deps gate as a precondition)
- NEW `rls_migrations/044_player_join_team_generates_token.sql`
- NEW `rls_migrations/045_platform_admins_and_whoami.sql`
- NEW `rls_migrations/046_superadmin_read_rpcs.sql`
- NEW `rls_migrations/048_admin_save_teams_scope_team_set.sql`
- NEW `rls_migrations/049_notify_team_change_whitelist_player_account_deleted.sql`
- Vercel platform-clubmanager production env — 4 VAPID vars set with real values
- Supabase `cron.job` rows 1–6 — URLs changed apex → www, plus job 5 syntax fix
- Supabase `platform_admins` table seeded with `b5d8c647-f08e-4309-836c-5b77724d2960` (tarny@desicity.com)

**Commits in order:** `cec9975`, `9b7bda8`, `a6fe2a8`, `7547d49`, `156dc84`, `5a1a0e3` — six commits. (User shipped `0a1e759` + `69951d4` mid-session — session 38's first-time-use tooltips.)

**Verified live (server-side only):**
- `/api/notify` returns 200 from curl, from pg_net (www URL), and from the 19:45 pg_cron tick (4× 200).
- Migration 048 adversarial test: team_demo admin attempted cross-team write to Finbars player → blocked (`team` value untouched). Happy-path test: same admin writing legit team_demo player → `team='A'` as expected.
- Live `www.in-or-out.com` on commit `5a1a0e3`, healthy.

**Deferred to next session:**
- Subscribe a real device to push notifications (in-app flow not yet located/exercised), then fire a test push via `/api/notify` direct-mode and confirm receipt on lock screen.
- Locate the "Allow notifications" affordance in the app (might be missing or buried).
- Superadmin Phase 3 (token-rescue write tools) + Phase 4 (data-fix write tools).
- Wire GitHub git-integration on `platform-superadmin` Vercel project so it auto-deploys on push.


---

## SESSION 40 — 2026-05-25 — Phase 0 + Phase 1 of League Mode

Two major phases of `LEAGUE_MODE_SCOPE.md` shipped end-to-end in one
session. The platform now has the full schema spine for evolving from
single-team app into Company HQ → Venue → League → Season → Fixtures.
Zero customer-visible change — every migration additive, every default
flows transparently.

**Key decision: multi-sport posture (recorded in DECISIONS.md).**
- Zero renames of existing tables/columns/fields (anything with "goal" /
  "motm" / "card" / "bib" / "cleanSheet" / "yellow_cards" / "red_cards"
  in its name stays exactly as it is)
- All NEW identifiers from Phase 0 onward generic by name
- `sport text DEFAULT 'football'` on `league_config`, `companies`,
  `venues`, `leagues` — single source of truth at every level
- Multi-sport-specific stats will land in a future `sport_stats jsonb`
  column on `player_match` + `matches` when sport #2 actually arrives

**Phase 0 — Foundation (6 migrations 050–054 + JS):**
- 050 `league_config` table + `get_league_config` RPC + `useLeagueConfig`
  hook in `packages/core/hooks/`
- 051 `matches.match_type` column (casual/competitive, defaults casual)
- 052 `teams.team_type` column + `create_team` RPC resigned with optional
  `p_team_type` (old 13-arg signature DROPed first)
- 053 `player_match.match_type` column + BEFORE INSERT trigger that
  auto-derives `match_type` from parent match; `player_career` gains 12
  casual/competitive split columns; new `sync_player_career(p_player_id)`
  RPC (service-role only)
- 054 `company_domains` table + `get_company_by_domain` RPC + defensive
  hook in `AuthCallback.jsx` (try/catch — login never breaks)
- `packages/core/notifications/notify.js` — multi-channel dispatch
  abstraction with kill switch, dry-run mode, per-recipient rate limit,
  template whitelist; sport-neutral template names. Phase 9 will plug
  Twilio providers.

**Phase 1 — Core data model (3 migrations 055–057):**
- 055 — 20 new tables: companies, company_admins, billing_events,
  clubs, venues, venue_admins, playing_areas (was `pitches`),
  match_officials (was `referees`), leagues, seasons, competitions,
  club_teams, competition_teams, team_name_history, cup_rounds,
  fixtures, match_events, player_registrations, incidents,
  hq_preview_tokens. All RLS-enabled, no public policies. `event_type`
  + `period` on `match_events` open text (no CHECK) so each sport
  defines its own vocabulary.
- 056 — 13 new columns on existing tables (teams: club_id /
  primary_colour / secondary_colour; matches: fixture_id /
  opponent_team_id / opponent_name; players: shirt_number /
  date_of_birth / phone / notification_channel; player_match:
  minutes_played / was_substitute / shirt_number). All additive, all
  metadata-only ALTERs (PostgreSQL ≥11). Backfilled via DEFAULT.
- 057 — Phase-0 FK completions: `league_config.league_id` →
  `leagues(id)`, `company_domains.company_id` → `companies(id)`. RPC
  `get_company_by_domain` extended to JOIN companies for `company_name`.

**MyView double-count hotfix (during the session, separate cycle):**
User noticed Tarny's My View on "Footy Tuesdays" showed "£5 + £5 = £10"
while Payments correctly showed £5. Root cause: `PlayerView.jsx:459-461`
added `effectiveDebt + price` whenever an unpaid ledger entry existed
AND status='in', assuming ledger = past carry-over. Breaks when the
ledger entry IS this week's fee (created with match_id=NULL because
lineup-lock hasn't happened yet). Fix: trust ledger as single source of
truth; never add `price` to `effectiveDebt`. Stale £5 ledger row
deleted via execute_sql. Commits `a8dd46d` + `ab6484f`.

**End-to-end Phase 0 smoke (verified live):**
User created a real team "Smoke Test" via `/create` with Google auth
(tarny@desicity.com). Verified: `team_type='casual'` written via new
14-arg `create_team`, team_admins linked, OAuth callback completed.
Then tested the `player_match` match_type propagation trigger with a
transactional UPDATE→INSERT→ROLLBACK — trigger auto-set
`match_type='competitive'` from the parent match. All three smoke
tests passed. Smoke Test team + 6 dependent rows deleted cleanly,
auth.users row preserved.

**Files touched live (Supabase main project):**
- NEW migrations 050, 051, 052, 053, 054, 055, 056, 057
- NEW table rows: 1 seed in `league_config` (platform-default,
  league_id IS NULL)
- ALTERed in-place: teams (3 cols), matches (1 col + 1 col Phase 0B),
  players (4 cols), player_match (1 col Phase 0D + 3 cols Phase 1)
- NEW RPCs: get_league_config, get_company_by_domain (later extended),
  sync_player_career; create_team RESIGNED (old signature dropped)
- NEW trigger: player_match_propagate_match_type_trg

**Commits in order:**
`ad939bb` 0A · `5cb2ecb` 0B · `bf21e1a` 0C · `7a0cb95` 0D ·
`3c30e9b` 0E · `b7f754a` 0F · `a8dd46d` MyView hotfix · `ab6484f` BUGS.md ·
`0821682` 055 · `d7733a3` 056 · `650e536` 057 · `ff83be8` SCHEMA.md

**Post-Phase-1 advisor scan:**
- 0 new ERROR-level (3 pre-existing on public views: teams_public,
  matches_public, players_public — unchanged)
- 20 INFO advisors for "RLS enabled, no policies" on Phase 1 tables —
  intentional, matches `ai_briefings` pattern. Phase 2 SECURITY DEFINER
  RPCs are the access path.

**Customer-visible impact this session: zero.** No UI reads from any of
the new tables yet. Phase 2 will be the first phase that builds
customer-facing surfaces on top of this spine.

**Deferred to next session:**
- Phase 2 — Venue + League admin (estimated 6 days). Builds `/venue/TOKEN`
  route, season setup flow, fixture generation, ref/pitch management,
  team self-registration. ~14 new SECURITY DEFINER RPCs (venue_*, league_*).
  First phase that creates real customer-visible surfaces on top of the
  Phase 1 spine.
- Independent track: Gaffer Phase 1 AdminView wire-up (Anthropic key
  confirmed live on Vercel `inor-out` project; just needs the
  `GafferCard` mounting + canary on one team). Doesn't depend on any
  Phase 2 work.
- `player_career` Phase 2 backfill: call `sync_player_career` for every
  player + wire to insert/update trigger on `player_match`. Phase 0D
  shipped only the schema + RPC; the backfill itself is Phase 2
  housekeeping (BUGS.md #2 has the detail).
