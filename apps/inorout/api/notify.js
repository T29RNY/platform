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

async function pushToSubs(subs, payload, type, teamId, gameDate) {
  await Promise.allSettled(
    subs.map(async sub => {
      const playerToken = sub.players?.token || '';
      const payloadObj = {
        ...payload,
        url: `https://app.in-or-out.com/p/${playerToken}`,
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

// ── Cron mode ─────────────────────────────────────────────────────────────────

async function handleCron(cronType) {
  const now = new Date();

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
    if (cronType === 'debtReminder') {
      const target = 24 * 60;
      if (minsAfter <= target - 7 || minsAfter > target + 7) continue;
      const unpaid = inPlayers.filter(p => !p.paid && !p.self_paid);
      if (!unpaid.length) continue;
      if (await alreadySent(teamId, cronType, gameDate)) continue;
      const subs = await getSubsForPlayers(teamId, unpaid.map(p => p.id));
      await pushToSubs(subs, {
        title: 'In or Out ⚽',
        body: `💸 You owe £${sched.price_per_player} for ${sched.day_of_week}. Pay up before the admin starts naming names 😅`,
        icon: '/icons/icon-192.png',
      }, cronType, teamId, gameDate);
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

  // ── Direct mode ─────────────────────────────────────────────────────────────
  const { type, teamId, playerIds, payload, gameDate } = body;
  if (!teamId || !payload) return res.status(400).json({ error: 'Missing fields' });

  const { data: sched } = await supabase
    .from('schedule')
    .select('reminders_config')
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

  // Filter out injured players before sending
  let targetIds = resolvedPlayerIds;
  if (resolvedPlayerIds?.length) {
    const { data: ps } = await supabase
      .from('players').select('id, injured').in('id', resolvedPlayerIds);
    targetIds = (ps || []).filter(p => !p.injured).map(p => p.id);
  }

  const subs = await getSubsForPlayers(teamId, targetIds);
  if (!subs.length) return res.status(200).json({ sent: 0 });

  if (quiet) {
    const queuedFor = nextQueueTime(quietEnd);
    const logs = subs.map(s => ({
      team_id: teamId,
      player_id: s.player_id,
      type,
      game_date: gameDate || null,
      sent_at: null,
      queued_for: queuedFor,
      queued_payload: { ...payload, url: `https://app.in-or-out.com/p/${s.players?.token || ''}` },
    }));
    await supabase.from('notification_log').insert(logs);
    return res.status(200).json({ queued: subs.length });
  }

  await pushToSubs(subs, payload, type, teamId, gameDate);
  return res.status(200).json({ sent: subs.length });
};
