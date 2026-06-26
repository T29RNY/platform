# App Store Rejection Handoff — Sign in with Apple logout (Guideline 2.1(a))

---

## ROUND 2 — build 1.0(4) REJECTED AGAIN (2026-06-25, session 212)

**The PR #96 fix did NOT hold.** App Review hit the SAME refresh-token storm on an
**iPad Air 11" (M4), iPadOS 26.5**: signed in with Apple → spinner forever → logged out.

**Root cause — now confirmed from the live auth logs, not inferred.** The reviewer's
fresh Hide-My-Email account (`s8vbkk54yc@privaterelay…`, provider `apple`) shows in
`auth.refresh_tokens`: **ONE session, 47 refresh-token rotations in 44 seconds**
(46 revoked, 1 active) → Apple's server 429'd it → logout. A single-session rotation
storm = a storage read-back failure. Since localStorage is reliable in this WebView
(the iPhone walk passed), the iPad must have been in **cookie mode** — i.e.
`Capacitor.isNativePlatform()` returned **false** in the remote-`server.url` WKWebView
on iPad, so the `__CAP_NATIVE__` flag PR #96 added was `false` and cookie mode engaged.
WKWebView then returned stale/partial cookie reads *within the session*. PR #96's
localStorage mirror did NOT save it: `getItem` only consults the mirror when the cookie
is **fully absent**, never when it reads back **wrong** (stale single value, or a
truncated chunk of a >3000-char Apple session).

**Verified before this fix:** live bundle still in cookie mode (`Domain=.in-or-out.com`
baked in); service worker only precaches `/offline.html` (no stale-bundle path — the
reviewer ran the current code); `capacitor.config` `server.url = https://app.in-or-out.com`
(so the native app loads live → a remote bundle fix reaches the 1.0(4) binary already
submitted).

**FIX SHIPPED THIS SESSION (Option 1 — detection-independent self-heal, web bundle only):**
`cookieAuthStorage.js` now reads every cookie write **straight back**; the first time
the read-back ≠ what was written, it concludes the cookie store is unreliable and
**latches to localStorage-only** for the page session. In-memory only (never persisted,
so a one-off web glitch can't permanently disable SSO); the mirror is written first so
the live session is never lost; healthy browsers round-trip exactly and never latch.
This fixes the storm **regardless of whether native detection works**, and because the
app loads live it fixes the **current 1.0(4) binary** too.
Gates: build green, hygiene 7/7, mock logic proof (healthy = no-op / 0 storms;
broken WKWebView dropping a chunk = latches on first write / 0 storms). No migration, no RPC.

**STILL OWED:**
1. Deploy the bundle (auto on push to `main`) + verify live.
2. **Real-iPhone AND real-iPad device walk** — Apple tested on iPad; the iPhone-only
   walk last round is what let this through. Force-quit/reopen ×2.
3. **Option 2 (recommended, separate native session):** add `appendUserAgent` in
   `capacitor.config.ts` so `isNative()` keys off a UA marker set at the WebView config
   level (immune to bridge timing), rebuild **1.0(5)**, device-walk, submit fresh.
   A fresh binary is the cleaner resubmission given this flow has now failed twice —
   do NOT bet on Apple re-reviewing the twice-failed 1.0(4).

---

## ROUND 1 (PR #96) — superseded by Round 2 above

**Status: FIX SHIPPED to PR, DEVICE WALK OWED.** Diagnosed s199; built + verified
2026-06-24 → **PR #96 `fix-ios-auth-storm`** (branch off `main`, built in an isolated
git worktree to avoid colliding with the concurrent manager-mobile-calendar session).
Bot-side gates all PASS (build, hygiene ×4, anti-storm storage unit-proof 12/12,
Playwright boot smoke: unauth landing renders, 0 console errors, 0 `/token` traffic).
No migration, no RPC.

**OWED before resubmit:** (1) merge PR #96 once the calendar PR has landed (sequencing);
(2) Vercel deploy + force-quit/reopen ×2; (3) the real-iPhone DEVICE WALK below; then
re-archive **1.0(4)** and resubmit with a reviewer note. `BUGS.md`/`GO_LIVE_ISSUES.md`
entries deferred to a follow-up to keep the PR conflict-free (cloud-discipline rule 4).

### WHAT SHIPPED (PR #96)
- `main.jsx` — `window.__CAP_NATIVE__ = Capacitor.isNativePlatform()` stamped before any
  storage read.
- `cookieAuthStorage.js` — `isNative()` trusts the flag (native → always localStorage);
  durable ls mirror kept; destructive `lsRemove` + write-on-read removed.
- `supabase.js` — explicit `autoRefreshToken`/`persistSession`/`detectSessionInUrl`
  (flowType left default).
- `App.jsx` — forced boot `refreshSession()` removed; resume throttle → `useRef`;
  relationships hang-guard sentinel; landing in-flight spinner; **new signed-in no-team
  onboarding branch** (Create/Join + Sign out + Manage/Delete via `/profile`) replacing
  the relay dead-end and the normal-email splash fall-through.

### ALSO IN PR #96 (post-fix audit follow-ups, App-Store-relevant)
- **In-app legal reachability (5.1.1):** Terms · Privacy · Contact were linked only
  from the logged-out splash; added to the new onboarding screen AND MemberProfile
  (normal + no-club empty state).
- **Accurate copy:** landing "No apps. No accounts." → "One link per player — they
  just tap In or Out."; SignIn "no password needed" → "no password to remember"
  (×3, dropped "10 seconds"); onboarding "No account needed." → "Players join with
  a link — no account needed."
- **Branding consistency:** unified the monochrome-amber "IN OR OUT" wordmark to the
  canonical tricolour lockup on 3 surfaces (multi-team landing, PWAWelcome, Legal);
  removed the unbuilt "Advanced Chemistry — Coming soon" card from My IO.
- **DEFERRED (separate follow-up after the device walk):** the larger font/colour-
  system unification (Inter vs DM Sans — DM Sans isn't even loaded; C.* palette vs
  CSS vars) — ~10 files on the daily-driver app, too much regression surface to fold
  into the resubmission PR.

### THOROUGH PRE-RESUBMIT AUDIT (5 parallel sweeps) — outcomes
- Self-review of the PR diff: CORRECT (no token-bleed on account-switch; onboarding
  branch can't fire for a user with a team; card removal clean).
- Fresh-reviewer walkthrough: "ship confidently" — no placeholders/dead buttons/raw errors.
- Client security: clean (only publishable keys client-side; zero console.log; RLS-gated).
- Fixed: PWA-install dead-end (PWAWelcome escape hatch; native binary was never affected);
  a11y (44pt tap targets on legal links, contrast C.faint→C.muted, Legal safe-area).
- **Payments (3.1.1):** all in-app payment handoffs (Stripe Checkout, GoCardless,
  billing portal, hosted invoice) now open in the SYSTEM browser on native via
  `native/open-external.js` — payment leaves the app, not in the WKWebView.
- **Privacy policy (Legal.jsx):** added Apple + OpenStreetMap/Nominatim processors;
  effective date → 24 June 2026.

### OWED — App Store Connect "App Privacy" nutrition labels (OPERATOR form, not code)
Declare (all "Data Not Used to Track You" — no ATT prompt needed; PostHog is
EU-hosted, identified-only, respects DNT, no ad SDKs):
- Contact Info → Name, Email — Linked to identity — App Functionality.
- Identifiers → User ID — Linked — App Functionality + Analytics.
- Usage Data → Product Interaction; Diagnostics → device/browser — PostHog — Analytics.
- Purchases → purchase/membership status (NOT card details — Stripe/GoCardless hold those).
- Tracking section: NONE.
Third parties/sub-processors in play: Supabase, Vercel, PostHog (EU), Stripe,
GoCardless, Resend, Twilio, Google (sign-in/fonts), Apple (sign-in),
OpenStreetMap/Nominatim, Unsplash (images).

### DEVICE WALK (the only real proof — run after deploy)
1. Confirm the Vercel deploy carrying PR #96 is live, then **force-quit + reopen the
   home-screen app twice** (the service worker swaps the bundle on the 2nd open).
2. **Sign in with Apple → choose "Hide My Email."**
3. Confirm **(a)** you STAY logged in — no bounce back to the sign-in screen after ~1 min;
   no "Loading…" hang on Feed.
4. Confirm **(b)** you land on the new **"You're signed in / not in a team yet"** screen
   (Create or join a team + the Hide-My-Email secondary hint).
5. Confirm **(c)** **Sign out** works and **Manage account → Delete my account** is reachable.
6. If all three pass → re-archive **1.0(4)**, resubmit, reviewer note: "Fixed the Sign in
   with Apple session-persistence loop and added a proper signed-in onboarding/account
   screen for new accounts."

---

## ORIGINAL DIAGNOSIS (s199, retained for reference)

---

## THE REJECTION

- Submission `17842d37-40ab-455b-9def-19ffbdad16b2`, version **1.0 (3)**, reviewed
  2026-06-24 on iPhone 17 Pro Max / iOS 26.5.
- Guideline **2.1(a)** — "we were logged out of the app a few moments after we logged
  in using Sign in with Apple."
- Two reviewer screenshots: (1) signed-in **Feed** (multi-context nav Feed/Sessions/
  Profile) stuck on **"Loading…" forever** at 5:42; (2) back at the **sign-in screen**
  at 5:43. I.e. a genuine logout ~1 min after login, with data screens hung meanwhile.

## ROOT CAUSE — refresh-token storm (CONFIRMED from live auth logs)

Supabase **auth logs at the exact review time** (12:42 UTC 2026-06-24, user
`729cmfr5bv@privaterelay.appleid.com`, name "John Apple", uid `ae5cf136-…`): in a 41s
window — **45 refresh-token logins, 38 `token_revoked`, 8 `token_refreshed`, 4 ×
`429 over_request_rate_limit`** on `POST /token`. Refreshes were *succeeding* server-side
and the client kept re-asking ≈1/sec → that is a **storage-not-persisting loop**, not a
credentials problem. supabase-js refreshes → rotates token → can't read the new one back
→ refreshes again → 429 → session dropped → logout. The Feed RPC is starved by the
storm/auth-lock → permanent "Loading…".

**Why it regressed since the s164 device walk passed:** nothing in the binary changed —
the wrap loads the **remote** bundle. Phase-0e cross-app SSO was switched on in **s172**
(`VITE_AUTH_COOKIE_DOMAIN=.in-or-out.com`), *after* s164. That moved the auth session
from localStorage to a shared **cookie** on `.in-or-out.com`. Inside the WKWebView the
cookie is not reliably persisted (the adapter's own header admits "WKWebView cookies are
unreliable across launches"). The native guard that is *supposed* to force localStorage
in the wrap is not holding, so the wrap fell into cookie mode → the storm.

Guard-failure mechanism (auditors split, fix makes it moot): `cookieAuthStorage.isNative()`
checks `window.Capacitor?.isNativePlatform?.()`. For a **remote `server.url`** WKWebView,
`isNativePlatform()` keys off `window.webkit.messageHandlers.bridge`, which may be absent
even while the App/Browser plugins (deep links) still work — so the guard can read false
and cookie mode engages.

## COMPOUNDING ISSUES FOUND IN THE DEEP AUDIT (4 parallel auditors)

Storm amplifiers:
- **Forced `refreshSession()` on every boot** — `apps/inorout/src/App.jsx:531` — races
  supabase-js's own auto-refresh; each rotation revokes the prior token.
- **Resume-handler refresh throttle resets** — `App.jsx:816-854`: `lastAuthRefresh` is
  declared *inside* the effect whose dep (`refreshTeamData`, deps `[route?.type,
  route?.token]`) changes on route change → the 5-min throttle is defeated.
- **Destructive migration-read in the adapter** — `packages/core/storage/cookieAuthStorage.js`
  `getItem` (~:91-94) does a write-on-read; `setItem` (~:109) `lsRemove`s the localStorage
  copy *before* confirming the cookie persisted → guaranteed read/write disagreement when
  the cookie write is dropped.
- Client auth options are all SDK defaults (no `flowType`/`autoRefreshToken`/`lock`/
  `detectSessionInUrl` set) — `packages/core/storage/supabase.js:7-26`. Native return is an
  implicit `#access_token` hash fed to a PKCE-default client (works today via
  `detectSessionInUrl`, but brittle — leave flow as-is, just make config explicit).

Routing / fresh-user dead-end (this is the *next* rejection if unfixed — the reviewer was a
fresh Hide-My-Email account with NO teams):
- A freshly-authed user with zero relationships → `homeScreenType === "squad_only"`
  (`App.jsx:374-383`). With 0 squads + 0 admin teams:
  - **privaterelay email** → "NEW ACCOUNT / Sign in a different way" dead-end
    (`App.jsx:1445-1480`) — pushes them to sign OUT, not onboard.
  - **normal email** → falls through to the **logged-out-looking marketing splash**
    (`App.jsx:1482`) — "No accounts… Already have a team? Sign in" shown to a signed-in user.
- From **neither** screen can the user reach **Sign Out or Delete Account** → also breaks
  **Guideline 5.1.1(v)** (Privacy Policy `Legal.jsx:81,153` promises in-app deletion;
  `/profile`/`MemberProfile.jsx:357-408` has the buttons but is only reachable via
  `ClubNavBar`, which a no-team user never sees).
- **Hang vector** — `getUserRelationships` throws on RPC error; `App.jsx:746-748` `.catch`
  swallows it and never sets state → `relationships` stays `null` forever → landing oracle
  never fires. Same swallow for `myAdminTeams` (:756) and `myWorld` (:763).
- **In-flight flash** — while a signed-in user's relationships/myAdminTeams are still loading,
  none of the landing branches match and the **marketing splash paints** (`loading` was set
  false for landing at :504-505) → brief logged-out look for everyone.

Already compliant (defence points — DON'T touch): account-deletion backend works end-to-end
(`delete_my_account_auth` mig 370 + `api/delete-account.js`); "Continue with Apple" is
first/most-prominent on all sign-in surfaces (`SignIn.jsx`/`JoinTeam.jsx`/`EmailCaptureOverlay.jsx`);
push permission fires only on explicit tap, never at launch (`native-push.js` ← `PlayerView.handleSubscribe`);
no other blank/null top-level routes for a fresh user.

---

## THE FIX (one PR; operator chose option A for the onboarding)

### Part 1 — kill the storm (defense-in-depth; dies regardless of exact guard theory)
1. **Deterministic native detection.** In `apps/inorout/src/main.jsx`, synchronously set
   `window.__CAP_NATIVE__ = Capacitor.isNativePlatform()` (reliable `@capacitor/core` API)
   *before* any auth-storage read (set it in the module body before `render()`; storage
   reads are async microtasks so the flag wins). `cookieAuthStorage.isNative()` trusts
   `window.__CAP_NATIVE__ === true` first, then falls back to the existing global check.
   Native → localStorage always; **web SSO untouched** (flag is false on web).
2. **Non-destructive storage.** In `cookieAuthStorage.js`: never `lsRemove` until a cookie
   write is confirmed readable (write → `readCookie` verify → only then drop the mirror);
   keep localStorage as a durable fallback; make the migration-read non-destructive.
3. **Remove the forced boot `refreshSession()`** (`App.jsx:531`) — let supabase-js own
   refreshing. Convert the resume throttle (`App.jsx:817`) to a `useRef` so it can't reset.
   Make client auth config explicit in `supabase.js` (`autoRefreshToken:true`,
   `persistSession:true`, `detectSessionInUrl:true`) — keep default `flowType` (web works).

### Part 2 — proper signed-in onboarding (A) + reachability
4. **New "signed-in, no team" branch** inserted **after the "Your Teams" chooser (~`App.jsx:1437`)
   and BEFORE both the relay block (`:1445`) and the generic landing (`:1482`)**, matching
   `route.type==="landing" && authReady && authUser && relationships && myAdminTeams!==null &&
   homeScreenType==="squad_only" && (relationships.squads?.length??0)===0 &&
   myAdminTeams.length===0`. Renders: "You're signed in as <email/name>", primary **Create a
   team** (`/create`), **Join a team / paste link**, AND visible **Sign out** + account/**Delete**
   access (link to `/profile`). Pass an `isRelay` flag to keep the Hide-My-Email "you may
   already have another account" note as a *secondary* hint, not the whole screen. This
   subsumes the relay dead-end, stops normal-email fall-through, and closes the 5.1.1(v)
   deletion-reachability gap in one move.
5. **Hang guard** — `App.jsx:746/756/763` `.catch` set an empty sentinel
   (e.g. `{squads:[],club_memberships:[],guardian_of:[]}`) instead of leaving `null`.
6. **In-flight guard** — between `App.jsx:1348` and `1354`, if `authReady && authUser &&
   (relationships===null || myAdminTeams===null)` render a spinner, not the splash.
7. Secondary (nice-to-have): add a "Create or join a team" CTA to the Sessions/Feed/Parent
   empty states (`SessionsScreen.jsx:1059`, `UnifiedFeedScreen.jsx:178`, `ParentHomeScreen.jsx:207`).

---

## VERIFICATION
- **Bot-side (this PR):** Playwright no-storm proof — sign in on local dev, watch network,
  confirm `POST /token` does NOT loop (count refreshes over 60s = ~0). Standard gates:
  `bash skills/scripts/check-build.sh`, `check-hygiene.sh` on every touched file,
  casual-regression (App.jsx touched), boot smoke. cookieAuthStorage round-trip unit-proof.
  No EV (no new write RPC). No migration.
- **Operator device walk (the only real proof — OWED, HR#13):** deploy → force-quit/reopen
  ×2 (service worker swaps on 2nd open) → **Sign in with Apple using "Hide My Email"** →
  confirm: (a) you STAY logged in (no bounce to sign-in), (b) you land on the new
  "create/join" onboarding, (c) Sign out + Delete account are reachable from it. Then
  re-archive **1.0 (4)** and resubmit with a reviewer note pointing at the fix.

## FILES IN SCOPE
- `apps/inorout/src/main.jsx` (native flag)
- `packages/core/storage/cookieAuthStorage.js` (guard + non-destructive storage)
- `packages/core/storage/supabase.js` (explicit auth config)
- `apps/inorout/src/App.jsx` (remove forced refresh; resume throttle ref; new onboarding
  branch; hang/in-flight guards)
- (optional) `SessionsScreen.jsx` / `UnifiedFeedScreen.jsx` / `ParentHomeScreen.jsx` empty-state CTAs

## CAUTIONS
- **RUN ONE SESSION ONLY** on this repo (native-wrap epic discipline).
- Working tree has **in-progress venue work** (resource-calendar layout: `apps/venue/src/*`).
  Do NOT sweep it into the auth-fix commit — stage only the files above.
- All fixes are in the **remote bundle** (+ `main.jsx`, also remote) → reach the device via
  Vercel deploy + force-quit/reopen ×2, NOT `cap sync`.
- This is Apple's FIRST review result on 1.0(3); manual release was chosen, so nothing is live.
