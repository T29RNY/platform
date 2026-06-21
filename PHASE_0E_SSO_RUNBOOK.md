# Phase 0e — Cross-app SSO operator runbook

> **✅ SWITCHED ON — session 172 (Jun 21 2026).** venue.in-or-out.com + ref.in-or-out.com
> are live on the shared `.in-or-out.com` cookie and the cross-app SSO walk is proven
> (sign in on venue → ref reads the same session → sign out clears across). admin +
> display attached too (admin deliberately NOT in the shared cookie — internal ops, kept
> isolated). Consumer app (app.in-or-out.com) flips on its next production deploy. The
> per-domain CNAME target was `*.vercel-dns-016.com` (read it from the Vercel Add-Domain
> dialog, NOT the generic `cname.vercel-dns.com` below). platform-ref's Root Directory was
> cleared (`apps/ref`→empty) so it deploys like venue. ⛔ Real-iPhone cross-app walk still
> owed. Steps below kept for reference / future apps.

The code for cross-app single-sign-on shipped **dark** (session 169). One sign-in
will carry across every In or Out app the moment you complete the steps below. No
further code change is needed to switch it on — it's all DNS + Vercel + Supabase +
three env vars.

## What the code already does (merged, dark)

- The shared Supabase client now stores the auth session through a custom adapter
  (`packages/core/storage/cookieAuthStorage.js`). When `VITE_AUTH_COOKIE_DOMAIN`
  is **unset** (today) it behaves exactly like before (per-origin localStorage).
  When **set** to `.in-or-out.com` it writes the session to a cookie scoped to
  the parent domain, so every `*.in-or-out.com` app reads the same session.
- The in-app context switcher deep-links to the venue/ref/club apps via
  `VITE_REF_APP_URL` / `VITE_VENUE_APP_URL` / `VITE_CLUB_APP_URL` (fall back to the
  current `*.vercel.app` URLs until you point them at subdomains).
- The venue console now offers Apple + Google + email magic-link + password
  (auth-method parity with the consumer app).
- Native (Capacitor) is force-guarded onto localStorage — the cookie path never
  engages inside the wrapper, so the app-store build is untouched.

## Steps to switch SSO ON

### 1. DNS (GoDaddy) — add a CNAME per role app
For each app, add a CNAME pointing at Vercel (`cname.vercel-dns.com`):
- `venue` → venue.in-or-out.com
- `ref` → ref.in-or-out.com
- `club` → club.in-or-out.com (if/when club OS gets its own deploy; today it's the venue app)
- `admin` → admin.in-or-out.com (superadmin), `display` → display.in-or-out.com (optional)

(`app.in-or-out.com` already exists on platform-clubmanager.)

### 2. Vercel — attach each subdomain to its project
- venue.in-or-out.com → project **platform-venue**
- ref.in-or-out.com → project **platform-ref**
- admin.in-or-out.com → project **platform-superadmin**
- display.in-or-out.com → project **platform-display**

### 3. Supabase → Auth → URL Configuration → Redirect URLs
Add the new origins (and their `/auth/callback` where used):
- `https://venue.in-or-out.com`
- `https://ref.in-or-out.com`
- `https://app.in-or-out.com/auth/callback` (already present)
- any other attached subdomain origin
Apple provider: the venue origin must also be allowed by the Apple Service ID
(s159 config) for "Continue with Apple" to round-trip on venue.

### 4. Vercel env vars — set on EVERY app project that should share the session
On **platform-clubmanager, platform-venue, platform-ref** (and any other role app):

```
VITE_AUTH_COOKIE_DOMAIN = .in-or-out.com
```

On **platform-clubmanager** (the consumer app — drives the switcher deep-links):

```
VITE_REF_APP_URL   = https://ref.in-or-out.com
VITE_VENUE_APP_URL = https://venue.in-or-out.com
VITE_CLUB_APP_URL  = https://club.in-or-out.com   (optional; defaults to venue)
```

Redeploy each project after setting env vars (Vite bakes them at build time).

> ⚠️ Do **NOT** set `VITE_AUTH_COOKIE_DOMAIN` only on some apps and not others —
> any app left without it keeps writing to its own localStorage and won't see the
> shared session. Set it on every app that should participate.

### 5. One-time re-login
On the first load after the flip, each user signs in once more (the session moves
from localStorage to the shared cookie; the adapter migrates an existing
localStorage session automatically on next read, so most users won't even notice).

## OWED — real-device cross-app walk (cannot be done bot-solo)
After the flip, on a real phone: sign in once on `app.in-or-out.com`, then open
`venue.in-or-out.com` and confirm you land **already signed in** (no second
sign-in). Repeat app→ref. Then sign out on one and confirm it clears on the other.

## Security note (see DECISIONS.md, Phase 0e)
The session cookie is `SameSite=Lax; Secure`, JS-readable on every subdomain.
Supabase APIs authorise off the `Authorization: Bearer` header JS sets — not the
cookie — so there is no classic cookie-CSRF surface. The trade-off is that an XSS
on **any** subdomain can read the session for **all** subdomains. Keep the
subdomain set tight and CSP on. HttpOnly is not possible (the SDK reads it from JS).
