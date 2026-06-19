# E2E test harness & scenario plan

Reusable Playwright suite for full end-to-end testing across all apps and every
user type, using the two cross-role demo accounts (see `DEMO_USERS.md`).
**Built + verified session 152. Deep per-scenario specs written + all passing
session 153 — see "Coverage (session 153)" at the bottom.**

## Coverage (session 153) — 60 specs, 9 projects, all green

Run a project with its dev server up (ports in the table below):
`cd apps/<app> && npm run dev` then `npm run e2e -- --project=<name>`.

| Project | App · role | Specs | Surfaces proven |
|---|---|---|---|
| `venue-alex` | venue · **owner** | 21 | Operations, Payments (totals + class/PT charges), Classes (schedule, **age roster youngest-first**, check-in, packages), Memberships (members + **Grading belt ladders** + **Club** tabs), Trainers + Appointments, Room hire (enquiry + held deposit), Spaces, Bookings + cancellations, Customers, Staff, Access (capability matrix), Equipment, Leagues/Table, QR |
| `venue-sam` | venue · **staff** | 5 | GATE: Access nav hidden, **class mgmt server-denied (`insufficient_role`)**; booking surfaces available; membership read OK |
| `inorout-alex` | consumer · admin+player+member | 12 | squad home, **admin panel**, Stats, Results, multi-context (both clubs), **classes timetable + pass credits**, **fight record (W-L-D, sparring excluded)**, **grading/belts**, safeguarding/consents, **PT /book**, **membership pass** |
| `inorout-sam` | consumer · guardian | 7 | squad home, **guardian /parent-home → Charlie**, child link + consents, **child safeguarding edit (medical/allergies/collectors)**, child pass (Junior·Active), **paused membership → Frozen** |
| `hq-alex` | hq · super_admin | 4 | Dashboard (2 venues, venue health), Utilisation (**classes feed the spaces-activity block**), Analytics (venue comparison, incidents) |
| `superadmin-alex` | superadmin · platform_admin | 6 | gate passes, Activity feed, Engagement, Health funnel + reach, Teams directory, Create-squad form (not submitted) |
| `display-token` | display · token-only | 1 | token + PIN 1234 → live Matchday Wall |
| `ref-token` | ref · token-only | 1 | fixture ref_token → pre-match + both squads |
| `tokens` | inorout · anon | 3 | `/p/` player token, `/m/` pass (no login), NEGATIVE `/classes` gates a signed-out visitor |

**Mutation policy:** every spec is read-only or renders a non-submitting form. The
Create-squad, class-book, PT-book and money actions are asserted to *exist* but never
fired. Post-run seed leak-check = 0; seed row counts unchanged (only the intentional
additive mig 366).

**One fix shipped:** mig 366 linked the two combat clubs to demo_venue via
`club_venues` (the seed gap that blanked the venue Grading/Club tabs + the consumer
`/classes` venue). 3 low-priority cosmetic findings logged in `BUGS.md` (SESSION 153).

## How auth works (the key trick)
Every app uses one Supabase client with default persistence, so a session lives in
`localStorage["sb-ktvpzpnqbwhooiaqrigm-auth-token"]` for every origin. The suite
**mints a session via the password grant and injects it as Playwright
`storageState`** — so each project boots **already signed-in**, with NO UI login
and NO OTP. This is what makes the consumer app (OTP-only in the UI) testable
unattended. Mechanism lives in `e2e/lib/auth.mjs` + `e2e/global-setup.mjs`.

## Layout
```
e2e/
  lib/auth.mjs          mintSession() + storageStateFor() + USERS/ORIGINS/keys
  global-setup.mjs      mints alex.json + sam.json into e2e/.auth/ (gitignored)
  playwright.config.mjs projects per app×role
  specs/                *.smoke.spec.js (the seed; add scenario specs here)
```

## Running
Dev servers are NOT auto-started (8 apps, different ports). Start the one(s) you
need, then run its project:
```bash
cd apps/venue && npm run dev          # leave running
# repo root:
npm run e2e -- --project=venue-alex
npm run e2e -- --project=inorout-alex --project=inorout-sam
npm run e2e -- --ui                   # interactive
```
Ports: inorout **5173**, clubmanager 5174, superadmin 5175, venue 5176, hq 5177,
ref 5180, display 5181. ⚠️ league also defaults to 5177 (clashes with hq — run one
at a time). Projects defined: `venue-alex`, `hq-alex`, `superadmin-alex`,
`inorout-alex`, `inorout-sam`.

## Accounts → roles (storageState)
- **alex** `tarny+demo@lettrack.co.uk` — platform superadmin · HQ super_admin · venue **owner** · squad admin · casual + competitive player · member of **both** combat clubs (fight record + grading).
- **sam** `tarny+family@lettrack.co.uk` — plain member (paused) · **guardian** of junior Charlie · venue **staff** (booking caps only) · plain player.

## Verified this session ✅
- `venue-alex`: boots as owner, Classes shows seeded sessions (2 tests pass).
- `inorout-alex`: consumer app boots signed-in, member/profile route resolves.
- `inorout-sam`: consumer app boots signed-in as guardian.
- (`hq-alex`, `superadmin-alex` specs written — same injection mechanism, run next session.)

## Scenario matrix to cover next session
Each cell = a spec asserting the screen renders the seeded data + a happy-path action.

**Consumer app (inorout)**
- alex: My Squads (admin of 5-a-Side FC + player of Competitive FC) · availability in/out · POTM · payments owed · multi-context switch · **club member**: classes timetable + book, class-pass balance, PT/`/book`, **fight record** (boxing), **grading/belts** (martial arts via multi-context).
- sam: paused membership state · **guardian home** → child Charlie · book a class on the child's behalf · child junior sparring record · safeguarding/profile fields.

**Venue console (venue, alex owner / sam staff)**
- Operations · Bookings · Payments (the seeded class/PT/package/room-hire/membership charges) · Memberships (combat clubs) · Classes (sessions, **age roster**, check-in) · Trainers + appointments · Room hire inbox · Spaces · Staff/Access.
- sam (staff): assert capability gating — only booking-related actions available.

**HQ (hq, alex super_admin)** — utilisation, analytics incl. the classes/activity blocks, class insights.

**Superadmin (superadmin, alex platform_admin)** — gate passes; engagement/health/teams/create-squad.

## Caveats (read before running destructive specs)
1. **This runs against the LIVE demo DB.** Alex is a superadmin + owner with write
   powers — write/delete specs will mutate real demo rows. Prefer read + reversible
   self-service actions, or point at a Supabase branch/local stack for destructive flows.
2. **The OTP login flow itself is NOT covered** (injection bypasses it). For a real
   OTP pass, sign in manually — the code arrives at `tarny@lettrack.co.uk`.
3. Sessions expire ~1h; global-setup re-mints every run, so just re-run.
4. `e2e/.auth/` (minted sessions) and `report/` are gitignored — never commit them.
