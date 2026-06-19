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
 * server.errorPath— belt-and-braces offline fallback (Stage 1.6 / Phase C):
 *                   if a navigation fails and the service worker hasn't run
 *                   for the remote origin inside the WebView, Capacitor serves
 *                   this file from the bundled webDir instead of a blank/native
 *                   error page. offline.html is copied from public/ into dist/
 *                   by the Vite build, so it is always present in webDir.
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
  appId: 'com.inorout.app',
  appName: 'In or Out',
  webDir: 'dist',
  backgroundColor: '#0A0A08',
  server: {
    url: 'https://app.in-or-out.com',
    cleartext: false,
    errorPath: 'offline.html',
  },
  plugins: {
    SplashScreen: {
      // Held until the remote WebView has loaded, then hidden manually by the
      // native bridge (native-shell.js) so users never see a white flash.
      launchAutoHide: false,
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
