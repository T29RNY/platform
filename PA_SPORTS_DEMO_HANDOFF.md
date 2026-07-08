# PA Sports — Pilot Club Demo (build sheet + go-live + reusable template)

**Status:** 🏁 Built & live on prod DB (migs 505–509, applied 2026-07-08).
**What it is:** the *real* PA Sports club in pre-launch state — real name, branding,
grounds, pitches, teams, staff, coaches, schedule. **Only the players are demo**;
they swap for real families/players at go-live with zero structural rebuild.

This doc doubles as the **repeatable Club Provisioning playbook** — the venue pilot
that follows forks the same shape (see "Reusable template" at the end).

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
