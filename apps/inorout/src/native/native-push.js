// Native push bridge (Stage 3.5 of the app-store epic).
//
// Only does anything inside the Capacitor wrapper. On the web (PWA / browser)
// `registerNativePush` is a no-op that returns false, so PlayerView can call it
// unconditionally and fall back to the existing web-push (VAPID) flow when it
// returns false.
//
// Flow on a native device:
//   1. check / request notification permission
//   2. register with APNs (iOS) / FCM (Android) — the OS hands back a device
//      token asynchronously via the 'registration' listener
//   3. persist that token against the player via register_push_subscription
//      with platform='ios'|'android' and subscription={ token: '<device>' }
//
// The SERVER send-path (api/notify.js) is what turns that token into a delivered
// push; its APNs/FCM branches stay dormant until the operator supplies the
// signing creds (Stage 3.1/3.2). Capturing the token now is harmless and means
// no client change is needed when those creds land.

import { Capacitor } from '@capacitor/core';
import { savePushSubscription } from '@platform/core/storage/supabase.js';

// Returns:
//   'subscribed'   — permission granted, registration kicked off, token will be
//                    saved by the listener
//   'denied'       — user declined the OS permission prompt
//   false          — not a native platform (caller should use the web flow)
export async function registerNativePush(playerToken) {
  if (!Capacitor.isNativePlatform()) return false;
  if (!playerToken) return false;

  // Lazy import: the plugin throws "not implemented on web", so it must never be
  // evaluated on the web build path.
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const platform = Capacitor.getPlatform(); // 'ios' | 'android'

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') return 'denied';

  // One-shot token capture. Listeners persist for the app's lifetime; we only
  // need the first token, but re-registers (token rotation) re-fire this and
  // upsert harmlessly via the (player_id, platform) unique key.
  await PushNotifications.addListener('registration', async (token) => {
    try {
      await savePushSubscription(playerToken, { token: token.value }, platform);
      // TEMP on-device diagnostic (push delivery test, session 165): confirm the
      // full path succeeded without needing Xcode/Console. Remove once verified.
      if (typeof alert === 'function') alert(`Push registered ✓\nToken saved (${platform}).`);
    } catch (e) {
      console.error('native push: save token failed', e);
      if (typeof alert === 'function') alert(`Push: token received but SAVE failed.\n${e?.message || e}`);
    }
  });

  await PushNotifications.addListener('registrationError', (err) => {
    console.error('native push: registration error', err);
    // TEMP on-device diagnostic — surfaces the real APNs error (e.g. missing
    // aps-environment / provisioning) instead of swallowing it. Remove once verified.
    if (typeof alert === 'function') {
      alert(`Push registration FAILED (Apple/APNs).\n${err?.error || err?.message || JSON.stringify(err)}`);
    }
  });

  // Triggers APNs/FCM registration; the OS replies on the 'registration' event.
  await PushNotifications.register();
  return 'subscribed';
}
