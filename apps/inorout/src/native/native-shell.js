// Native shell bridge — only does anything inside the Capacitor wrapper.
// On the web (PWA / browser) every call here is a guarded no-op, so this
// module is safe to import unconditionally from main.jsx.
//
// Responsibilities (Stage 2 of the app-store epic):
//   2.2  status bar style/colour + hide the splash once the WebView is up
//   2.4  Android hardware back button → WebView history (exit at the root)
//
// The status-bar / splash background is the shared app-shell near-black,
// pulled from the @platform/core palette (the only hygiene-exempt home for
// hex literals) so it can never drift from index.html theme-color.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { colors } from '@platform/core';

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
}
