# Per-Game Payment Marking — Epic Manifest

*Scoped 2026-07-01 via `/scope`. Audit + plan only — no code yet.*
*Runs as an epic loop: `/loop /dev-loop PER_GAME_PAYMENT_MARKING_HANDOFF.md`.*
*Each `### PR #n` = one dev-loop cycle → one PR.*

**MIGRATION-APPLY: PRE-AUTHORISED by the operator (2026-07-01).** For THIS epic only, the
loop may apply a migration once it is fully proven (ephemeral-verify PASS + rpc-security
PASS + both fresh-context reviews clean) **without stopping for sign-off**. The ONLY human
stop is the **merge tap** (merge = live prod deploy). The proof gates are NOT waived —
only the human pause before `apply_migration` is. PR-only; never pushes main; never
auto-merges.

**⚠️ Apply-order caveat (mig 460 is NOT dark).** mig 459 + `claim_ledger_payment` +
`set_player_paid`'s extra stamp are dark on apply (nothing reads them until the UI ships).
But **mig 460 changes `admin_confirm_payment`'s behaviour the instant it's applied** — the
live admin's existing "confirm" button starts settling per-week instead of zeroing the
whole balance, before any screen merges. For a one-unpaid-week player it's identical; for
a multi-week debtor it's the (more correct) per-week result. Treat applying mig 460 as a
live behaviour change on the real paying team — its ephemeral-verify (multi-week +
reconciliation invariant) must be watertight before it goes on.

**Plan gate: batched** · **Merge mode: per-phase**

---

## WHAT IT IS (plain English)

Let a casual player mark **an individual game's fee** as paid — not just "I've paid" in
the vague, whole-balance way it works today. Two places:

- **Payment History** (My View › Profile › Payment History): every past week is a row.
  Tap an **unpaid** week → *"Tap to mark as paid"* → it becomes a **claim** awaiting the
  admin's confirmation. Cancelled / waived / already-paid weeks aren't tappable.
- **My View** payment panel: reworked so it's about the **game you just played / what
  you owe**, not "this week's live game". People pay cash at the pitch and only mark it
  the next morning — by which point the live game has moved on. The primary button
  targets the **most recent unpaid game** (e.g. "I've paid · £5"); if they owe more from
  earlier weeks, a small line — *"You owe £10 more from earlier — see Payment History"* —
  jumps them to the history screen to settle those one by one.

A player tap is always a **claim** ("I say I've paid"), never a settled payment. The
**admin confirms** it (existing PaymentsScreen), and confirming a week clears **only that
week's money** off what the player owes — not their whole balance.

**The core scenario this nails:** player owes £15 (3 unpaid weeks incl. last night),
pays £5 cash for last night at the pitch, marks just last night's game → admin confirms →
they now owe £10. The other two weeks stay outstanding.

---

## LOCKED DECISIONS (confirm at the plan gate)

1. **A claim is a per-row marker on the immutable `payment_ledger` row**, via two new
   additive columns `claimed_at` / `claimed_by` — **not** a new `status` value (avoids a
   CHECK-constraint change) and **not** audit-events-only (the UI must render the claimed
   state). Status stays `'unpaid'` until the admin confirms → `'paid'`. Bonus: because the
   claim lives on the ledger row (not the transient `players.self_paid` flag), it
   **survives the weekly go-live rollover** — which resets `self_paid` but not ledger rows.
2. **`players.owes` becomes a value RECOMPUTED from the ledger, not an arithmetic
   accumulator.** A helper `_recompute_player_owes(player, team)` sets
   `owes = SUM(amount) WHERE type='game_fee' AND status='unpaid'`, called at the end of
   every settlement RPC. This is the single most important decision — it makes owes
   self-healing and eliminates the drift / double-subtract / negative-owes hazards that
   an `owes = owes - amount` subtraction would introduce. Replaces today's `owes = 0`
   zero-the-lot confirm.
3. **My View primary action targets the MOST RECENT unpaid game**, not the whole balance.
   Older backlog debt is surfaced as a link to Payment History, where per-week settling
   lives. Kills the confusing "pay this week vs clear debt" split.
4. **The player tap is always a CLAIM**; the admin's confirm is the money event. Same
   two-model semantics mig 211 established, now per-week.
5. **Admin can REJECT a false claim** — new `admin_reject_claim` clears `claimed_at`/
   `claimed_by`, leaves status `'unpaid'` and owes untouched (the debt persists). This
   gap exists today (`admin_reset_payment` only undoes a *confirmed* payment).
6. **Guests are OUT OF SCOPE.** `guest_fee` rows are excluded from the claim path
   (`type = 'game_fee'` guard); guests keep the existing `set_guest_payment` model (no
   admin-confirm path).
7. **Consistent wording across all three surfaces:** `UNPAID` / `CLAIMED` (amber,
   awaiting confirmation) / `PAID` (green) / `CANCELLED` / `WAIVED`.
8. **Only `game_fee` + `status='unpaid'` rows are claimable.** paid / waived / cancelled /
   disputed / refunded / non-game-fee rows are never tappable/claimable (server-guarded).

---

## KEY AUDIT FACTS (load-bearing — don't re-derive)

- **Next free migration = 459** (highest applied = 458, orphan-guest Keep-IN). PR #1 =
  mig 459, PR #2 = mig 460. First-come-on-main caveat applies (CLAUDE.md cloud-session
  discipline) — verify free before applying.
- **`payment_ledger`** (SCHEMA.md L360): `id uuid PK, team_id, player_id, match_id
  (nullable — NULL pre-lineup-lock), amount int, type CHECK(game_fee/guest_fee/
  debt_payment/waiver/refund/cancelled), status CHECK(paid/unpaid/waived/disputed/
  refunded/cancelled), method, paid_by CHECK(self/host/admin/stripe), paid_at, note,
  created_at, updated_at`. **Partial unique indexes** on (player_id, team_id, type,
  match_id) — one WHERE match_id IS NOT NULL, one WHERE match_id IS NULL. **PostgREST
  `.upsert()` cannot target partial unique indexes — use INSERT + catch 23505.**
- **`set_player_paid(p_token)` [mig 211]** — current-week whole-player claim: sets
  `players.self_paid=true, paid_by='self'`; does NOT touch owes or the ledger (only
  *reads* the current match's ledger_id). Broadcasts `notify_team_change(team,
  'player_paid_updated')`. Inserts audit `player_paid_self_declared`. Anon+authenticated.
- **`admin_confirm_payment(p_admin_token, p_player_id, p_match_id)` [mig 211]** — sets
  `players.paid=true, paid_by, paid_at, owes=0`; ledger row → `status='paid'`. Uses
  `resolve_admin_caller` for server-side team scoping. Audit `player_paid_confirmed`,
  broadcast `payment_confirmed`.
- **`admin_reset_payment` [mig 211]** — restores owes by the ledger row's amount ONLY if
  the payment was CONFIRMED (`v_was_paid=true`); undoing a mere claim leaves owes alone.
- **`get_my_payment_history(p_token, p_limit)` [mig 039]** — reads the ledger, mapped via
  `dbToLedger`. SECURITY DEFINER, anon+authenticated. Must add `claimed_at`/`claimed_by`
  to its returned object + the `dbToLedger` mapper (Hard Rule 12 — same commit).
- **`owes` is incremented `owes = owes + price` at result-save** (migs 205/206/241/268/
  347) per unpaid attendee, and reset weekly-independent (mig 243 resets flags, NOT owes).
  Switching owes to a ledger-recompute must reconcile with this: **result-save must
  create a `game_fee` unpaid ledger row per attendee** so `SUM(unpaid game_fee) == owes`.
  Verify this holds before shipping PR #2 (mig 211's one-off reconciliation already
  assumed Σowes == unpaid ledger — this makes it continuous).
- **UI surfaces:** `PaymentHistoryBody` in [PlayerProfile.jsx:149](apps/inorout/src/views/PlayerProfile.jsx#L149)
  (rows display-only today); payment panel in [PlayerView.jsx:950-1070](apps/inorout/src/views/PlayerView.jsx)
  (states: unpaid→"Paid"→"Confirm — You've Paid?"→"Awaiting confirmation"→"✓ Paid", plus
  a 'debt' path); admin per-row ledger + Reset in
  [PaymentsScreen.jsx:288-331](apps/inorout/src/views/AdminView/PaymentsScreen.jsx#L288).
- **Realtime:** App.jsx subscribes to the team broadcast that `notify_team_change` fires →
  refreshes squad → every screen reading `players.owes` (incl. squad-wide Σowes, computed
  client-side) updates automatically. New broadcasts need a matching subscriber
  (Hard Rule 10) — reuse the existing reason-string channel, don't invent a new topic.
- **Consumers of `paid`/`self_paid`/`owes`/ledger.status to check (Hard Rules 7/12):**
  `packages/core/engine/payments.js` (`getPaymentState`), `PaymentsScreen.jsx`,
  `AdminView/index.jsx` (`totalOwed`), `dbToLedger`/`dbToPlayer` mappers,
  `gaffer_get_context_payment*` RPCs. Grep before changing any return shape.

---

## ROADMAP (PRs in dependency order)

### PR #1 — Ledger-claim plumbing (backend)
**✅ BUILT + PROVEN — awaiting merge. PR #198 · branch `feat/per-game-payment-claim-plumbing` · mig 459 APPLIED (dark). EV PASS (9 assertions) · rpc-security PASS · QA/Security/adversarial reviews clean · build+CI(platform-clubmanager) green. Merge = the one human stop.**
**Tier-3 · PROTECTED · Effort M · migration-apply PRE-AUTHORISED (proof-gated) · ephemeral-verify + rpc-security · 🚦 merge only**
- Mig 459: `ALTER TABLE payment_ledger ADD COLUMN claimed_at timestamptz NULL,
  ADD COLUMN claimed_by text NULL CHECK (claimed_by IN ('self','host','admin'))`; partial
  index on (team_id, player_id, claimed_at DESC) WHERE claimed_at IS NOT NULL. Additive,
  byte-identical to existing rows. Write `459_*.sql` + `_down.sql` (Hard Rule 11).
- New RPC `claim_ledger_payment(p_token text, p_ledger_id uuid)` — SECURITY DEFINER,
  `search_path='public','pg_temp'`, REVOKE from public, GRANT anon+authenticated. Guards:
  derive player_id+team_id from token; ledger row must belong to that player AND team AND
  be `type='game_fee'` AND `status='unpaid'` (this single guard also excludes waived/
  cancelled/paid/disputed/refunded rows, since those aren't status='unpaid') AND its
  match not cancelled (`NOT EXISTS (SELECT 1 FROM matches m WHERE m.id=l.match_id AND
  m.cancelled=true)`) — else raise. Never trust client team_id/player_id/amount.
  Idempotent: `claimed_at = COALESCE(claimed_at, now())`,
  `claimed_by = COALESCE(claimed_by,'self')`. Audit `payment_ledger_claimed`
  (actor_type='player', actor_identifier='player_token:'||md5(token), metadata
  ledger_id/match_id/amount) — Hard Rule 9. Broadcast via `notify_team_change` reusing an
  existing subscribed reason-string — Hard Rule 10.
- New RPC `admin_reject_claim(p_admin_token, p_player_id, p_ledger_id)` — clears
  `claimed_at`/`claimed_by` on the row, leaves `status='unpaid'` + owes untouched.
  `resolve_admin_caller` team scoping, audit `payment_claim_rejected`.
- Extend `set_player_paid` to ALSO stamp the current match's `game_fee` ledger row
  (`claimed_at`/`claimed_by='self'`, only WHERE status='unpaid' AND claimed_at IS NULL),
  in the same transaction. Does NOT change owes (claim stays pending — same as today).
- JS wrappers: `claimLedgerPayment(token, ledgerId)`, `adminRejectClaim(...)` in
  supabase.js + barrel export. Add `claimed_at`/`claimed_by` to `get_my_payment_history`
  return + `dbToLedger` (Hard Rule 12, same commit).
- Gates: ephemeral-verify (throwaway fixture: player claims → row shows claimed_at/by,
  status still unpaid, owes unchanged; admin rejects → cleared) · rpc-security-sweep ·
  casual-regression (existing payment flow unbroken by NULL claimed_at) · Hard-Rule
  advisories (check-audit-events, check-realtime-subscriber, check-mapper-sync,
  check-rpc-consumers).
- **Done-check:** new RPCs exist + granted correctly; a claim stamps the ledger row and
  is visible via `getMyPaymentHistory`; owes untouched by a claim; reject clears it;
  no existing row/flow regressed.

### PR #2 — Per-week settle via owes-recompute (backend, RISKIEST)
**✅ BUILT + APPLIED + RECONCILED LIVE — awaiting merge. PR #201 · branch `feat/per-game-payment-per-week-settle` · mig 460 APPLIED. Multi-week EV + multi-team EV PASS · rpc-security PASS · QA (caught+fixed a team-scope regression → cross-team) / Security / adversarial(cannot-refute) reviews clean. Reconciliation done: Rohan→£10 (operator call), rockybram→£5 (future charge voided), 0 drifted across all 88 records. ⚠️ NOT DARK — live admin confirm behaviour already changed. Merge = source-sync (Hard Rule 11) + the human stop.**
**Tier-3 · PROTECTED · Effort M · migration-apply PRE-AUTHORISED (proof-gated) · heavy ephemeral-verify · 🚦 merge only**
*Branches off PR #1. This is the money-invariant change — isolate + prove hardest.*
- Mig 460: helper `_recompute_player_owes(p_player_id, p_team_id)` →
  `UPDATE players SET owes = COALESCE((SELECT SUM(amount) FROM payment_ledger WHERE
  player_id=p_player_id AND team_id=p_team_id AND type='game_fee' AND status='unpaid'),0)`.
- Amend `admin_confirm_payment`: mark THIS match's ledger row `status='paid'`
  (only if currently `'unpaid'` — idempotent, no double-settle), preserve `claimed_at`/
  `claimed_by` (COALESCE), set `players.paid`/`paid_at`, then **call
  `_recompute_player_owes`** instead of `owes = 0`. So confirming last night's £5 drops
  owes from £15 → £10; other unpaid weeks remain.
- Amend `admin_reset_payment`: after flipping the row back to `'unpaid'`, call
  `_recompute_player_owes` (replaces the manual `owes + amount` restore — self-healing).
- Rollback note: if mig 460's recompute misbehaves, apply `460_down.sql` (restores
  `owes=0` confirm + the manual restore), reconcile owes from the ledger, then only if
  needed `459_down.sql`. Never leave owes stale.
- Reconciliation: assert (in ephemeral-verify) `owes == SUM(unpaid game_fee)` after every
  operation, across a **multi-week** fixture (3 unpaid weeks; confirm one; owes drops by
  exactly that week; confirm again = no-op).
- Gates: ephemeral-verify multi-week + double-confirm idempotency + reconciliation
  invariant · rpc-security-sweep · casual-regression · confirm result-save creates a
  game_fee unpaid row per attendee (the SUM==owes precondition) before applying.
- **Done-check:** confirming one week reduces owes by exactly that week's amount, floored
  at 0, never over-subtracts on re-confirm; owes == Σ(unpaid game_fee) holds after
  confirm/reject/reset; squad-wide Σowes updates via broadcast.

### PR #3 — Payment History: tappable claim (frontend)
**✅ BUILT — awaiting merge. PR #202 · branch `feat/per-game-payment-history-claim` · build ✓ · hygiene ✓ · QA review NO-ISSUES (render non-regression + tap logic verified) · RPC EV-proven in PR #1. ⚠️ Live tap-smoke NOT run — demo player has no unpaid game_fee row to exercise + preview is SSO-gated; eyeball the tap on a real team post-merge. SHIPS-LIVE (player UI) but low blast radius, not native-critical (no real-device walk owed).**
**Tier-1 · CLEAR · Effort S–M · Playwright walk · 🚦 merge only**
*Branches off PR #1 (needs claimLedgerPayment + claimed_at in history).*
- `PaymentHistoryBody` ([PlayerProfile.jsx:149](apps/inorout/src/views/PlayerProfile.jsx#L149)):
  unpaid `game_fee` rows become tappable with a *"Tap to mark as paid"* hint; tap →
  optimistic `UNPAID`→`CLAIMED` pill + `claimLedgerPayment`, revert on error. Claimed rows
  read "CLAIMED · awaiting confirmation"; paid/cancelled/waived non-tappable. **Add a
  `claimed` key to the `STATUS_STYLE` map** (it doesn't exist yet) reusing amber tokens:
  `claimed: { bg:"var(--amber2)", border:"var(--amberb)", color:"var(--amber)" }` — in
  BOTH PlayerProfile.jsx and PaymentsScreen.jsx. Disable tap target + show loading state
  during the RPC.
- Gates: casual-regression (null claimed_at must not break render) · Playwright:
  tap unpaid row → RPC fires → pill flips.
- **Done-check:** an unpaid week can be claimed from history and shows CLAIMED; other row
  types inert.

### PR #4 — My View payment panel rework (frontend)
**✅ MERGED + LIVE (PR #203, 2026-07-01). Operator device-tested. Primary "I've paid (cash) · £{price}" for this week + backlog link → Payment History; killed whole-balance Clear Debt; removed dead locals + Stripe tiles (net −36 lines).**
**🔍 AUDITED — ready to build (next). Branch off updated main (has migs 459+460+PR#3). Audit cache (don't re-derive):**
- Payment panel = IIFE at `PlayerView.jsx:925-1164`. Header amount `amountText` (line 948-960) from `effectiveDebt = ledgerBalance>0 ? ledgerBalance : owes`. Buttons built into `btns[]` (973-1068) then rendered at 1156-1160.
- State via `getPaymentState(me, cashPending)` (packages/core/engine/payments.js:15): paid→'paid', selfPaid→'claimed', owes>0→'debt', else 'unpaid'. Two-tap confirm already exists (`cashPending` → "Confirm — You've Paid?") calling `handleCashPayment(me.token)` = `set_player_paid` (claims current week + flags self_paid; NO new write path — reuse it).
- **Rework:** replace the "Clear Debt — £{wholeDebt}" (debt branch) + "Paid" (unpaid branch) with ONE primary **"I've paid (cash) · £{price}"** targeting THIS week (price = `schedule.pricePerPlayer`); keep the two-tap confirm → 'claimed' → "Claimed · awaiting confirmation"; paid → "✓ Paid"; nothing owed → "Nothing owed 👊". Add a backlog line under the buttons (after 1160) shown only when `effectiveDebt > price`: *"You owe £{effectiveDebt - price} more from earlier — see Payment History →"* → `setShowProfile(true)`.
- Deep-link: profile renders inline at `PlayerView.jsx:725` via `showProfile` state → `<PlayerProfile>`. For auto-open of the Payment History section, add an optional `openPayments` prop to PlayerProfile (Section `defaultOpen` on the PAYMENT HISTORY section) — small companion change.
- Gates: casual-regression (payment states still render) · Playwright · **real-iPhone walk = human checkpoint (Hard Rule 13, loop can't do it)** · stops at merge gate.
**Tier-2 · PROTECTED · Effort M · casual-regression + Playwright + real-device walk · 🚦 merge only**
*Branches off PR #1. Live casual-app surface (Hard Rule 13).*
- Rework [PlayerView.jsx:950-1070](apps/inorout/src/views/PlayerView.jsx): primary action
  targets the **most recent unpaid game** ("I've paid (cash) · £X" → two-tap "Confirm —
  you've paid?" → "Claimed · awaiting confirmation" pill → "✓ Paid"); backlog surfaced as
  *"You owe £X more from earlier — see Payment History →"* (deep-links to the history
  screen). "Nothing owed 👊" when clear. Route the confirm through the extended
  `set_player_paid` (current match) — no new write path. Kill the "pay this week vs clear
  debt" duality. Target wireframe:
  ```
  ┌───────────────────────────────────────┐
  │ Saturday · 15:00              £15 owed │   ← total balance, red if >0
  │                                        │
  │  [  I've paid (cash) · £5  ]           │   ← primary: the MOST RECENT unpaid game
  │  You owe £10 more from earlier —        │
  │  see Payment History →                  │   ← only shown if backlog > this game
  └───────────────────────────────────────┘
  after tap → [ Confirm — you've paid? ]  → "Claimed · awaiting confirmation" (amber pill)
  ```
- Gates: casual-regression (payment states still render/work) · Playwright · flag the
  real-iPhone walk as a human-test checkpoint (Hard Rule 13 — the loop can't do it).
- **Done-check:** a player can mark last night's game from My View the next morning; the
  backlog line links to history; copy matches the shared wording.

### PR #5 — Admin PaymentsScreen: per-week Confirm + Reject (frontend)
**✅ BUILT — awaiting merge. PR #204 · branch `feat/per-game-payment-admin-perweek` · build ✓ · hygiene ✓ · QA NO-ISSUES. Per-row Confirm(green)/Reject(red) + CLAIMED pill on claimed game_fee rows; Confirm=admin_confirm_payment(matchId), Reject=adminRejectClaim(ledgerId); Reset on paid rows kept. Not native-critical → no device walk. 🚦 merge only.**
**Tier-2 · PROTECTED · Effort M · casual-regression + Playwright · 🚦 merge only**
*Branches off PR #2 (needs per-week confirm + admin_reject_claim).*
- Expanded ledger in [PaymentsScreen.jsx:288-331](apps/inorout/src/views/AdminView/PaymentsScreen.jsx#L288):
  claimed unpaid `game_fee` rows get inline **Confirm** (green) + **Reject** (red) buttons
  and an amber "CLAIMED" flag; Confirm → `admin_confirm_payment(matchId)` (per-week),
  Reject → `adminRejectClaim`. Keep existing Reset on paid rows.
- Gates: casual-regression · Playwright admin flow (confirm a claimed week → owes
  drops by that week; reject → back to unpaid).
- **Done-check:** admin can confirm/reject a specific claimed week; owes + squad total
  update live.

---

### FIX — admin CONFIRM settles whole balance (mig 461)
**✅ BUILT + APPLIED — awaiting merge. PR #206 · branch `fix/per-game-payment-confirm-settles-balance` · mig 461 applied + phantom row cleaned live. Live bug (on-device): player-level "claims paid · CONFIRM" confirmed the active match (per mig 460 per-week), settling nothing for a multi-week debtor whose debt is on earlier weeks. Fix: `admin_settle_player` settles the whole balance; doMarkPaid branches claim→settle-all vs £X-PAY→active-match. EV + QA + Security clean. ⚠️ hold CONFIRM taps until merge+deploy (old code re-creates the phantom).**

## 🚦 GATES the loop must stop at
- **PR #1 & PR #2 migration-apply:** PRE-AUTHORISED (see header) — apply autonomously once
  proven; do NOT stop for sign-off. Post a one-line "applied mig NNN, EV PASS" note and
  continue. (mig 460 apply = live behaviour change per the header caveat — proof must be
  watertight, but no human pause.)
- **Every PR:** merge gate (merge = prod deploy to the live casual team + App-Store bundle)
  — **this is the only human stop.** Hand over a one-line ship-safety verdict.
- **PR #4:** real-iPhone walk (Hard Rule 13, native-app-affecting player surface).
- **PR #2 precondition (VERIFIED true during scope):** result-save (migs 205/347) already
  INSERTs a per-attendee `game_fee` unpaid ledger row via a `NOT EXISTS` guard alongside
  the `owes += price` increment, so `owes == SUM(unpaid game_fee)` holds. Still re-prove
  it in PR #2's ephemeral-verify across a multi-week fixture + a few real historical rows
  before applying mig 460 (guards against a pre-205 row or a manual deletion having
  drifted a live player's owes).

## KNOWN LIMITATIONS (stated, not silently capped)
- **Whole-week claims only.** A player who pays £10 toward a £15 week must still claim the
  whole week; there's no partial-amount claim (`amount` is not split). Fine for cash-at-
  the-pitch (people pay a game's full fee); partial-amount claims are a future iteration.
- **No bulk admin confirm.** Admin confirms/rejects one claimed week at a time; a
  "confirm all claims for this player/week" is a quick post-ship add, out of scope here.
- **Cash model only.** `_recompute_player_owes` sums `type='game_fee'` unpaid rows only;
  Stripe `debt_payment` rows are NOT in the owes recompute. If/when Stripe settles casual
  debt, that needs its own mechanism — noted for [[project_stripe_full_build]].

## DONE =
A player can mark any specific unpaid week paid — from Payment History or (for the game
they just played) from My View — as a claim; the admin confirms per-week; confirming one
week clears exactly that week's money; `owes`, each player's total, and the squad-wide
total all recompute from the ledger and every screen updates live; false claims can be
rejected; guests and non-game-fee rows are untouched.

## Related
[[project_result_save_invariants]] · [[project_stripe_full_build]] · mig 211 (self-pay =
pending claim) · mig 243 (go-live resets flags not owes) · Hard Rules 9/10/11/12/13/15.

---

## Trigger
`/loop /dev-loop PER_GAME_PAYMENT_MARKING_HANDOFF.md`
