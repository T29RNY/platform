# Match Fitness — remaining display-surface verification (next session)

*Picks up after the Match Fitness epic (PRs #259–#267, migs 475–478) shipped + is live + DARK.
The three MAIN surfaces are verified live (StatsView section, H2H, per-game card). This doc covers
the FOUR remaining surfaces (4/5/6/7) to verify/screenshot + one dead-code check.*

## Status: the covered surfaces (done)
- ✅ **Stats → MATCH FITNESS** (own totals + trend-with-axes + squad board) — `MatchFitnessSection`
- ✅ **Head-to-Head → "Who works harder"** (Per-game/Total toggle) — `HeadToHead` §6
- ✅ **Results → per-game card + Top Runner** — `PerMatchFitnessCard`
Screenshots: `demo-screenshots/live-0[1-8]*.png` + `match-fitness-all-surfaces.png` (mockup).

## Remaining — pick up here
Grep that enumerates every fitness-display file (source of truth):
`grep -rlnE "getMyMatchHealth|getMatchHealthForMatch|getMatchRoute|getH2hMatchFitness|getSquadFitnessLeaderboard|getMyShareMatchFitness|MatchRouteHeatmap" apps/inorout/src`

4. **Route heatmap** — `components/MatchRouteHeatmap.jsx`, shown when you tap **"View route"** on your
   own row of a per-game card. **Reachable** — Alex's `m_demo_21` (May 5) has a seeded route
   (`cs_mf_alex_21`). Only blocker last time: the Results → month-group → match-row expansion is
   flaky to script via `page.evaluate` (each header click toggles). Use **ref-based** `browser_click`
   from a fresh snapshot instead of text-matching, and expand in discrete steps.

5. **MyIO compact fitness card** — `views/MyIOView.jsx:776` (`MatchFitness`), rendered at ~L933
   `{health?.sessions?.length > 0 && …}`. **DID NOT surface** on the token-route MY IO tab (the
   "IO Intelligence" redesign) — the `29.0 mi` nodes found in the DOM were the mounted-but-hidden
   Stats tab. **ACTION: first confirm it isn't dead/superseded** (does the `health` fetch at L818 run
   on this route? is the L933 block still reached in the redesigned layout?). If alive, it likely
   only renders on the **fully-signed-in `/myio` (My Squads)** entry, not the `/p/TOKEN` backdoor.

6. **Profile "Match fitness" sharing toggle** — `views/PlayerProfile.jsx` (`getMyShareMatchFitness` /
   `setShareMatchFitness`, mig 457). Signed-in-only. On the token route the avatar opens the
   **context switcher**, not this settings screen. Reach it via the fully-signed-in profile/settings
   route. Also a **write** surface (consent switch) — worth a quick toggle test.

7. **First-attach "share your fitness?" prompt** — `PerMatchFitnessCard` (PR #6). Only fires after a
   real HealthKit attach → **can't be shown live without a watch**. Mockup only
   (`match-fitness-all-surfaces.png`). No action unless we mock the attach.

## How to drive the live app (repeatable — the OTP workaround)
Consumer app is **email-OTP only** (code → `tarny@lettrack.co.uk` inbox), so headless sign-in uses a
temp password + GoTrue password grant:
1. `UPDATE auth.users SET encrypted_password = extensions.crypt('<pw>', extensions.gen_salt('bf')) WHERE email='tarny+demo@lettrack.co.uk';`
2. In Playwright on the app origin: `fetch('https://ktvpzpnqbwhooiaqrigm.supabase.co/auth/v1/token?grant_type=password',{headers:{apikey:<anon>},body:{email,password}})` → write the session to
   `localStorage['sb-ktvpzpnqbwhooiaqrigm-auth-token']` → reload.
3. Casual `team_demo` view = `/p/p_demo_alex_token` (getSession() still returns the auth session, so
   fitness readers fire). **For #5/#6 use the fully-signed-in My Squads route** (`/feed` → squad →
   `/myio`, and the profile-settings route), NOT the token backdoor.
4. **Preview deploys are Vercel-SSO-gated** (can't screenshot) → verify on prod after merge, or wire a
   Vercel protection-bypass token.
5. **Remove the temp password after:** `UPDATE auth.users SET encrypted_password = NULL WHERE email='tarny+demo@lettrack.co.uk';` (OTP/Google login is unaffected either way).

## Demo data (live on team_demo)
- migs **477** (seed) + **478** (enrich) — Alex + Sam + Dave/Mike/Steve/Liam/Callum backed by
  `d0d00000-…-0000000000{02,03,04,06,07}` auth users; consent on; `mf_demo_1/2` + `m_demo_16..21`
  fitness (`cs_mf_*`). **Revert:** `478_down` then `477_down` (clears all `cs_mf_%` + the 5 auth users).
- Demo login: **Alex Demo** `tarny+demo@lettrack.co.uk` (OTP to `tarny@lettrack.co.uk`).

## Paste-ready next-session kickoff
> Resume Match Fitness surface verification from `MATCH_FITNESS_REMAINING_SURFACES_HANDOFF.md`.
> First confirm the MyIOView `MatchFitness` card (#5) isn't dead post-"IO Intelligence" redesign,
> then drive the fully-signed-in app (password-grant trick) to screenshot #4 route heatmap, #5 MyIO
> card, #6 profile toggle. Remove the temp demo password when done.
