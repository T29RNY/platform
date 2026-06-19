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
- [ ] 3.3 🤖 Deep-link files served by `platform-clubmanager` under
      `apps/inorout/public/.well-known/`: `apple-app-site-association` (Team ID + Bundle ID)
      and `assetlinks.json` (package + SHA-256 fingerprint from 3.7). Correct content-type,
      no redirect. **iOS half now UNBLOCKED (s157):** AASA inputs both exist — Team ID
      `JCC44FW6XR` + Bundle ID `uk.inorout.app` (appID = `JCC44FW6XR.uk.inorout.app`). The
      `assetlinks.json` (Android) still needs the SHA-256 from 3.7. Could ship AASA now and add
      assetlinks when 3.7 lands, OR do both together — but each file must be valid when committed
      (no placeholders).
- [ ] 3.4 🤖 Capacitor `appUrlOpen` handler — route opened `/p/<token>`, `/admin/<token>`,
      `/m/<token>` into the webview at the right path.
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
- [ ] 3.6 🤖+👤 Auth-in-webview fix: route Google `signInWithOAuth` through
      `@capacitor/browser` / native auth + deep-link return (plain webview is blocked by
      Google). **Add Sign in with Apple** (Apple requires it once any social login exists):
      👤 enable capability + Apple service ID; 🤖 wire `provider:'apple'` + button in
      `SignIn` / `EmailCaptureOverlay` / `JoinTeam`.
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

## NEXT-SESSION PROMPT — Stage 3.4 (deep-link routing) — ✅ UNBLOCKED
```
Continue the APP STORE epic (APP_STORE_CHECKLIST.md). Read it first — Stages 1, 2 and 3.5 are
COMPLETE on `main` (3.5 native push merged PR #39 s157; mig 368 live; no live epic branch). Run
ONE session only. Check no other Claude session is live in /Users/tarny/platform before starting
and advise.

Build NOW (no further external inputs needed):
  • 3.4 `appUrlOpen` deep-link ROUTING handler (Capacitor @capacitor/app) in
    apps/inorout/src/native/native-shell.js — when the wrapped app is opened via a universal/app
    link, route the opened path (/p/<token>, /admin/<token>, /m/<token>, /signin, etc.) into the
    React app at the right place. Web/PWA = no-op. No migration. The handler is buildable now even
    though the .well-known files (3.3) that make the OS hand links to the app come next.

Then, if appetite (these now have their inputs — Team ID JCC44FW6XR + Bundle ID uk.inorout.app):
  • 3.3 (iOS half) — serve apps/inorout/public/.well-known/apple-app-site-association
    (appID `JCC44FW6XR.uk.inorout.app`, paths /p/* /admin/* /m/*), correct content-type, no
    redirect. Add assetlinks.json only once the Android SHA-256 (3.7) exists — no placeholders.

Still BLOCKED on operator (👤): 3.2 Firebase google-services.json, 3.7 signing certs/keystore +
Android SHA-256, the APNs .p8 key (un-dormants iOS push), Apple service ID for Sign in with Apple
(3.6). Payments (3.8) only when un-dormanted.

OWED real-iPhone walks (offline fallback, PostHog index.html, Stage-2 viewport-fit, native push
DELIVERY once the .p8 lands) — fold into the Stage 5.2 device-walk burn-down. Item 1.5 (off-brand
welcome) stays on the MARKETING branch. Next free mig = 369.
```
