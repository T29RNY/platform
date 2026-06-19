// Native shell bridge — only does anything inside the Capacitor wrapper.
// On the web (PWA / browser) every call here is a guarded no-op, so this
// module is safe to import unconditionally from main.jsx.
//
// Responsibilities:
//   2.2  status bar style/colour + hide the splash once the WebView is up
//   2.4  Android hardware back button → WebView history (exit at the root)
//   3.4  appUrlOpen deep links → route the opened path into the remote app
//
// The status-bar / splash background is the shared app-shell near-black,
// pulled from the @platform/core palette (the only hygiene-exempt home for
// hex literals) so it can never drift from index.html theme-color.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { colors } from '@platform/core';
import { supabase } from '@platform/core/storage/supabase.js';

export function initNativeShell() {
  // Web build: nothing to bridge. Bail before touching any native plugin.
  if (!Capacitor.isNativePlatform()) return;

  const platform = Capacitor.getPlatform(); // 'ios' | 'android'

  // --- Status bar: light icons on the near-black shell -------------------
  StatusBar.setStyle({ style: Style.Dark }).catch(console.error);
  if (platform === 'android') {
    // iOS has no settable status-bar background (it's translucent over
    // content); Android does, and we match the app shell.
    StatusBar.setBackgroundColor({ color: colors.appShell }).catch(console.error);
  }

  // --- Splash: hide once the remote WebView has had a moment to paint -----
  // launchAutoHide is false in capacitor.config so we own the timing and
  // avoid a white flash between splash and first paint of the remote site.
  setTimeout(() => {
    SplashScreen.hide().catch(console.error);
  }, 400);

  // --- Android hardware back button → WebView history --------------------
  // Default Capacitor behaviour ignores in-app history; route it through the
  // browser history so back navigates screens, and only exit at the root.
  if (platform === 'android') {
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        App.exitApp();
      }
    }).catch(console.error);
  }

  // --- Deep links: appUrlOpen → route the opened path into the WebView ----
  // 3.4. When the OS hands a universal/app link (or our custom scheme) to the
  // wrapped app — e.g. /p/<token>, /admin/<token>, /m/<token>, /signin — the
  // WebView is already pinned to https://app.in-or-out.com (server.url), so we
  // just navigate it to the path the link carried. The app re-reads
  // window.location.pathname on load (App.jsx) and routes itself from there,
  // exactly as it does for every other window.location.href navigation.
  //
  // Both transports land here with the right path: a universal/app link parses
  // as https://app.in-or-out.com/p/<token> (pathname = /p/<token>); the custom
  // scheme parses as uk.inorout.app:///p/<token> (same pathname). We take
  // pathname+search+hash from either and ignore the origin.
  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return; // unparseable — nothing safe to route to
    }

    // 3.6. OAuth / Sign-in-with-Apple return. The provider redirected to our
    // custom scheme uk.inorout.app://auth/callback?code=… (or ?error=…). The
    // custom-scheme form parses with host='auth', pathname='/callback'; a
    // universal-link form would be host='app.in-or-out.com',
    // pathname='/auth/callback' — both normalise to …auth/callback.
    const hostPath = `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
    const isAuthReturn = hostPath.endsWith('auth/callback') &&
      (parsed.searchParams.has('code') || parsed.searchParams.has('error'));
    if (isAuthReturn) {
      // Dismiss the system browser, then finish the PKCE exchange HERE — the
      // verifier never left this webview's localStorage. exchangeCodeForSession
      // wants the bare auth code (it POSTs it as auth_code), not the URL.
      // onAuthStateChange (App.jsx) then adopts the new session; we deliberately
      // do NOT window.location-navigate (that's only right for /p,/admin,/m).
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close().catch(() => {});
        const code = parsed.searchParams.get('code');
        if (code) await supabase.auth.exchangeCodeForSession(code);
      } catch (e) {
        console.error(e);
      }
      return;
    }

    const path = parsed.pathname + parsed.search + parsed.hash;
    // Bare host / empty path: let the app keep whatever it's showing.
    if (!path || path === '/') return;
    // Already on that exact path: don't trigger a needless reload.
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (path === current) return;
    window.location.href = path;
  }).catch(console.error);
}
