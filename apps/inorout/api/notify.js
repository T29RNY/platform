// POST /api/notify
// Body: { type, teamId, playerIds?, payload: { title, body, icon }, gameDate? }
// Sends web push to specified players (or all team players if no playerIds).
// Respects quiet hours: queues for end-of-quiet-window if triggered during quiet hours.
// Deletes expired subscriptions on 410 response.
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL

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

// Returns true if current time is in quiet window (assumed to cross midnight, e.g. 22:00–08:00)
function isQuietHours(quietStart, quietEnd) {
  const h = new Date().getHours();
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

function makeId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, teamId, playerIds, payload, gameDate } = req.body;
  if (!teamId || !payload) return res.status(400).json({ error: 'Missing fields' });

  // Check if this trigger type is enabled for the team
  const { data: sched } = await supabase
    .from('schedule')
    .select('reminders_config')
    .eq('team_id', teamId)
    .single();

  const rc       = sched?.reminders_config || {};
  const triggers = rc.triggers || {};

  // Bail early if this trigger is explicitly disabled
  if (triggers[type] === false) return res.status(200).json({ skipped: true });

  const quietStart = rc.quietStart || '22:00';
  const quietEnd   = rc.quietEnd   || '08:00';
  const quiet      = isQuietHours(quietStart, quietEnd);

  // Fetch subscriptions
  let q = supabase.from('push_subscriptions').select('*').eq('team_id', teamId);
  if (playerIds?.length) q = q.in('player_id', playerIds);
  const { data: subs } = await q;
  if (!subs?.length) return res.status(200).json({ sent: 0 });

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

  let sent = 0;
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
        sent++;
      } catch (err) {
        if (err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
    })
  );

  return res.status(200).json({ sent });
};
