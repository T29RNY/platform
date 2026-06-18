# In or Out — Domain & Accounts Fresh Start (detailed runbook)

**Move the consumer app off the apex onto `app.in-or-out.com`, turn `in-or-out.com` into
the marketing landing page, move account ownership off the personal Gmail, and leave the
URL structure clean enough to wrap as a native app.** This is the last critical step
before wrapping the app.

> **DONE (s150).** The migration is complete and live (squad path real-device verified). The
> native wrap it unblocks (Phase 8) now has its own self-contained roadmap + next-session
> prompt: **`APP_WRAP_HANDOFF.md`**. Only deferred housekeeping (5.3 delete dead `inor-out`,
> 5.4 drop the temp apex entry from Supabase Auth) remains here — both off the critical path.

---

## 0bis. STATUS — session 150 (2026-06-18): Phases 1–6 DONE & LIVE (squad path); only 5.3/5.4 housekeeping owed

**Phase 1 COMPLETE + a critical project-identity correction.** `app.in-or-out.com` now
resolves and serves the live consumer build (bundle parity with `www`: `index-D6SVS9w3.js`,
`/api/cron`→401, `/api/manifest`→200). Gate passed.

⚠️ **PROJECT-IDENTITY CORRECTION (the big find this session):** the live consumer app is
served by Vercel project **`platform-clubmanager`** (root dir `apps/inorout`), NOT `inor-out`.
`inor-out` is a DEAD project (old standalone `T29RNY/InorOut` repo, last deploy 2026-05-10, no
`/api`). `app.` was first added to `inor-out` by mistake, then moved to `platform-clubmanager`.
Every env/cron/domain instruction below has been re-pointed to `platform-clubmanager`, and the
old Phase 5.3 (which said "remove the apex from `platform-clubmanager`" — would have killed
prod) has been reversed. See §2 "Confirmed facts" for the corrected project map.

**Done:** Phase 1 (operator) + **Phase 2 (code repoint, commit `70b74cc` on main — 17 files,
27 link/auth constants → `app.`)** + **Phase 4 (DB cron/fns, mig 361, s150).** All on
`platform-clubmanager`.

**Phase 4 DONE (mig 361, s150):** all 7 pg_cron jobs repointed `www`→`app.in-or-out.com` +
`CRON_SECRET` ROTATED lockstep (old weak `Liverp00l123?!!*` → strong 32-byte secret on the
`platform-clubmanager` env + redeployed); `notify_spot_opened()` (direct push, no bearer) +
`get_display_landing_code()` (`/q/` url) repointed to `app.`. Live sweep clean: 7/7 jobs on
`app.` + new bearer, 0 apex refs in both fn bodies, security sweep PASS (both SECDEF +
search_path + single overload + grants intact). Verified live: `app./api/cron` + `/api/notify`
401 the old bearer, 200 the new; the 13:30 scheduled tick produced 8× HTTP 200 from `app.`,
zero 401s. **Zero apex references remain in the database.**

**Phase 5.1 DONE (repo only, s150):** `marketing/vercel.json` created — `cleanUrls`+catch-all
301 `source: /((?!venues|index\.html|favicon\.ico|assets/).+)` → `https://app.in-or-out.com/$1`
(preserves path+query; `/` + `/venues` served, everything else 301s into the app). Consumer
"Get the app"/"Get In or Out"/"Start your squad" CTAs (×4 in `marketing/index.html`, incl. the
previously-dead `href="#"` button) → `app.in-or-out.com`; "Run a venue? →" stays → `venues.html`.
⚠️ NO live effect until the operator deploys `marketing` + moves the apex (Phase 5.2).
⚠️ Operator-app CTA → `venue.` deliberately NOT wired: `venue.in-or-out.com` is Phase 7
(deferred, not live); venues.html "Book a demo" demo-funnel left as-is.

**Phase 3 DONE (no-op, s150):** env (`INOROUT_APP_URL`, `GC_CONNECT_REDIRECT_URI`) set on
`platform-clubmanager`; Stripe/GoCardless have NO accounts/webhooks/keys yet (dormant infra) →
no dashboards to repoint. ⚠️ When those accounts ARE created later, register the `app.` URLs
(`https://app.in-or-out.com/api/...`) from the start — code fallbacks already default to `app.`.

**Phase 2.5 DONE (s150):** Supabase Auth Site URL = `https://app.in-or-out.com`; Redirect URLs
add `app.` + `app./**` (apex entry kept for now). All 3 email templates (confirm/magic/reset)
use default `{{ .ConfirmationURL }}`/`{{ .Token }}` — no hardcoded domain, no edit needed.
⛔ OWED: sign-in round-trip test on `app.` (Google + magic link) — not yet run.

**Phase 5.2 DONE + VERIFIED LIVE (s150):** fresh `marketing` build deployed via Vercel CLI
(`dpl_CMKq…`, it's a MANUAL-CLI project — NOT git-connected, so `git push` does NOT redeploy
it; re-run `vercel deploy --prod` from `marketing/` for future marketing changes). Apex + `www`
MOVED off `platform-clubmanager` → `marketing` (app. stays on platform-clubmanager). Verified:
`in-or-out.com/`+`www/` → 200 marketing; `/p/`,`/q/`,`/join?q=`,`/tournament/join/` → 307/308
into `app.` with path+query intact (apex 2-hops via www-primary 307→ then 308; www is 1-hop);
`app./api/manifest`→200 + `/api/cron`→401 (app untouched). Local `apps/inorout/.vercel` RE-LINKED
to `platform-clubmanager` (`prj_yZFOHJbHmn64RhyTGw4fMUDAvn9h`) so a stray CLI deploy can't hit
dead `inor-out`. Vercel "DNS Change Recommended" (apex A → 216.150.1.1) is OPTIONAL — old IP
still works, defer.

**Claude's work for this migration is COMPLETE (Phases 2, 4, 5.1, 5.2 deploy+relink).**

**Phase 2.5 sign-in PROVEN (s150):** operator completed a Google sign-in round-trip on
`app.in-or-out.com` on a real iPhone → landed signed-in + routed. Supabase Auth redirect config
confirmed working on the new domain.

**Phase 6 squad/admin path VERIFIED on real iPhone (s150):** standalone PWA launch + Google
sign-in + post-auth routing all confirmed (Hard Rule #13 satisfied for the squad path).
Club-member/guardian `/feed` install path still UNVERIFIED (operator isn't a club member — N/A
for now; verify if/when a club-member account exists).

**SIGN-IN ROUTING GAP — FOUND & FIXED during the Phase 6 walk (commit `05157aa`, real-device
verified):** a signed-in squad-only user landing on `/` fell through to the Create/Join welcome
page (the relationship oracle in App.jsx only branched parent/multi/club_member — squad-only had
no branch). Fixed additively: squad-only + 1 squad → `/p/<player_token>`; + 2+ squads → new
"Your squads" chooser (from `relationships.squads`); new `/signin` route + "Already have a team?
Sign in →" entry on the welcome page. Casual `/p/` + `/admin/` token flows byte-untouched.
(Operator's account: admin of demo `Competitive FC` + PLAYER on real `Footy Tuesdays` — Footy's
admin is `rockybram@gmail.com`; both kept linked per operator. Zero-tap Footy default = install
PWA from `/p/p_0imvDLsGMdQhV-Aba5I`.) Welcome-screen styling/logo is off-brand → BUGS.md s150.

**OUTSTANDING — deferred housekeeping (NOT on the critical path, do anytime):**
- **5.3** — Vercel → dead `inor-out` project: remove any stale `in-or-out.com`/`www` domain
  claims (should NOT show `app.`), then **delete the project**. Safe; local `.vercel` already
  re-linked so no CLI-deploy risk. Pure tidiness.
- **5.4** — Supabase → Auth → URL Configuration → Redirect URLs: drop the temporary apex/`www`
  entry (keep the `app.` ones). Do after a day or two of stable `app.`.

---

### Original parking note (session 149) — superseded by the above
**WAS BLOCKED on the operator's Phase 1 (GoDaddy DNS + Vercel attach).** At s149,
`app.in-or-out.com` returned NXDOMAIN; apex still served the consumer app.

**Why Claude can't run ahead:** repointing the code (Phase 2), the 7 cron jobs + 2 DB
functions (Phase 4), or the marketing apex flip (Phase 5) to `app.` *before* that domain
resolves would point every live player/invite link at a dead host and make the timed cron
POSTs 401 silently (they don't follow 301s). So Phase 1 (operator) MUST land first.

**Operator's two unblocking steps (do these to start):**
1. GoDaddy → in-or-out.com → DNS → Add Record: **CNAME**, Name **`app`**, Value
   **`cname.vercel-dns.com`**, TTL default.
2. Vercel → project **`inor-out`** → Settings → Domains → add `app.in-or-out.com`; if Vercel
   shows a different CNAME target, match it in GoDaddy; wait for "Valid Configuration" + SSL.
Then confirm "app is live" → Claude runs Phases 2 + 4 + 5.1 in one sweep.

**Deltas since the runbook was written (fold in when executing):**
- **Next free migration = 361** (Classes open-access shipped as mig 360 this session; the gym
  vertical took 355–359). Phase 4's cron/function migration files take **361+**.
- **Multi-context-nav epic is MERGED** (the `manifest.js` `/feed` start_url + guided tours are
  on main) → the Phase 2.1 / 5.1 / 6.1 nav addenda are now safe to act on; no parallel-session
  collision risk remains. Phase 2.1 = change `BASE_URL` only, leave `/feed` logic intact.
- **`apps/inorout/.env.production` is now TRACKED** (was "untracked-and-unignored" when the
  runbook's Phase 0.5 was written). Inspected this session: it holds only Vercel build-env vars
  (`VERCEL_GIT_*`, `VERCEL_OIDC_TOKEN` — a short-lived build token) + the two PUBLIC `VITE_`
  client vars (`VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, both baked into the client bundle
  by design). NO server secret (no service_role / sk_ / whsec). It's build clutter, not a leak —
  optional cleanup (`git rm --cached` + gitignore), NOT blocking and NOT a security issue.
- **App-store submission is downstream of this** (Phase 8 bakes `https://app.in-or-out.com` as
  the native wrapper's load URL) → the domain must be live + proven before the wrap is built.
  Phase 0 (company-identity ownership + App Store Connect / Google Play / Stripe / Anthropic
  accounts on `founder@in-or-out.com`) is a prerequisite for the app store and can run in
  parallel with the DNS work.

### NEXT-SESSION PROMPT — Domain migration, Phase 4 (DB cron/fns) + Phase 5.1 (marketing 301)
```
Resume the DOMAIN MIGRATION (DOMAIN_MIGRATION.md). Read it in full first, especially the
"0bis. STATUS" banner, §2 Confirmed facts (the project-identity correction), and the
Phase 4 / 5 sections.

CONTEXT: Phase 1 (app.in-or-out.com live) + Phase 2 (code repoint, commit 70b74cc on main)
are DONE. ⚠️ The LIVE consumer app is Vercel project `platform-clubmanager` (root dir
apps/inorout) — NOT `inor-out` (a dead project). ALL env/cron/domain ops target
platform-clubmanager.

GATE FIRST (two checks — if either fails, STOP and surface the blocker, don't run ahead):
  1. Confirm app. still serves the live build with parity to www:
       curl -s -o /dev/null -w "%{http_code}" https://app.in-or-out.com/api/cron   → 401 (not 404)
       curl -s -o /dev/null -w "%{http_code}" https://app.in-or-out.com/api/manifest → 200
     (404s mean app. drifted off the live deployment — stop, re-check the Vercel domain.)
  2. Confirm the operator has completed Phase 3 on `platform-clubmanager`: INOROUT_APP_URL +
     GC_CONNECT_REDIRECT_URI set, and a NEW CRON_SECRET set + redeployed — AND has given you
     the new CRON_SECRET value. Phase 4 CANNOT run without it (the 7 cron jobs must send the
     exact new bearer or every /api/notify + /api/cron POST 401s). If you don't have the
     value, STOP and ask for it.

Once both pass, run a full AUDIT → VERIFY → EXECUTE → VERIFY → COMMIT cycle (proceed with
caution; checkpoint before the live-DB apply):
  - Phase 4 (DB, CRITICAL — mutates the live DB): re-schedule all 7 pg_cron jobs
    (notif-flush-queue, notif-game-day-9am, notif-one-hr-before, notif-debt-reminder,
    notif-bibs-24hr, notif-bibs-45min → /api/notify; inorout-cron-main → /api/cron) with
    url → https://app.in-or-out.com/... and the NEW CRON_SECRET bearer, same schedules; then
    CREATE OR REPLACE notify_spot_opened() (net.http_post URL → app./api/notify) and
    get_display_landing_code() (returned URL → app./q/). AUDIT the live cron.job table +
    both function bodies first (live is truth over migration files). Write the migration
    file(s) at mig 361+ in the SAME commit (Hard Rule #11) + matching _down. Re-sweep live:
    SELECT jobid,jobname,command FROM cron.job → all 7 show app.; function bodies → zero apex
    refs. rpc-security-sweep on the two functions. Then verify a cron tick lands on app.
  - Phase 5.1 (repo): build the marketing catch-all 301 vercel.json (denylist /, /venues,
    favicon, assets; 301 everything else → app., preserving path+query; "Get the app" CTA →
    app., operator CTA → venue.). No live effect until Phase 5.2 deploy.

Then hand me the remaining operator dashboard steps in order, ONE at a time: Phase 3 finish
(Stripe + GoCardless webhook/return URLs → app.), Phase 2.5 (Supabase Auth Site + Redirect
URLs + email templates → app.), Phase 5.2–5.4 (deploy marketing + move apex off
platform-clubmanager onto marketing; clean up the dead inor-out project + re-link local
.vercel), Phase 6 real-iPhone PWA verify (incl. /feed install for a club member/guardian).
Do NOT run two PRs against main at once (Cloud Session Discipline).
```

## 1. Why now
Wrapping the consumer app natively bakes its URL in ~permanently, and customers/payments
are coming. Fix URL structure + account ownership once, now: **1 pilot team, ~2 PWA
installs, no wrapper yet** → near-zero blast radius. Everything is additive until a single
cutover (Phase 5), reversible the whole way.

## 2. Confirmed facts (verified this session)
- **DNS** at **GoDaddy** (`ns29/ns30.domaincontrol.com`); apex+`www` already point at
  Vercel; `app.` not created yet.
- **Consumer app** = Vercel project **`platform-clubmanager`** (misleadingly named; its root
  dir is `apps/inorout`), serving `in-or-out.com`+`www`+all `/api/*`. ⚠️ **CORRECTED s150**:
  the runbook originally said `inor-out` — that was WRONG. Verified live via the Vercel API:
  `in-or-out.com` + `www` are aliased to a `platform-clubmanager` deployment built from the
  **platform monorepo** (today's `main` HEAD, 11 lambdas = the 11 `apps/inorout/api/*` routes).
  **All env vars, `CRON_SECRET`, domain ops in Phases 3–5 apply to `platform-clubmanager`.**
- **`inor-out` is a DEAD project** — wired to the old standalone `T29RNY/InorOut` GitHub repo,
  last deployed 2026-05-10, no `/api` functions. `app.in-or-out.com` was first added here by
  mistake (s150) then moved to `platform-clubmanager`. The local `apps/inorout/.vercel/
  project.json` still links to it (re-link or delete during Phase 5 cleanup). It also carries a
  stale, non-serving `in-or-out.com` claim — that's the one to release in Phase 5, NOT the
  live `platform-clubmanager` claim.
- **Marketing** built but undeployed (`marketing/index.html`, `marketing/venues.html`).
- One shared Supabase project (`ktvpzpnqbwhooiaqrigm`); URL/ref never change.
- **Live DB has 7 cron jobs + 2 functions hardcoded to the apex** (Phase 4).
- Auth = Supabase **PKCE** (`?code=` survives 301); redirects from
  `window.location.origin`; only host check is a `localhost` dev shortcut; no Apple Pay /
  CSP / cookie-Domain / X-Frame.

## 3. Locked decisions
- Subdomains: `app.` `venue.` `club.` `league.` `ref.` `display.` `hq.` `admin.`
- Apex = marketing (`/` + `/venues`) + **catch-all redirect** of all other paths → `app.`
- Native wrap = consumer app only.
- **Now:** Phase 0 + Phases 1–6. **Defer:** Phases 7–8.
- Company email: TBD (e.g. `founder@in-or-out.com`).

## 4. Target end state
| Surface | Address | Vercel project |
|---|---|---|
| Marketing | **in-or-out.com** (+`/venues`) | `marketing` |
| Consumer app (native target) | **app.in-or-out.com** | **`platform-clubmanager`** (root dir = `apps/inorout`) |
| Venue | venue.in-or-out.com | `platform-venue` |
| Club OS | club.in-or-out.com | ⚠️ TBD — `platform-clubmanager` actually serves the CONSUMER app, not Club OS; the real `apps/clubmanager` deploy target is unconfirmed (resolve in Phase 7, deferred) |
| League | league.in-or-out.com | `league` |
| Referee | ref.in-or-out.com | `platform-ref` |
| Display | display.in-or-out.com | `platform-display` |
| HQ | hq.in-or-out.com | `hq` |
| Superadmin | admin.in-or-out.com | `platform-superadmin` |

## 5. Who does what
- **Claude:** repo edits, builds, greps, DB migrations, commits.
- **You:** GoDaddy; company email; Vercel/Supabase/GitHub/Stripe/Anthropic ownership;
  Supabase Auth settings + email templates; Stripe + GoCardless dashboards.

## 6. Legend
`[You]` = you do it in a dashboard (I give exact steps). `[Claude]` = I do it in the repo
/ via tools. `[Verify]` = confirm before moving on. ✅ = success criteria.

---

# PHASE 0 — Accounts & ownership (parallel; does NOT affect the live app)

> Supabase URL/ref and Vercel domains do not change with ownership, so nothing here can
> break the running app. Do it any time; ideally before Stripe go-live and app-store signup.

### 0.1 [You] Create the company mailbox
1. Go to workspace.google.com → "Get started"; use the domain **in-or-out.com**.
2. Create the user **`founder@in-or-out.com`** (real mailbox).
3. Google shows DNS records to add at GoDaddy. **Before saving them**, see 0.1a.

### 0.1a [You] DNS caution — don't break Resend email
1. In GoDaddy DNS, you'll add Google's **MX** records (for receiving).
2. Google also gives an **SPF** TXT (`v=spf1 include:_spf.google.com ~all`). Resend
   already sends from this domain. **Do NOT add a second SPF** — find the existing SPF
   TXT and MERGE both includes into ONE record, e.g.
   `v=spf1 include:_spf.google.com include:amazonses.com ~all` (use whatever include
   Resend's dashboard lists).
3. Leave any existing Resend **DKIM CNAME** records untouched.
4. ✅ Resend dashboard still shows the domain "verified"; a test email still sends.

### 0.2 [You] Add the company identity as Owner (keep Gmail as backup)
1. **Vercel** → Team "Tarny's projects" → Settings → Members → Invite
   `founder@in-or-out.com` → role **Owner**.
2. **Supabase** → Organization → Team/Members → Invite `founder@in-or-out.com` →
   **Owner** (or Admin).
3. **GitHub** → create a company org (e.g. `in-or-out`) → Settings → "Transfer repository"
   → move the platform repo into it (or add the company identity as org owner). Keep your
   personal account as admin for now.

### 0.3 [You] Make the company identity primary + 2FA
1. Sign in as `founder@in-or-out.com` on Vercel, Supabase, GitHub.
2. Enable 2FA on all three.
3. (Optional) Transfer Vercel team / Supabase org primary ownership to it.
4. ✅ Push a trivial commit → confirm Vercel still auto-deploys each project after the
   GitHub transfer.

### 0.4 [You] New commercial accounts on the company identity
- App Store Connect + Google Play developer accounts.
- Stripe + GoCardless **business** accounts.
- **Anthropic Console** account + `ANTHROPIC_API_KEY` (powers the in-app Gaffer AI).

### 0.5 [You] Repo hygiene
1. Confirm `.env.local` is gitignored (it is).
2. `apps/inorout/.env.production` is currently untracked-and-unignored — add it to
   `.gitignore` so no env/secret is ever committed.

### 0.6 [You] Retire personal access — ONLY after 0.1–0.5 verified
- Downgrade/remove the personal Gmail from Vercel + Supabase + GitHub.

### 0.7 [You] Reconnect dev MCPs
- After ownership transfer, re-authorise any VS Code MCP (Supabase/GitHub/Vercel/Stripe)
  that authenticated as the old account. Dev-only; zero production impact.

**Rollback:** additive — the Gmail stays an owner until the company identity is proven.

---

# PHASE 1 — Stand up `app.in-or-out.com` (additive; nothing breaks)

### 1.1 [You] Add the DNS record at GoDaddy
1. GoDaddy → My Products → **in-or-out.com** → **DNS** (Manage DNS).
2. **Add New Record:** Type **CNAME**, Name **`app`**, Value **`cname.vercel-dns.com`**,
   TTL default (1 hr). Save.

### 1.2 [You] Attach the domain in Vercel
1. Vercel → project **`inor-out`** → Settings → **Domains** → enter
   `app.in-or-out.com` → **Add**.
2. If Vercel shows a *different* required CNAME target, change the GoDaddy value to match.
3. Wait for **"Valid Configuration"** + SSL issued (1–5 min).

### 1.3 [Verify] Claude
- Load `https://app.in-or-out.com` (app renders) and `…/api/manifest` (responds).
- Confirm `https://in-or-out.com` still serves the app unchanged.
- ✅ App live at BOTH addresses; apex untouched.

**Rollback:** remove `app.in-or-out.com` from the Vercel project.

---

# PHASE 2 — Repoint the app's links & auth to `app.` (code)

> Deploys are atomic → no downtime. Old apex links keep working (apex still serves the app
> until Phase 5). Constant value used everywhere: `https://app.in-or-out.com`.

### 2.1 [Claude] Repoint `apps/inorout` API files
- `api/manifest.js`: `BASE_URL` → `https://app.in-or-out.com` (fixes manifest icon URLs).
  ⚠️ **Multi-context nav epic addendum:** by the time this runs, `manifest.js` ALSO emits
  `start_url: /feed` for club/guardian/multi-context users (built BASE_URL-relative, so it
  already inherits this domain change automatically). When changing `BASE_URL`, leave the
  `/feed` start_url logic intact — do NOT revert it. See the follow-on section below.
- `api/cron.js`: line ~113 internal `base` (self-call to `/api/notify`) → `app.`;
  line ~775 (`/m/` email link) → `app.`; line ~1633 (`/p/` email link) → `app.`.
- `api/notify.js`: lines ~62 & ~336 (push payload `/p/` URLs) → `app.`.
- `api/gocardless-mandate.js` (`APP_URL` default), `api/gocardless-connect.js`
  (`GC_CONNECT_REDIRECT_URI` default), `api/stripe-member-checkout.js` (`appUrl` default)
  → `app.` (env also set in Phase 3; fix the hardcoded fallback too).

### 2.2 [Claude] Repoint `apps/inorout` UI files
- `src/onboarding/steps/SquadReady.jsx` (`BASE_URL`).
- `src/views/AdminView/SquadScreen.jsx` (join, player, reset URLs — 3 spots).
- `src/views/JoinSuccess.jsx` (joinUrl).
- `src/views/PWAWelcome.jsx` (placeholder text).
- Server-side fallback constant in `src/views/SignIn.jsx`, `EmailCaptureOverlay.jsx`,
  `JoinTeam.jsx` (the live path already uses `window.location.host`; only the SSR fallback
  changes).

### 2.3 [Claude] Repoint other apps' links to the consumer app
- `apps/venue/src/views/InvitesView.jsx` (`BASE` → `app.`, `/q/` links).
- `apps/venue/src/views/MembershipsView.jsx` (`/m/` link).
- `apps/superadmin/src/views/CreateSquad.jsx` + `TeamDetail.jsx` (`CASUAL_BASE`) +
  `Activity.jsx` (hardcoded `/p/`).

### 2.4 [Claude] Build, verify, commit
- `cd apps/inorout && npm run build` (and venue/superadmin builds).
- `grep -rn "www.in-or-out.com" apps/inorout/src apps/inorout/api` → only comments remain.
- Commit + push (auto-deploys `platform-clubmanager` = the consumer app; `platform-venue` if
  applicable). [DONE — commit `70b74cc`.]

### 2.5 [You] Supabase Auth URL Configuration
1. Supabase → **Authentication → URL Configuration**.
2. **Redirect URLs:** add `https://app.in-or-out.com` and `https://app.in-or-out.com/**`.
   Keep an apex entry for now.
3. **Site URL:** set to `https://app.in-or-out.com`.
4. **Authentication → Email Templates:** open confirmation / magic-link / reset. If they
   use `{{ .SiteURL }}` / `{{ .ConfirmationURL }}`, the Site URL change covers them. If any
   **hardcode `in-or-out.com`**, change to `app.in-or-out.com`.

### 2.6 [Verify]
- On `https://app.in-or-out.com`: Google sign-in round-trip + magic-link round-trip both
  land back signed-in.
- A freshly generated invite / player link reads `app.in-or-out.com`.
- ✅ Sign-in works on `app.`; new links emit `app.`.

**Rollback:** revert the commit; both domains still serve the app.

---

# PHASE 3 — Repoint payment providers & API callers (BEFORE Phase 5)

> Webhooks/POSTs don't follow 301s → repoint callers, never redirect `/api`. Must finish
> before the apex flip.

### 3.1 [You/Claude] Vercel env on `platform-clubmanager` (the LIVE consumer-app project)
1. Project **`platform-clubmanager`** → Settings → Environment Variables (Production).
   ⚠️ NOT `inor-out` (dead). This is where the live `/api/*` functions run.
2. Set `INOROUT_APP_URL = https://app.in-or-out.com`.
3. Set `GC_CONNECT_REDIRECT_URI = https://app.in-or-out.com/api/gocardless-connect`.
4. (Leave Stripe/GC *venue return* URLs on `platform-venue.vercel.app` until Phase 7.)
5. Redeploy `platform-clubmanager`.

### 3.2 [You/Claude] Venue env → point at the API's new home
1. `apps/venue/.env.local` and venue Vercel env: set
   `VITE_INOROUT_API_URL = https://app.in-or-out.com`.
2. Rebuild/redeploy venue (manual prebuilt-static).
3. (Venue stays on `platform-venue.vercel.app`, so the API's CORS allow-list still matches
   — no CORS change yet.)

### 3.3 [You] GoCardless dashboard
1. Developers → OAuth/redirect URI → set `https://app.in-or-out.com/api/gocardless-connect`.
2. Webhooks → endpoint → `https://app.in-or-out.com/api/gocardless-webhook`.

### 3.4 [You] Stripe dashboard
1. Developers → Webhooks → edit each endpoint → `https://app.in-or-out.com/api/stripe-webhook`
   (keep "Connected accounts" events enabled).
2. Connect onboarding return/refresh + Checkout return → `app.` (env-driven; confirm).

### 3.5 [Verify]
- One GoCardless sandbox connect + mandate round-trip → returns to `app.`.
- One Stripe test-mode checkout → returns to `app.`; a live webhook hits the new endpoint
  (Stripe dashboard shows 200).
- Venue's "Connect Stripe / GoCardless" buttons work.
- ✅ Payments + webhooks fully on `app.`.

**Rollback:** revert env + dashboard URLs to the apex (still live until Phase 5).

---

# PHASE 4 — Repoint database background calls (BEFORE Phase 5; CRITICAL)

> These are timed/triggered POSTs that won't follow a 301; miss one and that job goes
> silent with no error. Verified live — authoritative over migration files.

### 4.1 [Claude] Rotate the cron secret (lockstep with the jobs)
1. Pick a strong secret. Set `CRON_SECRET = <new>` in the **`platform-clubmanager`** Vercel env
   (the live consumer-app project — NOT `inor-out`), redeploy.
2. (The 7 jobs in 4.2 must send this exact value as the Bearer, or the endpoints 401.)

### 4.2 [Claude] Repoint all 7 pg_cron jobs (migration + live apply)
For each of `notif-flush-queue`, `notif-game-day-9am`, `notif-one-hr-before`,
`notif-debt-reminder`, `notif-bibs-24hr`, `notif-bibs-45min` (→ `/api/notify`) and
`inorout-cron-main` (→ `/api/cron`): re-`cron.schedule(<name>, <same schedule>, <command>)`
with the command's `url` → `https://app.in-or-out.com/...` and the new Bearer. Keep each
schedule identical. (Re-scheduling by the same job name replaces it.)

### 4.3 [Claude] Repoint the two functions
- `CREATE OR REPLACE FUNCTION notify_spot_opened()` — change its `net.http_post` URL →
  `https://app.in-or-out.com/api/notify` (mig 230 successor).
- `CREATE OR REPLACE FUNCTION get_display_landing_code(...)` — change the returned URL →
  `https://app.in-or-out.com/q/` (mig 252 successor).

### 4.4 [Claude] Land migration files + re-verify live
1. Write the `.sql` migration(s) in the same commit as the live apply (Hard Rule #11).
2. Re-run the live sweep:
   `SELECT jobid,jobname,command FROM cron.job` → all 7 show `app.in-or-out.com`;
   function sweep for `in-or-out.com` / `net.http` → zero apex refs.
- ✅ Zero apex references remain in the database.

### 4.5 [Verify]
- Trigger one cron tick (or wait 15 min) → `/api/notify` on `app.` receives it (check
  Vercel logs / a queued notification fires).
- ✅ Background jobs running against `app.`.

**Rollback:** re-point jobs/functions + `CRON_SECRET` back to the apex value (apex still
serves `/api` until Phase 5).

---

# PHASE 5 — Flip the apex to marketing (the one stateful cutover)

> `app.` is fully proven by now → instantly reversible.

### 5.1 [Claude] Build the marketing site as a deployable project
1. Structure: `/` = `index.html` (consumer), `/venues` = `venues.html` (operator).
2. `vercel.json` **catch-all denylist redirect** — serve only `/`, `/venues`,
   `/favicon.ico`, and marketing assets; **301 everything else** →
   `https://app.in-or-out.com/$1` preserving path + query. Example:
   ```json
   { "redirects": [
       { "source": "/((?!venues|favicon\\.ico|assets/).*)",
         "destination": "https://app.in-or-out.com/$1", "permanent": true }
   ]}
   ```
   (Covers `/p`,`/join`,`/q`,`/m`,`/admin`,`/auth`,`/tournament/join`, app screens, future.)
3. CTAs: consumer "Get the app" → `https://app.in-or-out.com`; operator → `venue.`.
4. (Optional) a 1-line service-worker unregister snippet for the ~2 browsers that cached
   the old app on the apex.

### 5.2 [You/Claude] Deploy marketing + move the apex
1. Confirm how `marketing` deploys (monorepo root-dir vs manual) → deploy it.
2. Vercel: remove `in-or-out.com` + `www` from **`platform-clubmanager`** (the LIVE serving
   project) → add them to `marketing`. (`app.` stays on `platform-clubmanager`.)
   ⚠️ This is the one stateful blip: the apex stops serving the app the instant it leaves
   `platform-clubmanager` and starts serving marketing once it lands there. `app.` is
   unaffected throughout.
3. Confirm no marketing route collides with a token path.

### 5.3 [You] Clean up the dead `inor-out` project
- ⚠️ **CORRECTED s150** — the original instruction here ("remove the apex from
  `platform-clubmanager`") was WRONG and would have taken the live site down; deleted.
- The vestigial apex claim lives on the **dead `inor-out`** project. Vercel → `inor-out` →
  Domains → remove `in-or-out.com` + `www` (its non-serving claims), then delete the project.
  Before deleting, re-link or remove the local `apps/inorout/.vercel/project.json` (it points
  at `inor-out`) so a manual `vercel` CLI deploy can't target the dead project.
- NEVER remove `in-or-out.com`/`www`/`app.` from `platform-clubmanager`.

### 5.4 [You] Tidy Supabase
- Once stable, drop the temporary apex entry from Auth Redirect URLs (keep `app.`).

### 5.5 [Verify]
- `https://in-or-out.com` shows the marketing home; `/venues` shows the operator page.
- `https://in-or-out.com/p/<token>` and `/tournament/join/<code>` 301 into the app on
  `app.` with the token intact.
- Payments, cron, push all still running on `app.`.
- ✅ Apex = marketing; all old links forward correctly.

**Rollback:** move `in-or-out.com` back onto **`platform-clubmanager`** (the live consumer-app
project — NOT `inor-out`, which is dead) → app reappears on the apex instantly.

---

# PHASE 6 — Verify end-to-end & soften one-way costs

### 6.1 [You] Real-device PWA test
- On iPhone Safari: open `app.in-or-out.com` → Share → Add to Home Screen → force-quit
  Safari → open from the icon → confirm standalone launch + push opt-in (Hard Rule #13).
- **Multi-context nav epic addendum:** also install + open as a **club member / guardian**
  (not just an admin/squad) → confirm the app launches to `/feed` and the `start_url: /feed`
  manifest resolves on `app.` (the nav epic's installable home for non-squad users).

### 6.2 [You] Migrate the ~2 existing installs
- Reinstall In or Out from `app.in-or-out.com` on the 2 phones; re-enable notifications
  (origin change strands the old install + push sub — unavoidable, trivial at this scale).

### 6.3 [Verify] Full pass — see "Verification gates" below.

---

# PHASE 7 — (DEFERRED) Move operator/internal apps to subdomains

Per app, same additive loop: GoDaddy CNAME → attach in Vercel → add to Supabase Redirect
URLs *if it has sign-in* → repoint inbound links/env → verify → 301 the old `.vercel.app`.
Order & extras:
- **7.1 Venue → `venue.`** — also set `platform-clubmanager` env `GC_CONNECT_ALLOWED_ORIGIN` +
  `STRIPE_CONNECT_ALLOWED_ORIGIN` → `venue.` (CORS), and Stripe/GC venue return URLs → `venue.`
- **7.2 Display → `display.`** — set venue env `VITE_DISPLAY_APP_URL` → `display.`
- **7.3 Ref → `ref.`** — fix its ERRORED deploy first; repoint
  `apps/inorout/src/views/SessionsScreen.jsx` ref links (×4) → `ref.`; set `REF_APP_URL`.
- **7.4 Club → `club.`** — fix `apps/superadmin/src/views/Venues.jsx:38` host-swap → `club.`
- **7.5 HQ → `hq.`** (set `HQ_APP_URL`); **Superadmin → `admin.`**; **League → `league.`**
- **7.6** Optionally rename Vercel projects for consistency.

---

# PHASE 8 — (DEFERRED) Native-app readiness (at wrap time)

- **8.1** Serve `app.in-or-out.com/.well-known/apple-app-site-association` (iOS) +
  `/.well-known/assetlinks.json` (Android) with the app's Team/Bundle + SHA256.
- **8.2** Point the native wrapper's load URL at `https://app.in-or-out.com`.
- **8.3** Real-device test: tapping a `/p/` link opens the native app; PWA install still works.

---

## Follow-on tasks from the multi-context nav epic (`MULTI_CONTEXT_NAV_HANDOFF.md`)
The context-aware-nav + guided-tours epic is built BEFORE this migration (it's domain-
independent except for one constant). It deliberately builds its PWA-install piece
**BASE_URL-relative** so it works on today's domain and inherits `app.` automatically. When
this migration runs, pick up these handoffs — there is nothing to *finish*, only to repoint
and re-verify:
1. **`api/manifest.js` (Phase 2.1)** — the nav epic added `start_url: /feed` for club/
   guardian/multi-context users alongside the existing `/admin/<token>` + `/` cases. Changing
   `BASE_URL` is the ONLY edit needed; the `/feed` logic inherits it. Do not run a manifest-
   touching nav session and this migration in parallel (shared-file collision — Cloud Session
   Discipline). Sequence: nav epic merged first, then this.
2. **`/feed` deep-link target (Phase 5.1 CTAs)** — the marketing apex's "Get the app" CTA and
   the catch-all 301 should land authenticated users on `app.in-or-out.com/feed` (the unified
   cross-context home + switcher the nav epic introduces).
3. **PWA install re-test (Phase 6.1)** — verify the `/feed` installable home for a club member
   AND a guardian on `app.`, not just the admin/squad install (Hard Rule #13).
4. **No new env, cron, webhook, or DB repoint** — the nav epic touches none of Phases 3–4.

## Repoint inventory (reference)
- **Code (Phase 2):** `apps/inorout/api/{manifest,cron,notify,gocardless-mandate,
  gocardless-connect,stripe-member-checkout}.js`; `apps/inorout/src/onboarding/steps/
  SquadReady.jsx`; `apps/inorout/src/views/{AdminView/SquadScreen,JoinSuccess,PWAWelcome,
  SignIn,EmailCaptureOverlay,JoinTeam}.jsx`; `apps/venue/src/views/{InvitesView,
  MembershipsView}.jsx`; `apps/superadmin/src/views/{CreateSquad,TeamDetail,Activity}.jsx`.
- **Env (Phase 3):** `platform-clubmanager` (the live consumer-app project, NOT `inor-out`):
  `INOROUT_APP_URL`, `GC_CONNECT_REDIRECT_URI`, `CRON_SECRET`;
  `platform-venue`: `VITE_INOROUT_API_URL`.
- **DB (Phase 4):** `cron.job` 1–7; `notify_spot_opened()`; `get_display_landing_code()`.
- **Dashboards:** Supabase (Site URL, Redirect URLs, email templates); GoCardless (redirect
  URI, webhook); Stripe (webhook, returns); Vercel (domains, deployment protection,
  marketing deploy); GoDaddy (CNAMEs).

## Downtime
None for app users. App reachable on apex until Phase 5, on `app.` from Phase 1; Vercel
deploys atomic. Only blip = seconds of SSL re-issue on the bare apex during the Phase 5
handover (by then it's just marketing). Risk = ordering (3–4 before 5), not availability.

## Impact on data, identity & RLS
Addresses & ownership only. No table/RLS/token/account change; Phase 4 repoints URLs inside
jobs/functions (no schema/data change). Roles/access come from JWT/tokens, not the domain;
players re-login once on `app.`; admins/refs token-based. Realtime channels, shared RPCs,
venue↔casual RLS wall are DB-keyed → unaffected. Bonus: subdomains enable future cross-app SSO.

## Coverage log (audited this session)
Links · QR (incl. DB-generated display QR) · ref app (safe, independent) · match/tournament
links · invites & join codes · app switcher · memberships · history · stats · every `/api`
+ callers · Stripe/GoCardless/Resend/Twilio/Anthropic/PostHog/WebPush/Supabase · cross-app
data/realtime/shared RPCs · venue↔casual wall · roles/access · RLS/security · env+config ·
**live DB (7 cron jobs + 2 fns)** · Vercel/GitHub/Supabase/Anthropic accounts · dev MCPs.

## External items only you can confirm (already steps above)
Stripe URLs · GoCardless URLs · Supabase Site/Redirect URLs + email templates · Vercel
deployment-protection + marketing deploy method · Resend verified domain/DNS · GoDaddy
access · any physically printed QR (catch-all redirect covers them).

## Verification gates (before "done")
- `app.in-or-out.com` serves the app; auth round-trips; new links emit `app.`
- Stripe + GoCardless round-trips land on `app.`; live webhook received
- All 7 cron jobs + both functions on `app.` (live sweep → zero apex refs)
- Apex serves marketing; `/p/` + `/tournament/join/` 301 into the app intact
- Real-iPhone PWA install on `app.` works
- `grep www.in-or-out.com apps/inorout` → no link constants remain

## Open decisions (not blocking)
1. Final subdomain names (locked above). 2. Company email for Phase 0. 3. Marketing SEO
polish (optional).
