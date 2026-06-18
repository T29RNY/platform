# Classes — Open / Free / Trial access (members_only + price-0 levers) — Build Handoff

*Created session 148 (2026-06-18). Status: PLANNED, not started. This is the OPT-IN follow-up
logged in BUGS.md after the gym/boxing vertical Phase 3 (PT booking, s147). Next free migration at
time of writing = **360**.*

---

## Why this exists

The classes epic (migs 338–345) hard-requires an active membership to book ANY class. The gym
vertical's Phase 3 (PT / 1-on-1 booking, mig 358) introduced **two independent levers** that the
operator liked and asked to bring to classes:

- **An account is always required** (`auth.uid()` → `member_profiles`) — no anonymous bookings, so
  attendance/charges/QR check-in always resolve to a real person.
- **A paid membership is OPTIONAL**, gated by a per-resource `members_only` flag. `members_only=true`
  (default) keeps today's behaviour; `members_only=false` lets any signed-in account book and pay at
  the door. **`members_only=false` + price 0 = a free open / trial class.**

This lets a venue run a free taster class, an open community session, or a paid drop-in trial WITHOUT
forcing a membership first — the single most-requested "let people try before they join" gap.

## Audit facts that shape the plan (verified live, session 148)

The membership gate is raised in **three places**, all with `RAISE EXCEPTION 'membership_required'`:

1. `member_book_class_session(p_session_id)` — mig 340, line ~223 ("active-membership gate (classes
   are member-only)"). The main booking path.
2. `member_claim_waitlist_spot(...)` — mig 341, line ~140. The claim-window waitlist promotion path.
3. `member_purchase_class_package(...)` — mig 344, line ~220. Bulk credit purchase.

Other relevant facts:
- The `members_only` flag should live on **`venue_class_types`** — that's where `is_sparring` already
  lives (Phase 1, mig 356) and it mirrors PT's per-trainer `members_only` (mig 358). A class SESSION
  reads its type's flag. Default **true** so every existing class stays member-only byte-identically.
- Class pricing + payment: sessions carry `payment_mode` ('prepay'|'door'|…) and a charge is applied
  via `_apply_class_booking_charge(booking_id)`. **NEXT SESSION must confirm where the class price
  lives** (session vs type) and that price 0 produces no charge (free class) cleanly — pull the
  `_apply_class_booking_charge` body before writing anything.
- The no-show suspension gate, capacity/waitlist logic, and Stripe-prepay dormancy gate are all
  downstream of the membership gate and must stay unchanged for member-only classes.

## Scope (mig 360)

- **Schema:** `ALTER TABLE venue_class_types ADD COLUMN members_only boolean NOT NULL DEFAULT true`
  (additive; default true = no behaviour change for existing types). Confirm the class price field;
  if classes have no per-type/per-session price for non-member door payment, decide where it lives
  (likely reuse the existing session price/`payment_mode` path — do NOT invent a new charge path;
  money rides `venue_charges` like everything else).
- **RPC changes (NOT new RPCs — modify the three gate sites):** thread the `members_only` read into
  `member_book_class_session`, `member_claim_waitlist_spot`, and decide `member_purchase_class_package`
  (packages are bulk credits — a `members_only=false` package is odd; RECOMMEND keeping package
  purchase member-only and scoping the lever to per-session booking + waitlist claim only — confirm
  with operator). The account requirement (`auth.uid` → `member_profiles`) stays in ALL paths. When
  `members_only=false`: skip the membership EXISTS check; a signed-in non-member books and pays at the
  door (or free when price 0). Keep the no-show, capacity, and prepay-dormancy gates.
- **Operator UI:** a "Members only" toggle on the class-type editor in `apps/venue/.../ClassesView.jsx`
  (sibling of the Phase 1 "Sparring/open-mat" toggle) + a clear "Open class — non-members can book"
  / "Free taster" indicator. Mirror the PT TrainersView copy ("A, but B for trials/one-offs").
- **Member UI:** `apps/inorout` class timetable / booking surface (`ClassesTimetable` /
  `ClassesScreen`) must let a signed-in non-member book an open class and show the right CTA (Free /
  £X at the door / Members only). Confirm the booking surface doesn't pre-filter out non-members.

## HEADLINE GATES

- The `venue_class_types.members_only` column is additive-NULLABLE-or-default-true → every existing
  member-only class is byte-identical. Prove it.
- Casual football is untouched (classes are a club/membership surface; no casual football path
  reads class types). Prove via additive-diff.
- The account requirement is NEVER dropped — there is no anonymous class booking in any path.

---

## Per-phase cycle (mandatory)
SQL applied to Supabase first → `_up.sql` + `_down.sql` source same commit (Hard Rule #11) →
**rpc-security-sweep** (the three modified write RPCs — confirm SECDEF + search_path + single
overload + grants survive the CREATE OR REPLACE; if a signature changes, DROP the old overload) →
**ephemeral-verify** (`_e2e_` fixture: a venue + an open class type [members_only=false] + a
members-only class type + a signed-in non-member [member_profile with NO membership] → assert the
non-member CAN book the open class, CANNOT book the member-only class [`membership_required`], a
price-0 open class books with no charge, a priced open class writes a `venue_charges` door row;
member-only path still works for an actual member; leak-check 0) → **casual-regression**
(additive-diff — prove no casual football surface touched + existing member-only classes unchanged) →
build/hygiene → **real-iPhone PWA walk** (Hard Rule #13 — non-member books an open class on a real
device) → docs (FEATURES/RPCS/SCHEMA/DECISIONS/BUGS/CONTEXT/this handoff + memory) → commit → merge
promptly → confirm main clean.

## Critical files
- `rls_migrations/360_*.sql` (new) — schema + the three modified RPC bodies.
- `packages/core/storage/supabase.js` — booking wrappers (likely no signature change; confirm).
- `apps/venue/src/views/ClassesView.jsx` — class-type editor "Members only" toggle.
- `apps/inorout/src/views/ClassesTimetable.jsx` / `ClassesScreen.jsx` — non-member booking CTA.

## Open decisions to confirm with operator before building
1. Does the `members_only=false` lever apply to **class packages** too, or only per-session booking +
   waitlist claim? (Recommend: per-session + waitlist only; keep packages member-only.)
2. For a priced open class booked by a non-member: door payment only (live path), or also offer Stripe
   prepay when connected? (Recommend: mirror PT — door is the live path, prepay stays dormant.)
3. Is "members only" a per-class-TYPE flag (recommended, where is_sparring lives) or per-SESSION
   (lets a venue open a single one-off session of an otherwise member-only type)?

---

## NEXT SESSION PROMPT — Classes open/free/trial access (members_only + price-0 levers, mig 360)

*Paste the block below to start the next session. The gym/boxing vertical is COMPLETE (Phases 0–4,
migs 355–359, on main). Next free mig = 360.*

```
Build the CLASSES open / free / trial access retrofit (members_only + price-0 levers), mig 360 — the
OPT-IN follow-up logged in BUGS.md after the gym vertical. Read CLASSES_OPEN_ACCESS_HANDOFF.md in full
first (it has the live audit facts: the three membership-gate sites, where the flag should live, and
the headline gates).

CONFLICT GUARD: before branching, confirm git is on main, tree clean, zero open PRs. If not, STOP and
report.

Goal: bring the gym PT booking's two levers to classes — an ACCOUNT (auth.uid → member_profiles) is
always required, but a paid MEMBERSHIP becomes OPTIONAL per class type via a `members_only` flag
(default true = unchanged). members_only=false + price 0 = a free open/trial class; members_only=false
+ price > 0 = a paid drop-in (door payment, settlement DORMANT until live keys). Reuse venue_charges —
do NOT invent a new charge path.

Scope (mig 360):
  - Schema: venue_class_types ADD COLUMN members_only boolean NOT NULL DEFAULT true (additive). Confirm
    the class price field by pulling _apply_class_booking_charge live before writing.
  - Modify the THREE gate sites (NOT new RPCs): member_book_class_session (340),
    member_claim_waitlist_spot (341), and decide member_purchase_class_package (344 — recommend keep
    packages member-only). Thread the members_only read; skip the membership EXISTS check when false;
    NEVER drop the auth.uid/member_profile requirement; keep no-show + capacity + prepay-dormancy gates.
  - Operator UI: "Members only" toggle on the class-type editor in ClassesView.jsx (sibling of the
    Phase 1 Sparring toggle).
  - Member UI: inorout ClassesTimetable/ClassesScreen lets a signed-in non-member book an open class
    with the right CTA (Free / £X door / Members only).

Run a full AUDIT → VERIFY → EXECUTE → VERIFY → COMMIT cycle:
  - AUDIT in plan mode first (no edits): pull the three gate-site bodies + _apply_class_booking_charge
    + venue_class_types schema + the inorout class booking surface; confirm where price lives and that
    price 0 = no charge cleanly.
  - Apply SQL to Supabase first, land _up/_down source same commit (Hard Rule #11). If a signature
    changes, DROP the old overload (CREATE OR REPLACE won't replace a different signature).
  - GATES (mandatory): rpc-security-sweep (the modified write RPCs); ephemeral-verify (_e2e_ fixture:
    open class type + member-only class type + a signed-in NON-member → assert non-member books the
    open class, is rejected on the member-only one [membership_required], price-0 open = no charge,
    priced open = venue_charges door row; member path still works; leak 0); casual-regression
    (additive-diff — no casual football surface touched, existing member-only classes byte-identical);
    real-iPhone PWA walk (Hard Rule #13 — non-member books an open class); build/hygiene.
  - Then docs (FEATURES/RPCS/SCHEMA/DECISIONS/BUGS/CONTEXT/this handoff + memory), commit, merge
    promptly, confirm main clean.

Confirm with me BEFORE building:
  1. Does members_only=false apply to class PACKAGES too, or only per-session booking + waitlist claim?
     (Recommend: per-session + waitlist only; packages stay member-only.)
  2. Priced open class for a non-member — door payment only (recommend, live path), or also Stripe
     prepay when connected (stays dormant otherwise)?
  3. Is "members only" a per-class-TYPE flag (recommended) or per-SESSION (open a single one-off
     session of an otherwise member-only type)?
```
