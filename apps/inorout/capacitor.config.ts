import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the In or Out CONSUMER app ONLY.
 *
 * This wraps the live consumer site (apps/inorout, deployed to the Vercel
 * project `platform-clubmanager` at https://app.in-or-out.com) — NOT venue,
 * display, hq, clubmanager, ref, league or superadmin. The native shell is a
 * thin container that loads the remote URL; it is not a local-bundle app.
 *
 * server.url      — the native WebView loads the live site directly, so the
 *                   app and the wrapped build never drift. Updates ship the
 *                   instant Vercel deploys, same as the PWA.
 * server.errorPath— REMOVED in Stage 5.3 (finding F5). It was a belt-and-braces
 *                   offline fallback (Stage 1.6 / Phase C), but Capacitor fires
 *                   it on ANY provisional-navigation failure — including
 *                   NSURLErrorCancelled (-999), which is NOT an offline state.
 *                   App.jsx's launch redirect bridge calls window.location.replace
 *                   synchronously during the first render (resume to last context /
 *                   ioo_last_visited), which cancels the in-flight load → -999 →
 *                   Capacitor swapped in offline.html EVEN WHEN FULLY ONLINE,
 *                   stranding every launch on "You're offline". A remote-URL wrap
 *                   that does early client-side redirects is fundamentally
 *                   incompatible with errorPath (it can't tell cancelled from
 *                   failed). Genuine-offline UX belongs at the app level (React
 *                   can read navigator.onLine + failed fetches), not here.
 *                   offline.html stays in public/ for potential app-level reuse.
 * webDir          — the Vite build output. With server.url set its contents
 *                   are not served as the app shell; it exists so cap can copy
 *                   a bundle (and the errorPath fallback) into the native
 *                   projects. Run `npm run build` before `npx cap sync`.
 *
 * Native projects (ios/ + android/) are generated on a build machine that has
 * Xcode + CocoaPods (iOS) and Android Studio + JDK (Android):
 *     cd apps/inorout
 *     npm run build
 *     npx cap add ios
 *     npx cap add android
 *     npx capacitor-assets generate            # icons + splash (see assets/)
 *     npx cap sync
 * They are gitignored (see apps/inorout/.gitignore) — regenerate, don't commit.
 */
const config: CapacitorConfig = {
  // Bundle ID / applicationId. `com.inorout.app` was unavailable on the Apple
  // Developer account, so the registered identifier is `uk.inorout.app`. This
  // exact string must match the App ID created in 3.1, the APNs topic, the AASA
  // / assetlinks files (3.3), and the package name when `npx cap add ios/android`
  // first runs (Capacitor bakes it into the native projects at creation time).
  appId: 'uk.inorout.app',
  appName: 'In or Out',
  webDir: 'dist',
  backgroundColor: '#0A0A08',
  // Appended to the WKWebView / Android WebView User-Agent. This is the DETERMINISTIC
  // native signal `isNativeApp()` keys off (src/native/is-native.js): it's baked into
  // the UA at the native config level, so it's present from the first line of JS and
  // immune to the bridge-injection timing that made Capacitor.isNativePlatform() read
  // FALSE in the remote-server.url WKWebView on the App Review iPad — the root cause of
  // both 2.1(a) rejections. Must match NATIVE_UA_MARKER in is-native.js.
  appendUserAgent: 'InorOutApp',
  server: {
    url: 'https://app.in-or-out.com',
    cleartext: false,
    // errorPath removed — see the server.errorPath note above (finding F5).
  },
  plugins: {
    SplashScreen: {
      // The native bridge (native-shell.js) hides the splash at ~400ms once the
      // remote bundle's initNativeShell runs — that still wins on a normal launch.
      // launchAutoHide + launchShowDuration is the NATIVE safety net: if the
      // remote JS never executes (offline.html fallback has no Capacitor JS, or a
      // load hiccup) the splash auto-hides after 2.5s instead of hanging forever.
      // A launch hang is a hard App Review reject (Stage 5.2 finding F2).
      launchAutoHide: true,
      launchShowDuration: 2500,
      backgroundColor: '#0A0A08',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      // Dark style = light icons/text, for our near-black shell.
      style: 'DARK',
      backgroundColor: '#0A0A08',
    },
  },
};

export default config;
