# In or Out — Native App Wrap (handoff / roadmap)

**Wrap the consumer PWA (`apps/inorout`, live at `https://app.in-or-out.com`) as native iOS +
Android apps for the App Store / Google Play.** Parked at end of session 150 — the domain
migration that this depends on is now COMPLETE, so the wrap can start whenever the operator is
ready. This doc is the self-contained pickup point.

---

## STATUS — parked session 150 (2026-06-18)

**Prerequisite DONE:** the domain migration is complete and live. The consumer app is on
`https://app.in-or-out.com` (Vercel project `platform-clubmanager`), the apex serves marketing
and 301/308s every token link into the app, cron/functions/auth are all on `app.`, and the
squad/admin PWA path is real-device verified. So the **wrap's load URL is locked: `https://app.in-or-out.com`.**

**Not started:** the wrap itself (Phase 8 of DOMAIN_MIGRATION.md), and the commercial accounts
it needs (Phase 0).

---

## Locked decisions (carry forward)
- **Wrapper = Capacitor** (DECISIONS.md session 131). Native push via APNs/FCM is the reason
  SMS/WhatsApp was ruled out — the wrap is what unlocks real push on iOS.
- **Wrap = the consumer app ONLY** (DECISIONS.md domain locked-decisions). Operator/internal
  apps (venue, club OS, display, hq, ref, league, superadmin) are NOT wrapped — they stay web
  (and move to subdomains later under domain-migration Phase 7, deferred).
- **Native load URL = `https://app.in-or-out.com`.**

---

## What must happen before store submission

### A. Commercial accounts (operator — the long pole; NOT done)
- **App Store Connect** developer account + **Google Play** developer account.
- Ideally on a **company identity** (`founder@in-or-out.com`), not the personal Gmail
  (`tarnysingh@gmail.com`) — see DOMAIN_MIGRATION.md Phase 0 (also parked).
- Apple Developer certs are also needed for the Wallet pass feature (Venue Memberships P5, owed).

### B. Deep-link / universal-link files (code — small, served from `app.`)
- `app.in-or-out.com/.well-known/apple-app-site-association` (iOS universal links) with the
  app's Team ID + Bundle ID.
- `app.in-or-out.com/.well-known/assetlinks.json` (Android App Links) with the package name +
  SHA-256 signing cert fingerprint.
- These let a tapped `/p/<token>` link open the native app instead of the browser. They live in
  `apps/inorout` (served by `platform-clubmanager`).

### C. Capacitor scaffold (code)
- Add Capacitor to `apps/inorout`, point the webview at `https://app.in-or-out.com`.
- Wire native push (APNs/FCM) to the existing web-push subscription model (`register_push_subscription`).
- iOS PWA niceties already in place (manifest, `start_url: /feed` for club/guardian, install bridge).

### D. Device test
- Tap a `/p/<token>` link → opens the native app (deep link). PWA install still works. Push
  opt-in + delivery on a real device. (Hard Rule #13.)

---

## ⚠️ The real pre-launch risk — owed real-device verification (~20 walks)

Almost every shipped epic passed automated gates (build / hygiene / ephemeral-verify /
casual-regression) but was **never tested on a real iPhone**. Wrapping the app puts ALL these
surfaces in front of real users, so this verification debt should be burned down (or consciously
accepted) as the wrap's QA pass. Sources: BUGS.md + FEATURES.md owed-walk notes.

- **Gym/boxing vertical** P1 (club nav labels), P2 (Pass rank chip / Profile progression,
  martial-arts club), P3 (`/book` Train tab + booking + operator QR check-in), P4 (MemberProfile
  Fight record, boxing club).
- **Classes + Room Hire** P3/P4/P5 (Classes tab + booking + timetable), P6 (check-in scanner
  camera), P7 (signed-in non-member books an open class).
- **Venue Memberships** — `/m/<token>` pass incl. under-18 + guardian branch; Wallet pass (needs
  Apple certs); venue redeploy + browser pass.
- **Membership V2 / Club OS** — multi-club routing + nav context; `/sessions` + RSVP.
- **Multi-context nav** Phase 1 on-device walk (+ Phase 2 guided tours, unbuilt).
- **Ref V2** — home-screen PWA walk (clock + sin-bin + added-time).
- **Equipment Hire** — Cycle 6 QR check-in camera.
- **Reception Display** — real-TV test (wake-lock, reconnect, PIN, colours) + venue sponsor upload.
- **Push notifications** — league availability / fixture reminders delivery unverified.
- **HQ dashboard** — deploy + Google-OAuth browser passes (also: HQ skin polish + deploy owed).
- **Persistent guests / cups player view / reserve-injured** (session 73 owed passes).
- **Monday HQ digest** delivery — eyeball once `RESEND_API_KEY` confirmed live.

These are mostly member/operator surfaces on non-football clubs, so they need real accounts on
the relevant club types to exercise.

---

## Other state worth knowing
- **Payments are DORMANT** (operator-gated): Stripe Connect + GoCardless fully built (migs
  329–337) but OFF pending the operator swapping in live keys + the money-flow sign-off. **Not a
  wrap blocker** — the app can ship wrapped with payments dormant and flip them on later.
- **Open bugs: 0.** Only cosmetic tech debt: the consumer welcome-screen styling/logo is
  off-brand (BUGS.md session 150) — worth a restyle before a public launch, not blocking.
- **Deferred domain housekeeping** (DOMAIN_MIGRATION.md): 5.3 delete the dead `inor-out` Vercel
  project; 5.4 drop the temporary apex entry from Supabase Auth Redirect URLs. Neither blocks the wrap.
- **Roadmap (not wrap blockers):** HQ Intelligence P3–P5, AI "Ask the Gaffer" P7, Public no-login
  pages P10, Classes HQ analytics P8, SaaS billing (year 2), Equipment QR self-hire C4, venue
  person/block-booking, churn flag.

---

## NEXT-SESSION PROMPT — Native app wrap (Capacitor)
```
Pick up the NATIVE APP WRAP (APP_WRAP_HANDOFF.md). Read it in full first.

CONTEXT: the domain migration is COMPLETE — the consumer app (apps/inorout) is live at
https://app.in-or-out.com (Vercel project platform-clubmanager), which is the locked native
load URL. Wrapper = Capacitor; wrap = consumer app ONLY (operator/internal apps stay web).

Decide with me which track to run FIRST (don't assume):
  1. Burn down the owed real-device verification walks (the ~20 listed in the handoff) — produce
     a prioritised checklist grouped by what a single device session covers, then walk them. This
     is the real pre-launch risk; the wrap exposes all these surfaces.
  2. Phase 8 mechanics: serve /.well-known/apple-app-site-association + assetlinks.json from app.,
     add the Capacitor scaffold to apps/inorout (load URL https://app.in-or-out.com), wire native
     push (APNs/FCM) to the existing web-push model, then deep-link device test.
  3. Phase 0 commercial accounts (App Store Connect + Google Play on the company identity) — the
     actual store-submission blocker; operator dashboard work.

Then run a full AUDIT → VERIFY → EXECUTE → VERIFY → COMMIT cycle on the chosen track. Code lands
in apps/inorout; .well-known files are served by platform-clubmanager. One PR at a time (Cloud
Session Discipline). Real-device test before commit for anything PWA/native (Hard Rule #13).

Next free migration = 362 (most wrap work is config/native, likely no migration).
```
