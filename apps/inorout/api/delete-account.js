// POST /api/delete-account
//
// Two-stage account deletion:
//   1. Calls delete_my_account(p_token) RPC — anonymises player row,
//      detaches from teams, revokes admin grants. Returns auth_user_id.
//   2. If auth_user_id present, deletes auth.users via admin API
//      (only possible with service-role key — runs server-side).
//
// Body:    { token: string }
// Response: { ok: true } | { error: 'last_admin', teamIds: [...] } | { error: '...' }
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'missing_token' });

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[delete-account] Supabase env vars missing');
      return res.status(503).json({ error: 'supabase_not_configured' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Stage 1 — anonymise + detach via RPC
    const { data, error } = await supabase.rpc('delete_my_account', {
      p_token: token,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.startsWith('last_admin:')) {
        const teamIds = msg.slice('last_admin:'.length).split(',').filter(Boolean);
        return res.status(409).json({ error: 'last_admin', teamIds });
      }
      if (msg === 'invalid_token') {
        return res.status(401).json({ error: 'invalid_token' });
      }
      console.error('[delete-account] RPC failed:', msg);
      return res.status(500).json({ error: 'rpc_failed' });
    }

    // Stage 2 — delete auth.users row if the player had one
    const authUserId = data?.auth_user_id;
    if (authUserId) {
      const { error: authErr } = await supabase.auth.admin.deleteUser(authUserId);
      if (authErr) {
        // RPC already ran — log + return ok with a soft warning so the
        // client UX matches what the user just did (player rows are gone).
        // Orphan auth row can be cleaned up later via admin tooling.
        console.error('[delete-account] auth deletion failed:', authErr.message);
        return res.status(200).json({ ok: true, authDeleted: false });
      }

      // KNOWN GOTCHA: in older Supabase versions, deleting a user via
      // admin.deleteUser did not cascade-delete auth.identities rows. If
      // an orphan identity remains, the email is forever blocked from
      // signing in with that provider — Google confirms the identity,
      // Supabase finds the identity row, looks up the user_id → 404
      // "User not found" → silent OAuth-loop error.
      //
      // Modern Supabase cascades correctly, so we don't add a follow-up
      // cleanup here. If a stuck account ever reappears, run this in
      // SQL editor (admin-only):
      //   DELETE FROM auth.identities i
      //   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = i.user_id);
    }

    return res.status(200).json({ ok: true, authDeleted: !!authUserId });
  } catch (e) {
    console.error('[delete-account] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
