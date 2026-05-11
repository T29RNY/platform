// POST /api/notify — two modes:
//
// Direct (event-triggered from app):
//   { type, teamId, playerIds?, payload: { title, body, icon }, gameDate? }
//
// Cron (called by pg_cron via pg_net, requires Authorization header):
//   { cronType: "flushQueue"|"gameDay9am"|"oneHrBefore"|"debtReminder"|"bibs24hr"|"bibs45min" }
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, CRON_SECRET

const webpush = require('web-push');
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

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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
      const pushPayload = JSON.stringify({
        ...payload,
        url: `https://in-or-out.com/p/${sub.player_token}`,
      });
      try {
        await webpush.sendNotification(sub.subscription, pushPayload);
        await supabase.from('notification_log').insert({
          id: makeId(),
          team_id: teamId,
          player_id: sub.player_id,
          type,
          game_date: gameDate || null,
          sent_at: new Date().toISOString(),
          queued_for: null,
          queued_payload: null,
        });
      } catch (err) {
        if (err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
    })
  );
}

async function getSubsForPlayers(teamId, playerIds) {
  let q = supabase.from('push_subscriptions').select('*').eq('team_id', teamId);
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
          try {
            await webpush.sendNotification(sub.subscription, JSON.stringify(log.queued_payload));
          } catch (err) {
            if (err.statusCode === 410) {
              await supabase.from('push_subscriptions').delete().eq('id', sub.id);
            }
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
      .from('players').select('id, name, status, paid, token, injured')
      .in('id', (tps || []).map(t => t.player_id));

    const inPlayers = (players || []).filter(p => p.status === 'in' && !p.injured);

    // 5. Game day 9am — cron schedule: "0 9 * * *"
    if (cronType === 'gameDay9am') {
      const isGameDay   = kickoff.toDateString() === now.toDateString();
      const is9amWindow = now.getHours() === 9 && now.getMinutes() < 15;
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
      const unpaid = inPlayers.filter(p => !p.paid);
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
      const unpaid = inPlayers.filter(p => !p.paid);
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
        .neq('bib_holder', '')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!lastMatch?.bib_holder) continue;
      const bibPlayer = (players || []).find(p => p.name === lastMatch.bib_holder && !p.injured);
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

  // Filter out injured players before sending
  let targetIds = playerIds;
  if (playerIds?.length) {
    const { data: ps } = await supabase
      .from('players').select('id, injured').in('id', playerIds);
    targetIds = (ps || []).filter(p => !p.injured).map(p => p.id);
  }

  const subs = await getSubsForPlayers(teamId, targetIds);
  if (!subs.length) return res.status(200).json({ sent: 0 });

  if (quiet) {
    const queuedFor = nextQueueTime(quietEnd);
    const logs = subs.map(s => ({
      id: makeId(),
      team_id: teamId,
      player_id: s.player_id,
      type,
      game_date: gameDate || null,
      sent_at: null,
      queued_for: queuedFor,
      queued_payload: { ...payload, url: `https://in-or-out.com/p/${s.player_token}` },
    }));
    await supabase.from('notification_log').insert(logs);
    return res.status(200).json({ queued: subs.length });
  }

  await pushToSubs(subs, payload, type, teamId, gameDate);
  return res.status(200).json({ sent: subs.length });
};
