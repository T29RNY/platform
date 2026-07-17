# PA Sports — Pilot Club Demo (build sheet + go-live + reusable template)

**Status:** 🔴 **NOT READY TO SEND (audit 2026-07-17)** — built & live on prod DB
(migs 505–512, applied 2026-07-08) but the demo has **aged out** and carries test
pollution. See **§0 Readiness audit** before sending logins to anyone.
**What it is:** the *real* PA Sports club in pre-launch state — real name, branding,
grounds, pitches, teams, staff, coaches, schedule. **Only the players are demo**;
they swap for real families/players at go-live with zero structural rebuild.

This doc doubles as the **repeatable Club Provisioning playbook** — the venue pilot
that follows forks the same shape (see "Reusable template" at the end).

---

## 0. Readiness audit — 2026-07-17 (blocks sending logins)

Audited before sending logins to PA Sports. Verdict: **not sendable as-is**. The
structure is sound; the failures are *data ageing* + *test pollution*, plus 3 genuine
platform bugs found along the way. Every row below was verified against the live DB
or reproduced — inferences are marked.

**Two corrections to the first pass (recorded so the mistakes aren't repeated):**
- `clubs` has **no `venue_id`** — the link is **`club_venues`**, and PA is on **two**
  venues (`pa_peugeot` + `seva_school`). A subquery `(select venue_id from clubs …)`
  silently resolves to the *outer* table and is **always true** → platform-wide counts.
- The public signup page is **not empty** (first-pass claim, inferred from BUGS.md).
  Calling `get_venue_signup_tiers('q_L8hbfm3fXy4')` live returns `ok:true` with exactly
  **one** tier — the fake `U8 Membership (Free) (demo)`. Worse than empty.

| # | Finding | Impact | Verified how | Fix | Effort | Value |
|---|---|---|---|---|---|---|
| 1 | **No live upcoming training for any real team** — only 2 future `scheduled` sessions, both "Test Booking" | 🔴 Blocker — weekly in/out loop empty for coach, parent, player | statuses are only `scheduled`/`cancelled`; counted per team | reseed from the 3 real series | M | **Critical** — this is the product |
| 2 | **Test team "U8 Lions" (Leo/Lena Lion) live on the public page** | 🔴 Blocker — fake kids on the client's page | invite `q_pau8demo`, `created_by: claude_demo_setup`, redeemed ×2 by `tarny+demo@lettrack.co.uk` | delete team + 2 profiles + cohort + tier + link | S | **Critical** |
| 3 | **Public signup offers ONLY the fake "U8 Membership (Free) (demo)"** — real Junior/Adult hidden (`self_signup` absent, reader fail-closed) | 🔴 Blocker — join flow sells demo junk | RPC called live on `q_L8hbfm3fXy4` | 2-row flag update + delete U8 tier | XS | **Critical** — best value/effort |
| 4 | **15 junk sessions + 2 junk series** — "Test Booking", "Test Clash", "Test1/2", "Wednesday Advanced T1" ×7 cancelled | 🟠 clutter; junk series **regenerates** if reseed runs first | id-prefix vs seed range; series created 2026-07-12 | delete series then sessions | XS–S | **High** |
| 5 | **Countdown off by one after midday** — "TOMORROW" for a game 2 days out; a game tomorrow says "TODAY" | 🟠 live on **every** club page | reproduced across the clock; `clubPublicSections.jsx:143-148` measures from `Date.now()` not today's midnight | code fix (dev-loop) | S | **High** — platform-wide |
| 6 | **Past games stuck under "UPCOMING"** — three 12 Jul fixtures | 🟠 looks broken | `clubPublicSections.jsx:211-213` filters on status only, no date guard | enter results (data) | XS | **High** — also enriches form guide |
| 6b | ↳ renderer date guard | 🟠 recurs for any club | same | **needs product call** — past+`scheduled` may be a postponement, not a missing result; "result pending" may be truer than hiding | S + decision | Medium |
| 7 | **"PLAY FOR US → Get started" does nothing** — scrolls to itself | 🟠 dead primary CTA | `ClubPublicScreen.jsx:80` — `website \|\| "#get-involved"`; PA has no website | set `socials.website` → join link | XS | **High** — *only after #3* |
| 8 | **41 of 68 charges overdue** (37 unpaid + 4 partial past due) — seed intended 6 | 🟡 club looks insolvent | re-scoped via `club_venues`; `seva_school` has zero charges | re-age `due_date` | XS | Medium — optics |
| 9 | **`stripe_connected: false`** | 🟡 no real payment in money walk | same RPC call | client onboarding, needs PA's bank details | L | Low now / **Critical at go-live** |

**Verified healthy** (do not rebuild): all 5 logins exist + confirmed + correctly wired
(Pav→admin · Nihal→coach U7 Dortmund · Harpreet→parent of Rhian, U7 Dortmund ·
Sonny→Mens · Jas→staff). Public page published, crest set (closes the old §4 item),
branding/sponsors/events/docs/news render. 3 real teams, 34 members, committee,
2 leagues, results + form guide intact. **The 3 real series are alive and run to
2027-07-08** (U7 Dortmund Wed 17:00 · U7 Milan Wed 18:00 · Mens Thu 20:00, all
`seva_school`) — only the concrete sessions ran out, so the reseed *generates from
what already exists* rather than inventing a schedule.

### Work order (dependency-driven, not severity-driven)

FK rules force most of this. `club_sessions.team_id → club_teams` is **NO ACTION**
(can't drop a team while sessions reference it); `venue_memberships` is **NO ACTION**
on profile *and* tier *and* cohort (must go first); `club_teams.cohort_id → club_cohorts`
is **CASCADE** (dropping the cohort would silently take the team with it — drop the
team first so the cascade is a no-op); `club_fixtures.club_team_id` is **SET NULL**
(orphans rather than deletes).

- **P0 — safety.** Re-verify next free migration vs `origin/main` (**597** at audit
  time; 596 is on main). Write the purge/reseed as a numbered migration **with a paired
  `_down.sql`** (Hard Rule 11) and dry-run in a rolled-back txn first (§6 golden rules).
- **P1 — code fix #5 → PR (start FIRST, longest lead time).** Independent of all data
  work; needs PR → CI → merge → Vercel deploy before the demo is sent. Runs in the
  background while P2–P5 proceed.
- **P2 — purge (#4, #2, U8 tier from #3).** Junk **series** before junk sessions, else
  the reseed regenerates them. Leaf-first: `venue_memberships` → charges → team_members
  → profiles (Leo/Lena) → sessions → series → invite link → team → tier_prices/tier →
  cohort **last**.
- **P3 — reseed (#1).** Generate concrete sessions from the 3 surviving series through
  the agreed end date. ⏰ **`generate_series(DATE,DATE,INTERVAL)` returns TIMESTAMPTZ →
  `AT TIME ZONE` runs backwards and drifts an hour across a clock change — cast `d::date`
  first.** End-Sept stays inside BST and never crosses it; **anything past 25 Oct 2026
  crosses BST→GMT and the trap bites.**
- **P4 — backfill (#6 results, #8 charge re-age).** After P2 so only surviving rows are
  touched.
- **P5 — wire (#3 flags, then #7 CTA).** #7 **must** follow #3 or the CTA just routes
  them to the demo tier faster.
- **P6 — verify.** Re-walk the public page, re-run the 5 persona checks, leak-check for
  test remnants, confirm #5 is actually deployed and the label reads correctly.
- **Parked:** #6b (product decision) · #9 (blocked on PA's bank details).

**Open question for the operator:** how far ahead should the schedule run? Recommend
**end of September** — long enough that the demo can't expire mid-conversation, and it
stays inside BST (see the P3 trap).

---

## 1. What was built

| Layer | Detail |
|---|---|
| **Operator** | company `company_pa_sports` (shared `company_id` → cross-site scheduling) |
| **Grounds** | `pa_peugeot` (Pinley House, 2 Sunbeam Way, CV3 1ND) · `seva_school` (Eden Rd, Walsgrave on Sowe, CV2 2TB) |
| **Pitches** | PA Peugeot: 2× 11-a-side grass + Cricket Pitch (inactive, "coming soon"). Seva: 1× 4G (7-a-side) |
| **Club** | `club_pa_sports` "PA Sports" (short **PA**), discipline football, contact Pav Somal |
| **Branding** | `club_pages`: navy `#1E2A4A` / gold `#C6A44E`, tagline "Play. Learn. Compete. Together.", Instagram `pa_sportsfc`. Crest URL **pending logo upload** |
| **Committee** | Pav (Secretary), Ranvir (Chair), Gurchetan (Treasurer), **Jas (Welfare Officer)** |
| **Cohorts** | Under 7s (youth) · Mens (adult) |
| **Teams** | U7 Dortmund, U7 Milan (youth + guardians) · PA Sports Mens (adult, FA league) |
| **Coaches** | Dortmund → Nihal · Milan → Gurbinder · Mens → Inderpal (mgr) + Iknam (coach). All with enhanced DBS |
| **Players** | 9 kids + 9 guardians per U7 team; 16 Mens players (all **demo** — swap at go-live) |
| **Training** | Wed 5–6pm U7 Dortmund + 6–7pm U7 Milan @ Seva 4G; Thu 8–9pm Mens @ Seva. Recurring series + next 2 weeks of concrete sessions (for in/out) |
| **Fixtures** | Mens FA Sunday league (2 played w/ scores + 2 upcoming, home games on PA Peugeot Pitch 1); U7 Dortmund & Milan mini-soccer fixtures |
| **In/Out** | Both training (session RSVP) and matches (fixture availability) — adults for themselves, **guardians on behalf of kids** |
| **Activity** *(mig 510)* | Past training + attendance marked, in/out RSVPs on all upcoming training, availability on all upcoming fixtures, 4 played Mens games (form guide), Player-of-the-Month per team, 3 club announcements |
| **Documents** *(mig 511)* | 4 club policies; signed consents (guardians for kids, players for self); proof-of-age ID docs (mixed approved/pending); guardian-confirmed medical reviews; photo-consent flags + sample medical notes on 2 kids — all placeholders |
| **Membership & content** *(mig 512)* | Junior/Adult membership tiers; a sub for every player (kids payable-by-guardian) with a paid/unpaid charge each (6 overdue for the finance screen); club shop (5 items); 3 sponsors; 3 events; 4 club documents; 1 news post |

All rows use deterministic ids so they remove cleanly:
`company_pa_sports` / `pa_peugeot` / `seva_school` / `club_pa_sports` (text) and the
`a5…` UUID range (a5a=pitches, a5c0=cohorts, a510=teams, a530=managers, a504=staff,
a501/a502/a503=demo people, a5d0/a5d1=schedule, a5b0/a5b1=leagues/fixtures,
a5f0=test logins, a5ad=operator rows).

---

## 2. Multi-role test logins (walk every persona)

All are **+aliases on the operator inbox** (`tarnysingh+…@gmail.com`) so every OTP
lands in one place. Each is wired onto a **real seeded person** — you walk live data.
**Password (all): `PaSportsDemo1!`** · In the consumer app use the **email code**
option, not Google (Google → your real identity, not the test role).

| Login | Role in app | Is (person) | Verified via `get_my_world()` |
|---|---|---|---|
| `tarnysingh+pa_admin@gmail.com` | Club/operator admin (Pav's view) | Pav Somal | 2 admin roles (owns both grounds) ✅ |
| `tarnysingh+pa_coach@gmail.com` | Coach | Nihal | 1 coaching team ✅ |
| `tarnysingh+pa_parent@gmail.com` | Guardian | Harpreet Sandhu | guardian of 1 child ✅ |
| `tarnysingh+pa_player@gmail.com` | Adult player | Sonny Athwal | Mens roster |
| `tarnysingh+pa_staff@gmail.com` | Staff + Welfare Officer | Jas | venue staff |

**Where each persona lives** (no dedicated Club Manager app yet — see §5):
- **Admin** → operator app (fixtures, pitches, assign coaches) + main app hub
- **Coach / Parent / Player / Staff** → main app `/hub` (role auto-resolved server-side)

---

## 3. Demo → Live switch (quick & simple, as designed)

**Structure, branding, schedule, grounds, teams and join codes all stay.** Going live is:

1. **Real people in:** hand each team its `member_join_club_team` code — families/players self-register into `club_team_members`.
2. **Demo people out:** run `507_pa_sports_demo_people_down.sql` (removes exactly the `a501/a502/a503` demo profiles + their rosters + guardian links; touches nothing else). Optionally drop the test logins with `509_…_down.sql`.
3. **Pav real admin:** when Pav signs in for real, grant his account `venue_admins` owner (replaces the `+pa_admin` test row).

**⚠️ Hard go-live gate for the KIDS only:** real under-18 data trips the safeguarding /
DPIA / APD sign-off (`GO_LIVE_ISSUES.md` — HARD GO-LIVE GATE). Demo kids are fine now.
**The adult Mens side has no such gate and can go fully live immediately.**

---

## 4. Outstanding

- [ ] **Upload the PA crest PNG** to the `club-media` bucket at `club_pa_sports/crest.png`, then set `club_pages.crest_url`. (Needs the logo file from the operator — only manual step.)
- [ ] **Real-device walk** of each persona in the native app (Hard Rule 13).
- [ ] Optional: confirm exact **FA league name/division** and rename `club_leagues` row (currently "Coventry & District Sunday League — Division Two").
- [ ] Optional: Mens training day/time (assumed **Thu 8–9pm**) and match day (assumed **Sunday**).

---

## 5. Known platform gap surfaced by this build

There is **no dedicated Club Manager app** — `apps/clubmanager` is a "coming soon" stub.
Club admin is currently split across the operator app + main app hub. A unified
Club-Manager front-end (desktop + mobile) is being **scoped separately** (see the
`/scope` run). This demo does **not** depend on it — it runs on the shipped apps.

---

## 6. Reusable template (for the venue pilot next)

The provisioning order that works, each step verified against live schema and
dry-run in a rolled-back transaction before apply:

1. **Operator + sites** — `companies` + `venues` (shared `company_id`) + `playing_areas`
2. **Entity + branding** — `clubs`/(venue) + `club_pages` (colours/crest/tagline/socials) + committee
3. **Structure** — cohorts + teams + staff/coach `member_profiles` + managers + DBS
4. **Demo people** — members/guardians/players via deterministic-id loops (a distinct id range = clean teardown)
5. **Schedule** — recurring series + concrete sessions + leagues + fixtures (dates relative to `current_date`)
6. **Test logins** — `+alias` auth users wired onto real seeded people, covering every role

**Golden rules that made it safe:** distinct deterministic id range per tenant;
`ON CONFLICT DO NOTHING` everywhere (idempotent re-run); a paired `_down.sql` per
migration; a rolled-back dry-run against live before every apply; verify + persona
`get_my_world()` check after.
