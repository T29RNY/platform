# AuthSession — DORMANT iOS OAuth-return plugin (Stage 5.3 / finding F4)

A minimal Capacitor plugin wrapping `ASWebAuthenticationSession`. It exists as a
**fallback** for native Apple/Google sign-in return. It is **not active** until
you both flip the JS flag and add these files to the Xcode target.

## When to activate

Only if, after rebuilding the iOS app with the `uk.inorout.app` URL scheme
registered, native Apple sign-in **still** hangs on the blank Apple page and the
Xcode console shows `appUrlOpen` **never firing**. That confirms the
SFSafariViewController (`@capacitor/browser`) custom-scheme handoff is the cause.

Background: web Apple sign-in already works (s164), so Apple Developer Center, the
Apple secret, and the Supabase Apple provider are all correct. The only break is
the final `uk.inorout.app://auth/callback` redirect not returning to the app from
inside SFSafariViewController. ASWebAuthenticationSession returns the callback URL
directly to JS, bypassing that hop entirely.

## How it works

`registerPlugin('AuthSession').start({ url, scheme })` opens `url` in an
`ASWebAuthenticationSession` keyed to `scheme` (`uk.inorout.app`) and resolves
with `{ url: '<full callback URL with ?code=…>' }`. `native-auth.js`
(`startOAuthViaAuthSession`) then runs `supabase.auth.exchangeCodeForSession(code)`
in the same webview where the PKCE verifier was stored — identical to the
existing appUrlOpen path, just with a reliable opener.

## Activation steps (on the Mac, after `npx cap add ios`)

1. **Flip the flag** — in `apps/inorout/src/native/native-auth.js` set:
   ```js
   const NATIVE_OAUTH_VIA = 'authsession';
   ```
   Build + deploy app.in-or-out.com (the wrap loads the remote bundle).

2. **Add the plugin to the Xcode target** — in Xcode, drag both files into the
   `App` target (Build Phases → Compile Sources must list `AuthSessionPlugin.swift`;
   the `.m` registers it with Capacitor):
   - `AuthSessionPlugin.swift`
   - `AuthSessionPlugin.m`
   If prompted to create an Objective-C bridging header, accept it.

3. **No extra capability needed** — `ASWebAuthenticationSession` is part of
   `AuthenticationServices` (already linked on iOS 12+). The `uk.inorout.app`
   URL scheme must be registered in Info.plist (it already is).

4. **Rebuild + re-test** Apple and Google. The session now returns to the app
   directly; `exchangeCodeForSession` runs in `native-auth.js`, not appUrlOpen.

## Files

| File | Purpose |
|---|---|
| `AuthSessionPlugin.swift` | The plugin: opens ASWebAuthenticationSession, resolves with the callback URL. |
| `AuthSessionPlugin.m` | Capacitor `CAP_PLUGIN` registration exposing it to JS as `AuthSession`. |

These live outside the gitignored `ios/` so they survive `npx cap add ios`
regenerations — copy/drag them into the regenerated project each time (or keep
them in a synced plugin folder).
