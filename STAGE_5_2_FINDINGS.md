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
Likely cause (per native-auth.js:22 "DORMANT until allowlist"):
  1. uk.inorout.app://auth/callback NOT in Supabase Auth → Redirect URLs allowlist.
  2. and/or Apple provider Service ID (uk.inorout.app.signin) return URL / Apple
     "Sign in with Apple" key not fully configured in Supabase Auth providers.
Owner: 👤 Supabase dashboard (Auth → URL Config → Redirect URLs add the custom
scheme; Auth → Providers → Apple verify Service ID + key). Then re-test.
Same allowlist gap will also break Google return (Test 4) — test after fix.
Diagnostic still wanted: Xcode console lines around the tap (appUrlOpen? error?).

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
3. **F4 (👤 Supabase dashboard)** — Auth → URL Configuration → Redirect URLs:
   add `uk.inorout.app://auth/callback`. Auth → Providers → Apple: confirm
   Service ID `uk.inorout.app.signin` + the Apple sign-in key are set. Then
   re-test Apple AND Google return (same allowlist gates both).

After all three: **re-walk Tests 2,3,4,5,6,7,8,9,10** on the rebuilt app; capture
the 4.1 screenshots (1320×2868) on the corrected layout. Then Stage 6 (upload+submit).

State at end of s163: Phase 0+1 DONE. ios/ is gitignored (regenerate with
`npm run build && npx cap add ios && npx capacitor-assets generate && npx cap sync`).
Bundle uk.inorout.app, Team JCC44FW6XR, signing+caps done in Xcode (persist in the
gitignored ios/ project — re-add caps in Xcode if ios/ is regenerated). Next mig=369
(unused; none expected for 5.3).
