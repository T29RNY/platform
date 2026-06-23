# Stripe Full Build — Handoff & Plan

> **STATUS (2026-06-23):** 🏁 **PHASE 1 + 2 + 3 + 4 SHIPPED + MERGED**; **PHASE 4 RUNTIME WALK PASSED
> (s185)** (Phase 1: mig 403, PR #69; Phase 2: mig 404, PR #71; Phase 3: mig 405, PR #73; Phase 4: mig 406,
> PR #75 — all MERGED). Full Stripe build — one track. 21 scope items (see coverage map). Built end-to-end
> against the **test keys already in place**; **live keys go in last** (Phase 7), so go-live is a config
> change, not a code change. **Next free migration = 407.** **NEXT = Phase 5** (lifecycle: billing portal,
> bulk price change, Stripe refunds). Re-confirm the next mig off `main` before any SQL.
>
> ✅ **Phase 4 runtime walk DONE (s185):** the live test-mode `checkout.session.completed` verified
> (200/Recovered) and created membership `442877d5` with `stripe_schedule_id`, `phase_end_at=2027-06-30`,
> `billing_starts_at=2026-09-01` (Stripe sub `status:trialing`, anchor=1 Sept → future anchor fires). The
> **auto-stop** was proven via the Stripe CLI test-clock (sub→schedule `end_behavior:cancel`+`end_date`,
> advanced past end → `subscription.status=canceled`, `schedule.status=completed`, clock deleted clean).
> Getting there exposed + fixed **two 100%-outage webhook bugs** (see `GO_LIVE_ISSUES.md` #19): (1) raw-body
> lazy-`req.body`-getter drain on bare `@vercel/node` → empty body → `bad_signature` (fix `6f4ac8b`: read
> the stream, never touch `req.body`; Next.js `bodyParser:false` is ignored by `@vercel/node`); (2)
> `STRIPE_WEBHOOK_SECRET` mismatch (Vercel `whsec_hT…` vs destination `whsec_zP…` — re-copied + redeployed).
> ⚠️ **GO-LIVE TRAP:** the LIVE Connect destination has its OWN `whsec_…` — re-copy it once at Phase 7 or
> this exact failure returns day one. (The webhook is ONE platform-level Connect endpoint; clubs connect
> their own Stripe via Express but never touch the webhook/secret.)
>
> ⛔ **One carried walk still owed (fold into the next test-mode session):** the **Phase-3
> `invoice.paid` → ledger reconcile** walk. The Phase-4 season sub is trialing/£0 until Sept, so it never
> fired a paid invoice — this needs a real PAYING member (an open-ended monthly enrolment that charges
> now) to exercise `invoice.paid` → `stripe_record_invoice_payment`/`stripe_record_charge_payment`. Not a
> blocker for Phase 5.

---

## GOAL

Make In or Out a full payments platform a multi-age football club can run on:
recurring subs, season plans that end themselves, one-off bulk invoicing, pro-rating,
refunds, and a single coherent money view for the person paying — all on the venue's own
Stripe Connect account, with our platform fee clipped.

**The persona test ("Dave"):** one human who (a) pays his daughter's U12 subs as guardian,
(b) pays his own adult membership, and (c) drops in for one-off casual football — must save
his card **once**, see **everything he owes/paid in one place**, and never be double-charged
or chased for money already paid.

---

## WHAT ALREADY EXISTS (dormant — built migs 329–337, verify don't rebuild)

- `venue_integrations` table + Connect onboarding (`/api/stripe-connect.js`,
  `set_venue_connect_state`) — operator connects their bank.
- Per-member self-serve checkout (`/api/stripe-member-checkout.js`) — subscription for
  monthly/quarterly/annual, one-off payment for season.
- Webhook (`/api/stripe-webhook.js`) — checkout.session.completed, subscription lifecycle,
  invoice.paid/failed, account.updated; persist-then-process (`record_stripe_event`),
  04:00 reconciliation cron.
- `stripe_complete_member_enrolment`, `apply_membership_subscription_status`,
  `get_venue_signup_tiers` (stripe_connected flag), `venue_get_billing_status`.
- `_prorated_first_charge` (mig 393) — season first-charge pro-rating (joining fee +
  remaining season slice), Option A "round up in member's favour". Already in checkout.
- `get_my_payment_history` (mig 039) — **casual-only** payment history (token-scoped).
- `venue_charges` / `venue_payments` ledger; `run_membership_renewals` + reminder cron;
  #4 chase engine (paid/unpaid pills + auto-reminders, mig 398).

**The dormant switch is purely the absent live env vars.** Everything below is built/tested
in test mode; live keys flip it on.

---

## PHASE 1 — Foundations & safety  ✅ SHIPPED (mig 403, PR #69, session 181)

**Delivered:** renewal-cron guard (`run_membership_renewals` skips live `stripe_subscription_id`);
`stripe_customers` table + `get_or_link_stripe_customer` (one customer per payer+connected account,
reused in checkout); `stripe_record_invoice_payment` + `stripe_record_refund` (invoice.*/refund.* →
`venue_charges`/`venue_payments` ledger, idempotent; `venue_payments.method` += `'stripe'`);
reconciliation cron invoice drift-repair; `stripe_complete_member_enrolment` += `p_payer_profile_id`
(8→9 arg, old DROPped) now writing `venue_memberships.payer_profile_id`. All 5 RPCs service_role-only
(⚠️ Supabase default-grants anon+authenticated on NEW fns AND on DROP+recreate — explicitly REVOKED).
Gates: rpc-security PASS, EV 15/15 + leak 0, build PASS, hygiene clean, casual-regression N/A
(api/ + migration only). Phase 2 inputs now live: the payer→customer map and `payer_profile_id`.

<details><summary>Original Phase 1 spec (for reference)</summary>

### PHASE 1 — Foundations & safety (no new user features; makes Stripe-live safe)

**Why first:** the moment live keys go on, the current code double-bills and fragments
customers. Fix that before layering anything on.

**Build:**
- **mig 403** — `run_membership_renewals` Stripe-sub guard: skip any membership with a live
  `stripe_subscription_id` (Stripe re-bills those itself). ⚠️ Without this, monthly Stripe
  members get a phantom "unpaid" ledger charge → #4 chases money already paid.
- **One Stripe customer per human** (scope #3): enhance `/api/stripe-member-checkout.js` to
  look up / reuse a single Stripe customer keyed on the payer's auth identity (email/uid)
  on the connected account, instead of creating a fresh customer each checkout. Store the
  customer id against the human, not per-membership. New RPC `get_or_link_stripe_customer`
  (or extend enrolment) to persist the mapping.
- **Webhook + reconciliation coverage** (scope #15): extend `/api/stripe-webhook.js` +
  reconciliation cron to handle `invoice.*` (incl. Invoicing product) and `refund.*` /
  `charge.refunded` events. Confirm every event we now emit is reconciled.

**Use cases:** no member double-billed when Stripe goes live; Dave's three relationships
share one Stripe customer + one saved card; no payment ever silently lost.

**Gates:** rpc-security-sweep (mig 403), ephemeral-verify (renewal guard + customer-reuse),
build + hygiene, casual-regression (checkout touches `api/`, not `src/` — confirm).

</details>

---

## PHASE 2 — Unified money view for the member (scope #4, #5)  ✅ SHIPPED (mig 404, PR #71, session 182)

**Delivered:** `get_my_money()` — one authenticated READ resolver aggregating the signed-in human's
whole money picture across streams: casual match fees (`get_my_payment_history` folded in UNCHANGED,
whole-pounds, **separate array**), own memberships, and memberships paid as guardian (own ∪
`payer_profile_id` ∪ `member_guardians`, deduped, non-cancelled). Membership charges matched from
`venue_charges` via `split_part(source_id,':',1)`; `paid_pence` from non-voided `venue_payments`.
**Pence (membership) vs whole-pounds (casual) kept in separate arrays — never summed.** Identity
model mirrors `get_my_world` (person spine). SECDEF STABLE, search_path pinned, single overload,
anon REVOKED + authenticated grant (mig-175 gotcha), **read-only → no audit**. UI = additive "My
money" section in `MemberProfile.jsx`; casual surfaces byte-unchanged. Gates: rpc-security PASS, EV
8/8 + leak 0, build + hygiene 7/7, casual-regression PASS (additive +20/-0), Playwright authed walk
PASS (guardian demo user → child membership renders, who_for tagged). ⛔ real-iPhone PWA walk owed
(none of Hard Rule #13's enumerated files touched). **DECISION: season one-off (mode=payment) Stripe
payments deferred to Phase 3** (Phase 1 recorded `invoice.*` only); `get_my_money` is complete for
everything Phase 1 records.

<details><summary>Original Phase 2 spec (for reference)</summary>

### PHASE 2 — Unified money view for the member (scope #4, #5)

**Build:**
- **mig 404** — `get_my_money` (or extend): one authenticated RPC aggregating the signed-in
  human's full picture across streams — casual fees (fold in `get_my_payment_history`), his
  own memberships, and memberships he pays for as guardian (his children). Returns paid
  history + upcoming/owed, each tagged by stream + who-it's-for.
- **UI** (`apps/inorout/src`): a "Payments" / "My money" view — one screen: "Daughter's subs,
  my membership, last Sunday's match fee" with paid & upcoming. Casual logic untouched;
  just surfaced alongside.

**Use cases:** Dave opens one place and sees everything he's paid and everything coming up,
across all three hats.

**Gates:** rpc-security-sweep, ephemeral-verify, build + hygiene, **casual-regression
(touches `apps/inorout/src`)**, Playwright authed walk, ⛔ **real-iPhone PWA walk** (Hard #13).

</details>

---

## PHASE 3 — Mass invoicing (the headline operator action: scope #6, #7, #8, #18)  ✅ SHIPPED (mig 405, s183)

**Delivered:** `venue_billing_runs` table + `venue_charges.billing_run_id`. The billable entity is a
MEMBERSHIP — cohorts (tier/club/team) resolve to active `venue_memberships`; a bulk charge is one
`venue_charges` row per included member, `source_type='membership'`, `source_id='<membership_id>:run:<run_id>'`,
so it surfaces in `get_my_money` verbatim (no Phase-2 rework). RPCs: `venue_bulk_charge_preview` (READ,
gated, will-invoice/auto-skip paused|left|already-billed + per-member pro-rated amount via `_prorated_first_charge`),
`venue_bulk_charge_commit` (WRITE, one charge per included active membership, idempotent per run, writes the run
record; cash payers excluded via `excluded_ids`), `venue_void_billing_run` (WRITE, run→voided + charges→refunded,
payments intact), `venue_list_billing_runs` (READ), `stripe_record_charge_payment` (service_role webhook-only —
reconciles a ONE-OFF Stripe Invoice via `metadata.iorout_charge_id`; the Phase-1 `stripe_record_invoice_payment`
is subscription-keyed and can't match a one-off). `get_my_money`+`venue_get_charges` rebuilt to surface the run
label. API `/api/stripe-bulk-invoices.js` (one finalized Stripe Invoice per pay-online charge on the connected
account, reuses `get_or_link_stripe_customer`, idempotency_key per run+charge) + `invoice.paid` one-off webhook
branch. UI: apps/venue PaymentsView 4-step wizard + billing-run list w/ Void-run. **DECISION (operator-confirmed):**
mass invoicing bills membership-holders only; non-member billing is a clean later add (nullable
`venue_charges.payer_profile_id` + a `get_my_money` UNION + `cohort_type='ad_hoc'` — `cohort_type` left OPEN TEXT
for it). Gates: EV 8/8 + leak 0, rpc-security PASS, build inorout+venue + hygiene 7/7 PASS, casual-regression N/A
(no `apps/inorout/src`). ⛔ OWED before merge: Playwright wizard smoke + Stripe test-mode invoice→paid→reconciled
walk. NOTE: the Phase-2-deferred season one-off (mode=payment) Stripe payments now reconcile via this same
one-off-invoice path once those checkouts attach `metadata.iorout_charge_id` (Phase 4 follow-up).

<details><summary>Original Phase 3 spec (for reference)</summary>

**Build:**
- **mig 405** — bulk one-off charge engine:
  - `venue_bulk_charge_preview(token, cohort, amount, due_date, ...)` → returns every
    member with status (will-invoice / auto-skip + reason: already-paid|paused|left).
  - `venue_bulk_charge_commit(token, run spec, excluded_ids[])` → creates one `venue_charges`
    row per included member; idempotent per run key; writes a **billing_run** record.
  - `venue_void_billing_run(token, run_id)` → soft-void the whole run (mirrors `venue_payments`
    void pattern).
  - New table `venue_billing_runs` (who/what/when/totals/status) + run_id on charges.
  - Pro-rated mass invoicing (#18): reuse `_prorated_first_charge` for late joiners in a
    season-fee run.
- **Stripe Invoices for online-payable charges** (#7): when "let them pay online" is on,
  `venue_bulk_charge_commit` (or a follow-on `/api/stripe-create-invoices.js`) creates a
  Stripe **Invoice** per member on the connected account (using the Phase-1 reused customer),
  finalizes it, Stripe emails the hosted pay page; `invoice.paid` webhook → marks the ledger
  charge paid. Use Stripe `idempotency_key` per (run, member).
- **UI** (`apps/venue` Payments + consumer coach "Subs & payments" roster): 4-step wizard —
  (1) cohort (team / tier / whole club, live count), (2) charge (label, amount, due date,
  pay-online toggle), (3) **interactive preview** — tick/untick individuals, auto-skips
  locked with reason, running total recomputes, (4) type-to-confirm total → Send. Plus a
  billing-run list with Void-run.

**Use cases:** "Bill the U12 squad £15 tournament fee, skip the two who paid cash" →
parents tap a pay link → ledger goes green on its own. "Sent wrong amount" → void run.

**Gates:** rpc-security-sweep (3 new write RPCs), **ephemeral-verify** (own `_e2e_` cohort,
preview→commit→void→leak-check 0), build + hygiene (venue app = hand-check hex),
casual-regression if consumer roster touches `src`, Playwright wizard smoke + Stripe test-mode
invoice paid→reconciled.

</details>

---

## PHASE 4 — Fixed-term & dated billing (scope #9, #10, #19)  🏁 BUILT (mig 406, s184) — PR open

**Delivered:** `venue_memberships` += `stripe_schedule_id`/`phase_end_at`/`billing_starts_at` (additive
nullable). A tier with `pricing_model='season'` on a recurring cadence now becomes a "season schedule":
checkout creates the sub, the webhook converts it to a Stripe **Subscription Schedule** (`from_subscription`
→ phase `end_date` = season end, `end_behavior:'cancel'`) so it auto-stops over summer; `stripe_schedule_id`
persisted via `stripe_set_membership_schedule`. **Future anchoring (#10):** early joiners get
`subscription_data.trial_end = season_start` (pay nothing until then). **Mid-cycle (#19) — operator
decision:** late joiners pay only the remaining season (Option 1) as **equal instalments** computed by
`_season_instalment_plan` (remaining-season total from `_prorated_first_charge`, divided, rounded DOWN —
member's favour); the Stripe recurring price IS that instalment, so **no Stripe proration is used** and the
member sees one number matching the ledger. **Season one-off fold-in:** `mode=payment` emits no invoice, so
the webhook calls `stripe_record_season_payment` (payment_intent ref) to land it in the ledger →
`get_my_money`. `run_membership_renewals` guard extended to skip schedule-backed / future-anchored subs.
Open-ended monthly + season one-off paths **byte-identical** until a tier opts in. Gates: EV 7-groups + leak
0, rpc-security PASS, build + hygiene clean, casual-regression N/A. ⛔ owed: Stripe test-clock walk +
Phase-3 invoice→paid walk (need test keys).

<details><summary>Original Phase 4 spec (for reference)</summary>

**Build:**
- **mig 406** — store schedule/anchor metadata on `venue_memberships`
  (`stripe_schedule_id`, phase end, `billing_starts_at`); cron must leave scheduled subs alone.
- **Subscription Schedules** (#9): for season-length recurring plans, `/api/stripe-member-checkout.js`
  creates a Stripe Subscription Schedule (phases Sept→June, `end_behavior: cancel`) instead of
  an open-ended sub.
- **Future start-date anchoring** (#10): `billing_cycle_anchor` / `trial_end` so billing
  begins on the season start date, not signup day.
- **Mid-cycle proration on recurring subs** (#19): set `proration_behavior` so a mid-month
  joiner's first charge is the part-period (Stripe-side; must agree with mig-393 Option A
  convention — round in member's favour).

**Use cases:** U12s pay monthly Sept→June then auto-stop (no summer billing); sign up in July,
first charge 1 Sept; join mid-month → pay the part-month.

**Gates:** rpc-security-sweep (mig 406), ephemeral-verify (schedule metadata + cron-leaves-
alone), build + hygiene, casual-regression (api only — confirm), Stripe test-mode schedule
walk (advance test clock to prove auto-stop).

</details>

---

## PHASE 5 — Lifecycle management (scope #11, #12, #13, #20, #21)

**Build:**
- **Stripe Billing Portal** (#11, hosted/light): `/api/stripe-billing-portal.js` → returns a
  portal session URL for the signed-in member (their reused customer) to update card / cancel /
  pause. Webhook already handles the resulting subscription.updated/deleted.
- **mig 407** — bulk price change (#12, +pro-rated #20): `venue_bulk_price_change(token,
  cohort, new_price, effective_date)` — for Stripe-sub members, push the new price to their
  Stripe subscription with proration; for non-Stripe members, update the ledger amount.
- **Refunds via Stripe** (#13, +pro-rated #21): `venue_refund_charge(token, charge_id,
  amount|full)` → Stripe refund on a Stripe-collected charge (today only manual void exists);
  pro-rated "unused portion" refund reuses the mig-393 maths; reconcile back to the ledger.

**Use cases:** Dave manages his own card/cancel without the coach; "subs up £2 Sept" applied
to every junior (Stripe + cash); member quits mid-term → refund the unused months.

**Gates:** rpc-security-sweep (migs 407 + refund RPC), **ephemeral-verify** (price-change +
refund against own fixture, no live rows touched), build + hygiene, casual-regression,
Stripe test-mode refund + price-change walk, ⛔ real-iPhone walk for the portal entry point.

> **STATUS (s186):** 🏁 **PHASE 5 BUILT + TEST-MODE WALK PASSED** (mig 407, PR #76). Four new fns
> (no schema change), three new DORMANT APIs (`stripe-billing-portal` / `stripe-refund` /
> `stripe-price-change`), venue PaymentsView (Change-price wizard + Refund modal) + inorout
> MemberProfile (Manage card/cancel). **Operator decision "Option A":** a mid-cycle price change
> applies at the NEXT renewal (no mid-cycle proration); season-schedule members excluded from the
> push. Refunds only INITIATE — the existing `charge.refunded → stripe_record_refund` reconciles.
> Gates: EV 5-grp+leak0, rpc-security PASS, build+hygiene 7/7, casual-regression PASS. **TEST-MODE
> WALK PASSED:** price change proven via a Stripe test clock (new £17 price bills at next renewal,
> NO mid-cycle invoice; first invoice stayed £15; clock deleted clean), refund proven with a REAL
> test charge+refund (`ch_…`/`re_…`) reconciled through `stripe_record_refund` (status→partial,
> idempotent, leak0). ⛔ STILL OWED (narrow): the carried Phase-3 `invoice.paid` reconcile on a
> REAL PAYING member through the DEPLOYED webhook on a CONNECTED account; real-iPhone portal walk.

---

## PHASE 6 — Collection, chasing & reporting (scope #16, #6.2, #6.3)

**Build:**
- **Pay-now links in chase reminders** (#16): the #4 reminder email/pill carries the Stripe
  hosted-invoice / portal pay link for online-enabled charges.
- **Notification de-storm** (#6.2): a bulk run + the reminder cron dedupe via `notification_log`
  so a member isn't double-emailed; throttle a large blast.
- **Operator reconciliation view** (#6.3): per-run + per-period raised/paid/overdue, collection
  rate, Stripe-vs-manual split (extend `venue_get_billing_status` / PaymentsView).

**Use cases:** overdue reminder has a Pay-now button; invoice 200 people without 200 double-
emails; "how much of this season's subs are actually in, and who's outstanding?"

**Gates:** rpc-security-sweep (any RPC change), build + hygiene, casual-regression, Playwright
smoke, dedupe proven against the reminder cron.

---

## PHASE 7 — Go-live (scope #1, #1.1, #1.2, #1.3) — LAST

**Build / actions (config + verification only, no new features):**
- **Live keys** (#1.1): operator sets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Connect
  return/refresh URLs; register the live webhook endpoint in the Stripe dashboard.
- **Connect onboarding verify** (#1.2): operator completes Express onboarding for real; status
  pill shows connected/restricted; surfaced in venue Payments.
- **Real-device payment walk** (#1.3): a parent genuinely pays on a real iPhone PWA install,
  end-to-end (Hard Rule #13) — across all of Dave's three streams.

**Gate:** nothing in Phases 1–6 may assume live keys; this phase is the single switch.

---

## SCOPE COVERAGE MAP (all 21 items placed)

| # | Item | Phase |
|---|------|-------|
| 1 / 1.1 / 1.2 / 1.3 | Live keys, Connect onboarding, real-device walk | 7 |
| 2 | Per-member checkout (enhance) | 1 |
| 3 | One Stripe customer per human | 1 |
| 4 | Unified member payment history | 2 |
| 5 | Casual history (fold in, no change) | 2 |
| 6 | Mass invoicing wizard + remove individuals | 3 |
| 7 | Stripe Invoices for online one-offs | 3 |
| 8 | Billing-run record + void | 3 |
| 9 | Subscription Schedules (fixed-term seasons) | 4 |
| 10 | Future start-date anchoring | 4 |
| 11 | Stripe Billing Portal (self-service) | 5 |
| 12 | Bulk price change → push to Stripe | 5 |
| 13 | Refunds via Stripe | 5 |
| 14 | Renewal cron double-bill guard | 1 |
| 15 | Webhook + reconciliation coverage | 1 |
| 16 | Pay-now links in #4 chase engine | 6 |
| 17 | Season first-charge pro-rating (no change) | — (live) |
| 18 | Pro-rated mass invoicing | 3 |
| 19 | Mid-cycle proration on recurring subs | 4 |
| 20 | Pro-rated price change | 5 |
| 21 | Pro-rated refund on leaving | 5 |

---

## CROSS-CUTTING (every phase)

- **Idempotency:** ledger `ON CONFLICT (source_type, source_id)`; unique billing-run keys;
  Stripe `idempotency_key` on every API write.
- **Audit:** every write RPC INSERTs `audit_events` (Hard Rule #9).
- **Guardian routing:** a child's charge/invoice routes to the guardian's customer + email.
- **Permissions:** bulk invoicing / price change / refund gated on `manage_memberships`
  (venue token = anon backdoor, auth enforced inside — grant anon, per venue_* RPC gotcha).
- **Pro-rating convention:** one engine, two surfaces — `_prorated_first_charge` for our
  ledger, Stripe `proration_behavior` for live subs; both honour mig-393 Option A
  (round up, member's favour) so a member never sees two different numbers.
- **Migration source in same commit as live apply** (Hard #11). Confirm next free mig off
  `main` each phase. Update SCHEMA/RPCS/DECISIONS/FEATURES/BUGS per phase.

---

## NEXT-SESSION KICKOFF PROMPT (paste-ready) — PHASE 6

```
Read STRIPE_FULL_BUILD_HANDOFF.md in full (Phases 1–5 are SHIPPED+MERGED — P1 mig 403 PR #69, P2 mig 404
PR #71, P3 mig 405 PR #73, P4 mig 406 PR #75, P5 mig 407 PR #76; P4 runtime walk PASSED s185, P5
test-mode walk PASSED s186 — read the STATUS blocks + the Phase 6 section), then RPCS.md + SCHEMA.md
(venue_charges + venue_payments ledger; venue_billing_runs mig 405; venue_memberships money columns;
notification_log shape), BUGS.md head + GO_LIVE_ISSUES.md #19 (webhook raw-body + secret outage — don't
re-trip it). Also read: the #4 chase engine (mig 398 — paid/unpaid pills + auto-reminders + the reminder
cron), api/stripe-webhook.js, api/stripe-bulk-invoices.js (how a pay-online run is invoiced), the
existing venue_get_charges / venue_get_billing_status readers, and apps/venue PaymentsView. We build the
full Stripe payments platform phase-by-phase, one phase shipped + merged before the next (cloud-session
discipline). Built/tested on the TEST keys in place; LIVE keys are Phase 7 only — NO code path may
assume live keys.

CONFIRM next free mig off origin/main (should be 408; local main may be stale — check origin/main).
Then run a full AUDIT -> VERIFY (review) -> EXECUTE -> VERIFY -> COMMIT cycle (skills/audit.md FIRST,
report findings before editing anything). AUDIT the #4 reminder cron + notification_log + how a charge
knows its pay link (Stripe hosted-invoice URL vs the venue payment_link vs the new billing-portal)
BEFORE designing — Phase 6 is collection/reporting on top of the charges Phases 1–5 already create, not
a new money path.

PHASE 6 — Collection, chasing & reporting (scope #16, #6.2, #6.3):
- Pay-now links in chase reminders (#16): the #4 reminder email/pill carries the Stripe hosted-invoice /
  Billing-Portal pay link for online-enabled charges (cash-only charges keep the manual nudge). Decide
  where the link comes from per charge: a bulk pay-online run already has a Stripe Invoice (hosted URL);
  a recurring sub member uses the Billing Portal; a cash charge has none.
- Notification de-storm (#6.2): a bulk run + the reminder cron must dedupe via notification_log so a
  member isn't double-emailed, and a large blast is throttled. Prove the dedupe against the reminder
  cron (two runs in a window → one send).
- Operator reconciliation view (#6.3): per-run + per-period raised/paid/overdue, collection rate,
  Stripe-vs-manual split (venue_payments.method='stripe' vs cash/card) — extend venue_get_billing_status
  / venue_list_billing_runs + PaymentsView. Read-only (no audit).

GATES: rpc-security-sweep (any RPC added/changed — single overload, search_path pinned, venue_* grant
anon+auth per the gotcha, reads no-audit / writes audited Hard Rule #9); ephemeral-verify (any new write
RPC against your OWN _e2e_ fixture, never touch demo/prod rows, leak-check 0); build + hygiene (apps/venue
hex hand-check if touched); casual-regression ONLY IF apps/inorout/src is touched; Playwright PaymentsView
smoke. If a pay-link path is added, a Stripe TEST-MODE check that the hosted-invoice/portal URL resolves
(reuse the s186 CLI sandbox). ⛔ STILL OWED from earlier phases — fold in if you set up the webhook+CLI:
the carried Phase-3 invoice.paid -> ledger reconcile on a REAL PAYING member through the DEPLOYED webhook
on a CONNECTED account (needs a connected-account test checkout); the real-iPhone walk of the Phase-5
member "Manage card / cancel" button. Update RPCS/SCHEMA/DECISIONS/BUGS/FEATURES in the same commit; then
PR -> merge to main before Phase 7.

GO-LIVE REMINDER (do NOT action now, just don't break it): the webhook is ONE platform-level Connect
endpoint; its whsec is set once in Vercel. The LIVE destination will have its OWN whsec to copy at Phase
7 (GO_LIVE #19) or it's a 100% day-one outage. Clubs/venues connect their own Stripe via Express but
never touch the webhook.

NOTE: Phase 6 is mostly readers + the reminder cron + venue UI. Design additively so today's members are
byte-identical until an operator sends a reminder or opens the reconciliation view; no member is ever
double-emailed.
```
