# Venue Payments Ledger — Scope (planned, NOT built)

*Scoped session 60 (2026-05-29). Cash/manual now; online staged (hosted link → Stripe Connect).
Separate from Phase 8 SaaS billing (venue/company → In-or-Out). This is money OWED TO the venue
for pitch hire + league/cup fixtures.*

---

## SUMMARY

Venue-side tracking of money **owed** and **collected** for:
- **Pitch bookings** — one payer (the hirer).
- **League + cup fixtures** — per team (cup fixtures are `fixtures` rows → covered free once Phase 11 lands).

Unified ledger built for reporting (collection rate, outstanding, revenue, aging — sliceable by
venue / team / competition / period). Cash + manual transfer at first; automated online later.

## SETTLED DECISIONS (operator, session 60)

1. **Unified ledger, not per-surface tables** — best for reporting (no UNIONs; one HQ rollup).
2. **Instalment log** — each payment is its own row (full cash history: who took what, when).
3. **Amount due = default fee + per-charge override** — defaults on `league_config` (fixtures) +
   `playing_areas` (pitch slots); admin can override per charge.
4. **Fixture payer = `league_config.fixture_fee_payer` (`both`|`home`, default `both`) + per-fixture
   toggle** — auto-creation reads the league default; the Payments UI adds/voids a team's charge
   per fixture (operational toggle, no extra fixture column).
5. **Cancellation ≠ payment status** — cancellation stays on `pitch_bookings.status` / fixture
   status; `payment_status` is purely money (unpaid/partial/paid/refunded).
6. **Backfill: forward-only in production** (don't apply new fees to pre-fee rows) **+ seed charges
   for demo data** in V1 so the UI/reports are testable. (No real data exists yet.)
7. **Online payments share the ledger** — an online/transfer payment is just a `venue_payments`
   row with a non-cash `method`; only capture differs (admin marks vs processor webhook).
8. **Online staged**: hosted `venues.payment_link` (interim) → Stripe Connect + Apple/Google Pay
   (full rails, V5). Apple/Google Pay are NOT a toggle — they need a processor + Apple-Pay domain
   verification; "directly to the venue" needs Stripe Connect (per-venue connected account + KYC).

## DATA MODEL

| Table / column | Fields |
|---|---|
| `venue_charges` | `id`, `venue_id` (denormalized for rollup), `source_type` (`booking`\|`fixture`), `source_id`, `team_id` (NULL for booking), `competition_id` (NULL for booking → slices league/cup), `amount_due_pence`, `status` (unpaid/partial/paid/refunded), `due_date`, `created_at`. UNIQUE(`source_type`,`source_id`,`team_id`) |
| `venue_payments` (instalment log) | `id`, `charge_id`→venue_charges, `kind` (payment\|refund), `amount_pence`, `method` (`cash`\|`bank_transfer`\|`card`\|`other`), `external_ref` (nullable, UNIQUE — processor/transfer ref + webhook idempotency), `note`, `taken_by`, `taken_at`, `voided_at` |
| `league_config.fixture_fee_pence` | default per-team fixture fee |
| `league_config.fixture_fee_payer` | `both`\|`home` (default `both`) |
| `playing_areas.default_fee_pence` | default pitch-slot fee |
| `venues.payment_link` | hosted pay URL (interim online option) |

`status` + balance derived from non-voided `venue_payments` vs `amount_due_pence`.

## RPCs (SECDEF · `resolve_venue_caller` · audited · `notify_venue_change`)

- `venue_record_payment(venue_token, charge_id, amount_pence, method, external_ref?, note?)` — append instalment, recompute status. (write → ephemeral-verify)
- `venue_void_payment(venue_token, payment_id)` — soft-void a mistaken instalment.
- `venue_set_charge_due(venue_token, charge_id, amount_pence)` — override auto-filled due.
- `venue_get_charges(venue_token, filters)` — list/report (read).
- Charge **auto-creation** hooked into existing RPCs:
  - `venue_confirm_booking` → booking charge (amount from `playing_areas.default_fee_pence`).
  - `venue_generate_fixtures` → per-team charges per `fixture_fee_payer` (amount from `league_config.fixture_fee_pence`).
  - `venue_update_fixture_status` (void/cancel/postpone) → void/adjust the charge.

## CYCLES

| Cycle | Scope | Write RPC? |
|---|---|---|
| **V1 ✅ SHIPPED** (mig 180, session 63) | schema (2 tables + `method`/`external_ref` + 3 fee columns + `venues.payment_link`) + demo charge seed | no |
| **V2 ✅ SHIPPED** (mig 181, session 63) | charge auto-creation hooks + payment RPCs (cash + manual bank_transfer share `venue_record_payment`) | yes → ephemeral-verify |
| **V3 ✅ SHIPPED** (session 63) | apps/venue **Payments** screen (record cash/transfer, balances, collection rate) on the 4 V2 RPCs. Per-fixture add/void + `payment_link` show/edit deferred to **V3.1** (need new write RPCs + `venue_get_state` to expose `payment_link`). | no |
| **V4 ✅ SHIPPED** (mig 182, session 64) | HQ revenue / collection-rate / outstanding into the analytics registry (new `revenue` card: company chips + per-venue table) **+ revenue fed into the Health Score** (4th axis = collection-rate %, weight 0.30, additive — drops when a venue has no charges). Also wired the mig-179 health_score/reason into VenueHealthGrid (was never actually shipped). | no (all read/immutable) |
| **V5** | **online capture (full rails)** — Stripe Connect per-venue connected account, in-app Payment Element, webhook → `venue_payments` row (method `card`, `external_ref` = PaymentIntent), Apple/Google Pay via wallet enablement + Apple-Pay domain verification | yes (webhook) |

## V5 DEPENDENCIES (when building the automated online rail)

- Stripe (platform) account + **Connect** enabled; per-venue **KYC onboarding** (store `venues.stripe_connect_account_id` — distinct from the existing `stripe_customer_id`, which is the venue paying *us*).
- **Apple Pay domain verification** (hosted file + register domain with Stripe) for the wallet to appear.
- Webhook endpoint (e.g. `apps/inorout/api/venue-payment-webhook.js`) writing the ledger idempotently via `external_ref`.
- Interim before V5: the hosted `venues.payment_link` (ships in V1/V3) covers "pay online" without any of the above — wallets appear only if the link's provider supports them (a Stripe Payment Link does).

## NOTES

- Player match-subs (`payment_ledger`, player → team admin) are a SEPARATE, existing flow — NOT
  venue money. The PlayerView "Transfer" button is a disabled placeholder in that flow, unrelated.
- Cup-side (`team_id` fixture charges) works automatically once Phase 11 builds cups (cup fixtures
  are already `fixtures` rows).
