# E2E run prompt (paste this to kick off the exhaustive e2e session)

> You (the agent) do everything here, including starting the dev servers. The
> human just pastes this prompt.

---

EXHAUSTIVE E2E TEST — every app, every user type, every feature, every state. No stone unturned.

CONTEXT — read these first, in order, before writing anything:
- E2E_HANDOFF.md      (the harness, scenario matrix, run guide, caveats)
- DEMO_USERS.md       (the two sign-in accounts + what each covers)
- e2e/lib/auth.mjs, e2e/playwright.config.mjs, e2e/global-setup.mjs, e2e/specs/*
- CLAUDE.md           (methodology, hard rules)
Use the EXISTING harness. Do NOT rebuild auth — it injects a Supabase session as
storageState so every app boots signed-in (no UI login, no OTP). Config is .mjs
(root pkg is CommonJS). Accounts: alex = tarny+demo@lettrack.co.uk (superadmin /
HQ super_admin / venue owner / squad admin / casual+competitive player / member of
BOTH combat clubs); sam = tarny+family@lettrack.co.uk (paused member / guardian of
junior Charlie / venue staff with booking caps only / plain player). Passwords are
in DEMO_USERS.md; they do not expire; global-setup re-mints a fresh session each run.

STARTING THE DEV SERVERS — YOU do this yourself, in the background, before testing
each app; do NOT ask the human to run anything:
- `cd /Users/tarny/platform/apps/<app> && npm run dev` (run_in_background), wait for
  "ready", confirm the port responds, then run that app's e2e project.
- Ports: inorout 5173, clubmanager 5174, superadmin 5175, venue 5176, hq 5177,
  ref 5180, display 5181. league clashes with hq on 5177 — run it separately.
- Start only the app(s) you're currently testing; kill servers when done.
- Confirm each app's dev .env points VITE_SUPABASE_* at the live project before relying on it.

GOAL: a complete, passing e2e suite that proves every seeded scenario renders AND
behaves. Treat the seed (migs 363–365) as the source of truth for what must appear.

RULES OF ENGAGEMENT:
1. RUN every spec you write against a live dev server and make it PASS before moving
   on. A spec that isn't executed doesn't count. `npm run e2e -- --project=<name>`.
2. This runs against the LIVE demo DB and alex has write powers. For mutating flows,
   prefer reversible self-service actions and CLEAN UP after (cancel the booking you
   made, etc.), or create a Supabase branch and point VITE_SUPABASE_* at it. Never
   leave the demo seed mutated. Never touch non-demo rows.
3. Each spec must assert THREE things where applicable: (a) the seeded data renders
   (exact names/counts/amounts/states from the seed), (b) a happy-path action works
   end-to-end, (c) a negative/edge case behaves (gated control hidden, validation
   fires, capability denied).
4. Add new projects to playwright.config.mjs as needed (per app × role). Keep specs
   under e2e/specs/. Don't commit e2e/.auth or report/.
5. If a screen is empty/thin or a flow is broken, that's a FINDING — log it (file +
   what's missing) and, if it's a real bug, fix it following AUDIT→EXECUTE→VERIFY and
   note it; if it's just missing demo data, add a small follow-up seed (mig 366+).
6. NOTE the time-relative seed: class sessions/appointments were seeded as now()+
   intervals on the seed date, so "today's" session may now read a day or two old.
   Everything still exists; assert on existence/state, not on it being literally today.
   (If you want a fresh same-day timeline, add a tiny mig to re-base the session times.)

EXHAUSTIVE COVERAGE CHECKLIST — write specs until every box is proven:

CONSUMER APP (inorout)
  alex — squad as ADMIN (5-a-Side FC): roster, set availability in/out, open next
    week, results, payments/owed, POTM, reminders; squad as PLAYER (Competitive FC);
    multi-context switch between squads + both clubs; club member surfaces: classes
    timetable + book a session + see it on the pass + cancel it, waitlist/offer
    states, class-pass balance, PT /book flow + an appointment, FIGHT RECORD (boxing
    W-L-D + sparring excluded), GRADING/belts (martial arts, via multi-context),
    membership pass + status.
  sam — paused-membership state shown correctly; GUARDIAN home → child Charlie;
    book a class ON BEHALF of the child; child junior sparring record; safeguarding/
    profile fields (consent, emergency contact, medical/allergies); plain player view.
  negative — a signed-out context still gates correctly; member-only class blocks a
    non-member; OTP screen NOT shown when injected.

VENUE CONSOLE (venue)
  alex (owner) — Operations tiles; Bookings; Payments shows the seeded class/PT/
    package/room-hire/membership charges + outstanding total; Memberships (both
    combat clubs, all statuses incl paused/ending/cancelled); Classes: schedule list,
    session detail with the AGE ROSTER (Leo 13 etc., youngest-first), every booking
    state, check-in; Trainers + availability + appointments (upcoming/completed/
    no-show); Room hire inbox (confirm + pending enquiry + deposit states); Spaces;
    Customers; Teams/Players; Staff/Access; Leagues/Table; Equipment; QR.
  sam (staff, booking caps only) — CAPABILITY GATING: booking actions available,
    everything requiring manage_facility / manage_memberships / reverse_money etc.
    hidden or denied. Must-prove.

HQ (hq, alex super_admin) — company picker; utilisation incl. spaces/activity block;
  analytics incl. the classes drill-down + revenue (no double-count); class insights.

SUPERADMIN (superadmin, alex platform_admin) — gate passes; Engagement, Health,
  Teams (+ detail filters), Create Squad.

TOKEN-ONLY (no login) — smoke each with its demo token: reception display
  (display_token), referee (demo_league ref tokens), a player token route (/p/…),
  a membership pass route (/m/…), the public class timetable.

DELIVERABLE:
- All specs committed, all passing, projects wired in the config.
- A COVERAGE REPORT: a table of app × role × surface × pass/fail, the spec count, and
  every finding (missing data, bug, gap) with file refs and what you did about each.
- Confirm the demo seed is unmutated (re-run the seed leak/count checks) and the tree
  is clean. Commit + push. Update E2E_HANDOFF.md with what's now covered.

Be exhaustive. If you're unsure whether a surface is covered, it isn't — write the spec.
