# Club Manager — Go-Live Runbook (PR #12 / G5)

*Drafted 2026-07-08. The autonomous build is done (11/12 PRs merged); everything below is
**human intent** — real children's data reaching production. Work top-to-bottom; each step
names its **owner**, the **gate** it clears, and how to **verify** it. Nothing here is code
the loop can run — these are deliberate operator actions.*

**Reference tenant:** PA Sports (navy/gold). **Do NOT repoint the demo/seed rows** — the real
club is provisioned as its own fresh tenant (HR#15). The demo club stays a demo.

---

## 0. Where we are (shipped, not live-to-a-real-club)
- ✅ Admin console `apps/clubmanager` built: Home · People · Structure · Schedule · Memberships ·
  Comms · Club page · Safeguarding · Season rollover. Live at `platform-club-admin.vercel.app`.
- ✅ Coach `/hub` native companion: Tonight · League · People · Matchday · Squad (reliability + Smart-Teams).
- ✅ Migrations 515/516/517 applied to live DB. ✅ G3 DPIA approved (2026-07-08).
- ⛔ **Not yet:** on the in-or-out.com domain · manual clubmanager redeploy of the latest console
  code · real-iPhone `/hub` walks · App Store privacy metadata · Stripe live keys · a real club tenant.

---

## 1. Clear the compliance gate (G3) — final paperwork  · owner: operator/DPO
- [ ] Physically initial Parts A–D of `CLUB_MANAGER_DPIA_AND_SAFEGUARDING_PACK.md` (approval already
      recorded in DECISIONS.md + GO_LIVE_ISSUES.md; this is the audit-trail signature).
- [ ] Confirm the four `GO_LIVE_ISSUES.md` safeguarding boxes stay ticked.
- **Gate cleared:** real child special-category / DBS / flag data may be exposed to a real club.

## 2. Domain + SSO — put the console on in-or-out.com  · owner: operator (DNS + Vercel)
- [ ] Add DNS `club.in-or-out.com` (or `admin`/`manage`) → the **`platform-club-admin`** Vercel project.
- [ ] Add the domain in the Vercel project settings.
- [ ] Set env **`VITE_AUTH_COOKIE_DOMAIN=.in-or-out.com`** on `platform-club-admin`
      (use `vercel env add … --value .in-or-out.com --force` — the piped-value form creates it EMPTY).
- [ ] Rebuild `apps/clubmanager` with `.env.local` public creds → `vercel deploy --prod` from `dist`
      (prebuilt-static = **manual**; this ALSO makes the #6/#10/#9/#11 console code live — see step 3).
- **Verify:** open `https://club.in-or-out.com`, sign in as the demo admin, confirm navy/gold real data;
      confirm one sign-in now carries across the console ↔ the native `/hub` (shared cookie).
- **Do NOT** rename `platform-clubmanager` (that Vercel project = the LIVE inorout consumer app).

## 3. Manual clubmanager redeploy — make the latest console live  · owner: operator
> `platform-club-admin` is prebuilt-static — it does **not** auto-deploy on merge. The console
> changes from #6 (Memberships), #10 (Club page), #9 (Season rollover), #11 (Safeguarding) are on
> `main` but **not yet on the live URL** until a manual redeploy. (Folded into step 2's deploy.)
- [ ] After the step-2 `vercel deploy --prod`, run `/prod-verify` (supervised, demo surfaces) or walk
      the console yourself: People/Structure/Schedule/Memberships/Comms/Club-page/Safeguarding/Season-rollover
      all render real demo data with no console errors.

## 4. Real-iPhone `/hub` walks (HR#13) — owed on every native surface  · owner: operator (device)
> The web bundle already carries these; the walks confirm the on-device tap flows work (the
> "tap does nothing" class the build gate can't see). Do these on a real iPhone in the native app:
- [ ] **#4 coach tabs** — Tonight (availability board) + People (roster + medical flag).
- [ ] **#8 Matchday** — tap a fixture → pick XI → log score + per-player goals/assists/cards + POTM → save; reopen, confirm it persisted.
- [ ] **#7a Squad** — reliability board renders; Smart-Teams balancer produces two sides.
- [ ] **Guardian track** — a parent sets their child's in/out + sees the child's week.
- **Any defect → open a `/dev-loop` fix phase before proceeding.**

## 5. App Store metadata — child data now flows through the store app  · owner: operator (Apple)
- [ ] Update **App Store "App Privacy"** data-collection details to reflect children's
      special-category / safeguarding data (DBS, youth rosters, matchday).
- [ ] Review the **app age rating**.
- [ ] Note: pure web-bundle `/hub` screens ship without review; **only a new native binary triggers
      Apple review** — and while a build is in review the **auth/native freeze re-imposes** (HR#13).
      Don't submit a binary at launch unless you must.

## 6. Stripe live keys (G4) — out of loop scope, operator flips  · owner: operator
- [ ] Swap **live** Stripe keys + the project's **own `whsec`** into the `platform-club-admin` env
      (built + tested in test mode; see `project_stripe_test_cleanup`).
- [ ] Delete the sandbox webhook; confirm `STRIPE_CONNECT_*` URLs unchanged.
- **Verify:** one live membership join → Stripe test-then-live smoke on a throwaway/refunded charge.

## 7. Provision the real club as its OWN tenant  · owner: operator  🚦 the real go-live act
- [ ] Onboard the real club with **fresh** `clubs` / `venue_admins` provisioning (mirror
      `self_serve_create_venue`) — **never repoint the demo/seed rows** (HR#15; no `_e2e_`/demo ids).
- [ ] Designate the club's **Safeguarding Lead** (grant the `safeguarding_lead` cap on their
      `venue_admins` row — owner/manager are NOT auto-Leads).
- [ ] Set the club's real branding + white-label colours on the Club page.
- [ ] Enable the club features the club needs (`public_web`, `memberships`, `competition`, …).

## 8. Final prod-verify on the real tenant  · owner: operator (supervised)
- [ ] Admin signs into `club.in-or-out.com`, sees their real club.
- [ ] A coach signs into the native `/hub`, sees their team + can run a matchday.
- [ ] A parent RSVPs their child; the coach sees the count.
- [ ] The public `/c/<slug>` page renders with U18 protections intact (minors first-name + initial, no photo).
- [ ] Safeguarding board: DBS R/A/G correct; the Lead (only) can see the open-concerns count.

---

## Deferred (NOT blockers for go-live — separate scoped work)
- **#7b Gaffer club-context** (dark AI panel) — filed to FEATURES.md.
- **#7c adult-player self-serve `/hub` track** — an adult club player has no personal in/out + stats
  surface yet; the strategic engagement play, a real new build (operator decision).
- **Welfare-officer name** on the safeguarding board (needs a venue-token committee reader = tier-3).
- **Enforced** DBS-to-youth-assignment block (currently display-only warning; product + legal).
- **Count-only safeguarding-concerns reader** (defense-in-depth hardening — GO_LIVE_ISSUES.md).

## Rollback / safety
- Migrations 515/516/517 each ship with a `_down.sql`; all are additive (new RPCs/tables) — a rollback
  drops them without touching existing data.
- The console is a separate Vercel project; taking it down does not affect the live inorout app.
- Safeguarding boundaries are server-enforced (cert numbers withheld, flagged-incident content Lead-only +
  audited, minor rosters filtered) — independent of any client build.
