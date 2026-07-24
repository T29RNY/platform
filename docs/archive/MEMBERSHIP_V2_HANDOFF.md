# MEMBERSHIP V2 — Member Accounts, Households & the Club Operating System

*Epic plan, session 92 (2026-06-13). Supersedes the v1 membership plan
`~/.claude/plans/if-we-wanted-to-binary-orbit.md` for everything beyond
what already shipped. v1 (the venue-CRM-record membership system, Phases
1–7, mig 269–282) is LIVE; this doc is the **reform** that turns it from
"a venue's CRM record" into "a person-owned account + household + club
operating system." Nothing here is built yet — this is the agreed design
to audit and build against, phase by phase.*

---

## 1. WHY — the reframe

What shipped in v1 treats a **member as a `venue_customers` row owned by
the venue** — a CRM record, with all PII inline, no member login, and the
`/m/<token>` pass as a public magic-link page. That is correct for a
walk-in directory but wrong for the pilot **club**, where the dominant
case is **a parent registering their child to train**, and where members
expect to own and manage their own data.

This epic moves to: **a member is a person who owns their profile; a
venue/club grants them a membership.** It also absorbs four futureproofing
requirements (standalone module, multi-venue membership, pro-rata/season
joins, merchandise) and one strategic realisation — that the platform's
core **"In or Out" availability primitive can solve the club's
"who's-turning-up-to-training" WhatsApp mess**, which makes this a **club
operating system**, not a membership module. (Commercial framing already
lives in `STRATEGY.md` session 91 — modular superadmin-toggled SKUs,
football-as-wedge, Pilot 2 = the club. This doc is the product/architecture
counterpart; do not duplicate the commercial doc.)

Tournaments are **out of scope** — they already exist as a complete,
separate module (FEATURES "Phase 11 cups & knockouts"). The Phase-1
identity hooks keep the door open for club-member-based tournaments to
*consume* the existing cup engine later; we build nothing for them here.

---

## 2. DECISIONS LOCKED THIS SESSION

Operator-confirmed:

- **D1 — Member accounts.** Members get real logins + a self-service
  profile they own and update.
- **D2 — Households.** Parent account → **multiple children**; many
  guardians per child (360Player model).
- **D3 — Venue-defined benefits.** Each benefit is a **venue-named line**
  with a value that is **either a £ amount or a %** (the venue sets the
  label and the value). Tiers can target adult / junior / child; family &
  sibling pricing supported. `/q` displays exactly what the venue set.
- **D4 — Consent documents.** Versioned documents, viewed in-modal,
  signed with an audit trail (clickwrap + optional typed signature).
- **D5 — ID mandate.** Per-venue **"require proof of ID/age"** toggle +
  conditional document upload.
- **D6 — Safeguarding fields.** Expand the youth form to the **CPSU
  standard** (see §8), venue-configurable.

Futureproofing asks (triaged in §5):

- **Standalone module + superadmin on/off** — generalised to a
  module-entitlements matrix.
- **Multi-venue membership** — forces club-as-owner (the one
  expensive-to-retrofit decision; baked into Phase 1).
- **Pro-rata / mid-season join** — pricing-model discriminator + season
  hook.
- **Merchandise / add-ons** — line-item money model from the start.

Default calls carried forward (flag to change): fixed CPSU superset +
venue toggles (NOT a full form builder in v1); parent-managed child
profiles in v1 (own child login at 16+ deferred); `venue_memberships`
records both payer (parent) and member (child) for the future Stripe
phase; second-guardian invite via the existing invite-link mechanism
(Phase 3).

---

## 3. CORE ARCHITECTURE

Three clean entities replace the conflated `venue_customers`:

1. **`member_profiles`** — the *person*. Source of truth for PII, DOB,
   contact, address, medical/safeguarding. Optionally linked to a Supabase
   auth login; can exist **unclaimed** (venue created it) and be claimed
   later. **Role-agnostic** — being a parent/coach/player/member are
   *relationships*, never baked into the person.
2. **`member_guardians`** — the *household graph*: parent-profile ↔
   child-profile, relationship, primary flag. One parent → many children;
   many guardians → one child.
3. **`clubs`** + **`club_venues`** — the **membership-issuing entity** and
   its venues (M:N). Memberships are owned by a **club**, not a `venue_id`;
   a club maps to one *or many* venues; a venue can host many clubs. A
   single-site club is just a club with one venue (the 99% case).
   `venue_customers`/`venue_memberships` are reframed as the club↔person
   relationship + the membership grant.

**Guardrails:**
- Stay **inside the venue-membership domain** — do NOT touch the casual
  `players` system or its RLS wall. Member identity is its own thing;
  unification with casual players is explicitly out of scope.
- **Reuse Supabase auth** — no parallel login. The member account lives in
  **apps/inorout** (in-or-out.com), where `/m` and auth already are.

**Three structural hooks that go in Phase 1** (cheap now, costly to
retrofit): **club-as-owner** (+ `club_venues`), **`pricing_model`
discriminator** on prices (`recurring` | `term`), **line-item money model**
(membership / fee / merchandise / add-on all fit). Plus the **role-agnostic
identity**, **club cohorts**, and **club-scoped consent** hooks (§5/§6).

---

## 4. MEMBER-APP UX SPINE — reuse, don't rebuild

The member-facing side reshapes furniture already in apps/inorout:

- **Profile icon (avatar) → `PlayerProfile`** becomes the **person
  profile** (PII, consents, documents, my children). Today's
  team-scoped Stats/Payments/Injuries move *down* into each team/membership
  card. The avatar represents the **human/account**, persistently.
- **`MySquads`** becomes **"My memberships & teams"** — casual squads +
  club/venue memberships + leagues as cards, and (household) **mine + my
  children's**. Tapping a child manages the child; In/Out for a child's
  training lives on the child's card.
- **"+ Join another team"** becomes **"+ Join a club, team or league"** —
  it already hands off through **`InviteResolve`**, which **dispatches by
  code type** (`venue_landing` / `join` / `checkin`). Adding "start a
  membership" extends that dispatcher; no new screen.

**Reads stay domain-separate** — MySquads aggregates casual + membership
in the *UI*, never in one all-seeing query (respects the RLS wall).

---

## 5. ZERO-FOOTPRINT UX PRINCIPLE (non-negotiable)

The new scope must be **invisible to casual/league players who aren't
members.** Hard rule: **nothing membership-related renders on zero data.
Empty = today's app, unchanged.**

- No "Memberships"/"My Children" headers, no consent/medical sections,
  unless the person actually has the relationship.
- Medical/safeguarding/guardian data is **context-summoned** — only asked
  when joining a club that collects it; never for a casual player.
- Terminology ("member", "guardian", "club") never surfaces for a
  non-member.
- **Proof:** a `casual-regression.md` pass must show the casual experience
  is byte-for-byte unchanged with no memberships present.

---

## 6. SECURITY POSTURE (membership domain)

The catastrophic **RLS-retrofit risk does NOT recur** — every new table is
**born RLS-on, all access via `SECURITY DEFINER` RPCs from migration one**
(not a switch flipped on a live surface), and the discipline is now
enforced (hooks block direct `from()`/`rpc()`, rpc-security-sweep,
ephemeral-verify). What broke the app in 2024 was retrofitting RLS onto
direct-access tables; we are not doing that.

But this domain is **higher-stakes than anything before** — children's
records + special-category medical data under UK GDPR. The danger is
**silent wrong-person exposure**, not visible breakage. Posture:

1. **Threat-model every new RPC** for "can A read B's / a child's data" —
   documented in the audit before code.
2. **Negative-path ephemeral-verify** — prove the *wrong* user is
   **refused** (wrong parent, wrong coach, unclaimed record), not just that
   the right user works.
3. **Standing membership-domain RLS/authorization test suite** run every
   phase, so a later change can't silently re-open a closed door.
4. **Special-category data** (medical/safeguarding) — access audit-logged
   (Hard Rule #9), narrowest read scope.
5. **Claim-flow ownership** — linking an unclaimed record to an account
   needs hard proof (verified email), never a guessable token →
   account-takeover guard.
6. **A security gate between verify and commit** for any phase touching
   member/child data (extends `rpc-security-sweep.md` with horizontal-access
   + claim-ownership checks).

---

## 7. THE PHASED PLAN

| # | Phase | Delivers | Notes |
|---|---|---|---|
| **0** | Module entitlements + superadmin control | per-venue/club module matrix; superadmin on/off screen; standalone "memberships-only" mode in venue dashboard + `/q` | build |
| **1** | Foundation: club-as-owner + person/membership split + accounts | `clubs` + `club_venues`; `member_profiles` (person) + auth link + claim; **the 3 hooks** (pricing_model, line-item billing, role-agnostic identity) + club cohorts + club-scoped consent hooks; backfill demo data | build + hooks |
| **2** | Member self-service profile | login, view/edit own details, consents, documents, pass | apps/inorout |
| **3** | Household / child memberships | parent manages multiple children, registers a child, invites 2nd guardian | apps/inorout |
| **4** | Membership builder rework (venue/club) | venue-named benefits (£/% values), tier audience (adult/junior/child), family/sibling pricing, **season + pro-rata pricing**, ID toggle, safeguarding-field config | apps/venue |
| **5** | Consent documents + e-sign | versioned `policy_documents` + `consent_acceptances` (snapshot, timestamp, IP/UA, signed-on-behalf-of, typed signature); modal viewer + clickwrap; re-consent on version bump; shown in member profile; **club-scoped** | both |
| **6** | ID & document upload | conditional upload (passport/licence/PASS/birth-cert), storage, venue verification | both |
| **7** | `/q` signup rebuild (the original Step 1) | full rebuild on the new model: person vs child path, period + subtotal, mandatory-field rules, CPSU youth fields, doc signing, ID upload, progressive disclosure | apps/inorout |
| **10** | **Club attendance — the centrepiece** | club session/fixture schedule + **In/Out RSVP (parent-for-child)** + attendance register; reuse the existing In/Out primitive, do NOT rebuild | later |
| **11** | Club comms | broadcast announcements (push/email) — NOT two-way chat | later |
| **12** | Club staff + DBS + role-scoped access | coach/manager roles, DBS-check tracking (UK compliance), cohort-scoped visibility | later |
| **8** | Multi-venue activation | turn on a club spanning several venues; access validation at check-in | later (Phase-1 hooks enable) |
| **9** | Merchandise / add-ons | club catalogue, add-ons at enrolment, standalone purchases (on the line-item money layer) | later |

**Build order:** identity first (0–3), then the club defines its offer
(4–6), then the `/q` form is rebuilt *last* (7) because it sits on top of
everything. Attendance (10) is the strategic centrepiece we build *toward*
— it lands after the foundations because it depends on accounts + household
+ cohorts. 8/9/11/12 are additive later phases the Phase-1 hooks already
make possible without a rewrite.

**Folded-in best-practice adds:** session/match fees + bursaries → Phase-4
builder + money layer; waiting lists → reuse the casual "reserve /
spot-opened" mechanic; iCal calendar feed + member data export (GDPR
subject access) → small adds once accounts exist.

---

## 8. RESEARCH BASIS (UK, 2024–2026)

**CPSU youth registration standard** (NSPCC Child Protection in Sport
Unit — the UK authority) — fields a compliant club form needs beyond v1:
- **Two** emergency contacts (v1 has one)
- Disability / **SEND** / additional needs + reasonable adjustments
- **Dietary** requirements
- Consent for **emergency medical treatment** (parent unreachable)
- Consent to **administer medication**
- **"Can the child leave the session unaccompanied?"** + authorised
  collectors
- **Annual re-consent** (details change)
Source: thecpsu.org.uk registration & consent form.

**Photography/image consent** — granular **per use** (website / social /
press / marketing), not one tick. **Under-16 → parent consents; 16–17 →
child may self-consent.** Source: CPSU photography & filming guidance.

**360Player model** (to copy for households) — one parent account → many
children; many guardians per child (invite link); optional child login at
16+; club-configurable form builder (we defer the full builder). Source:
help.360player.com.

**ID** — don't force at signup; age attested by parent via DOB. Proof of
age only for competition eligibility or licensed-venue access; accept
passport / driving licence / PASS card / (minors) birth certificate.
Sources: PASS scheme, GOV.UK licensed-premises.

**Consent / e-sign** — valid under UK ECA 2000 / eIDAS. Clickwrap + typed
name = valid Simple Electronic Signature. Best practice: present the
actual document, affirmative per-policy accept, **version-pin the exact
text signed**, audit trail (timestamp/IP/UA/signed-on-behalf-of), re-consent
on version change. Sources: Law Commission 2019, UK eIDAS.

---

## 9. RESOLVED IN PHASE-1 AUDIT (session 92)

- **Club vs company entity — RESOLVED.** The audit found a `clubs` table
  **already exists** (mig 055, league layer: `id text, name, short_name,
  founded_year` + `club_teams` → casual `teams`), but it is **completely
  dormant** (0 rows, RLS-on, no policies/RPCs/JS refs). `companies` is a
  separate thing — the **billing/operator rollup that owns venues 1:N**
  (`venues.company_id`, regions, HQ analytics). **DECISION: extend the
  single existing `clubs` table** as the canonical club entity (NOT
  `companies`, NOT a new table). League, membership (`club_venues` M:N),
  cohorts and attendance are all *relationships* off the one `clubs` row —
  never a second club-like table. Elegance (one real-world club = one row),
  futureproof (club-member tournaments later consume the existing cup engine
  via the same `clubs`), safe (empty/unwired so we define the meaning now),
  zero-footprint (league-only clubs just have no `club_venues` rows). Full
  rationale + guardrail in `DECISIONS.md` ("clubs is the SINGLE canonical
  club entity").

- **v1 security posture observed (carry into Phase-1 design).** Existing
  membership RPCs are SECDEF + `search_path` set, but granted to **anon +
  authenticated** and authenticate via the **shared `p_venue_token`**;
  `member_self_signup` is **anon**; `get_member_pass` is an **anon
  bearer-token** page leaking first+last name + tier; `venue_claim_memberships`
  claims venue-**admin** invites (no member-side claim exists yet). New
  club/member RPCs must break this pattern — `auth.uid()`-based, verified-email
  claim, negative-path EV. See §6.

- Next free migration number: **283**.

## 9a. PHASE-1 RECOMMENDED SCHEMA (audit output — review before execute)

All tables **born RLS-on, REVOKE-all, RPC-only** from migration one.

- **`member_profiles`** (NEW) — the *person*, source of truth, role-agnostic.
  `auth_user_id → auth.users` (null = unclaimed venue-created record),
  PII + DOB + address, CPSU safeguarding superset (**two** emergency contacts,
  SEND/additional needs, dietary, emergency-treatment + administer-medication
  consent, "may leave unaccompanied" + authorised collectors, medical/allergies/
  meds/GP), **granular per-use photo consent** (website/social/press/marketing).
  No role columns.
- **`member_guardians`** (NEW) — household graph: `child_profile_id`,
  `guardian_profile_id`, relationship, `is_primary`, `can_collect`, invite/accept
  state, `UNIQUE(child,guardian)`. Parent→many children; many guardians→one child.
- **`clubs`** (EXTEND existing) — add owner/contact, `id_mandate boolean` (D5),
  `safeguarding_config jsonb` (D6 toggles), pricing/cohort defaults. Nullable,
  dormant until membership on.
- **`club_venues`** (NEW) — M:N `club_id`/`venue_id`, `UNIQUE(club_id,venue_id)`.
- **`club_cohorts`** (NEW) — age-group/squad, referenced by membership (enables
  Phase 10 attendance + Phase 12 cohort-scoped staff visibility).
- **Reframe `venue_memberships`** (additive, keep `venue_id` for back-compat):
  add `club_id`, `member_profile_id`, `payer_profile_id`, **`pricing_model`
  discriminator (`recurring`|`term`)**.
- **Line-item money hook:** extend the existing **`venue_charges` polymorphism**
  (`source_type`/`source_id` already supports membership/fee/merchandise/add-on) —
  do NOT add a parallel ledger. (Note: a second recurring engine `venue_fee_plans`/
  `venue_fee_subscriptions` exists — reconcile, don't triplicate.)
- **Club-scoped consent hook:** Phase-5 `policy_documents`/`consent_acceptances`
  should FK the **club**, not the venue — seat that scoping now so it needn't move.
- **Untouched:** `players`, `teams`, `player_match`, `club_teams`, all casual RPCs +
  their RLS wall. MySquads aggregates casual + membership in the **UI only**.

## 9b. PHASE-1 DEMO BACKFILL STRATEGY (`demo_venue` only)

1. Create `club_demo` (extend `clubs`) + `club_venues(club_demo → demo_venue)`.
2. One `member_profiles` per existing `venue_customer` (9), copying PII (idempotent
   on a stable key).
3. **Leo Bennett** (DOB 2012, the one junior with guardian fields): also create a
   guardian profile + `member_guardians(child=Leo, guardian, is_primary)` — proves
   the household path with real demo data.
4. Re-point the 8 `venue_memberships` to `club_id` + `member_profile_id`
   (+ `payer_profile_id` for Leo). **Keep `venue_customers` rows intact/dual-readable**
   so the v1 venue dashboard keeps working until Phase 4 reworks the builder — no drift.
5. Seed data, not an EV run — must not COMMIT against any non-membership domain row;
   casual `players`/`teams` byte-for-byte unchanged (casual-regression gate before commit).

## 9c. PHASE-1 RPC THREAT MODEL (negative-path EV mandatory — prove the WRONG user is refused)

| RPC (Phase 1–3) | Caller | Horizontal-access threat | Guard |
|---|---|---|---|
| `member_claim_profile` (NEW) | authed | claim a stranger's unclaimed record (account takeover) | **verified-email match only**, one-time, audit-log, refuse if already claimed; never a guessable token |
| `member_get_self`/`member_update_self` | authed | read/write another person | scope to `auth_user_id = auth.uid()`; never trust a passed profile_id |
| `member_get_child`/`member_update_child` | authed (parent) | parent A reads/edits parent B's child | require a `member_guardians(child, auth.uid())` edge |
| `member_invite_guardian`/accept | authed | attach self as guardian to arbitrary child | invite only by existing guardian; accept binds to auth.uid()'s verified email |
| `get_member_pass` (EXISTS, anon) | anon | bearer link leaks name+tier | decide: gate behind member login or keep anon; do NOT widen |
| medical/safeguarding reads | club/venue admin | over-broad PII read | narrowest (cohort/club) scope, **access audit-logged** (Hard Rule #9) |
| any club/member write | — | shared-token backdoor | authenticate via `auth.uid()`/`venue_admins`, NOT the shared `p_venue_token` |

A **standing membership-domain RLS/authorization suite** runs every phase.
