# In or Out — Domain & Accounts Fresh Start (detailed runbook)

**Move the consumer app off the apex onto `app.in-or-out.com`, turn `in-or-out.com` into
the marketing landing page, move account ownership off the personal Gmail, and leave the
URL structure clean enough to wrap as a native app.** This is the last critical step
before wrapping the app.

---

## 1. Why now
Wrapping the consumer app natively bakes its URL in ~permanently, and customers/payments
are coming. Fix URL structure + account ownership once, now: **1 pilot team, ~2 PWA
installs, no wrapper yet** → near-zero blast radius. Everything is additive until a single
cutover (Phase 5), reversible the whole way.

## 2. Confirmed facts (verified this session)
- **DNS** at **GoDaddy** (`ns29/ns30.domaincontrol.com`); apex+`www` already point at
  Vercel; `app.` not created yet.
- **Consumer app** = Vercel project `inor-out`, serving `in-or-out.com`+`www`+all `/api/*`.
- **Marketing** built but undeployed (`marketing/index.html`, `marketing/venues.html`).
- `platform-clubmanager` wrongly also lists `in-or-out.com` (stale; remove from THAT
  project only).
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
| Consumer app (native target) | **app.in-or-out.com** | `inor-out` |
| Venue | venue.in-or-out.com | `platform-venue` |
| Club OS | club.in-or-out.com | `platform-clubmanager` |
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
- Commit + push (auto-deploys `inor-out`, `platform-venue` if applicable).

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

### 3.1 [You/Claude] Vercel env on `inor-out`
1. Project `inor-out` → Settings → Environment Variables (Production).
2. Set `INOROUT_APP_URL = https://app.in-or-out.com`.
3. Set `GC_CONNECT_REDIRECT_URI = https://app.in-or-out.com/api/gocardless-connect`.
4. (Leave Stripe/GC *venue return* URLs on `platform-venue.vercel.app` until Phase 7.)
5. Redeploy `inor-out`.

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
1. Pick a strong secret. Set `CRON_SECRET = <new>` in the `inor-out` Vercel env, redeploy.
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
2. Vercel: remove `in-or-out.com` + `www` from `inor-out` → add them to `marketing`.
   (`app.` stays on `inor-out`.)
3. Confirm no marketing route collides with a token path.

### 5.3 [You] Remove the stale apex from clubmanager
- Vercel → `platform-clubmanager` → Domains → remove `in-or-out.com` + `www`
  (NEVER remove from `inor-out`).

### 5.4 [You] Tidy Supabase
- Once stable, drop the temporary apex entry from Auth Redirect URLs (keep `app.`).

### 5.5 [Verify]
- `https://in-or-out.com` shows the marketing home; `/venues` shows the operator page.
- `https://in-or-out.com/p/<token>` and `/tournament/join/<code>` 301 into the app on
  `app.` with the token intact.
- Payments, cron, push all still running on `app.`.
- ✅ Apex = marketing; all old links forward correctly.

**Rollback:** move `in-or-out.com` back onto `inor-out` (app reappears on the apex instantly).

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
- **7.1 Venue → `venue.`** — also set `inor-out` env `GC_CONNECT_ALLOWED_ORIGIN` +
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
- **Env (Phase 3):** `inor-out`: `INOROUT_APP_URL`, `GC_CONNECT_REDIRECT_URI`, `CRON_SECRET`;
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
