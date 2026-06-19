# In or Out — App Store / Google Play submission checklist

**The last epic.** Ordered, dependency-correct path to get the consumer app (`apps/inorout`,
live at `https://app.in-or-out.com`, Vercel project `platform-clubmanager`) wrapped with
Capacitor and submitted to the App Store + Google Play. Companion to `APP_WRAP_HANDOFF.md`
(which holds the locked decisions and the owed real-device walk list).

**Plan of attack:** work this list top-to-bottom → run a final E2E Playwright pass (Stage 5.1)
→ resolve everything it + the device walks surface (Stage 5.3) → submit. After this epic ships,
the product is done.

Owner tags: 🤖 = me (code/config, lands in `apps/inorout`); 👤 = operator (console / account /
real-device). Dependencies are called out so nothing is built before its inputs exist.

---

## Audit findings baked into this checklist (verified session 151, 2026-06-18)
- ✅ **Privacy + Terms already exist in-app** at `/legal`, `/privacy`, `/terms`
  (`apps/inorout/src/views/Legal.jsx`, contact `hello@in-or-out.com`, effective 10 May 2026).
  → review-and-upgrade to store-grade, not a from-scratch build.
- ✅ **Account deletion already reachable in-app** — `PlayerProfile.jsx:497`
  `deleteMyAccount(me.token)` → backend `api/delete-account.js`. → confirm wording/placement
  meets Apple's requirement, don't rebuild.
- ⚠️ **Google OAuth IS exposed to consumers** (`SignIn.jsx`, `EmailCaptureOverlay.jsx`,
  `JoinTeam.jsx` all call `signInWithOAuth({ provider: 'google' })`). → blocked in a plain
  Capacitor webview AND forces **Sign in with Apple** on iOS. Real build work.
- ⚠️ **No Sign in with Apple anywhere** — confirmed absent. New build (Stage 3.6).
- ⚠️ **Push stores web-push subs only** — `push_subscriptions(id, player_id, player_token,
  team_id, subscription)`; `subscription` is the VAPID jsonb. No platform/token-type column.
  Native APNs/FCM tokens are a different transport → schema + send-path change (migration 368).
  Biggest code lump in the epic.
- ✅ **Payments are exempt from Apple IAP** — pitch booking / gym membership / PT / classes are
  real-world services (Guideline 3.1.3(e)/3.1.5(a)). Stripe + GoCardless already use hosted
  redirect→return (`api/stripe-member-checkout.js`, `api/gocardless-mandate.js`) into
  `app.in-or-out.com`. No rule problem; DORMANT; not a launch blocker.
- Next free migration = **369** (368 = native-push platform column, shipped s157 — renumbered
  from 362, which had already been taken on `main` by `class_session_roster_age` + the s152 demo
  seed; 362–367 are all used).

---

## STAGE 0 — Commercial identity & accounts (👤 — START NOW, runs in parallel; long pole)
- [x] 0.1 👤 ✅ DECIDED — **Apple = Individual enrolment** (order placed s151). Seller name on
      the App Store listing will be the **personal name**, not a company. Conversion to an
      Organization later is awkward → revisit only if branding demands it.
      ⚠️ The Play decision (0.4) is still open and independent — a **personal** Play account
      DOES hit the 12-tester / 14-day closed-test gate; an org account avoids it.
- [x] 0.2 👤 ✅ DONE. Listing support email = **`support@in-or-out.com`**. (Legal page currently
      lists `hello@in-or-out.com` — optionally align to `support@` in 1.1.)
- [x] 0.3 👤 ✅ APPROVED (s157) — **Apple Developer Program, Individual, $99/yr.** Enrolment is
      live; Team ID `JCC44FW6XR` recorded (0.5). Already drawn from it: App ID + capabilities
      (3.1), App Store name reservation (0.6). Still to draw: APNs .p8 key (un-dormants iOS push),
      Apple service ID for Sign in with Apple (3.6), distribution cert + provisioning profile
      (3.7), TestFlight.
- [ ] 0.4 👤 IN PROGRESS — enrol in **Google Play Console** ($25 one-off).
- [x] 0.5 👤 ✅ DONE (s157) — **Apple Team ID = `JCC44FW6XR`** (feeds the AASA file in 3.3).
- [x] 0.6 👤 ✅ DONE (s157) — **App Store name reserved as "In or Out - Book & Play"**
      (broadened from the football-specific "In or Out — Football Organiser" so it covers the
      venue/club/booking surfaces too; still dodges the exact-name clash + helps ASO). The app
      itself stays "In or Out". **App record created in App Store Connect.** Original s151 check:
      no exact "In or Out" clash in the football/team category on either store (Footsapp/Spond/
      Teamer exist but no collision); "In or Out" is a generic phrase / weak trademark.

## STAGE 1 — Pre-wrap code prep (🤖 — 1.1/1.2/1.3/1.6 merged via PR #35 s154; 1.4 DONE Phase D s155; 1.5 deferred to marketing)
- [x] 1.1 🤖 ✅ DONE (Phase A, s151) — store-grade Privacy + Terms in `Legal.jsx`. UK sole-trader
      controller; contact `support@in-or-out.com`; full subprocessor list (Supabase, Vercel,
      Google, PostHog, Resend, Twilio, Stripe, GoCardless); push-token + payment-data
      disclosures; UK GDPR legal bases; international transfers; in-app deletion; ICO complaint
      route; age 13+ w/ under-18 guardian supervision. Colours via tokens. Effective 19 Jun 2026.
- [x] 1.2 🤖 ✅ VERIFIED, no change (Phase B, s151) — in-app deletion already meets Apple's bar:
      red "Delete my account" button in the profile "Account" section
      (`PlayerProfile.jsx:944`), typed-DELETE + 6-digit auth-code confirm modal, real deletion
      (anonymises, signs out everywhere) → `deleteMyAccount` → `api/delete-account.js`.
      ⚠️ 2 minor real-device checks: button is gated `{!isAdminView}` (confirm a pure
      admin/operator account also has a deletion path); point Apple's reviewer at a player
      account that shows it.
- [x] 1.3 🤖 ✅ DECIDED (s151) — **Option A: 13+, under-18s only via a parent/guardian who
      supervises; no under-13s.** Already written into `Legal.jsx`. Use this for the age-rating
      forms (4.5) + data-safety (4.4).
- [x] 1.4 🤖 ✅ DONE (Phase D, s155). **Route chosen: documented legitimate interest (UK GDPR
      Art. 6(1)(f)), implemented defensibly — no blocking consent banner.** Changes (2 files):
      `index.html` PostHog `init` gains `respect_dnt: true` (browsers signalling Do Not Track /
      Global Privacy Control are auto-excluded — the real, honoured opt-out) alongside the
      existing privacy-first config (EU residency `eu.i.posthog.com`, `person_profiles:
      "identified_only"` → no profile for anonymous visitors). Capture volume UNCHANGED
      (autocapture left on — operator's data, out of scope to cut). `Legal.jsx` Cookies &
      Analytics paragraph reconciled: states legitimate-interest basis, EU hosting, no
      ads/no-sale/no-cross-site, DNT auto-exclude + email opt-out (`support@…`) — replaces the
      stale "analytics relies on your consent, which you can withdraw at any time" line that
      promised a mechanism the code didn't honour. **Real-browser smoke (Playwright on the built
      `dist`): DNT off → 1 capture POST to `eu.i.posthog.com/e/` 200 (fires normally); DNT on →
      `has_opted_out_capturing()`=true, ZERO capture requests (opt-out path proven real).**
      Build clean. ⚠️ Hard Rule #13: real-iPhone home-screen walk OWED (index.html touched).
      **Data-safety form (4.4) answers banked:** Analytics data type = "App activity / app
      interactions" + "Device or other IDs"; purpose = Analytics; **NOT** sold/shared with third
      parties; **NOT** used for ads or tracking across other companies' apps/sites; collection is
      "optional" for users via DNT/GPC + email opt-out; processor = PostHog (EU-hosted). No
      advertising ID collected.
- [ ] 1.5 🤖 DEFERRED — off-brand welcome screen (BUGS.md s150) **overlaps the marketing
      cinematic redesign** (same entry screens; WIP stashed — see branch state below). Fold into
      the marketing redesign, not Stage 1. Still must precede the screenshot shoot (4.1).
- [x] 1.6 🤖 ✅ DONE (Phase C, s154). Offline fallback for the remote-URL wrap + installed PWA.
      `apps/inorout/public/offline.html` = self-contained branded page (zero network deps:
      no Google Font/JS/analytics; IN-green/OR/OUT-red lockup, "You're offline" + Try-again
      reload; safe-area padded; brand hex literals hardcoded — same precedent as the inline
      `<style>` in index.html). `sw.js` bumped `ioo-v1`→`ioo-v2`: precaches `/offline.html`
      on install; adds a **network-first fetch handler for navigations ONLY** —
      `fetch(req).catch(() => caches.match('/offline.html'))`. App shell is deliberately NOT
      cached, so the always-fresh update model (close+reopen) is unchanged; non-navigation
      requests (assets, /api/*, push) pass straight through untouched. Build clean; offline.html
      rendered + verified in a real browser (only console msg = harmless favicon 404).
      ⚠️ Stage 2 follow-on: when Capacitor is scaffolded (2.1), also set
      `server.errorPath = 'offline.html'` (or bundle the file in webDir) as belt-and-braces in
      case the native WebView doesn't run the SW for the remote URL — the SW path covers the
      PWA today regardless.

## STAGE 2 — Capacitor scaffold (🤖 — ✅ COMPLETE s156, PR — Capacitor 8, no external dependency)
- [x] 2.1 🤖 ✅ DONE — Capacitor 8 added to `apps/inorout` (`@capacitor/core` dep;
      `@capacitor/cli`+`/ios`+`/android` devDeps). `capacitor.config.ts` at the app root:
      appId `uk.inorout.app` (⚠️ changed from `com.inorout.app` s157 — that Bundle ID was
      unavailable on the Apple account; `uk.inorout.app` is the registered one and must match
      the App ID, APNs topic, AASA/assetlinks, and `cap add ios/android`), appName "In or Out",
      `webDir: 'dist'`,
      `server.url = https://app.in-or-out.com`, `server.cleartext: false`. Wrap = CONSUMER app
      ONLY (apps/inorout → Vercel `platform-clubmanager`), documented in the config header.
      Belt-and-braces (Phase C): `server.errorPath = 'offline.html'` — offline.html is copied
      public/→dist/ by the Vite build so it is always present in webDir as the WebView fallback.
- [x] 2.2 🤖 ✅ DONE — added `@capacitor/splash-screen` + `@capacitor/status-bar` (deps) and
      `@capacitor/assets` (devDep). SplashScreen (`#0A0A08`, `launchAutoHide:false`, no spinner)
      + StatusBar (`style:'DARK'` = light icons, `backgroundColor:'#0A0A08'`) configured in
      `capacitor.config.ts`; runtime applied + splash hidden after first paint by
      `src/native/native-shell.js`. Icon/splash MASTERS staged in `apps/inorout/assets/`
      (icon.png 1024, splash.png + splash-dark.png 2732, README + generate cmd). ⚠️ masters were
      upscaled from the 512 brand mark — **replace icon.png with a crisp 1024 export before the
      Stage 4.1 screenshot shoot.** Actual `capacitor-assets generate` runs on the build machine
      (writes into ios/android, which don't exist here).
- [x] 2.3 🤖 ✅ DONE — added `viewport-fit=cover` to the `index.html` viewport meta. The app
      ALREADY uses `env(safe-area-inset-*)` across ~16 surfaces, but without viewport-fit those
      insets resolved to 0 — this one flag activates all the existing safe-area code in the
      native shell (notch / Dynamic Island / home indicator).
- [x] 2.4 🤖 ✅ DONE — `@capacitor/app` `backButton` listener in `native-shell.js`: Android back
      → `window.history.back()` while there's history, `App.exitApp()` at the root. iOS/web no-op.
- [x] 2.5 🤖 ✅ DONE — `npx cap sync` runs clean: it parsed `capacitor.config.ts` and resolved
      the dep graph incl. the `@platform/core`/`@platform/ui` workspace SYMLINKS without choking
      (copy+update web, 0 errors). Monorepo build passes (`cd apps/inorout && npm run build` —
      Capacitor web shims bundle fine). `check-workspace-deps` PASS. Boot smoke (Playwright on
      built dist): bundle parses, no Capacitor/native-shell error, `window.Capacitor` undefined
      on web → bridge no-ops; `viewport-fit=cover` confirmed live. (The lone `supabaseUrl is
      required` console error is the pre-existing missing-`.env` local-preview limit, not a
      regression.)
      ⚠️ Native `ios/`+`android/` projects are **gitignored, not generated here** (no Xcode /
      CocoaPods / JDK / Android SDK on this machine — CLT only). They're generated on the
      operator's build machine: `npm run build && npx cap add ios && npx cap add android &&
      npx capacitor-assets generate && npx cap sync`. See `apps/inorout/assets/README.md`.
      ⚠️ OWED (Hard Rule #13): real-iPhone home-screen walk for the index.html viewport change —
      fold into the Stage 5.2 device-walk burn-down (alongside the offline + PostHog walks).

## STAGE 3 — Native capabilities (🤖 code + 👤 certs/console — needs Stage 0 IDs)
- [~] 3.1 👤 ✅ MOSTLY DONE (s157) — App ID **`uk.inorout.app`** registered with **Push** +
      **Associated Domains** + **Sign in with Apple** capabilities enabled. ⏳ REMAINING: create
      the **APNs auth key (.p8)** + note its Key ID — that's the last input that un-dormants the
      iOS push send-path in 3.5 (`APNS_KEY_P8` / `APNS_KEY_ID` / `APNS_TEAM_ID=JCC44FW6XR` /
      `APNS_BUNDLE_ID=uk.inorout.app` env on Vercel `platform-clubmanager`).
- [ ] 3.2 👤 Create **Firebase project** → `google-services.json` (Android push impossible
      without it). (blocks 3.5)
- [~] 3.3 🤖 **iOS half DONE (s158).** `apps/inorout/public/.well-known/apple-app-site-association`
      shipped: `appIDs: ["JCC44FW6XR.uk.inorout.app"]`, modern `components` format matching
      `/p/*`, `/admin/*`, `/m/*`. Served by `platform-clubmanager`: Vite copies the dot-prefixed
      `public/.well-known/` straight to `dist/` (confirmed in the build), so the file is a static
      asset that takes precedence over the SPA catch-all rewrite (same as manifest.json/sw.js
      today). `vercel.json` adds a `Content-Type: application/json` header on the AASA path; no
      redirect (served at the exact path). ⏳ REMAINING (Android): `assetlinks.json` (package +
      SHA-256 fingerprint from 3.7) — NOT created (no placeholders; needs the 3.7 keystore).
      ✅ **LIVE-VERIFIED (s158, post-deploy):** origin `https://app.in-or-out.com/.well-known/
      apple-app-site-association` → HTTP 200, `content-type: application/json`, no `location`
      redirect, correct body. Apple's CDN has fetched + accepted it:
      `https://app-site-association.cdn-apple.com/a/v1/app.in-or-out.com` → 200,
      `Apple-Origin-Format: json`, `Apple-From:` the origin URL, body matches. Only the
      real-device tap-the-link test remains (needs the signed iOS build → Stage 5.2).
- [x] 3.4 🤖 ✅ DONE (s158). Capacitor `appUrlOpen` handler in `native-shell.js`: when the OS
      hands a universal/app link (or the `uk.inorout.app://` custom scheme) to the wrapped app,
      it parses the URL, takes `pathname+search+hash`, and `window.location.href`-navigates the
      WebView to it. The app re-reads `window.location.pathname` on load (App.jsx:75) and routes
      itself — same model as every other in-app navigation, so `/p/<token>`, `/admin/<token>`,
      `/m/<token>`, `/signin` all land correctly. Guards: bare-host/`/` ignored, same-path skipped
      (no needless reload), unparseable URL ignored. Web/PWA = no-op (whole module behind
      `Capacitor.isNativePlatform()`). Build clean; hygiene PASS; no migration.
      ⚠️ OWED (Hard Rule #13): real-iPhone deep-link-open walk (can't be exercised in a browser —
      native-only path) → Stage 5.2.
- [x] 3.5 🤖 ✅ DONE (s157, mig 368 — renumbered from 362, own PR). **Native push bridge.** Schema: `push_subscriptions`
      gains `platform` ('web'|'ios'|'android', DEFAULT 'web', CHECK); uniqueness widened
      `(player_id)` → `(player_id, platform)` so a player holds a web AND a native sub at once.
      `register_push_subscription` gains `p_platform` (DEFAULT 'web' → web call sites unchanged;
      old 2-arg overload DROPped); validates VAPID `endpoint` for web vs `{token}` for native;
      audit records platform. Client: `@capacitor/push-notifications` + `src/native/native-push.js`
      captures the APNs/FCM device token and registers it; `PlayerView.handleSubscribe` branches
      native-first, falls through to the unchanged web-push flow on web. Send-path: `api/notify.js`
      `getSubsForPlayers` selects `platform`; a `deliverPush` dispatcher routes web→web-push (LIVE,
      unchanged), ios→APNs (HTTP/2 + ES256 JWT), android→FCM (HTTP v1 + service-account OAuth) —
      both native transports **DORMANT** (env-guarded, no-op cleanly) until operator creds land
      (3.1/3.2); both use Node built-ins only, no new server dep. `api/cron.js` needed NO send
      change — it never sends push directly, always POSTs `/api/notify`. Gates: EV 11/11 + leak 0
      (web+ios coexist, upsert, audit×3, all error paths); rpc-security PASS (SECDEF, search_path,
      single overload, anon+authenticated); hygiene PASS; build clean; boot smoke clean (only the
      known no-env `supabaseUrl` error). ⚠️ OWED (Hard Rule #13): real-iPhone walk for actual push
      DELIVERY can't happen until APNs/FCM creds exist — folds into Stage 5.2.
- [~] 3.6 🤖 ✅ CODE LEG DONE (s159) — see "STAGE 3.6 CODE LEG COMPLETE" below. Auth-in-webview
      fix + Sign in with Apple wired, web path byte-identical, native path DORMANT.
      ⏳ REMAINING (👤): allowlist `uk.inorout.app://auth/callback` in Supabase Auth → URL
      Configuration → Redirect URLs; configure the Apple Service ID + key in Supabase Auth (Apple
      web leg); native build must register the `uk.inorout.app` scheme (CFBundleURLTypes /
      intent-filter — build machine). **AUDIT done s158 — see "3.6 AUDIT" below.**

### 3.6 AUDIT (s158 — read before building 3.6)
**Call sites (all 3 call `supabase.auth.signInWithOAuth` DIRECTLY in the view — auth calls are
exempt from the core-only hygiene rule, established pattern; do NOT move them into supabase.js):**
- `apps/inorout/src/views/SignIn.jsx:24` `signInWithGoogle` → `provider:"google"`,
  `redirectTo: ${BASE_URL}/auth/callback`. Also has `signInWithOtp` (magic link) + a Google button
  (lines 100-114) — the Apple button slots in here next to it.
- `apps/inorout/src/views/EmailCaptureOverlay.jsx:25` `signInWithGoogle` →
  `redirectTo: ${BASE_URL}/auth/callback?returnTo=${returnTo}`. Shares the `GOOGLE_SVG` const.
- `apps/inorout/src/views/JoinTeam.jsx:601` `handleGoogleSignIn` → same shape.
- `BASE_URL` in each = `window.location.protocol//host` (so it's `https://app.in-or-out.com` in the
  wrap). Return always lands on `apps/inorout/src/views/AuthCallback.jsx`, which calls
  `getSession()` and redirects to `auth_return_to`/`returnTo`.

**Why the native fix is needed + how it works:**
- Google blocks `signInWithOAuth`'s full-page redirect inside an embedded WebView
  (`disallowed_useragent`). Fix = open the provider URL in the SYSTEM browser, return via deep link.
- The Supabase client (`packages/core/storage/supabase.js:6`) uses **default auth config →
  PKCE flow, `detectSessionInUrl:true`, localStorage persistence**. On WEB the redirect back to
  `/auth/callback?code=…` is auto-exchanged by `detectSessionInUrl` before `AuthCallback`'s
  `getSession()` runs. On NATIVE: call `signInWithOAuth({ provider, options:{ redirectTo: <deep
  link>, skipBrowserRedirect:true } })` → it stores the PKCE **verifier in the WEBVIEW's
  localStorage** and returns `data.url` → open `data.url` with `@capacitor/browser`
  (`Browser.open`). Google auth happens in the system browser; on success it redirects to the deep
  link, the OS hands it to the app, **3.4's `appUrlOpen` handler fires**. Because the verifier
  never left the webview, the webview can finish the exchange.
- ⚠️ **3.6 must EXTEND the 3.4 `appUrlOpen` handler in `native-shell.js`**: when the opened URL is
  the auth-callback path AND carries `?code=` (or `?error=`), call `Browser.close()` +
  `supabase.auth.exchangeCodeForSession(url)` and let `onAuthStateChange` (App.jsx:696) take over —
  do NOT just `window.location.href`-navigate (the plain-navigate path is only right for
  `/p`,`/admin`,`/m`). This is the one place 3.4 and 3.6 couple.

**Inputs / what's buildable now vs blocked:**
- `@capacitor/browser` is **NOT installed** (only `@capacitor/app` + `@capacitor/core`) → add it,
  pin to the `@capacitor/* ^8` line.
- Deep-link return target: **recommend the custom scheme `uk.inorout.app://auth/callback`**
  (conventional + reliable for OAuth return; universal-link `/auth/callback` would also need adding
  to the AASA `components`). EITHER way: 👤 must add the chosen redirect URL to **Supabase Auth →
  URL Configuration → Redirect URLs** allowlist, and the native build must register the scheme
  (CFBundleURLTypes / intent-filter — build machine). Until both exist the native path is DORMANT,
  exactly like 3.5's APNs/FCM — **so the code leg is safe to build + merge NOW** (web path stays
  byte-identical, native branch only runs in the wrap).
- **Sign in with Apple** web leg (`provider:'apple'`) is **operator-blocked** on the Apple Service
  ID + key being configured in Supabase Auth — but the button + `provider:'apple'` wiring can land
  now (dormant). Apple HIG: the Apple button must be ≥ as prominent as the Google one. Simplest
  defensible path = the SAME browser-based OAuth flow with `provider:'apple'`; a fully-native
  `ASAuthorization` sheet (`@capacitor-community/apple-sign-in` + `signInWithIdToken`) is a heavier
  possible upgrade, not required for v1.
- Magic-link (`signInWithOtp`) return ALSO lands on `/auth/callback` via an email link that opens
  in Safari — returning to the wrapped app would need `/auth/callback` covered by the AASA. Note it;
  may justify adding `/auth/callback` to the AASA `components` regardless of the OAuth scheme choice.
- **Suggested shape:** a shared `apps/inorout/src/native/native-auth.js` exporting one
  `startOAuth(provider, opts)` that does the web full-redirect vs native browser-flow branch, so all
  3 call sites collapse to one call (DRY, matches the native-shell co-location). Execute-time call.
- [ ] 3.7 👤/🤖 Signing: 👤 iOS distribution cert + provisioning profile; 👤/🤖 Android upload
      keystore + read SHA-256 (feeds 3.3).
- [ ] 3.8 🤖 Payments (only when un-dormanted): swap checkout open-calls to
      `@capacitor/browser`; return rides the 3.3 deep-link files. No rule change. NOT a blocker.

## STAGE 4 — Store listing assets (🤖 produce + 👤 upload)
- [ ] 4.1 🤖 Screenshots (captured during Stage 5 device walks): iPhone 6.7" (1290×2796) +
      Play phone shots (min 2). Off-brand welcome (1.5) MUST be fixed first.
- [ ] 4.2 🤖 Play-only graphics: 512×512 icon + 1024×500 feature graphic.
- [ ] 4.3 🤖 Listing copy: name, subtitle, description, keywords/ASO, promo text,
      category (Sports), support URL, marketing URL (`in-or-out.com`).
- [ ] 4.4 👤 App Privacy nutrition labels (Apple) + Data Safety form (Google) — 🤖 supplies
      exact answers from the data audit (incl. PostHog).
- [ ] 4.5 👤 Age-rating questionnaires (Apple + Google IARC) per the 1.3 decision.
- [ ] 4.6 👤+🤖 Reviewer demo account — stable test squad/login in App Review notes; 🤖 prepares
      it + a note explaining the token-link model and IAP-exempt real-world payments.

## STAGE 5 — Build, sign, final E2E + real-device test (👤 device + 🤖 fixes)
- [ ] 5.1 🤖 **Final E2E Playwright pass** of the live consumer surfaces (web) — the gate this
      epic builds toward. Catches render/route regressions before wrapping. Can run now as a baseline.
- [ ] 5.2 👤+🤖 Real-iPhone walk on the wrapped build — burn down the ~20 owed verification
      walks (grouped by club type; see APP_WRAP_HANDOFF.md): deep link opens app, push opt-in +
      delivery, Google + Apple sign-in, payments redirect→return, PWA still installs.
      Capture screenshots here (→ 4.1). (Hard Rule #13)
- [ ] 5.3 🤖 Resolve everything 5.1 + 5.2 surface; re-build; re-test.
- [ ] 5.4 👤 Signed release builds: iOS `.ipa` → TestFlight; Android `.aab` → Play internal testing.

## STAGE 6 — Submit & review (👤)
- [ ] 6.1 👤 Upload builds + listing + privacy forms + demo account.
- [ ] 6.2 👤 Submit; handle review feedback. Likely challenge = Guideline 4.2 "minimum
      functionality / just a website" — defence is native push + deep links + offline shell.
- [ ] 6.3 👤 Release (phased rollout recommended on Play).

---

## Critical path / sequencing notes
- **Stage 0 is the long pole** — Apple org enrolment can take weeks. Start today, in parallel.
- **Stage 1 is 100% unblocked** — code prep can begin immediately, no accounts needed.
- **Stage 3.3** (deep-link files) blocked on Stage 0 + 3.7 identifiers — don't commit placeholder
  AASA/assetlinks; they fail verification.
- **Stage 3.5** (native push) is the biggest code lump and the only migration (368).
- **Stage 5.1 (Playwright)** can run as a baseline NOW; the real-device walk (5.2) needs the
  wrapped build, which needs Stages 2–3.
- One PR at a time (Cloud Session Discipline). Real-device test before commit for anything
  PWA/native (Hard Rule #13).

---

## Branch & WIP state at end of session 157 (READ FIRST next session)
- **Stage 3.5 (native push, mig 368) merged via PR #39 — see the "STAGE 3.5 COMPLETE" section
  below for the current state.** No live epic branch — start 3.4 fresh off `main`.
- **Stage 2 is COMPLETE on `main`** (Capacitor 8 scaffold, items 2.1–2.5, merged via its own PR
  s156). No live epic branch — start Stage 3 fresh off `main`. Touched only `apps/inorout/*`
  (package.json, capacitor.config.ts, index.html viewport, src/main.jsx, src/native/, assets/,
  .gitignore) + `packages/core/constants/colors.js` (new `appShell` token) + root lockfile. No
  migration. Native `ios/`/`android/` projects are gitignored (generated on the build machine).
- **Stage 1 is COMPLETE on `main`.** Phase D (1.4, PostHog legitimate-interest + DNT opt-out)
  merged via its own PR (s155). Phases A + C merged earlier via PR #35 (`8e5545a`): store-grade
  Legal (1.1), in-app deletion verified (1.2), age 13+/guardian (1.3), offline fallback (1.6).
  All Stage 1 working branches are merged + deleted. Only 1.5 (off-brand welcome) remains, and it
  lives on the MARKETING branch, not this track.
- `main` also has: the marketing rebuild (PR #33, `marketing/` only), the exhaustive e2e
  Playwright suite, and the s154 e2e follow-up fixes (PR #34, mig 367).
- **Marketing WIP is parked in a git stash, NOT on a branch** (local-only — not pushed):
  `stash@{0}` = "MARKETING-WIP: cinematic entry-screen backdrops — owes real-iPhone walk".
  `stash@{1}` = an older full safety backup. To resume marketing later:
  `git checkout marketing-cinematic-redesign && git stash apply stash@{0}`. ⚠️ It only exists
  locally — don't wipe the local clone without restoring/committing it first.
- **`marketing-cinematic-redesign` = `f084f79`** (marketing-only, matches origin). The off-brand
  welcome fix (1.5) belongs here, not in the app-store track.
- ⚠️ **Single-session discipline matters here** — s151 hit repeated branch-clobbering because a
  second Claude session was live in the SAME folder. Run ONE session at a time on this repo.

## STAGE 3.5 COMPLETE (s157) + STAGE 0 IDs LANDED (s157)
- **Stage 3.5 native push bridge merged via PR #39** (commit `fc0c4aa`). Mig 368 (the epic's only
  migration) is LIVE on prod DB. See item 3.5 above for the full summary. Bundle ID = `uk.inorout.app`.
- **Stage 0 IDs are in (s157):** Apple **Team ID `JCC44FW6XR`** (0.5 ✅); **App ID `uk.inorout.app`**
  registered with Push + Associated Domains + Sign in with Apple (3.1 ✅, only the APNs .p8 key still
  to create); **App Store name "In or Out - Book & Play"** reserved + App record created (0.6 ✅).
- These unblock the iOS half of **3.3** (AASA: appID = `JCC44FW6XR.uk.inorout.app`) and most of **3.6**.
  Still blocked: Android (3.2 Firebase, 3.7 SHA-256), the APNs .p8 (to un-dormant iOS push send),
  and Apple service ID for Sign in with Apple's web leg.

## STAGE 3.4 + 3.3-iOS COMPLETE (s158)
- **3.4 deep-link routing + 3.3 iOS AASA shipped together** (one PR off `main`). Three files,
  no migration: `apps/inorout/src/native/native-shell.js` (appUrlOpen handler),
  `apps/inorout/public/.well-known/apple-app-site-association` (new), `apps/inorout/vercel.json`
  (Content-Type header for the AASA path). See items 3.4 + 3.3 above for the full state.
- No live epic branch after merge — start the next item fresh off `main`.

## STAGE 3.6 CODE LEG COMPLETE (s159)
- **Auth-in-webview fix + Sign in with Apple shipped** (one PR off `main`). 7 files, no migration:
  - **`apps/inorout/package.json`** — added `@capacitor/browser ^8.0.1` (resolved 8.0.3, on the
    `@capacitor/* ^8` line) + lockfile.
  - **`apps/inorout/src/native/native-auth.js`** (NEW) — one shared `startOAuth(provider, options)`
    helper. WEB: thin pass-through to `supabase.auth.signInWithOAuth({ provider, options })` —
    **byte-identical** to the old inline calls (same options object forwarded untouched). NATIVE
    (`Capacitor.isNativePlatform()`): `skipBrowserRedirect:true` + `redirectTo` overridden to the
    custom scheme `uk.inorout.app://auth/callback`, opens `data.url` via `@capacitor/browser`
    `Browser.open`. Exports `NATIVE_AUTH_REDIRECT`.
  - **`apps/inorout/src/native/native-shell.js`** — EXTENDED the 3.4 `appUrlOpen` handler (now
    `async`): if the opened URL normalises to `…auth/callback` AND carries `?code=`/`?error=`,
    `Browser.close()` + `supabase.auth.exchangeCodeForSession(code)` and let `onAuthStateChange`
    (App.jsx:696) adopt the session — does NOT `window.location`-navigate (that stays the
    `/p`,`/admin`,`/m` path). ⚠️ Deviation from the audit's literal wording: `exchangeCodeForSession`
    is passed the **bare `code`** (`searchParams.get('code')`), not the URL — verified in
    `auth-js@2.105.4` it POSTs `auth_code: <arg>` to `/token?grant_type=pkce`, so the URL form
    would fail. Custom-scheme URLs parse with `host='auth'`,`pathname='/callback'`; the handler
    normalises `host+pathname` and `endsWith('auth/callback')` so both custom-scheme and
    universal-link forms match.
  - **`SignIn.jsx` / `EmailCaptureOverlay.jsx` / `JoinTeam.jsx`** — all 3 call sites now route
    BOTH providers through `startOAuth`; each gains a `provider:'apple'` handler + a HIG-compliant
    **"Continue with Apple"** button placed ABOVE Google, solid near-white fill (`C.text`/`var(--t1)`
    bg, `C.bg`/`var(--bg)` text — existing tokens, zero new hex; Apple logo `fill="currentColor"`),
    so it's ≥ as prominent as the bordered Google button. No raw `signInWithOAuth` remains in any view.
- **DORMANT until 👤:** allowlist `uk.inorout.app://auth/callback` in Supabase Auth Redirect URLs;
  configure Apple Service ID + key in Supabase Auth (Apple web leg); native build registers the
  scheme. Same dormancy model as 3.5's APNs/FCM — web sign-in is unchanged today.
- **Verify:** build clean (inorout); hygiene 7/7 PASS on all 5 touched source files; grep confirms
  all 3 call sites hit `startOAuth` for google+apple and no direct `signInWithOAuth` in views;
  Playwright web boot smoke — `window.Capacitor` undefined (native branch no-ops), `/signin`
  renders Apple-above-Google-above-Email, only console errors are the known no-`.env` dummy-host
  failures. ⚠️ OWED (Hard Rule #13): real-iPhone walk for the native Google+Apple sign-in RETURN
  (native-only path, can't run in a browser) → Stage 5.2.
- No live epic branch after merge — start the next item fresh off `main`. Next free mig still = 369
  (3.6 added no migration).

## NEXT-SESSION PROMPT — Stage 3.6 (auth-in-webview + Sign in with Apple) — ✅ CODE LEG COMPLETE s159
```
Continue the APP STORE epic (APP_STORE_CHECKLIST.md). Read it first — Stages 1, 2, 3.4, 3.5 and
the iOS half of 3.3 are COMPLETE on `main` (s158); 3.6 has a full AUDIT in the checklist (the
"3.6 AUDIT (s158)" section) — READ THAT FIRST, it has the exact call sites, the PKCE/native-exchange
mechanism, and the 3.4↔3.6 coupling. No live epic branch. Run ONE session only; check no other
Claude session is live in /Users/tarny/platform before starting and advise.

Build the 3.6 CODE LEG (safe to merge now — native path stays DORMANT until the operator adds the
redirect URL to Supabase + the native build registers the scheme, exactly like 3.5's APNs/FCM; the
web path must stay byte-identical):
  • Add @capacitor/browser (pin to the @capacitor/* ^8 line).
  • Google-in-webview: branch signInWithOAuth on Capacitor.isNativePlatform(). Native =
    skipBrowserRedirect:true + redirectTo the custom scheme uk.inorout.app://auth/callback, open
    data.url with Browser.open. Web = unchanged full redirect. Suggest a shared
    apps/inorout/src/native/native-auth.js startOAuth(provider, opts) so SignIn.jsx,
    EmailCaptureOverlay.jsx, JoinTeam.jsx all call one helper.
  • EXTEND the 3.4 appUrlOpen handler in native-shell.js: if the opened URL is the auth-callback
    path with ?code= (or ?error=), Browser.close() + supabase.auth.exchangeCodeForSession(url)
    and let onAuthStateChange (App.jsx:696) take over — NOT a plain window.location.href navigate.
  • Sign in with Apple: add provider:'apple' + a HIG-compliant Apple button (≥ prominence of the
    Google button) to all 3 views, reusing the same startOAuth helper. Dormant until 👤 configures
    the Apple Service ID + key in Supabase Auth.
  • Consider adding /auth/callback to the AASA components (magic-link + universal-link return).

VERIFY: build clean; hygiene PASS; grep all 3 call sites hit the helper; web OAuth path unchanged;
Playwright web boot smoke (native branch can't run in a browser — real-iPhone walk is OWED → 5.2).

Still BLOCKED on operator (👤): add uk.inorout.app://auth/callback to Supabase Auth Redirect URLs;
Apple Service ID + key in Supabase (Apple web leg); 3.2 Firebase google-services.json; 3.7 iOS dist
cert + provisioning profile + Android keystore/SHA-256 (SHA-256 unblocks the Android half of 3.3 —
assetlinks.json); APNs .p8 key (un-dormants iOS push in 3.5). Payments (3.8) only when un-dormanted.

OWED real-iPhone walks (offline fallback, PostHog index.html, Stage-2 viewport-fit, deep-link OPEN
routing from 3.4, Google+Apple sign-in return, native push DELIVERY once the .p8 lands) — fold into
the Stage 5.2 device-walk burn-down. (AASA live-URL + Apple-CDN check already DONE & passed s158.)
Item 1.5 (off-brand welcome) stays on the MARKETING branch. Next free mig = 369.
```
