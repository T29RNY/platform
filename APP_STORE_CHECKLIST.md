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
  Native APNs/FCM tokens are a different transport → schema + send-path change (migration 362).
  Biggest code lump in the epic.
- ✅ **Payments are exempt from Apple IAP** — pitch booking / gym membership / PT / classes are
  real-world services (Guideline 3.1.3(e)/3.1.5(a)). Stripe + GoCardless already use hosted
  redirect→return (`api/stripe-member-checkout.js`, `api/gocardless-mandate.js`) into
  `app.in-or-out.com`. No rule problem; DORMANT; not a launch blocker.
- Next free migration = **362**.

---

## STAGE 0 — Commercial identity & accounts (👤 — START NOW, runs in parallel; long pole)
- [x] 0.1 👤 ✅ DECIDED — **Apple = Individual enrolment** (order placed s151). Seller name on
      the App Store listing will be the **personal name**, not a company. Conversion to an
      Organization later is awkward → revisit only if branding demands it.
      ⚠️ The Play decision (0.4) is still open and independent — a **personal** Play account
      DOES hit the 12-tester / 14-day closed-test gate; an org account avoids it.
- [x] 0.2 👤 ✅ DONE. Listing support email = **`support@in-or-out.com`**. (Legal page currently
      lists `hello@in-or-out.com` — optionally align to `support@` in 1.1.)
- [x] 0.3 👤 ✅ ORDER PLACED (s151) — **Apple Developer Program, Individual, $99/yr.**
      Awaiting Apple approval (usually fast for Individual). Once approved → record Team ID (0.5)
      and these unlock: Push, Associated Domains/deep links, Sign in with Apple, TestFlight.
- [ ] 0.4 👤 IN PROGRESS — enrol in **Google Play Console** ($25 one-off).
- [ ] 0.5 👤 DEFERRED until after Stage 5.1 E2E — enable 2FA on both; record the
      **Apple Team ID** (feeds 3.3).
- [x] 0.6 👤 ✅ CHECKED (s151): no exact "In or Out" name clash found in the football/team
      category on either store (competitors exist — Footsapp/Spond/Teamer/etc — but no name
      collision). Web search is not authoritative — **reserve the exact name in App Store
      Connect the moment 0.3 lands.** "In or Out" is a generic phrase (weak trademark) →
      **list as "In or Out — Football Organiser"** (dodges exact-name conflict + helps ASO);
      the app stays "In or Out".

## STAGE 1 — Pre-wrap code prep (🤖 — 1.1/1.2/1.3/1.6 MERGED to main via PR #35 s154; 1.4 = Phase D next; 1.5 deferred to marketing)
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
- [ ] 1.4 🤖 (Phase D) PostHog consent — gate analytics init in `index.html` behind consent (or
      document legitimate-interest basis) for UK/EU + the data-safety form.
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

## STAGE 2 — Capacitor scaffold (🤖 — no external dependency)
- [ ] 2.1 🤖 Add Capacitor to `apps/inorout` (`@capacitor/core`,`/cli`,`/ios`,`/android`);
      `capacitor.config.ts` with `server.url = https://app.in-or-out.com`, appId
      `com.inorout.app` (confirm), appName "In or Out". Verify wrap = consumer app ONLY.
- [ ] 2.2 🤖 Native icon + splash from 1024×1024 master (`@capacitor/assets`); add
      `@capacitor/splash-screen` + `@capacitor/status-bar` (style `#0A0A08`).
- [ ] 2.3 🤖 Safe-area insets — `viewport-fit=cover` + `env(safe-area-inset-*)` so content
      clears notch / Dynamic Island / home indicator in the native shell.
- [ ] 2.4 🤖 Android hardware back-button → webview history (`@capacitor/app`).
- [ ] 2.5 🤖 Verify monorepo build: Capacitor wraps the Vite build but loads remote; ensure
      `webDir` + `@platform/*` workspace deps don't break `npx cap sync`.

## STAGE 3 — Native capabilities (🤖 code + 👤 certs/console — needs Stage 0 IDs)
- [ ] 3.1 👤 Apple Developer: create App ID + **Bundle ID**; enable **Associated Domains** +
      **Push**; create **APNs auth key (.p8)**. (blocks 3.3, 3.5)
- [ ] 3.2 👤 Create **Firebase project** → `google-services.json` (Android push impossible
      without it). (blocks 3.5)
- [ ] 3.3 🤖 Deep-link files served by `platform-clubmanager` under
      `apps/inorout/public/.well-known/`: `apple-app-site-association` (Team ID + Bundle ID)
      and `assetlinks.json` (package + SHA-256 fingerprint from 3.7). Correct content-type,
      no redirect. (needs 3.1 + 3.7 values)
- [ ] 3.4 🤖 Capacitor `appUrlOpen` handler — route opened `/p/<token>`, `/admin/<token>`,
      `/m/<token>` into the webview at the right path.
- [ ] 3.5 🤖 **Native push bridge (migration 362 — biggest code item):**
      `@capacitor/push-notifications`; capture APNs/FCM device token; add `platform`/`token_type`
      column to `push_subscriptions` + `register_push_subscription`; branch the send-path
      (`api/notify.js`, `api/cron.js`) — APNs/FCM for native tokens, `web-push` for web subs.
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
- **Stage 3.5** (native push) is the biggest code lump and the only migration (362).
- **Stage 5.1 (Playwright)** can run as a baseline NOW; the real-device walk (5.2) needs the
  wrapped build, which needs Stages 2–3.
- One PR at a time (Cloud Session Discipline). Real-device test before commit for anything
  PWA/native (Hard Rule #13).

---

## Branch & WIP state at end of session 154 (READ FIRST next session)
- **Stage 1 Phases A + C are MERGED TO MAIN** (PR #35, squash `8e5545a`): store-grade Legal
  (1.1), in-app deletion verified (1.2), age 13+/guardian decided (1.3), offline fallback (1.6).
  The `app-store-stage1` working branch and the redundant `app-store-stage1-docs-s151` branch
  are both DELETED (local + remote). **There is no live epic branch — start Phase D fresh off
  `main`.**
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

## NEXT-SESSION PROMPT — Stage 1 Phase D (PostHog consent, item 1.4)
```
Continue the APP STORE epic (APP_STORE_CHECKLIST.md). Read it first — note the s154 branch state
(Stage 1 Phases A + C are MERGED TO MAIN via PR #35; no live epic branch). Run ONE session only.
Check no other session is active before starting and advise.

Do Stage 1 Phase D — item 1.4: PostHog analytics consent. Branch fresh off `main`. Full cycle:
AUDIT (the PostHog init is inline in apps/inorout/index.html lines ~64-70, fired unconditionally
at page load; check what events it captures, where person_profiles is set, and the UK/EU consent
expectation the data-safety form (4.4) + the store-grade Legal page (already says PostHog is a
subprocessor) will need) → decide gate-behind-consent vs documented legitimate-interest basis
(make a recommendation) → EXECUTE → VERIFY (build: cd apps/inorout && npm run build; real-browser
smoke that analytics only fires post-consent if gated) → COMMIT, then open ONE PR and MERGE it
(don't leave it open — Cloud Session Discipline). Hard Rule #13: real-device test owed for any
index.html change before claiming the PWA path works.

Context: Stage 0.3 (Apple Dev, Individual) is awaiting Apple approval — once approved, grab the
Team ID (0.5) and reserve the app name "In or Out — Football Organiser" in App Store Connect (0.6).
Item 1.5 (off-brand welcome screen) stays DEFERRED to the marketing branch, NOT this track.
After Stage 1 completes → Stage 2 (Capacitor scaffold), which is fully unblocked.
```
