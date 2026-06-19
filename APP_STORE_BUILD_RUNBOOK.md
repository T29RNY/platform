# In or Out — iOS build & submit runbook (Mac + Xcode)

**What this is.** The pure-execution checklist for the one remaining stretch of the App Store epic:
generate the native iOS build, prove it works on a real iPhone (Stage 5.2), and submit (Stage 6).
Everything that could be done without a Mac is already done (see `APP_STORE_CHECKLIST.md` through
s161). **iOS only — Google Play is parked until after Apple approval.**

**Run order:** Section A (scaffold) → B (Xcode config) → C (build to a real iPhone) → D (the 5.2
device walk = the approval insurance) → E (screenshots) → F (TestFlight + submit).

**Key identifiers (already registered):**
- Bundle ID: `uk.inorout.app` · Apple Team ID: `JCC44FW6XR`
- App Store name: `In or Out - Book & Play` · App record already created in App Store Connect
- APNs key: `9KPP827P4U` (live in Vercel) · Sign-in-with-Apple Service ID: `uk.inorout.app.signin`
- Deep-link scheme: `uk.inorout.app://auth/callback` (allowlisted in Supabase)
- Live web target the wrap loads: `https://app.in-or-out.com`

**Prereqs on the Mac:** Xcode (latest) + Command Line Tools, CocoaPods (`sudo gem install cocoapods`
or `brew install cocoapods`), Node 20+, an Apple ID enrolled in the Developer Program, and a real
iPhone + a USB cable. A Mac is mandatory — there is no cloud substitute for App Review's native
checks.

---

## SECTION A — Scaffold the native project (🤖 can drive)

```bash
cd /Users/tarny/platform/apps/inorout

# 0. Replace the placeholder icon FIRST if doing the screenshot shoot this session
#    (assets/icon.png is currently upscaled — fine for TestFlight, blurry for the store).
#    A crisp 1024×1024 PNG of the brand mark, named exactly assets/icon.png.

npm run build                      # produces dist/ (webDir; carries offline.html)
npx cap add ios                    # generates ios/  (needs Xcode + CocoaPods)
npx capacitor-assets generate \
  --iconBackgroundColor '#0A0A08' \
  --splashBackgroundColor '#0A0A08'
npx cap sync                       # copies web + installs native deps (CocoaPods)
```

Notes:
- **iOS only** — do NOT run `npx cap add android` this session (Play parked).
- `ios/` is gitignored — it is regenerated, never committed. Don't try to commit it.
- `cap sync` runs `pod install` under the hood — if it fails, run `cd ios/App && pod install` and
  re-check CocoaPods is installed.
- The web bundle is already proven (5.1, 27/27). This step only wraps it.

---

## SECTION B — Xcode project config (👤 + 🤖) — open `ios/App/App.xcworkspace`

```bash
npx cap open ios          # opens the WORKSPACE (.xcworkspace), not the .xcodeproj
```

In Xcode, on the **App** target:

1. **Signing & Capabilities → Signing**
   - Tick **Automatically manage signing**.
   - Team = the `JCC44FW6XR` Apple Developer account (sign in via Xcode → Settings → Accounts).
   - Bundle Identifier = `uk.inorout.app` (must match exactly).
   - This auto-creates the distribution cert + provisioning profile → **closes checklist 3.7**.

2. **Signing & Capabilities → + Capability** — confirm/add all three:
   - **Push Notifications**
   - **Associated Domains** → entry `applinks:app.in-or-out.com` (powers the 3.3 deep links)
   - **Sign in with Apple**

3. **URL scheme for OAuth return (closes 3.6's last piece).** Target → **Info** → **URL Types** →
   `+`:
   - Identifier: `uk.inorout.app`
   - URL Schemes: `uk.inorout.app`
   (This is what lets the system-browser Google/Apple sign-in redirect back into the app.)

4. **Info.plist hygiene** (Info tab → add rows):
   - `ITSAppUsesNonExemptEncryption` = **NO** (Boolean). Standard HTTPS only → skips the
     export-compliance question on every upload.
   - **Do NOT add** camera or photo-library usage strings — source-verified s161 the consumer app
     has no `<input type=file>` / `getUserMedia` (the QR scanner is in the venue app, not inorout).
     Push needs no usage string either.

5. **Deployment target** — leave Capacitor's default (iOS 14+) unless there's a reason to raise it.

After any change here, **do not** re-run `cap add` (it won't overwrite). If you change
`capacitor.config.ts` later, run `npx cap sync` to propagate.

---

## SECTION C — Build to a real iPhone (👤 device)

1. Plug in the iPhone; trust the Mac if prompted.
2. In Xcode top bar, select the **App** scheme + the **physical device** (not a simulator — APNs
   push and deep links need real hardware).
3. **Product → Run** (⌘R). First run: on the iPhone, Settings → General → VPN & Device Management →
   trust the developer cert.
4. App launches loading `https://app.in-or-out.com` inside the wrap. If you see the offline screen,
   the device has no connection or the SW kicked in — check signal.

If the build fails on pods: `cd ios/App && pod repo update && pod install`, then re-run.

---

## SECTION D — Stage 5.2 device walk ⭐ THE APPROVAL INSURANCE (👤 + 🤖)

This is the single most important section. Each item is something the build hook / type-check /
Playwright **cannot** see (Hard Rule #13). The first four back the Guideline 4.2 defence — if they
work, the "just a website" rejection has no legs. Tick every box; log anything broken → Section E
fixes before submit.

**Guideline 4.2 native-evidence walks (must pass):**
- [ ] **Deep link opens in-app.** Send yourself `https://app.in-or-out.com/p/p_demo_alex_token`
      (e.g. in Messages), tap it → opens the **app** (not Safari) and lands on the player screen.
      Repeat for `/admin/admin_demo` and a `/m/<token>` member pass.
- [ ] **Push delivery.** In the app, opt into notifications (grant the iOS prompt). Trigger a
      reminder (have the organiser open availability / use the demo squad) → a **real APNs push**
      arrives on the lock screen. Screenshot it (→ Section E shot 3).
- [ ] **Sign in with Apple** returns into the app. Tap "Continue with Apple" → system sheet →
      completes → lands back in the app signed in. (Apple REQUIRES this works.)
- [ ] **Google sign-in** returns into the app. Tap Google → system browser → returns via the
      `uk.inorout.app://` deep link → signed in.

**Robustness / polish walks:**
- [ ] **Offline shell.** Enable Airplane Mode, cold-launch the app → branded offline screen (not a
      dead white webview); "Try again" reloads once signal returns.
- [ ] **Splash → first paint.** Cold launch → splash on `#0A0A08` → app paints with **no white
      flash** between.
- [ ] **Safe areas.** Header, bottom controls and the home indicator all clear the notch / Dynamic
      Island — nothing clipped or under the bar.
- [ ] **Account deletion.** Profile → Delete my account → typed-DELETE + code confirm → account
      gone, signed out. Also confirm an **admin/operator-only** account has a deletion path (the
      button is gated `{!isAdminView}` — verify operators aren't stranded).
- [ ] **PWA still installs** from Safari (Add to Home Screen) and opens — the wrap must not have
      regressed the installed-PWA path.
- [ ] **PostHog DNT.** With iOS "Limit Ad Tracking" / a DNT signal, analytics opt-out still holds
      (no capture). (Lower priority — already proven in-browser at 1.4.)
- [ ] **Payments** (ONLY if Stripe/GoCardless are un-dormanted) — a checkout opens in the system
      browser and returns to the app. Skippable for v1; they're dormant.

---

## SECTION E — Screenshots (4.1) + fixes (5.3) (🤖 produce / 👤 shoot)

- **Blocker:** the off-brand welcome screen (item 1.5, on the marketing branch) MUST be fixed +
  merged before shooting — don't capture the entry screen until then.
- **Size:** iPhone 6.7"/6.9" portrait **1290×2796** (one size satisfies Apple; it down-scales).
- **Shot list (search-priority order)** — full captions in `APP_STORE_LISTING.md` §4.1:
  1. The in/out moment (squad mid-fill)  2. Squad filled / game on  3. Match-day push (use the
  screenshot from walk D)  4. Organiser view  5. Beyond-one-match (venue/club)  6. *(opt)* Stats/POTM.
- **5.3:** resolve everything the 5.2 walk + 5.1 surfaced, rebuild, re-walk the broken items.

---

## SECTION F — TestFlight + submit (👤)

1. **Archive:** Xcode → set scheme to **Any iOS Device (arm64)** → Product → **Archive**.
2. **Upload:** Organizer window → **Distribute App** → App Store Connect → Upload.
3. **TestFlight (strongly recommended dress rehearsal):** once the build processes, install via
   TestFlight on a clean device and re-spot-check walks D(a–d). Free way to catch a signing/entitlement
   miss before a human reviewer does.
4. **App Store Connect — the version page:**
   - Paste 4.3 copy (name/subtitle/promo/keywords/description/What's New) from `APP_STORE_LISTING.md`.
   - Attach screenshots.
   - **App Privacy** (4.4): click through using the banked answers in `APP_STORE_LISTING.md` §4.4.
   - **Age rating** (4.5): Apple questionnaire → 13+.
   - **App Review Information**: paste the 4.6 reviewer note; confirm the demo token links resolve.
   - Select the uploaded build.
5. **Submit for review.** Likely challenge = Guideline 4.2 — the reviewer note pre-empts it with the
   native push + deep links + offline + Sign-in-with-Apple evidence proven in Section D.
6. On approval: **release** (manual or phased).

---

## Quick-reference: what closes which checklist item

| Section | Closes |
|---|---|
| A | native `cap add ios` scaffold + assets (2.2 final) |
| B step 1 | 3.7 iOS cert + provisioning profile |
| B step 3 | 3.6 native scheme registration (last 3.6 piece) |
| B step 2 | confirms 3.1 push / 3.3 associated-domains / 3.6 Apple capabilities |
| D | Stage 5.2 (all owed real-device walks) |
| E | 4.1 screenshots + 5.3 |
| F | 5.4 + Stage 6 (submit) |

**No migration. No `apps/inorout/src` changes expected** (config + native only). If the 5.2 walk
forces an app-code fix, that's a normal AUDIT→EXECUTE→VERIFY cycle + Hard Rule #13 re-walk. Next
free mig still = 369.
