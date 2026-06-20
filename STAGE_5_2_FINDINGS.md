# Stage 5.2 device-walk findings (to fix in 5.3)
Device: iPhone18,2 (iOS 26.6), wrap loads remote https://app.in-or-out.com.
NOTE: fixes must DEPLOY to app.in-or-out.com (wrap loads remote), then re-walk.

## F1 — Safe-area top inset not applied on casual player shell (Test 1)
Symptom: status bar / Dynamic Island overlaps the green PageHeader on the
player "my-view" screen.
Cause: viewport-fit=cover IS live, but the casual shell doesn't pad for it.
- components/ui/PageHeader.jsx:60 outer `padding:"8px 12px 10px"` → needs
  `calc(8px + env(safe-area-inset-top))` top.
- PlayerView.jsx:1657/1662 stats & history tabs "render their own headers" →
  same inset needed.
- Bottom nav = components/ui/NavBar.jsx → verify safe-area-inset-bottom clears
  home indicator.
- POTM fixed banner PlayerView.jsx:682 `top:0` → also needs inset.
Scope: touches apps/inorout/src → casual-regression + Hard Rule #13 re-walk.

## F2 — Cold-launch splash HANG (Test 6, SERIOUS — submission blocker)
Symptom: force-quit → reopen from icon → stuck on splash indefinitely
(waiting 15s+ did nothing; live site TTFB=123ms so not the server).
Recovered only by relaunching via Xcode.
Cause: capacitor.config.ts SplashScreen.launchAutoHide:false + the only hide is
native-shell.js:38 `setTimeout(()=>SplashScreen.hide(),400)` which runs ONLY if
the remote bundle's initNativeShell executes. No native fallback timeout → if the
remote JS doesn't run (SW/offline.html fallback has no Capacitor JS, or a load
hiccup) the splash hangs forever. App Review = launch hang is a hard reject.
Fix (NATIVE only, no Vercel deploy): capacitor.config.ts → launchAutoHide:true +
launchShowDuration ~2500-3000ms as a safety net (JS hide at 400ms still wins on
success). Then cap sync + rebuild. Consider also: offline.html should call a tiny
SplashScreen.hide bridge, or the native fallback covers it.

## F3 — Sign-in screen still uses OLD amber "IN OR OUT" wordmark (cosmetic, low)
The SignIn screen (Continue with Apple/Google/Email) shows the legacy amber
wordmark, not the green/red brand lockup from item 1.5 (which only restyled the
landing welcome block). Also F1 (status bar overlaps the wordmark) applies here.
Deployed-site fix; fold into the F1 safe-area sweep.

## F4 — Sign in with Apple doesn't return to app (Test 3, BLOCKER, Apple-required)
Symptom: tap Continue with Apple → system browser → Apple sheet → Face ID PASSES
→ then stuck on a BLANK appleid.apple.com page in the in-app browser; never
redirects to uk.inorout.app://auth/callback, never returns to the app signed in.
Flow (native/native-auth.js): signInWithOAuth({provider, redirectTo:
'uk.inorout.app://auth/callback', skipBrowserRedirect:true}) → Browser.open(url)
→ provider → Supabase callback → SHOULD redirect to uk.inorout.app://auth/callback
→ native-shell.js:67 appUrlOpen → exchangeCodeForSession.
⚠️ ORIGINAL CAUSE (allowlist gap) DISPROVEN s164 — see the STAGE 5.3 STATUS F4
entry below for the re-diagnosis. Short version: web Apple sign-in WORKS, so
Apple/Supabase are correct; F4 is the native SFSafariViewController custom-scheme
return only. Diagnostic that decides it: Xcode console — does appUrlOpen fire?

---

## STAGE 5.3 FIX PLAN (next session, in order)

1. **F2 (native, no deploy)** — `apps/inorout/capacitor.config.ts` SplashScreen:
   set `launchAutoHide: true` + `launchShowDuration: 2500` (JS hide at 400ms still
   wins on success; this is the safety net). `npx cap sync` → rebuild in Xcode →
   cold-launch test ×3.
2. **F1 + F3 (deployed-site — wrap loads remote app.in-or-out.com)** — add
   `env(safe-area-inset-*)` to the casual shell:
   - `components/ui/PageHeader.jsx:60` outer pad → add `env(safe-area-inset-top)`.
   - `PlayerView.jsx` stats/history tab headers (≈1657/1662) + POTM fixed banner (≈682).
   - `components/ui/NavBar.jsx` → `env(safe-area-inset-bottom)` (home indicator).
   - F3: restyle SignIn screen wordmark to green/red lockup (match item 1.5).
   Then: build → **casual-regression (MANDATORY, touches apps/inorout/src)** →
   commit → push → confirm Vercel deploy live → wrap reload picks it up.
   ⛔ Hard Rule #13 re-walk owed.
3. **F4 (native deep-link — re-diagnosed s164, NOT Supabase).** Supabase + Apple
   are PROVEN correct (web Apple sign-in works). Rebuild the current `ios/` (URL
   scheme `uk.inorout.app` already registered) and re-test Apple, WATCHING the
   Xcode console for `appUrlOpen`. If it never fires → activate the DORMANT
   ASWebAuthenticationSession opener: set `NATIVE_OAUTH_VIA='authsession'` in
   `native-auth.js` + add the `AuthSession` plugin (`apps/inorout/ios-plugins/
   AuthSession/`) to the Xcode target. No Supabase/Apple dashboard change needed.

After all three: **re-walk Tests 2,3,4,5,6,7,8,9,10** on the rebuilt app; capture
the 4.1 screenshots (1320×2868) on the corrected layout. Then Stage 6 (upload+submit).

## STAGE 5.3 STATUS (code fixes shipped)

- **F2 ✅ CODE DONE** — `capacitor.config.ts` SplashScreen now `launchAutoHide:true`
  + `launchShowDuration:2500` (native safety net; JS 400ms hide still wins on
  success). ⛔ OWED (Mac/Xcode): `npx cap sync` → rebuild → cold-launch ×3.
- **F1 ✅ CODE DONE + DEPLOYS** — `env(safe-area-inset-*)` added to: PageHeader
  top pad, NavBar bottom (`max(26px, env(safe-area-inset-bottom))`), StatsView +
  HistoryView sticky hero tops, PlayerView POTM fixed banner top. Build clean,
  hygiene 7/7, additive-only.
- **F3 ✅ CODE DONE + DEPLOYS** — SignIn header wordmark = green/red brand lockup
  (IN `C.green` · OR `C.text` · OUT `C.red`, matches PageHeader/welcome) + the
  header now carries the safe-area-top inset too (F1 on the sign-in screen).
- **F4 ⛔ OWED — but cause RE-DIAGNOSED s164 (NOT the Supabase allowlist).**
  The s163 finding blamed a missing `uk.inorout.app://auth/callback` redirect-URL
  allowlist entry. WRONG: operator confirmed s164 that entry + the Apple provider
  (Service ID `uk.inorout.app.signin`, secret, callback) were ALREADY present and
  unchanged when the walk failed. DECISIVE TEST s164: **Apple sign-in on the WEB
  (`app.in-or-out.com` in plain Safari) WORKS** — signs in, Supabase redirects,
  lands on the "Your Squads" chooser. Web uses the SAME Service ID + SAME Supabase
  callback as native, so Apple Developer Center + the secret + the Supabase Apple
  provider are all PROVEN correct. ⇒ F4 is **native-deep-link-only**. The CFBundle
  URL scheme `uk.inorout.app` IS registered in the current `ios/` Info.plist
  (`CFBundleURLSchemes`), and `native-shell.js:67` appUrlOpen→exchangeCodeForSession
  is correct. The only divergence is the final hop: Supabase 302s to
  `uk.inorout.app://auth/callback` INSIDE the SFSafariViewController that
  `@capacitor/browser` opens, and SFSafariViewController does not reliably hand a
  custom-scheme *redirect* (vs a user tap) back to the app — leaving the blank
  Apple `form_post` page on screen. NEXT: rebuild the current `ios/` (scheme now
  present) and re-test, WATCHING the Xcode console — does `appUrlOpen` fire?
    • fires (exchangeCodeForSession runs) → s163 build simply lacked the scheme; FIXED.
    • never fires (still blank) → SFSafariViewController handoff confirmed; activate
      the ASWebAuthenticationSession opener (pre-written + DORMANT in native-auth.js,
      `NATIVE_OAUTH_VIA='authsession'`; needs the AuthSession native plugin in
      `apps/inorout/ios-plugins/AuthSession/` added to the Xcode target). It returns
      the callback URL straight to JS, bypassing appUrlOpen/SFSafariViewController.
  Same path gates Google native (shares the scheme). No Supabase/Apple change needed.
- ⛔ HR#13 real-device re-walk OWED on the rebuilt app (Playwright MCP was not
  connected this session, so the browser smoke was not auto-run — additive CSS
  insets resolve to 0 on desktop; only the SignIn wordmark is visible there).

State at end of s163: Phase 0+1 DONE. ios/ is gitignored (regenerate with
`npm run build && npx cap add ios && npx capacitor-assets generate && npx cap sync`).
Bundle uk.inorout.app, Team JCC44FW6XR, signing+caps done in Xcode (persist in the
gitignored ios/ project — re-add caps in Xcode if ios/ is regenerated). Next mig=369
(unused; none expected for 5.3).
