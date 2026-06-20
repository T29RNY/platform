# In or Out — App Store / Google Play submission checklist

**The last epic.** Ordered, dependency-correct path to get the consumer app (`apps/inorout`,
live at `https://app.in-or-out.com`, Vercel project `platform-clubmanager`) wrapped with
Capacitor and submitted to the App Store + Google Play. Companion to `APP_WRAP_HANDOFF.md`
(which holds the locked decisions and the owed real-device walk list).

**⏸️ APPLE-FIRST (operator decision s160):** ship the **iOS App Store first**; **Google Play is
PARKED until after Apple approval.** The wrap stays cross-platform in code — only the Play-console /
Android-build work is deferred (0.4, 3.2, the Android half of 3.3, 3.7 keystore/SHA-256, 4.2 Play
graphics, 4.5 IARC, the `.aab` in 5.4, Play's half of Stage 6). Read Android items as "do AFTER iOS
launch." See item 0.4 + DECISIONS.md s160.

**Plan of attack:** work this list top-to-bottom (iOS path) → run a final E2E Playwright pass
(Stage 5.1 ✅ DONE s160) → resolve everything it + the device walks surface (Stage 5.3) → submit to
Apple. Google Play follows after Apple approval. After the iOS launch ships, the core product is done.

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

## REMAINING ROADMAP — ordered, with ETAs (locked s161)

Everything bot-solo without a Mac is DONE. What's left, in execution order. ETA = active hands-on
time (Apple's review wait is calendar time, not effort). Owner: 🤖 me · 👤 operator · 🍎 Apple.
Full step detail for Phases 1–4 lives in **`APP_STORE_BUILD_RUNBOOK.md`**.

**▶ #1 (welcome-screen fix) ✅ DONE s162 — the last bot-solo Phase 0 item.** Remaining Phase 0 = #2
(👤 export crisp 1024×1024 icon). After that the epic is gated on the Mac build (Phase 1+) — pure
execution from `APP_STORE_BUILD_RUNBOOK.md`. No bot-solo work remains.

### Phase 0 — Before the Mac (bot-solo, do now)
| # | Task | Owner | ETA |
|---|------|-------|-----|
| 1 | ✅ DONE (s162) — off-brand welcome screen restyled on-brand (item 1.5; green/red lockup + DM Sans + thin Phosphor; behaviour byte-identical) | 🤖 | done |
| 2 | ✅ DONE (s163) — crisp 1024×1024 `assets/icon.png`: extracted the real brand artwork from the 1254px source, composited the IO mark **full-bleed on `#0A0A08`** (no baked squircle → iOS masks cleanly), no alpha. Propagated into ios AppIcon 1024 slot. | 🤖 | done |

### Phase 1 — Mac: scaffold + configure + first build ✅ DONE s163
| # | Task | Owner | ETA |
|---|------|-------|-----|
| 3 | ✅ DONE (s163) — Xcode 26.5 + iOS 26.5 SDK installed & selected; CocoaPods 1.16.2 (⚠️ Capacitor 8 iOS uses **SPM, not pods** — `App.xcodeproj`, no `.xcworkspace`; pods unused but harmless). | 👤 | done |
| 4 | ✅ DONE (s163) — `npm run build` → `cap add ios` → `capacitor-assets generate` (13 ios assets) → `cap sync`. `ios/` gitignored, not committed. | 🤖 | done |
| 5 | ✅ DONE (s163) — automatic signing, Team "Tarnbir Athwal" (`JCC44FW6XR`), cert "Apple Development", Xcode Managed Profile. Device registered. **Closes 3.7.** | 👤 | done |
| 6 | ✅ DONE (s163) — capabilities Push + Associated Domains (`applinks:app.in-or-out.com`) + Sign in with Apple added; `uk.inorout.app://` URL scheme + `ITSAppUsesNonExemptEncryption=NO` set via PlistBuddy. **Closes last of 3.6.** | 🤖+👤 | done |
| 7 | ✅ DONE (s163) — built & launched on a real iPhone (iPhone18,2 / iOS 26.6); wrap loads `app.in-or-out.com`, all native bridges fired. (Needed: Developer Mode ON on device.) | 👤 | done |

### Phase 2 — The 5.2 device walk ⭐ approval insurance — ⏸️ PARTIAL (s163), 4 findings → 5.3
| # | Task | Owner | ETA |
|---|------|-------|-----|
| 8 | ⏸️ PARTIAL (s163) — **Test 1 deep-links = PASS** (link → opens app, routes to player screen). Walk then **blocked by F1–F4** (see `STAGE_5_2_FINDINGS.md`): F1 safe-area inset missing → status bar covers header + **blocks profile tap** (gates push/deletion); F2 **cold-launch splash HANG** (blocker); F3 sign-in wordmark off-brand (cosmetic); F4 **Sign in with Apple doesn't return to app** (blocker — Supabase redirect allowlist). Re-walk after 5.3. | 👤+🤖 | resume |
| 9 | Capture 5–6 screenshots during the **re**-walk (device confirmed = 1320×2868, store-perfect) | 👤 | 20–30 min |
| 10 | ▶ NEXT — fix F1–F4, rebuild/redeploy, re-walk (5.3) | 🤖+👤 | 1–3 h |

### Phase 3 — Listing entry + upload (~1–1.5 h, Runbook §F)
| # | Task | Owner | ETA |
|---|------|-------|-----|
| 11 | Paste 4.3 copy into App Store Connect | 👤 | 15 min |
| 12 | Click through App Privacy 4.4 + age rating 4.5 (answers banked) | 👤 | 20–30 min |
| 13 | Paste 4.6 reviewer note; verify demo token links resolve | 👤 | 10 min |
| 14 | Archive → upload build → Apple processing | 👤 | 20–40 min |
| 15 | TestFlight dress rehearsal (spot-check sign-in + push) | 👤 | 20–30 min |

### Phase 4 — Submit & review
| # | Task | Owner | ETA |
|---|------|-------|-----|
| 16 | Submit for review | 👤 | 5 min |
| 17 | **Apple review** (calendar wait) | 🍎 | ~24–48 h typical |
| 18 | Handle feedback if rejected (most likely Guideline 4.2 — note pre-empts it) | 🤖+👤 | 0–1 day if it happens |
| 19 | Release (manual or phased) | 👤 | 5 min |

**Totals:** ~5–8 h active work over 2–3 Mac sittings; ~3–5 days calendar to live (most of it Apple's
queue). Only real schedule risks = #10 (what the walk breaks) and #18 (a 4.2 rejection).

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
- [ ] 0.4 👤 ⏸️ **PARKED (operator decision s160) — Google Play enrolment + the entire Android leg
      are deferred until AFTER Apple App Store approval.** Ship iOS first, then circle back to Play.
      The Capacitor wrap stays cross-platform in CODE (nothing to undo); only the Play-console /
      Android-build work waits. Deferred-behind-iOS items: 0.4 (this), 3.2 Firebase
      `google-services.json`, the Android half of 3.3 (`assetlinks.json` + SHA-256), 3.7 Android
      upload keystore, 4.2 Play graphics, 4.5 Google IARC age rating, the Android `.aab` in 5.4, and
      Play's half of Stage 6. When resumed, note: a **personal** Play account hits the
      12-tester/14-day closed-test gate — an org account avoids it. See DECISIONS.md s160.
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
- [x] 1.5 🤖 ✅ DONE (s162, no mig, branch `appstore-welcome-restyle`) — off-brand welcome screen
      (BUGS.md s150) restyled on-brand as a **focused brand-token restyle on the app-store track**
      (NOT the cinematic marketing redesign, which stays parked in `stash@{0}`). `App.jsx`
      `route.type === "landing"` block: flat-amber "IN OR OUT" → the real brand lockup (IN `C.green`
      · OR `C.text` · OUT `C.red`, matching `PageHeader.jsx`/marketing — the wordmark IS the logo,
      no image asset exists); dead `"Inter"` body → `"DM Sans"` (the loaded brand body font); literal
      `→` → Phosphor `ArrowRight`/`LinkSimple` `weight="thin"`; stray `#000` → `C.black`; CTA anchor
      underline killed. **Behaviour byte-identical** (`/create`,`/signin`,`/legal`,mailto hrefs +
      `showLinkInput` toggle + `/\/p\/…/` paste-navigate all preserved). Build clean, hygiene 7/7,
      no new hex; Playwright render of live `/` confirms on-brand (view via `127.0.0.1` — `localhost`
      hits the App.jsx:114 dev backdoor). ⛔ Hard Rule #13 real-iPhone walk OWED → Stage 5.2.
      **Unblocks the 4.1 screenshot shoot.**
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
- [x] 3.1 👤 ✅ DONE (s159) — App ID **`uk.inorout.app`** registered with **Push** +
      **Associated Domains** + **Sign in with Apple** (s157). **APNs auth key created (s159):**
      name "In or Out APNs", **Key ID `9KPP827P4U`**, Environment **Sandbox & Production**,
      restriction **Team Scoped (All Topics)**; key file `AuthKey_9KPP827P4U.p8` on operator's
      machine (`~/Downloads/` s159 — keep safe; APNs keys do NOT expire, no renewal needed, but
      losing it = revoke + new key). Vercel env values supplied for `platform-clubmanager`
      (Production+Preview): `APNS_KEY_ID=9KPP827P4U`, `APNS_TEAM_ID=JCC44FW6XR`,
      `APNS_BUNDLE_ID=uk.inorout.app`, `APNS_PRODUCTION=true`, `APNS_KEY_P8` = full PEM contents
      (notify.js handles real or `\n`-escaped newlines). ✅ Env pasted + **REDEPLOYED LIVE (s159)** —
      post-deploy health check: app root 200, AASA 200/json (deep links intact). SERVER side of iOS
      push now ACTIVE; end-to-end DELIVERY still needs a native build capturing real APNs device
      tokens → verified in the 5.2 device walk.
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
      fix + Sign in with Apple wired, web path byte-identical.
      ✅ 👤 OPERATOR CONFIG DONE (s159): `uk.inorout.app://auth/callback` allowlisted in Supabase
      Auth → URL Configuration → Redirect URLs; **Apple provider configured + ENABLED** in Supabase
      Auth (Client ID `uk.inorout.app.signin`, OAuth client-secret JWT installed). The Apple WEB
      leg is now LIVE; the native deep-link return is ready server-side.
      ⏳ REMAINING (build machine only): native build must register the `uk.inorout.app` scheme
      (iOS `CFBundleURLTypes` / Android intent-filter) for the native OAuth return — rides the
      `cap add` step. **AUDIT done s158 — see "3.6 AUDIT" below.**
      ⏰ **APPLE CLIENT-SECRET RENEWAL — expires 2026-12-16** (Apple caps these at ~6 months; sign-in
      goes dark silently when it lapses). Regenerate from the `.p8` with the same Node one-liner
      (s159). Inputs: Team ID `JCC44FW6XR`, Service ID `uk.inorout.app.signin`, Key ID
      `GH33Y95P4W`, signing key `.p8` = `AuthKey_GH33Y95P4W.p8` (operator's machine,
      `~/Downloads/` s159 — keep it safe; lose it → revoke + new key in Apple console). Paste the
      new JWT into Supabase → Auth → Providers → Apple → Secret Key (for OAuth).

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

## STAGE 4 — Store listing assets (🤖 produce + 👤 upload) — APPLE COPY DONE s161 → `APP_STORE_LISTING.md`
- [~] 4.1 🤖 ✅ SPEC DONE (s161, `APP_STORE_LISTING.md`) — Apple 6.7"/6.9" **1290×2796** portrait,
      5–6 shot list + captions + framing rules. ⏳ ASSETS owed: shot on the wrapped build at Stage
      5.2; off-brand welcome (1.5) MUST be fixed first; replace upscaled icon.png (2.2) before icon gen.
- [ ] 4.2 🤖 ⏸️ PARKED (Play) — Play-only graphics: 512×512 icon + 1024×500 feature graphic.
- [x] 4.3 🤖 ✅ DONE (s161, `APP_STORE_LISTING.md`) — name `In or Out - Book & Play` (23), subtitle
      `Who's in for the match?` (23), promo (143), keywords (96, comma-no-space), full description
      (~1.75k, "NATIVE NOT JUST A WEBSITE" block = on-listing 4.2 evidence), What's New, category
      Sports, support/marketing/privacy URLs. All under Apple field limits (counted).
- [x] 4.4 🤖 ✅ ANSWERS DONE (s161, `APP_STORE_LISTING.md`) — Apple App Privacy questionnaire mapped
      from the 1.4 audit: global "Data NOT Used to Track You"; COLLECTED = Email, Name, User ID,
      Device ID, Product Interaction, Purchase History, User Content (all Linked, no tracking,
      App-Functionality/Analytics purposes); Financial/Payment Info NOT collected (Stripe/GC hosted);
      Location/Health/Contacts/Browsing/Sensitive/Diagnostics NOT collected. ⚠️ 👤 to confirm Phone
      Number = not collected (recommended) + click through ASC. (Google Data Safety skipped — parked.)
- [ ] 4.5 👤 Apple age-rating questionnaire = 13+ per item 1.3 (Google IARC ⏸️ PARKED).
- [x] 4.6 🤖 ✅ DONE (s161, `APP_STORE_LISTING.md`) — paste-ready App Review note: token-link model
      (no-sign-in player/admin/member links `p_demo_alex_token`/`admin_demo`/member pass), full
      sign-in demo accounts (`tarny+demo@` all-roles via email OTP, `tarny+family@` guardian+staff),
      IAP-exempt real-world payments (3.1.3(e)/3.1.5(a)), and the Guideline-4.2 native defence.

## STAGE 5 — Build, sign, final E2E + real-device test (👤 device + 🤖 fixes)
- [x] 5.1 ✅ **Final E2E Playwright pass** of the live consumer surfaces (web) — DONE s160.
      **Result: 27/27 GREEN — zero render/route regressions.** Ran local dev code (`apps/inorout`
      on :5173) against the LIVE Supabase DB (`ktvpzpnqbwhooiaqrigm`):
      - `inorout-alex` 16/16 · `inorout-sam` 7/7 (incl. all `guardian.*` specs) · `tokens` 4/4.
        Operator-app projects (venue/hq/superadmin/display/ref) were OUT of 5.1 scope — not run.
      - ⚠️ **Harness gotcha found + documented (NOT an app bug):** running the authed projects
        chained/back-to-back produced FALSE failures on Sam's auth-gated routes (parent-home /
        profile fell to the SignIn screen). Root cause: global-setup mints ONE refresh token per
        user; every app boot force-refreshes (App.jsx:511, intentional PWA token recovery), rotating
        that single-use token. Playwright re-injects the SAME token into each fresh test context, so
        contexts reuse an already-rotated token — Supabase tolerates reuse only within a ~10s grace
        window, and chaining pushes later reuses past it → refresh 400 → supabase-js signs out. Each
        project passes 100% when run COLD/ALONE (all reuses land inside the grace window).
      - **Fixes committed (harness only, no app code touched):** (1) `e2e/global-setup.mjs` now mints
        only the user(s) the selected `--project` needs (keeps per-project cold runs lean + under the
        GoTrue limit; full `npm run e2e` still mints both); (2) `e2e/playwright.config.mjs` header
        documents the rotation constraint + the canonical 5.1 command = three SEPARATE cold
        invocations (`--project=inorout-alex`, then `inorout-sam`, then `tokens`).
      - A fully deterministic single-command run would need App.jsx:511 gated behind a test env —
        out of scope for this read-only baseline (PWA auth path, Hard Rule #13). The surfaces are
        proven regression-free regardless. casual flow untouched (no `apps/inorout/src` edits).
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
- **👤 OPERATOR CONFIG DONE (s159):** redirect URL `uk.inorout.app://auth/callback` allowlisted +
  Apple provider configured & ENABLED in Supabase Auth (Client ID `uk.inorout.app.signin`, OAuth
  client-secret JWT minted from the `.p8` via Node, **expires 2026-12-16** — renewal noted on item
  3.6). Apple WEB leg LIVE; native return ready server-side. Only remaining piece = the native
  build registering the `uk.inorout.app` scheme (build machine, rides `cap add`).
- **Verify:** build clean (inorout); hygiene 7/7 PASS on all 5 touched source files; grep confirms
  all 3 call sites hit `startOAuth` for google+apple and no direct `signInWithOAuth` in views;
  Playwright web boot smoke — `window.Capacitor` undefined (native branch no-ops), `/signin`
  renders Apple-above-Google-above-Email, only console errors are the known no-`.env` dummy-host
  failures. ⚠️ OWED (Hard Rule #13): real-iPhone walk for the native Google+Apple sign-in RETURN
  (native-only path, can't run in a browser) → Stage 5.2.
- No live epic branch after merge — start the next item fresh off `main`. Next free mig still = 369
  (3.6 added no migration).

## STAGE 3.6 OPERATOR CONFIG + 3.1 APNs DONE (s159)
- **3.6 operator config DONE** (commit `b4aa264`): `uk.inorout.app://auth/callback` allowlisted in
  Supabase Auth → URL Configuration → Redirect URLs; **Apple provider configured + ENABLED** (Client
  ID `uk.inorout.app.signin`; OAuth client-secret JWT minted locally from the `.p8` via Node ES256;
  Apple Services ID `uk.inorout.app.signin` → Primary App ID `uk.inorout.app`, domain
  `ktvpzpnqbwhooiaqrigm.supabase.co`, return `https://ktvpzpnqbwhooiaqrigm.supabase.co/auth/v1/callback`).
  Apple WEB leg LIVE. ⏰ **Client secret EXPIRES 2026-12-16** — renewal scheduled as a cloud routine
  (`trig_019JDdvrTJ1bgFDUKoxxbiMq`, fires 2026-12-09) + recorded on item 3.6. Key file
  `AuthKey_GH33Y95P4W.p8` (operator `~/Downloads/`). Only 3.6 piece left = native scheme registration
  (build machine, rides `cap add`).
- **3.1 APNs DONE** (commits `4bc25a4`, `cee2f8b`): APNs key "In or Out APNs" created (**Key ID
  `9KPP827P4U`**, Sandbox & Production, Team Scoped); key file `AuthKey_9KPP827P4U.p8` (operator
  `~/Downloads/`; APNs keys DON'T expire). Vercel `platform-clubmanager` env set + **REDEPLOYED LIVE**
  (`APNS_KEY_ID=9KPP827P4U`, `APNS_TEAM_ID=JCC44FW6XR`, `APNS_BUNDLE_ID=uk.inorout.app`,
  `APNS_PRODUCTION=true`, `APNS_KEY_P8`=full PEM); post-deploy health 200/200. SERVER side of iOS push
  now ACTIVE; end-to-end DELIVERY still needs a native build with real device tokens (5.2).
- **All console/code work that needs no Mac is now DONE.** The epic is gated on the build machine
  (Mac + Xcode) for 3.7 signing + the native `cap add` scaffold. Remaining operator-only: 0.4 Play
  Console, 3.2 Firebase, 3.7 certs/keystore/SHA-256.

## STAGE 5.1 E2E BASELINE DONE (s160)
- **5.1 PASS — 27/27 green, zero render/route regressions.** `inorout-alex` 16/16, `inorout-sam`
  7/7 (incl. all `guardian.*` specs), `tokens` 4/4 — local dev (`apps/inorout` :5173) vs the LIVE
  Supabase DB. Full detail + the harness gotcha on item 5.1 above.
- **Harness fix committed (no app code touched):** `e2e/global-setup.mjs` mints only the user(s) a
  selected `--project` needs; `e2e/playwright.config.mjs` header documents the refresh-token-rotation
  constraint. Canonical 5.1 command = three SEPARATE cold invocations (chaining produces FALSE
  auth-gate failures via single-use-token reuse past Supabase's ~10s grace window — see item 5.1).
- **Remaining 🤖-solo work = Stage 4 listing paperwork only** (4.3 copy, 4.2 Play graphics, 4.4
  privacy labels from the 1.4 data audit, 4.6 reviewer note). Everything else waits on the build
  machine → 5.2 device walks → submit. No live epic branch — start Stage 4 fresh off `main`.
- No live epic branch. Working tree clean on `main` at end of s159. Next free mig still = 369.

## STAGE 4 DONE (s161) — Apple listing paperwork complete → `APP_STORE_LISTING.md`
- **The last 🤖-solo work in the epic is done.** New repo doc `APP_STORE_LISTING.md` holds, ready
  for the operator to paste into App Store Connect: **4.3** listing copy (all fields verified under
  Apple limits), **4.4** App Privacy questionnaire answers (mapped from the 1.4 audit; global "not
  used to track"), **4.6** the paste-ready App Review demo note (token-link model + demo accounts +
  IAP-exemption + Guideline-4.2 native defence), and the **4.1** screenshot spec (sizes/shot
  list/captions; assets still owed at 5.2). Doc-only — no migration, no code, no build change.
- **One 👤 confirmation flagged in 4.4:** Phone Number recommended as "not collected" for the
  consumer app (Twilio SMS is an operator surface, not consumer collection) — operator to confirm
  while clicking through the ASC questionnaire.
- **Everything 🤖 can do without a Mac is now COMPLETE.** The epic is fully gated on the build
  machine + operator console: 3.7 iOS dist cert + provisioning profile, the native `cap add ios`
  scaffold + 3.6 scheme registration, then the Stage 5.2 real-iPhone device walks (which also
  capture the 4.1 screenshots), then submit (Stage 6). PARKED behind Apple approval: all Android/Play.
- Working tree was clean on `main` at start; this session touched only `APP_STORE_LISTING.md` (new)
  + `APP_STORE_CHECKLIST.md`. No live epic branch. Next free mig still = **369**.
- ⚠️ Session note: a second Claude session was live in `/Users/tarny/platform` during s161 (a
  morning `--resume`). This was doc-only on files that session was not touching, so no clash — but
  per Cloud Session Discipline, prefer one session at a time on this repo.

## SESSION 162 STATE (read before resuming) — Phase 0 #1 (item 1.5) ✅ DONE
- **Off-brand welcome screen RESTYLED + MERGED** (PR #44, commit `da2a7db`, branch deleted). Focused
  brand-token restyle of the `apps/inorout/src/App.jsx` `route.type === "landing"` block — NOT the
  cinematic marketing redesign (still parked in `stash@{0}`). Wordmark flat-amber → real brand lockup
  (IN `C.green` · OR `C.text` · OUT `C.red`, matching `PageHeader.jsx`); dead `"Inter"` → `"DM Sans"`;
  literal `→` → Phosphor `ArrowRight`/`LinkSimple` `weight="thin"`; stray `#000` → `C.black`; CTA
  underline killed. Behaviour byte-identical (all hrefs + `showLinkInput` toggle + `/\/p\/…/`
  paste-navigate preserved). Build clean, hygiene 7/7, no new hex; Playwright-confirmed on-brand.
  ⚠️ To Playwright the real unauth `/` landing, serve with `--host` + hit **`127.0.0.1`** — `localhost`
  hits the App.jsx:114 dev backdoor (`→ admin/local`).
- ⛔ **OWED (HR #13):** real-iPhone home-screen walk of the welcome screen → folded into Stage 5.2.
- **THE LAST 🤖-SOLO ITEM IS DONE.** Everything remaining is gated on the **build machine (Mac + Xcode)**
  + operator console. Next session = the BUILD-MACHINE prompt below (pure execution from
  `APP_STORE_BUILD_RUNBOOK.md`). Remaining Phase 0 = #2 (👤 export a crisp 1024×1024 `assets/icon.png`).
- ⚠️ s162 had two other Claude sessions live in `/Users/tarny/platform` (one scope-locking the watchOS
  epic — FEATURES.md/DECISIONS.md). Kept edits in separate files; a stray `git add -A` briefly absorbed
  FEATURES.md and was backed out before the final commit. **RUN ONE SESSION ONLY.**

## ▶ NEXT-SESSION PROMPT — ✅ SUPERSEDED (item 1.5 done s162, PR #44) — use the BUILD-MACHINE prompt below
```
[HISTORICAL — #1 is DONE. Kept for the record. The live next-session prompt is the BUILD-MACHINE one.]
Continue the APP STORE epic. Read APP_STORE_CHECKLIST.md first (esp. the "REMAINING ROADMAP" table
— we're on Phase 0 #1) + BUGS.md "SESSION 150 — consumer welcome screen styling + logo off-brand".
This is the last bot-solo item before the Mac build; it blocks the Stage 4.1 screenshot shoot.
Run ONE session only; check no other Claude session is live in /Users/tarny/platform and advise.

TASK (item 1.5): restyle the unauthenticated root (`/`) welcome screen — apps/inorout/src/App.jsx
~line 1280 ("IN OR OUT" wordmark / "The fastest way to organise your weekly football game" /
Create-Join CTA + player-link). Today it uses ad-hoc inline styles (Bebas Neue as plain amber text,
Inter body, hand-rolled button) that don't match the design system. Bring it onto brand: tokens.css
vars (no stray hex beyond the two allowed), the real In or Out logo mark, Phosphor icons weight=thin,
Bebas Neue headings / DM Sans body. Functional behaviour (the Create/Join CTA + player-link routing)
must stay byte-identical — restyle only.

⚠️ SCOPE DECISION TO CONFIRM AT AUDIT (one question): this is a FOCUSED brand-token restyle on a
fresh branch off `main` (app-store track) — NOT resurrecting the full cinematic marketing redesign
(that's a separate heavy epic; its WIP is parked in `stash@{0}` on `marketing-cinematic-redesign`
and owes its own device walk). Recommendation: focused restyle now to unblock screenshots; the
cinematic redesign stays its own later epic. Confirm before EXECUTE.

CYCLE: AUDIT (read App.jsx welcome block in full — exact styles, the logo asset path used elsewhere
in the app, which tokens/components to reuse; no edits) → EXECUTE (restyle only) →
cd apps/inorout && npm run build → VERIFY (hygiene PASS on App.jsx; grep no new hex; confirm CTA/
link routing unchanged; Playwright boot smoke of `/` renders on-brand) → COMMIT + push.
⚠️ Hard Rule #13: App.jsx is PWA-affecting → real-iPhone home-screen walk is OWED; fold it into the
Stage 5.2 device-walk burn-down (don't block the commit on it — note it). Then mark 1.5 done in
BUGS.md + the checklist in the same commit. Next free mig = 369 (no migration expected).
```

## NEXT-SESSION PROMPT (after #1) — build machine (Mac + Xcode required; no more 🤖-solo work)
**▶ Pure-execution runbook: `APP_STORE_BUILD_RUNBOOK.md`** — exact commands for scaffold → Xcode
config → build-to-iPhone → the Stage 5.2 device walk (tickable) → TestFlight → submit. Follow that;
the prose below is the summary.
```
The APP STORE epic (APP_STORE_CHECKLIST.md) has NO remaining bot-solo work — every console/code item
that needs no Mac is DONE through s161 (Stages 1, 2; 3.1, 3.3-iOS, 3.4, 3.5, 3.6 code+provider; 5.1
E2E baseline; and Stage 4 Apple listing paperwork in APP_STORE_LISTING.md). The epic is now gated on
the build machine + operator console. iOS-first; Google Play PARKED until after Apple approval.

On a Mac with Xcode (operator + Claude on that machine):
  • npx cap add ios && npx capacitor-assets generate && npx cap sync (apps/inorout; replace the
    upscaled assets/icon.png with a crisp 1024 export first — item 2.2).
  • Register the uk.inorout.app:// scheme in the iOS project (CFBundleURLTypes) for the 3.6 OAuth
    return; confirm Associated Domains + Push + Sign-in-with-Apple capabilities are on.
  • Info.plist hygiene: set ITSAppUsesNonExemptEncryption=false (standard HTTPS only — skips the
    export-compliance question on every upload). NO camera/photo-library usage strings needed —
    source-verified s161 the consumer app has no <input type=file>/getUserMedia (QR scanner lives in
    the venue app, not inorout). Push needs no usage string.
  • 👤 3.7: iOS distribution cert + provisioning profile (easiest = Xcode automatic signing).
  • Stage 5.2 real-iPhone walk: deep-link open, push opt-in + DELIVERY, Google + Apple sign-in
    return, payments redirect→return, PWA still installs, offline shell, viewport-fit. Capture the
    4.1 screenshots here (1290×2796) AFTER the 1.5 off-brand welcome fix lands from the marketing branch.
  • Stage 5.3: resolve anything 5.1/5.2 surfaced; rebuild. Stage 6: upload + submit to Apple.
Next free mig = 369.
```

## NEXT-SESSION PROMPT (SUPERSEDED) — Stage 4 (Apple listing paperwork — the last 🤖-solo work)
```
Continue the APP STORE epic (APP_STORE_CHECKLIST.md). Read it first — through s160, EVERY console/code
item that needs no Mac is DONE: Stages 1, 2; 3.1 (APNs live), 3.3-iOS, 3.4, 3.5, 3.6 (code + Apple
provider live); and 5.1 (E2E baseline 27/27 GREEN — see the "STAGE 5.1 E2E BASELINE DONE (s160)"
section + item 5.1). ⏸️ APPLE-FIRST (operator s160): iOS App Store ships FIRST; Google Play is PARKED
until after Apple approval — SKIP all Android/Play work (0.4, 3.2, Android half of 3.3, Android keystore,
4.2 Play graphics, 4.5 IARC, .aab) this session. The epic is now gated on the build machine (Mac+Xcode)
for 3.7 iOS signing + native `cap add`. No live epic branch; start fresh off `main`. Run ONE session
only; check no other Claude session is live in /Users/tarny/platform before starting and advise.

Do Stage 4 — APPLE App Store listing paperwork — the ONLY remaining 🤖-solo work. All doc-only, no
code/build/device needed. As an AUDIT → EXECUTE → VERIFY → COMMIT cycle:
  • 4.3 App Store listing COPY: name/subtitle/description/keywords/promo text. Pull positioning from
    STRATEGY.md + the marketing site; lead with the Guideline-4.2 defence story (native push + deep
    links + offline shell, not "just a website"). Reserved App Store name = "In or Out - Book & Play".
  • 4.4 App Privacy LABELS (Apple's questionnaire). The underlying data audit incl. PostHog is ALREADY
    banked in item 1.4 — convert it to App Store Connect's App Privacy format. No new audit needed.
    (Skip Google Data Safety — Play parked.)
  • 4.6 reviewer demo-account NOTE — stable demo squad/login (the DEMO_USERS.md accounts) + a short
    note explaining the token-link model and that real-world payments are IAP-exempt.
  • (Apple screenshot spec for 4.1 can ride here too — sizes/copy; assets shot on the wrapped build at
    5.2. SKIP 4.2 Play feature graphic — parked.)
  Write each as a doc under the repo (e.g. APP_STORE_LISTING.md) so the operator can paste into App
  Store Connect. Doc-only cycle — no migration, no build gate beyond hygiene.

Still BLOCKED on operator (👤, iOS path): 3.7 iOS dist cert + provisioning profile (easiest via Xcode
automatic signing); the native cap-add scaffold + 3.6 scheme registration (build machine). After Stage 4
+ the build machine → 5.2 real-iPhone device walks → submit to Apple. PARKED behind Apple approval
(do NOT start): 0.4 Play Console, 3.2 Firebase, Android keystore/SHA-256, 4.2/4.5, the .aab.

FUTURE EPIC (not now): a watchOS companion app — ref view on the wrist + a lightweight football
workout tracker (metrics TBD) — is logged in FEATURES.md "## WATCHOS COMPANION APP" + DECISIONS.md
s160; it starts AFTER Apple approval as its own epic. Item 1.5 (off-brand welcome) stays on the
MARKETING branch. Next free mig = 369.
```

## NEXT-SESSION PROMPT (SUPERSEDED) — Stage 3.6 — ✅ COMPLETE (code s159 / operator config s159)
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
