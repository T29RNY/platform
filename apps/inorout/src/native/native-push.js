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
import { savePushSubscription, saveMemberPushSubscription, removeMemberPushSubscription } from '@platform/core/storage/supabase.js';
import { isNativeApp } from './is-native.js';

// VITE_VAPID_PUBLIC_KEY → Uint8Array for the web (PWA) PushManager.subscribe path.
function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// `callbacks` (optional): { onRegistered(), onError(err) } — fire on the ACTUAL
// async outcome so the caller can mark "subscribed" only when a token truly
// landed (not the moment registration is kicked off — which optimistically
// hid the Enable prompt forever when the token never arrived).
//
// Returns:
//   'registering' — permission granted, register() called; the real result
//                   arrives later via callbacks.onRegistered / onError
//   'denied'      — user declined the OS permission prompt
//   false         — not a native platform (caller should use the web flow)
export async function registerNativePush(playerToken, callbacks = {}) {
  if (!isNativeApp()) return false;
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

  // Avoid stacking duplicate listeners across repeated subscribe taps.
  try { await PushNotifications.removeAllListeners(); } catch { /* noop */ }

  // One-shot token capture. Listeners persist for the app's lifetime; we only
  // need the first token, but re-registers (token rotation) re-fire this and
  // upsert harmlessly via the (player_id, platform) unique key.
  await PushNotifications.addListener('registration', async (token) => {
    try {
      await savePushSubscription(playerToken, { token: token.value }, platform);
      callbacks.onRegistered?.();
    } catch (e) {
      console.error('native push: save token failed', e);
      callbacks.onError?.(e);
    }
  });

  await PushNotifications.addListener('registrationError', (err) => {
    console.error('native push: registration error', err);
    callbacks.onError?.(err);
  });

  // Triggers APNs/FCM registration; the OS replies on the 'registration' event.
  await PushNotifications.register();
  return 'registering';
}

// ── Member push (club managers / members) ─────────────────────────────────────
// Same transport as the casual player flow, but keyed on the signed-in member
// (auth.uid) instead of a player token (mig 422). Used by MemberProfile's
// Notifications toggle and the SessionsScreen soft prompt. So managers/members
// get announcements + pitch-bump pings on the phone, not just in the feed.

// Native (iOS/Android) device-token capture for the signed-in member.
// Returns 'registering' | 'denied' | false (= not native; use the web flow).
async function registerMemberNativePush(callbacks = {}) {
  if (!isNativeApp()) return false;

  const { PushNotifications } = await import('@capacitor/push-notifications');
  const platform = Capacitor.getPlatform(); // 'ios' | 'android'

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') return 'denied';

  try { await PushNotifications.removeAllListeners(); } catch { /* noop */ }

  await PushNotifications.addListener('registration', async (token) => {
    try {
      await saveMemberPushSubscription({ token: token.value }, platform);
      callbacks.onRegistered?.();
    } catch (e) {
      console.error('member push: save token failed', e);
      callbacks.onError?.(e);
    }
  });
  await PushNotifications.addListener('registrationError', (err) => {
    console.error('member push: registration error', err);
    callbacks.onError?.(err);
  });

  await PushNotifications.register();
  return 'registering';
}

// Turn ON member notifications. Native-first (APNs/FCM); on the web falls back to
// VAPID web-push. Returns:
//   'registering' — native: token arrives later via callbacks.onRegistered/onError
//   'subscribed'  — web: sub saved synchronously
//   'denied'      — OS permission declined
//   'unsupported' — web with no service-worker / PushManager
export async function enableMemberPush(callbacks = {}) {
  const native = await registerMemberNativePush(callbacks);
  if (native) return native; // 'registering' | 'denied'

  // Web (PWA / desktop browser): VAPID web-push.
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
  });
  await saveMemberPushSubscription(sub.toJSON(), 'web');
  callbacks.onRegistered?.();
  return 'subscribed';
}

// Turn OFF member notifications: drop the server rows and, on the web, also
// release the local PushManager subscription. Best-effort.
export async function disableMemberPush() {
  try {
    if (!isNativeApp() && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    }
  } catch (e) {
    console.error('member push: web unsubscribe failed', e);
  }
  await removeMemberPushSubscription();
}
