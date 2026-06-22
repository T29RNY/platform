# Club Org & Team Structure — Epic Scope & Handoff

**Pilot backlog #2** (multi-age football club, 2026-06-22 feedback). Positioned as the
360Player + MatchDay Admin replacement. Wider-management demo **~2026-06-29**.

This doc is the single source of truth for the epic. Work the phases **one at a time**,
audit → execute → verify → commit per `CLAUDE.md`. Each phase has its own kickoff prompt
at the bottom — start a fresh session per phase.

**⚠️ Next free migration = 392.** (389 = Phase 1; 390 = Phase 2; 391 = Phase 3.)
Last updated: 2026-06-22, **Phase 1 SHIPPED (mig 389, f30c87b); Phase 2 SHIPPED (mig 390);
Phase 3 SHIPPED (mig 391)**.

---

## 1. WHY (the ask, in the operator's words)

A multi-age football club needs **clear org and team structure**: one club running **youth
and adult** teams, **girls and boys** teams, cleanly separated but under one roof. On top of
the structure:

- The structure creator should **visually make sense as an org chart**.
- Teams need **prioritisation** — within an age group, one team can rank above the rest
  (not always, but possible). (Also pilot backlog #6.)
- Each **team manager** (e.g. U7A and U7B) sends comms to **their own** players/guardians;
  the **club** can send a broadcast to everyone.
- Each **team needs a join link + QR code**. Scanning starts a join flow that **checks for a
  membership**; if none, it runs the new player through **full registration (the "360Player
  bits")** and **pays the relevant membership**.
- Memberships should be **pro-rated** for anyone joining after the official season start —
  and the **club decides the rule**, with the relevant calculation applied automatically.

---

## 2. WHAT ALREADY EXISTS (audit findings — verified against live DB 2026-06-22)

**The data spine is already built and seeded — it's just invisible in the UI.**

Live hierarchy (⚠️ `SCHEMA.md` is stale here — it omits the age + nesting columns below):

```
clubs (text PK)
  └─ club_cohorts          ← AGE-GROUP layer. Has: name, description, min_age, max_age,
       │                      active, primary_official_id  (min_age/max_age NOT in SCHEMA.md)
       └─ club_teams       ← playing teams. cohort_id uuid NOT NULL (nesting already enforced;
            │                 NOT in SCHEMA.md). Columns: id, club_id, cohort_id, name, created_at
            ├─ club_team_members   (member_profile_id, is_active)
            └─ club_team_managers  (member_profile_id, role: manager|assistant_manager|coach)
  └─ club_sessions         (cohort_id + nullable team_id — training/fixtures)
```

**Two unrelated "team" tables — do NOT confuse:**
- `club_teams` (membership/club domain) = what the pilot means ("U12 Lions"). **This epic.**
- `teams` (text PK, league/casual domain) = the In-or-Out availability/POTM squad.
  **Leave untouched** — touching it ripples into casual flows for zero benefit.

**Dormant / partially-built pieces we will reuse:**
- RPCs `club_create_cohort`, `club_update_cohort`, `club_list_cohorts` **exist** but are
  called by **zero screens** except `clubListCohorts` (filter chips in venue
  `SessionsView.jsx:109`). No admin UI creates/edits a cohort.
- **No `club_create_team` RPC exists at all** — `club_teams` rows are only ever created by
  seed migrations. No create path in the product.
- Comms: `club_send_announcement(venue_token, club_id, title, body, audience, cohort_id,
  team_id)` exists — venue-admin only, audience ∈ club|cohort|team. **No manager-scoped**
  announcement RPC (a team manager cannot message their own team yet).
- QR/onboarding: `invite_links(code, entity_type, entity_id, action, active, expires_at,
  max_uses, use_count, label, created_by, created_at)` + `venue_manage_invite_links` +
  `resolve_invite_link` + `react-qr-code`. `action='join_team'` exists **but points at the
  casual `teams` table, not `club_teams`** — needs extending.
- Registration ("360Player bits"): full member registration + child/guardian capture
  **exists** (`member_register_child`, `member_self_signup`, `get_venue_signup_tiers`,
  full-registration mig 282).
- Payments: Stripe rails **built but DORMANT** (live keys off; test mode works).
- `venue_membership_tiers.audience` (all|adult|junior|family) is a **billing-only** notion,
  **not linked** to cohorts — a parallel youth/adult axis. Leave as-is.

**Demo data (live, `club_demo` "Finbar's FC"):** cohorts Adults, Juniors, U12s (10–12);
2 club_teams. Boxing/MA demo clubs have Juniors + Adults cohorts. Structure is demonstrable.

---

## 3. THE GAP (what's missing)

1. No admin UI to **create/edit/list age groups** (RPCs dormant).
2. No **create path for teams** at all (no RPC, no UI).
3. No explicit **Youth/Adult** label (only two nullable age ints, mostly blank).
4. No **Girls/Boys/Mixed** tag on a team (gender exists only per-person).
5. No **priority** ranking on teams.
6. No **org-chart view** — structure surfaces only as a count + filter chips.
7. No **helper text** on club/team/membership setup inputs (forms are bare).
8. Join links/QR not wired to club teams; no **membership-gated join** orchestration.
9. No **team-manager → own-team** comms.
10. No **pro-rating** of memberships for mid-season joiners (does NOT exist today).

---

## 4. DESIGN DECISIONS (settled with operator 2026-06-22)

- **Age group** (`club_cohorts`) carries an explicit **type**: `youth | adult | mixed`
  (admin picks it; ages stay optional metadata). Drives a clear badge.
- **Team** (`club_teams`) carries **gender/stream**: `girls | boys | mixed`, and a
  **priority rank** within its age group (⭐ = top). Gender lives on the **team** so one age
  group can hold both a Girls and a Boys team.
- The structure creator is a **visual org chart** (club → age group → team tree), editable
  in place.
- **Helper text + an example on every admin input** across the new screens AND the existing
  club/membership setup forms.
- Comms: club broadcast + admin cohort/team targeting (exist) **plus** new
  team-manager-to-own-team messaging.
- **Pro-rating is club-configurable per tier**: basis `none | monthly | weekly | daily`,
  uses the tier's existing season start/end, optional one-off **joining fee**. Calculation
  applied automatically.

---

## 5. PHASES

Order = demo-critical first. The 29th realistically shows **Phases 1–3** end-to-end
(payment in Stripe **test mode**); Phases 4–5 land just after.

### Phase 1 — Structure (venue console) · ✅ SHIPPED (mig 389, commit f30c87b, 2026-06-22)
Delivered exactly as scoped: `club_cohorts.category`, `club_teams.gender/priority_rank/
archived_at`; new RPCs `club_create_team`/`club_update_team`/`club_list_teams`/
`club_archive_team`; `p_category` on create/update cohort + `category` in the cohort list
shape; JS wrappers + barrel; **Structure** tab in venue MembershipsView (org-chart tree,
create/edit/archive, helper text + example on every input); membership-plan helper text;
SCHEMA.md fixed. Gates: rpc-security PASS (7), EV 11/11 + leak 0, build clean, Playwright
smoke 0 errors. ⛔ owed: real-device venue walk. **Original scope (kept for reference):**
**Migration 389** (was mistakenly "388"; additive, no renames/drops):
- `club_cohorts.category text` CHECK `youth|adult|mixed` (nullable; backfill demo rows).
- `club_teams.gender text` CHECK `girls|boys|mixed` (nullable).
- `club_teams.priority_rank int` (nullable; lower = higher priority within cohort).
- New venue-token SECURITY DEFINER RPCs (pattern: `venue_admins` + `manage_memberships`,
  audit_events insert per Hard Rule #9): `club_create_team`, `club_update_team`,
  `club_list_teams`, `club_archive_team` (soft). Extend `club_create_cohort` /
  `club_update_cohort` to accept `p_category`.
- JS wrappers + barrel exports.

UI: new **Club Structure** screen in `apps/venue` (MembershipsView area) — org-chart tree;
create/edit age groups (type + optional ages) and teams (gender + priority); helper text +
examples on every field. Wire the dormant cohort RPCs. Retro-fit helper text onto existing
club + membership-tier setup forms.

Gates: rpc-security-sweep, ephemeral-verify, hygiene. **Venue app only → no casual-regression.**

### Phase 2 — Team join link + QR · ✅ SHIPPED (mig 390)
Delivered: `invite_links` widened to `entity_type='club_team'` + a **distinct**
`action='join_club_team'` (kept out of the casual `/join` flow); `resolve_invite_link`
+ `redeem_invite_link` club_team branches; new `club_ensure_team_invite_link` get-or-create
(club-domain ownership via `club_venues`) + JS wrapper/barrel; per-team **"Join link / QR"**
action in the Structure screen (react-qr-code + reused `printAssets.js` poster/table-talker);
consumer `InviteResolve` resolved-context screen for `join_club_team` (real join = Phase 3).
The generic `venue_owns_entity` / QR-codes panel was deliberately NOT extended — the
Structure screen owns one canonical code per club team. Gates: rpc-security 3/3, EV 8/8 +
leak 0, builds clean, Playwright smoke on demo venue PASS. ⛔ real-device venue walk owed.
**Decision note:** the original scope suggested reusing `action='join_team'`; shipped with a
separate `join_club_team` for clean dispatch + isolation from the casual squad flow.

### Phase 3 — Membership-gated join · ✅ SHIPPED (mig 391)
Delivered: 2 RPCs — `club_team_join_context(p_code)` (anon+auth resolver: club-team code →
team/cohort/club + the club venue's `venue_landing` code + signed-in self/children membership
& on-team status; statuses incl. `signup_not_configured`) and `member_join_club_team(p_code,
p_for_profile_id)` (authenticated-only writer; **server-side active-membership gate** at the
team's venue → else `no_membership`; idempotent `club_team_members` insert + audit; self or
accepted child). Consumer: new **`ClubTeamJoin`** screen replaces the Phase 2 placeholder in
`InviteResolve` (`/q/<code>`) — resolve → sign in → membership check → (if none) **reuse
`MembershipSignup`** verbatim, keyed on the venue_landing code (register incl. child/guardian
→ tier `get_venue_signup_tiers` → pay Stripe **test mode**, live off) → assign team →
`redeem_invite_link` post-join. Already-members / registered children get a one-tap "Join".
Minimal additive edits: `MembershipSignup` gained `clubTeamCode` + `onEnrolled`;
`stripeInitMemberCheckout` + `api/stripe-member-checkout.js` gained optional `returnCode`
(paid joiner returns to the club-team screen). Self-heals on re-scan (gate sees the now-live
membership), covering a Stripe payer who closes the tab. **Design note:** assignment is
client-side on return + idempotent rather than threaded through the Stripe webhook — keeps
the Stripe rails byte-identical while DORMANT; revisit if guaranteed-without-return is needed.
Gates: rpc-security 2/2 PASS, EV 12/12 + leak 0, build clean, hygiene 7/7, casual-regression
PASS via additive-diff (no casual surface touched), Playwright smoke PASS on demo. ⛔ owed:
real-iPhone walk (member flow, Hard Rule #13).

### Phase 4 — Team-manager comms · ~1 day + tests · 🟠 just after
- New `club_manager_send_announcement(p_team_id, title, body)` — authenticated, manager-of-
  team check (mirrors `club_manager_*` RPCs), delivers to that team's players/guardians.
- UI in `apps/inorout` SessionsScreen (manager view).

Gates: rpc-security-sweep, ephemeral-verify; **apps/inorout/src → casual-regression +
real-iPhone walk**.

### Phase 5 — Pro-rating (club-configurable) · ~1.5 days · 🔴 after
- Per-tier config: `proration_basis text` CHECK `none|monthly|weekly|daily`,
  `joining_fee_pence int` (uses existing `season_start`/`season_end`).
- First-charge calculation in the membership-creation path; show the breakdown at checkout.

Gates: rpc-security-sweep, ephemeral-verify.

**Total ≈ 6–8 build days.**

---

## 6. INVARIANTS / GUARDRAILS

- Never touch the `teams` (league/casual) table or casual flows.
- All new writes via venue-token (admin) or authenticated manager-check (manager) SECURITY
  DEFINER RPCs; REVOKE anon where not needed; audit_events insert on every fire-and-forget.
- Additive columns only — no rename/drop (no schema-sync trigger).
- Stripe stays in **test mode** until the operator flips live keys.
- Update `SCHEMA.md` for the stale `club_cohorts`/`club_teams` columns in the Phase 1 commit.
- Update FEATURES.md / DECISIONS.md / BUGS.md per phase.

---

## 7. NEXT-SESSION KICKOFF PROMPTS

> **Phases 1–3 SHIPPED (migs 389/390/391).** Next session = **Phase 4** (jump to it below).
> The Phase 1–3 prompts are kept for history.

### → Phase 1 (✅ SHIPPED — mig 389)
```
Read CLUB_STRUCTURE_HANDOFF.md in full, then CONTEXT.md and BUGS.md.
We are building Phase 1 — Structure (venue console) of the club org/team epic.

AUDIT FIRST (plan mode, no edits): confirm the live columns on club_cohorts and
club_teams, the exact grant pattern on club_create_cohort / club_list_cohorts, the
MembershipsView ClubTab + venue SessionsView cohort code, and where the dormant
clubCreateCohort/clubUpdateCohort wrappers sit. Confirm next free migration is still 388.

Then propose the Phase 1 execute plan:
- Migration 388: club_cohorts.category (youth|adult|mixed), club_teams.gender
  (girls|boys|mixed), club_teams.priority_rank int; new venue-token RPCs
  club_create_team / club_update_team / club_list_teams / club_archive_team; extend
  club_create_cohort + club_update_cohort with p_category; backfill demo rows.
- JS wrappers + barrel exports.
- New Club Structure org-chart screen in apps/venue (create/edit age groups + teams,
  Youth/Adult + Girls/Boys/Mixed + ⭐ priority), helper text + examples on every input;
  retro-fit helper text onto existing club + membership-tier setup forms.

Mandatory gates before commit: rpc-security-sweep, ephemeral-verify (live-DB, auto-
rollback, leak-check 0). Venue app only → casual-regression NOT required. Build clean,
hygiene 7/7. Update SCHEMA.md (stale cohort/team columns) + FEATURES.md in the same commit.
Show me each diff before committing.
```

### → Phase 2 (✅ SHIPPED — mig 390)
```
Read CLUB_STRUCTURE_HANDOFF.md. Phase 1 is merged. Build Phase 2 — Team join link + QR.
AUDIT FIRST: invite_links schema, venue_manage_invite_links, resolve_invite_link, the
react-qr-code + tournament poster/print pattern. Then plan extending invite_links to
entity_type='club_team' + per-team join-link/QR UI in the structure screen + printable QR.
Gates: rpc-security-sweep, ephemeral-verify. Confirm next free migration before writing SQL.
```

### → Phase 3 (✅ SHIPPED — mig 391)
```
Read CLUB_STRUCTURE_HANDOFF.md. Phases 1–2 merged. Build Phase 3 — Membership-gated join.
AUDIT FIRST: member_self_signup, get_venue_signup_tiers, member_register_child + the 360
registration flow, the Stripe test-mode path, club_team_members assignment. Then plan the
public join page (scan → membership check → register → pick tier → pay test-mode → join
team) + orchestration RPC(s). Gates: rpc-security-sweep, ephemeral-verify, casual-regression,
real-iPhone walk (touches member flow). Confirm next free migration before writing SQL.
```

### → Phase 4 (START HERE — Phases 1–3 merged)
```
Read CLUB_STRUCTURE_HANDOFF.md. Build Phase 4 — Team-manager comms.
AUDIT FIRST: club_manager_* RPC pattern (manager-of-team auth.uid check), club_send_
announcement, SessionsScreen manager view. Then plan club_manager_send_announcement
(p_team_id,title,body) + SessionsScreen UI. Gates: rpc-security-sweep, ephemeral-verify,
casual-regression, real-iPhone walk (apps/inorout/src). Confirm next free migration first.
```

### → Phase 5 (after Phase 4 merged)
```
Read CLUB_STRUCTURE_HANDOFF.md. Build Phase 5 — Pro-rating (club-configurable).
AUDIT FIRST: venue_membership_tiers (season_start/season_end), the membership-creation
charge path, get_venue_signup_tiers. Then plan per-tier proration_basis
(none|monthly|weekly|daily) + joining_fee_pence + first-charge calculation + checkout
breakdown. Gates: rpc-security-sweep, ephemeral-verify. Confirm next free migration first.
```
