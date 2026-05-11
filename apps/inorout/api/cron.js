// Vercel Cron — runs every 15 mins
// Handles: queued quiet-hours notifications, game-day 9am, 1hr-before,
//          24hrs-after debt reminder, bibs 24hr & 45min reminders.
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, CRON_SECRET

const webpush  = require('web-push');
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

function makeId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

async function sendToPlayers(teamId, playerIds, payload, type, gameDate) {
  let q = supabase.from('push_subscriptions').select('*').eq('team_id', teamId);
  if (playerIds?.length) q = q.in('player_id', playerIds);
  const { data: subs } = await q;
  if (!subs?.length) return;

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
          game_date: gameDate,
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

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const now = new Date();

  // ── 1. Flush queued quiet-hours notifications ─────────────────────────────
  const { data: queued } = await supabase
    .from('notification_log')
    .select('*')
    .is('sent_at', null)
    .not('queued_for', 'is', null)
    .lte('queued_for', now.toISOString());

  if (queued?.length) {
    await Promise.allSettled(
      queued.map(async log => {
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('*')
          .eq('team_id', log.team_id)
          .eq('player_id', log.player_id);

        for (const sub of subs || []) {
          try {
            await webpush.sendNotification(
              sub.subscription,
              JSON.stringify(log.queued_payload)
            );
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
  }

  // ── 2. Time-based triggers for each live game ─────────────────────────────
  const { data: schedules } = await supabase
    .from('schedule')
    .select('*')
    .eq('game_is_live', true)
    .not('game_date_time', 'is', null);

  if (!schedules?.length) return res.status(200).json({ ok: true });

  for (const sched of schedules) {
    const teamId    = sched.team_id;
    const rc        = sched.reminders_config || {};
    const triggers  = rc.triggers || {};
    const gameDate  = sched.game_date_time?.split('T')[0];
    const kickoff   = new Date(sched.game_date_time);
    const minsToKick = (kickoff - now) / 60000;
    const minsAfter  = -minsToKick;

    // Get all players on this team
    const { data: tps } = await supabase
      .from('team_players').select('player_id').eq('team_id', teamId);
    const { data: players } = await supabase
      .from('players').select('id, name, status, paid, token')
      .in('id', (tps || []).map(tp => tp.player_id));

    const inPlayers = (players || []).filter(p => p.status === 'in');

    // 5. GAME DAY 9AM (09:00–09:14 on game day)
    if (triggers.gameDay9am !== false) {
      const isGameDay   = kickoff.toDateString() === now.toDateString();
      const is9amWindow = now.getHours() === 9 && now.getMinutes() < 15;
      if (isGameDay && is9amWindow && inPlayers.length) {
        const done = await alreadySent(teamId, 'gameDay9am', gameDate);
        if (!done) {
          await sendToPlayers(teamId, inPlayers.map(p => p.id), {
            title: 'In or Out ⚽',
            body: "⚽ Game day! See you tonight — don't forget your boots.",
            icon: '/icons/icon-192.png',
          }, 'gameDay9am', gameDate);
        }
      }
    }

    // 6. 1HR BEFORE KICKOFF — unpaid IN players (55–70 min window)
    if (triggers.oneHrBefore !== false) {
      if (minsToKick > 55 && minsToKick <= 70) {
        const unpaid = inPlayers.filter(p => !p.paid);
        if (unpaid.length) {
          const done = await alreadySent(teamId, 'oneHrBefore', gameDate);
          if (!done) {
            await sendToPlayers(teamId, unpaid.map(p => p.id), {
              title: 'In or Out ⚽',
              body: '🕐 Kickoff in an hour! Pay now.',
              icon: '/icons/icon-192.png',
            }, 'oneHrBefore', gameDate);
          }
        }
      }
    }

    // 7. 24HRS AFTER GAME — unpaid IN players (±7 min window)
    if (triggers.debtReminder !== false) {
      const target = 24 * 60;
      if (minsAfter > target - 7 && minsAfter <= target + 7) {
        const unpaid = inPlayers.filter(p => !p.paid);
        if (unpaid.length) {
          const done = await alreadySent(teamId, 'debtReminder', gameDate);
          if (!done) {
            await sendToPlayers(teamId, unpaid.map(p => p.id), {
              title: 'In or Out ⚽',
              body: `💸 You owe £${sched.price_per_player} for ${sched.day_of_week}. Pay up before the admin starts naming names 😅`,
              icon: '/icons/icon-192.png',
            }, 'debtReminder', gameDate);
          }
        }
      }
    }

    // 8 & 9. BIBS — find bib holder from most recent completed match
    if (triggers.bibs24hr !== false || triggers.bibs45min !== false) {
      const { data: lastMatch } = await supabase
        .from('matches')
        .select('bib_holder')
        .eq('team_id', teamId)
        .not('bib_holder', 'is', null)
        .neq('bib_holder', '')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastMatch?.bib_holder) {
        const bibPlayer = (players || []).find(p => p.name === lastMatch.bib_holder);

        // 8. 24HRS BEFORE (±7 min window)
        if (triggers.bibs24hr !== false) {
          const t = 24 * 60;
          if (minsToKick > t - 7 && minsToKick <= t + 7 && bibPlayer) {
            const done = await alreadySent(teamId, 'bibs24hr', gameDate);
            if (!done) {
              await sendToPlayers(teamId, [bibPlayer.id], {
                title: 'In or Out ⚽',
                body: `🧺 ${sched.day_of_week}'s tomorrow — get those bibs in the wash tonight!`,
                icon: '/icons/icon-192.png',
              }, 'bibs24hr', gameDate);
            }
          }
        }

        // 9. 45MINS BEFORE (38–52 min window)
        if (triggers.bibs45min !== false) {
          if (minsToKick > 38 && minsToKick <= 52 && bibPlayer) {
            const done = await alreadySent(teamId, 'bibs45min', gameDate);
            if (!done) {
              await sendToPlayers(teamId, [bibPlayer.id], {
                title: 'In or Out ⚽',
                body: "👕 Don't forget the bibs! Kickoff in 45.",
                icon: '/icons/icon-192.png',
              }, 'bibs45min', gameDate);
            }
          }
        }
      }
    }
  }

  return res.status(200).json({ ok: true });
};
