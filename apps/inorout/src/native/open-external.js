import { isNativeApp } from "./is-native.js";

// Open a URL OUTSIDE the app's own webview.
//
// In the native wrap (iOS/Android via Capacitor) this hands the URL to the
// SYSTEM browser (SFSafariViewController / Custom Tab) instead of navigating the
// app's WKWebView. That keeps every third-party PAYMENT page — Stripe Checkout,
// GoCardless mandate setup, the Stripe billing portal, hosted invoices — out of
// the app shell, which is the posture App Store guideline 3.1.1 expects for
// external purchases (payment visibly leaves the app rather than rendering
// inside it). On the web it is an ordinary same-tab navigation, so the existing
// Stripe redirect-and-return flow (success/cancel URLs) is unchanged.
//
// `@capacitor/browser` is a native plugin — lazy-import it so it never loads on
// web (mirrors native-auth.js).
export async function openExternal(url) {
  if (!url) return;
  if (isNativeApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch (e) {
      console.error("openExternal: Browser.open failed, falling back to navigation", e);
    }
  }
  window.location.href = url;
}
