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
- [ ] 0.1 👤 Decide legal entity/identity. Use a **company identity + `founder@in-or-out.com`**
      (an org Google Play account skips the 12-tester / 14-day closed-test gate; personal
      accounts don't).
- [ ] 0.2 👤 Stand up + monitor mailboxes `hello@in-or-out.com` (already in Legal) and
      `founder@in-or-out.com` — both must actually receive mail (store listings require it).
- [ ] 0.3 👤 Enrol in **Apple Developer Program** ($99/yr). Company → needs D-U-N-S number.
      Can take days–weeks → this is why Stage 0 starts first.
- [ ] 0.4 👤 Enrol in **Google Play Console** ($25 one-off).
- [ ] 0.5 👤 Enable 2FA on both. Record the **Apple Team ID** (feeds 3.3).
- [ ] 0.6 👤 Confirm app name "In or Out" available on both stores + trademark sanity-check.

## STAGE 1 — Pre-wrap code prep (🤖 — fully unblocked, can start immediately)
- [ ] 1.1 🤖 Upgrade in-app Privacy + Terms (`Legal.jsx`) to store-grade: data collected (auth
      email, push token, availability/match data, PostHog analytics, payment data), named
      subprocessors (Supabase, Vercel, Resend, PostHog, Stripe, GoCardless, Twilio), retention,
      deletion, UK GDPR basis, children's-data stance.
- [ ] 1.2 🤖 Confirm the account-deletion entry (`PlayerProfile.jsx`) is clearly labelled +
      easy to find, with copy meeting Apple's account-deletion requirement. (Exists — verify, don't rebuild.)
- [ ] 1.3 🤖 **PRODUCT CALL NEEDED** — under-18 stance (guardian/`/m/<token>` flow exists).
      Either set age rating 13+/17+ and gate, or commit to UK Children's Code / families
      compliance. Decide before age-rating forms (4.5) + data-safety (4.4).
- [ ] 1.4 🤖 PostHog consent — gate analytics init in `index.html` behind consent (or document
      legitimate-interest basis) for UK/EU + the data-safety form.
- [ ] 1.5 🤖 Fix the off-brand welcome screen (BUGS.md s150) — **must precede the screenshot
      shoot (4.1), since screenshots = the store listing.**
- [ ] 1.6 🤖 Add an offline fallback page so a no-connection launch of the remote-URL wrap
      doesn't render blank (Apple rejection risk).

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
