// POST /api/notify — two modes:
//
// Direct (event-triggered from app):
//   { type, teamId, playerIds?, payload: { title, body, icon }, gameDate? }
//
// Cron (called by pg_cron via pg_net, requires Authorization header):
//   { cronType: "flushQueue"|"gameDay9am"|"oneHrBefore"|"debtReminder"|"bibs24hr"|"bibs45min"|"autoOpen"|"teamsConfirmed" }
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, CRON_SECRET

const webpush = require('web-push');
const http2 = require('http2');
const crypto = require('crypto');
// Email fallback for the debt chase (PR #4). _mailer guards its own require of `resend` and
// no-ops to {skipped:'no_api_key'} without RESEND_API_KEY, so importing it here can never
// crash the push path — same reasoning cron.js relies on.
const { sendTemplated } = require('./_mailer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── Native push transports (Stage 3.5) ─────────────────────────────────────────
// DORMANT until the operator supplies signing creds (epic Stage 3.1/3.2). Each
// transport no-ops cleanly ({ ok:false, skipped:true }) when its env is absent,
// so web-push is never affected. Mirrors the Stripe/GoCardless "live keys → on"
// pattern used elsewhere in this codebase. Both paths use Node built-ins only
// (no new dependency). NOT runnable in EV / on-device until creds land — first
// real exercise is the Stage 5.2 device walk.

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// --- APNs (iOS): HTTP/2 to Apple, ES256 JWT signed with the .p8 auth key ------
// env: APNS_KEY_P8 (PEM contents), APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID,
//      APNS_PRODUCTION ('true' → api.push.apple.com, else sandbox)
let _apnsJwt = null;
let _apnsJwtAt = 0;
function apnsConfigured() {
  return !!(process.env.APNS_KEY_P8 && process.env.APNS_KEY_ID &&
            process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID);
}
function apnsToken() {
  // Apple rejects tokens older than 1h; refresh every ~50 min.
  const now = Date.now();
  if (_apnsJwt && now - _apnsJwtAt < 50 * 60 * 1000) return _apnsJwt;
  const header  = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }));
  const iat     = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat }));
  const signer  = crypto.createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const sig = b64url(signer.sign({
    key: process.env.APNS_KEY_P8.replace(/\\n/g, '\n'),
    dsaEncoding: 'ieee-p1363', // ES256 raw r||s, not DER
  }));
  _apnsJwt = `${header}.${payload}.${sig}`;
  _apnsJwtAt = now;
  return _apnsJwt;
}
function deliverApns(sub, payloadObj) {
  return new Promise((resolve) => {
    if (!apnsConfigured()) return resolve({ ok: false, skipped: true });
    const deviceToken = sub.subscription?.token;
    if (!deviceToken) return resolve({ ok: false });
    const host = process.env.APNS_PRODUCTION === 'true'
      ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    let client;
    try { client = http2.connect(host); } catch { return resolve({ ok: false }); }
    client.on('error', () => { try { client.close(); } catch {} resolve({ ok: false }); });
    const body = JSON.stringify({
      aps: { alert: { title: payloadObj.title, body: payloadObj.body }, sound: 'default' },
      url: payloadObj.url,
    });
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${apnsToken()}`,
      'apns-topic': process.env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });
    let status = 0;
    let data = '';
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { client.close(); } catch {}
      if (status === 200) return resolve({ ok: true });
      // 410 = unregistered; 400 BadDeviceToken = stale → prune.
      const gone = status === 410 || (status === 400 && /BadDeviceToken/.test(data));
      if (!gone) console.error('APNs send failed:', status, data);
      resolve({ ok: false, gone });
    });
    req.on('error', () => { try { client.close(); } catch {} resolve({ ok: false }); });
    req.end(body);
  });
}

// Diagnostic: send to a DUMMY device token to prove the JWT/creds/topic are
// accepted by Apple WITHOUT needing a real device. Returns Apple's raw status +
// reason. Expected when creds are correct: 400 / "BadDeviceToken" (auth OK, token
// bad). A 403 "InvalidProviderToken"/"ExpiredProviderToken" means the .p8/key-id/
// team-id/signing is wrong. A 400 "TopicDisallowed"/"BadTopic" means APNS_BUNDLE_ID
// is wrong. Used by the `apnsDiag` cron branch. Never delivers a real push.
function apnsHandshakeProbe() {
  return new Promise((resolve) => {
    if (!apnsConfigured()) return resolve({ configured: false });
    const host = process.env.APNS_PRODUCTION === 'true'
      ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    let client;
    try { client = http2.connect(host); }
    catch (e) { return resolve({ configured: true, error: e.message }); }
    client.on('error', (e) => { try { client.close(); } catch {} resolve({ configured: true, error: e.message }); });
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${'a'.repeat(64)}`,
      authorization: `bearer ${apnsToken()}`,
      'apns-topic': process.env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });
    let status = 0, data = '';
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { client.close(); } catch {}
      let reason = data;
      try { reason = JSON.parse(data).reason || data; } catch {}
      const credsOk = status === 400 && reason === 'BadDeviceToken';
      resolve({
        configured: true,
        production: process.env.APNS_PRODUCTION === 'true',
        bundleId: process.env.APNS_BUNDLE_ID,
        status, reason,
        credsAccepted: credsOk,
        verdict: credsOk
          ? 'APNs creds/signing/topic all accepted by Apple (dummy token rejected as expected).'
          : `Unexpected — investigate: status=${status} reason=${reason}`,
      });
    });
    req.on('error', (e) => { try { client.close(); } catch {} resolve({ configured: true, error: e.message }); });
    req.end(JSON.stringify({ aps: { alert: { title: 'probe', body: 'probe' }, sound: 'default' } }));
  });
}

// --- FCM (Android): HTTP v1 with an OAuth token from the service account -------
// env: FCM_SERVICE_ACCOUNT (service-account JSON string), FCM_PROJECT_ID (optional
//      — falls back to project_id inside the service account)
let _fcmToken = null;
let _fcmTokenAt = 0;
function fcmServiceAccount() {
  if (!process.env.FCM_SERVICE_ACCOUNT) return null;
  try { return JSON.parse(process.env.FCM_SERVICE_ACCOUNT); } catch { return null; }
}
async function fcmAccessToken(sa) {
  const now = Date.now();
  if (_fcmToken && now - _fcmTokenAt < 50 * 60 * 1000) return _fcmToken;
  const iat = Math.floor(now / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat, exp: iat + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const assertion = `${header}.${payload}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('FCM token exchange failed');
  _fcmToken = json.access_token;
  _fcmTokenAt = now;
  return _fcmToken;
}
async function deliverFcm(sub, payloadObj) {
  const sa = fcmServiceAccount();
  if (!sa) return { ok: false, skipped: true };
  const deviceToken = sub.subscription?.token;
  if (!deviceToken) return { ok: false };
  const projectId = process.env.FCM_PROJECT_ID || sa.project_id;
  try {
    const accessToken = await fcmAccessToken(sa);
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: payloadObj.title, body: payloadObj.body },
            data: { url: payloadObj.url || '' },
          },
        }),
      }
    );
    if (res.ok) return { ok: true };
    const txt = await res.text();
    const gone = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt);
    if (!gone) console.error('FCM send failed:', res.status, txt);
    return { ok: false, gone };
  } catch (e) {
    console.error('FCM send error:', e.message);
    return { ok: false };
  }
}

// --- Web (PWA / browser): VAPID web-push (the live transport) ------------------
async function deliverWeb(sub, payloadObj) {
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payloadObj));
    return { ok: true };
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) return { ok: false, gone: true };
    console.error('webpush.sendNotification failed:', err.statusCode, err.body || err.message);
    return { ok: false };
  }
}

// Platform dispatcher. `payloadObj` is the fully-built notification (title, body,
// icon, url). Returns { ok, gone } so the caller can prune dead subscriptions.
async function deliverPush(sub, payloadObj) {
  switch (sub.platform || 'web') {
    case 'ios':     return deliverApns(sub, payloadObj);
    case 'android': return deliverFcm(sub, payloadObj);
    default:        return deliverWeb(sub, payloadObj);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function isQuietHours(quietStart, quietEnd) {
  const h  = new Date().getHours();
  const sh = parseInt(quietStart.split(':')[0], 10);
  const eh = parseInt(quietEnd.split(':')[0], 10);
  if (sh > eh) return h >= sh || h < eh; // crosses midnight
  return h >= sh && h < eh;
}

function nextQueueTime(quietEnd) {
  const [eh, em] = quietEnd.split(':').map(Number);
  const t = new Date();
  t.setHours(eh, em, 0, 0);
  if (t <= new Date()) t.setDate(t.getDate() + 1);
  return t.toISOString();
}

async function alreadySent(teamId, type, gameDate) {
  const { data } = await supabase
    .from('notification_log')
    .select('id')
    .eq('team_id', teamId)
    .eq('type', type)
    .eq('game_date', gameDate)
    .not('sent_at', 'is', null)
    .limit(1);
  return (data?.length || 0) > 0;
}

// ── Email fallback for the debt chase (ADMIN_DEBT_CHASE_HANDOFF PR #4) ───────
// Push is the only channel this endpoint has ever had, which is why the chase silently misses
// every debtor who never enabled notifications — and debtors skew hard into that group (the
// bloke who hasn't paid is the bloke who hasn't opened the app).
//
// A casual `players` row has NO email column. The ONLY route to an address is
// players.user_id → auth.users via the service-role Admin API, which is reachable from here
// and nowhere else (not from SQL, not from the client). Same mechanism as cron.js:1551's
// authEmailsForUserIds.
//
// Best-effort and last: a failed email must never break a push that already worked.
async function emailForPlayer(playerId) {
  try {
    const { data: p } = await supabase
      .from('players').select('user_id, name, nickname').eq('id', playerId).maybeSingle();
    if (!p?.user_id) return null;
    const { data, error } = await supabase.auth.admin.getUserById(p.user_id);
    if (error || !data?.user?.email) return null;
    return { email: data.user.email, firstName: (p.nickname || p.name || '').split(/\s+/)[0] };
  } catch (e) {
    console.error('chase email: lookup failed', e?.message);
    return null;
  }
}

// ── platform_config.push_transport_live mirror (mig 591) ─────────────────────
// SQL cannot read this process's env, so _team_debtors cannot answer "is the push
// transport actually configured?" — but PR #2's confirm sheet ("4 will get a push")
// depends on that answer being true. mig 591 mirrors it into a one-row table; this is
// the write-back that keeps the mirror honest.
//
// Without it the flag is hand-maintained and fails DANGEROUSLY in one direction: creds
// revoked or expired, flag still true → the sheet promises a push that silently no-ops.
// That is precisely the lie the epic exists to remove, reintroduced by the mechanism
// built to prevent it. Node is the only process that knows, so Node writes it.
// Best-effort: never let a mirror update break an actual send.
async function syncPushTransportFlag(live) {
  try {
    await supabase.from('platform_config')
      .update({ push_transport_live: !!live, updated_at: new Date().toISOString() })
      .eq('id', true);
  } catch (e) {
    console.error('platform_config: push_transport_live sync failed', e?.message);
  }
}

// A debt chase lands on Payment History (?pay=1, PlayerView reads it at mount), not the
// top of PlayerView — a chase you can't act on is a nag, and the "I've paid" button is
// the whole point of sending it. Every other type keeps the plain /p/<token> landing.
const LANDING_QUERY = { adminChasePayment: '?pay=1' };

async function pushToSubs(subs, payload, type, teamId, gameDate) {
  await Promise.allSettled(
    subs.map(async sub => {
      const playerToken = sub.players?.token || '';
      const payloadObj = {
        ...payload,
        // NOTE the spread order: payload first, url last. A caller-supplied `url` is
        // always clobbered by this server-derived per-player link — that's what stops
        // /api/notify's unauthenticated direct mode from being an arbitrary-link
        // phishing vector. Don't reorder.
        url: `https://app.in-or-out.com/p/${playerToken}${LANDING_QUERY[type] || ''}`,
      };
      const res = await deliverPush(sub, payloadObj);
      if (res.ok) {
        await supabase.from('notification_log').insert({
          team_id: teamId,
          player_id: sub.player_id,
          type,
          game_date: gameDate || null,
          sent_at: new Date().toISOString(),
        });
      } else if (res.gone) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    })
  );
}

// Resolve the player_ids of a team's active admins (team_admins → players by
// user_id). Used to target admin-only notifications (e.g. plus-one approvals).
// Returns [] when no admin has a linked player row — the push is then a no-op.
async function getAdminPlayerIds(teamId) {
  const { data: admins } = await supabase
    .from('team_admins')
    .select('user_id')
    .eq('team_id', teamId)
    .is('revoked_at', null);
  const userIds = (admins || []).map(a => a.user_id).filter(Boolean);
  if (!userIds.length) return [];

  const { data: tps } = await supabase
    .from('team_players').select('player_id').eq('team_id', teamId);
  const { data: players } = await supabase
    .from('players').select('id, user_id')
    .in('id', (tps || []).map(t => t.player_id));
  return (players || []).filter(p => userIds.includes(p.user_id)).map(p => p.id);
}

async function getSubsForPlayers(teamId, playerIds) {
  let q = supabase
    .from('push_subscriptions')
    .select('id, player_id, team_id, subscription, platform, players(token)')
    .eq('team_id', teamId);
  if (playerIds?.length) q = q.in('player_id', playerIds);
  const { data } = await q;
  return data || [];
}

// Resolve push subs for club members by member_profile_id (mig 422):
// member_profiles.auth_user_id → push_subscriptions.auth_user_id. Each returned
// sub is tagged with member_profile_id so the caller can dedup per recipient.
async function getSubsForMembers(memberProfileIds) {
  const ids = [...new Set((memberProfileIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data: profs } = await supabase
    .from('member_profiles')
    .select('id, auth_user_id')
    .in('id', ids);
  const authToProfile = {};
  for (const p of profs || []) if (p.auth_user_id) authToProfile[p.auth_user_id] = p.id;
  const authIds = Object.keys(authToProfile);
  if (!authIds.length) return [];
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, auth_user_id, subscription, platform')
    .in('auth_user_id', authIds);
  return (subs || []).map(s => ({ ...s, member_profile_id: authToProfile[s.auth_user_id] }));
}

// Resolve push subs for an auth user directly (mig 422 keys member/referee subs
// on auth_user_id). Referees are not necessarily club members — a match_official
// or casual player can be assigned with no member_profiles row — so this targets
// the auth user straight, bypassing the member_profiles hop getSubsForMembers does.
async function getSubsForAuthUsers(authUserIds) {
  const ids = [...new Set((authUserIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data } = await supabase
    .from('push_subscriptions')
    .select('id, auth_user_id, subscription, platform')
    .in('auth_user_id', ids);
  return data || [];
}

// Deliver a ref-assignment push to an auth user's registered devices. Deep-links
// into the /hub Fixtures tab by default. The CALLER owns dedup (cron.js logs
// per (type, entity, recipient, channel) in notification_log), so this only
// delivers + prunes dead subs and returns how many landed.
async function pushToAuthUserSubs(subs, payload) {
  let sent = 0;
  await Promise.allSettled(
    subs.map(async sub => {
      const payloadObj = { ...payload, url: payload.url || 'https://app.in-or-out.com/hub/fixtures' };
      const res = await deliverPush(sub, payloadObj);
      if (res.ok) {
        sent++;
      } else if (res.gone) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    })
  );
  return sent;
}

// Deliver a club announcement (and therefore a pitch-bump, which creates one)
// to members who've enabled device push. Deep-links into the agenda. Deduped
// per (announcement, member, push) so a re-run never double-pings. Returns count.
// type defaults to 'club_announcement' (existing callers unchanged); a caller may pass a
// specific notification_log type (e.g. 'membership_payment_due') so the push dedups + logs
// under its own type rather than being mislabelled as a broadcast.
async function pushToMemberSubs(subs, payload, announcementId, type = 'club_announcement') {
  let sent = 0;
  await Promise.allSettled(
    subs.map(async sub => {
      if (announcementId) {
        const { data: dup } = await supabase
          .from('notification_log')
          .select('id')
          .eq('type', type)
          .eq('entity_id', announcementId)
          .eq('recipient', sub.member_profile_id)
          .eq('channel', 'push')
          .limit(1);
        if (dup?.length) return;
      }
      const payloadObj = { ...payload, url: payload.url || 'https://app.in-or-out.com/sessions' };
      const res = await deliverPush(sub, payloadObj);
      if (res.ok) {
        sent++;
        await supabase.from('notification_log').insert({
          type,
          entity_id: announcementId || null,
          recipient: sub.member_profile_id,
          channel: 'push',
          sent_at: new Date().toISOString(),
        });
      } else if (res.gone) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    })
  );
  return sent;
}

// ── Cron mode ─────────────────────────────────────────────────────────────────

async function handleCron(cronType) {
  const now = new Date();

  // apnsDiag — prove APNs creds/signing/topic are accepted by Apple without a
  // real device. Guarded by the CRON_SECRET check in the handler. Sends nothing.
  if (cronType === 'apnsDiag') {
    const probe = await apnsHandshakeProbe();
    await syncPushTransportFlag(probe.credsAccepted === true);
    return probe;
  }

  // flushQueue — send any notifications queued during quiet hours
  if (cronType === 'flushQueue') {
    const { data: queued } = await supabase
      .from('notification_log')
      .select('*')
      .is('sent_at', null)
      .not('queued_for', 'is', null)
      .lte('queued_for', now.toISOString());

    await Promise.allSettled(
      (queued || []).map(async log => {
        const subs = await getSubsForPlayers(log.team_id, [log.player_id]);
        for (const sub of subs) {
          const res = await deliverPush(sub, log.queued_payload);
          if (res.gone) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
          }
        }
        await supabase
          .from('notification_log')
          .update({ sent_at: now.toISOString() })
          .eq('id', log.id);
      })
    );
    return { ok: true, flushed: queued?.length || 0 };
  }

  // Time-based triggers — loop over all live games
  const { data: schedules } = await supabase
    .from('schedule')
    .select('*')
    .eq('game_is_live', true)
    .eq('is_cancelled', false)
    .not('game_date_time', 'is', null);

  if (!schedules?.length) return { ok: true };

  for (const sched of schedules) {
    const teamId    = sched.team_id;
    const rc        = sched.reminders_config || {};
    const triggers  = rc.triggers || {};
    if (triggers[cronType] === false) continue;

    const gameDate   = sched.game_date_time?.split('T')[0];
    const kickoff    = new Date(sched.game_date_time);
    const minsToKick = (kickoff - now) / 60000;
    const minsAfter  = -minsToKick;

    const { data: tps } = await supabase
      .from('team_players').select('player_id').eq('team_id', teamId);
    const { data: players } = await supabase
      .from('players').select('id, name, nickname, status, paid, self_paid, token, injured, disabled')
      .in('id', (tps || []).map(t => t.player_id));

    const inPlayers = (players || []).filter(p => p.status === 'in' && !p.injured && !p.disabled);

    // 5. Game day 9am — cron schedule: "0 9 * * *"
    if (cronType === 'gameDay9am') {
      const isGameDay   = kickoff.toDateString() === now.toDateString();
      // now.getHours() is UTC on Vercel — must read UK wall-clock time
      const ukHour      = parseInt(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', hour12: false,
      }).formatToParts(now).find(p => p.type === 'hour').value, 10);
      const is9amWindow = ukHour === 9 && now.getMinutes() < 15;
      if (!isGameDay || !is9amWindow || !inPlayers.length) continue;
      if (await alreadySent(teamId, cronType, gameDate)) continue;
      const subs = await getSubsForPlayers(teamId, inPlayers.map(p => p.id));
      await pushToSubs(subs, {
        title: 'In or Out ⚽',
        body: "⚽ Game day! See you tonight — don't forget your boots.",
        icon: '/icons/icon-192.png',
      }, cronType, teamId, gameDate);
    }

    // 6. 1hr before kickoff — cron schedule: "*/15 * * * *"
    if (cronType === 'oneHrBefore') {
      if (minsToKick <= 55 || minsToKick > 70) continue;
      const unpaid = inPlayers.filter(p => !p.paid && !p.self_paid);
      if (!unpaid.length) continue;
      if (await alreadySent(teamId, cronType, gameDate)) continue;
      const subs = await getSubsForPlayers(teamId, unpaid.map(p => p.id));
      await pushToSubs(subs, {
        title: 'In or Out ⚽',
        body: '🕐 Kickoff in an hour! Pay now.',
        icon: '/icons/icon-192.png',
      }, cronType, teamId, gameDate);
    }

    // 7. 24hrs after — debt reminder — cron schedule: "*/15 * * * *"
    //
    // This told people the WRONG NUMBER for years. It sent ONE payload saying
    // `You owe £${sched.price_per_player}` — the WEEK'S PRICE — to everyone unpaid. A player
    // three weeks behind owes £15 and was told "You owe £5", every week, live. Wrong for
    // exactly the multi-week debtors it most needs to reach.
    //
    // Two causes, both fixed here:
    //   • ONE payload for N people can't carry N different amounts (pushToSubs broadcasts a
    //     single body). Hence one post per player now — the cost of being accurate.
    //   • It was a THIRD definition of "who owes": `!p.paid && !p.self_paid`, which reads the
    //     whole-player flags and knows nothing about the ledger. So it also ignored waivers
    //     (admin_waive_debt zeroes owes but never marks the games waived, and paid stays
    //     false) — meaning it could chase a forgiven debt too.
    // The audience INTENT is deliberately unchanged: people who actually played last night
    // (status 'in'). _team_debtors supplies the truth about what they owe and who is
    // chaseable — it does NOT widen this to everyone who owes anything.
    if (cronType === 'debtReminder') {
      const target = 24 * 60;
      if (minsAfter <= target - 7 || minsAfter > target + 7) continue;
      if (await alreadySent(teamId, cronType, gameDate)) continue;

      // THE definition (migs 591/592/593) — team-scoped from the ledger, waivers subtracted,
      // pending claims and known minors excluded, guests rolled up to their host.
      // service_role only; this handler holds that key.
      const { data: debtors, error: debtErr } = await supabase
        .rpc('_team_debtors', { p_team_id: teamId });
      if (debtErr) { console.error('debtReminder: _team_debtors failed', debtErr.message); continue; }
      if (!debtors?.length) continue;

      // Intersect with who played last night — keeps this cron's own meaning.
      const inIds  = new Set(inPlayers.map(p => p.id));
      const owing  = debtors.filter(d => inIds.has(d.player_id));
      if (!owing.length) continue;

      // One post per player, each carrying THAT player's real outstanding total.
      for (const d of owing) {
        const subs = await getSubsForPlayers(teamId, [d.player_id]);
        if (!subs.length) continue;
        const amount = Number(d.owed) % 1 === 0 ? Number(d.owed) : Number(d.owed).toFixed(2);
        await pushToSubs(subs, {
          title: 'In or Out ⚽',
          body: `💸 £${amount} outstanding for ${sched.day_of_week}. Pay up before the admin starts naming names 😅`,
          icon: '/icons/icon-192.png',
        }, cronType, teamId, gameDate);
      }
    }

    // 8 & 9. Bibs — find bib holder from most recent match
    if (cronType === 'bibs24hr' || cronType === 'bibs45min') {
      const { data: lastMatch } = await supabase
        .from('matches')
        .select('bib_holder')
        .eq('team_id', teamId)
        .not('bib_holder', 'is', null)
        .order('match_date', { ascending: false })
        .limit(1)
        .single();

      if (!lastMatch?.bib_holder) continue;
      const bibPlayer = (players || []).find(p => p.id === lastMatch.bib_holder);
      if (!bibPlayer) continue;

      // 8. Bibs 24hr before — cron schedule: "0 * * * *"
      if (cronType === 'bibs24hr') {
        const t = 24 * 60;
        if (minsToKick <= t - 7 || minsToKick > t + 7) continue;
        if (await alreadySent(teamId, cronType, gameDate)) continue;
        const subs = await getSubsForPlayers(teamId, [bibPlayer.id]);
        await pushToSubs(subs, {
          title: 'In or Out ⚽',
          body: `🧺 ${sched.day_of_week}'s tomorrow — get those bibs in the wash tonight!`,
          icon: '/icons/icon-192.png',
        }, cronType, teamId, gameDate);
      }

      // 9. Bibs 45min before — cron schedule: "*/15 * * * *"
      if (cronType === 'bibs45min') {
        if (minsToKick <= 38 || minsToKick > 52) continue;
        if (await alreadySent(teamId, cronType, gameDate)) continue;
        const subs = await getSubsForPlayers(teamId, [bibPlayer.id]);
        await pushToSubs(subs, {
          title: 'In or Out ⚽',
          body: "👕 Don't forget the bibs! Kickoff in 45.",
          icon: '/icons/icon-192.png',
        }, cronType, teamId, gameDate);
      }
    }

    // 10. Auto-open — game just went live, notify all players
    if (cronType === 'autoOpen') {
      if (await alreadySent(teamId, 'autoOpen', gameDate)) continue;
      const allActive = (players || []).filter(p => !p.injured);
      if (!allActive.length) continue;
      const subs = await getSubsForPlayers(teamId, allActive.map(p => p.id));
      await pushToSubs(subs, {
        title: 'In or Out ⚽',
        body: `${sched.day_of_week || 'Game'} is open — are you in?`,
        icon: '/icons/icon-192.png',
      }, 'autoOpen', teamId, gameDate);
    }

    // 11. Teams confirmed — send to IN players when teams are set on the active match
    if (cronType === 'teamsConfirmed') {
      if (!sched.active_match_id) continue;
      const { data: activeMatch } = await supabase
        .from('matches')
        .select('team_a, team_b')
        .eq('id', sched.active_match_id)
        .single();
      if (!activeMatch?.team_a?.length || !activeMatch?.team_b?.length) continue;
      if (!inPlayers.length) continue;
      if (await alreadySent(teamId, 'teamsConfirmed', gameDate)) continue;
      const subs = await getSubsForPlayers(teamId, inPlayers.map(p => p.id));
      await pushToSubs(subs, {
        title: 'Teams are up 👀',
        body: "Check which side you're on",
        icon: '/icons/icon-192.png',
      }, 'teamsConfirmed', teamId, gameDate);
    }
  }

  return { ok: true };
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body;

  // ── Cron mode ───────────────────────────────────────────────────────────────
  if (body.cronType) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).end();
    }
    const result = await handleCron(body.cronType);
    return res.status(200).json(result);
  }

  // ── Member-push mode (club comms + pitch bumps) — cron-triggered only ─────────
  // cron.js clubBroadcastJob resolves an announcement's member recipients and POSTs
  // them here. CRON_SECRET-gated so it can't be used to spam arbitrary members.
  if (Array.isArray(body.memberProfileIds)) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).end();
    }
    if (!body.payload) return res.status(400).json({ error: 'Missing payload' });
    const subs = await getSubsForMembers(body.memberProfileIds);
    if (!subs.length) return res.status(200).json({ sent: 0 });
    const sent = await pushToMemberSubs(subs, body.payload, body.announcementId, body.type);
    return res.status(200).json({ sent });
  }

  // ── Auth-user push mode (ref assignment) — cron-triggered only ────────────────
  // cron.js onboardingEmailJob resolves a referee's auth_user_id (match_officials
  // .user_id for league refs, players.user_id for casual refs) and POSTs them here
  // to reach their /hub push subscription (mig 422, keyed on auth_user_id). Refs
  // need not be club members, so this targets the auth user directly. CRON_SECRET-
  // gated so it can't be used to push arbitrary users. Dedup lives in the caller.
  if (Array.isArray(body.authUserIds)) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).end();
    }
    if (!body.payload) return res.status(400).json({ error: 'Missing payload' });
    const subs = await getSubsForAuthUsers(body.authUserIds);
    if (!subs.length) return res.status(200).json({ sent: 0 });
    const sent = await pushToAuthUserSubs(subs, body.payload);
    return res.status(200).json({ sent });
  }

  // ── Direct mode ─────────────────────────────────────────────────────────────
  const { type, teamId, playerIds, payload, gameDate } = body;
  if (!teamId || !payload) return res.status(400).json({ error: 'Missing fields' });

  // day_of_week is for the chase email's subject/body (PR #4) — additive to the existing
  // reminders_config read, so the push path is byte-identical.
  const { data: sched } = await supabase
    .from('schedule')
    .select('reminders_config, day_of_week')
    .eq('team_id', teamId)
    .single();

  const rc       = sched?.reminders_config || {};
  const triggers = rc.triggers || {};
  if (triggers[type] === false) return res.status(200).json({ skipped: true });

  const quietStart = rc.quietStart || '22:00';
  const quietEnd   = rc.quietEnd   || '08:00';
  const quiet      = isQuietHours(quietStart, quietEnd);

  // guestPendingApproval: target the team's admins (no playerIds supplied).
  // Dormant in practice until admins register push subscriptions.
  let resolvedPlayerIds = playerIds;
  if (type === 'guestPendingApproval' && !playerIds?.length) {
    resolvedPlayerIds = await getAdminPlayerIds(teamId);
    if (!resolvedPlayerIds.length) return res.status(200).json({ sent: 0 });
  }

  // Filter out injured players before sending — EXCEPT for a debt chase.
  //
  // Skipping the injured is right for an availability nudge (don't ask a man with a torn
  // hamstring whether he's playing Tuesday) but wrong for money: the £15 is owed whether
  // or not he's fit. Operator decision, 2026-07-16 — "injured → chase them".
  //
  // This filter is why the decision needs code rather than just a note: mig 591's
  // admin_chase_payment deliberately has no injured filter of its own, so without this
  // exemption notify.js would silently drop injured debtors on the far end of the
  // fire-and-forget POST, and the RPC's own attempted_count would have counted them.
  // The chase would under-deliver, invisibly, in exactly the direction the epic exists
  // to prevent. Do not "tidy" adminChasePayment back into the filter.
  const skipInjuredFilter = type === 'adminChasePayment';
  let targetIds = resolvedPlayerIds;
  if (resolvedPlayerIds?.length && !skipInjuredFilter) {
    const { data: ps } = await supabase
      .from('players').select('id, injured').in('id', resolvedPlayerIds);
    targetIds = (ps || []).filter(p => !p.injured).map(p => p.id);
  }

  const subs = await getSubsForPlayers(teamId, targetIds);

  // ── Email fallback (PR #4) ─────────────────────────────────────────────────
  // MUST be computed BEFORE the !subs.length early-return below. That return is exactly the
  // silent miss this closes: a debtor with an account but no push subscription produced
  // {sent:0} and nothing else — no email, no trace, no clue for the admin.
  //
  // NOT gated on quiet hours, deliberately. An email doesn't buzz anyone at 22:30, and the
  // push queue only ever re-sends PUSH — so quiet-gating the email would mean an email-only
  // debtor chased at 22:30 gets nothing at all, ever. The ChaseSheet's quiet-hours line says
  // "pushes send in the morning" for exactly this reason.
  let emailed = 0;
  if (type === 'adminChasePayment' && Array.isArray(targetIds) && targetIds.length) {
    const pushed = new Set(subs.map(s => s.player_id));
    const noPush = targetIds.filter(id => !pushed.has(id));
    for (const pid of noPush) {
      const who = await emailForPlayer(pid);
      if (!who) continue;                       // no account = genuinely unreachable
      const { data: t } = await supabase
        .from('teams').select('name').eq('id', teamId).maybeSingle();
      const { data: pl } = await supabase
        .from('players').select('token').eq('id', pid).maybeSingle();
      const r = await sendTemplated('admin_chase_payment', who.email, {
        firstName: who.firstName || 'there',
        amount:    body.chaseAmount ?? '',      // whole pounds — never gbp(), that divides by 100
        dayOfWeek: sched?.day_of_week || 'the game',
        squadName: t?.name || 'your squad',
        payUrl:    `https://app.in-or-out.com/p/${pl?.token || ''}?pay=1`,
      });
      if (r?.id) {
        emailed += 1;
        await supabase.from('notification_log').insert({
          team_id: teamId, player_id: pid, type,
          game_date: gameDate || null, sent_at: new Date().toISOString(),
          channel: 'email', recipient: who.email,
        });
      }
    }
  }

  if (!subs.length) return res.status(200).json({ sent: 0, emailed });

  if (quiet) {
    const queuedFor = nextQueueTime(quietEnd);
    const logs = subs.map(s => ({
      team_id: teamId,
      player_id: s.player_id,
      type,
      game_date: gameDate || null,
      sent_at: null,
      queued_for: queuedFor,
      // Same landing rule as the immediate send above — a chase queued through quiet
      // hours must still open Payment History when it finally lands at 08:00, or the
      // deep-link silently only works outside 22:00–08:00.
      queued_payload: {
        ...payload,
        url: `https://app.in-or-out.com/p/${s.players?.token || ''}${LANDING_QUERY[type] || ''}`,
      },
    }));
    await supabase.from('notification_log').insert(logs);
    return res.status(200).json({ queued: subs.length, emailed });
  }

  await pushToSubs(subs, payload, type, teamId, gameDate);
  return res.status(200).json({ sent: subs.length, emailed });
};
