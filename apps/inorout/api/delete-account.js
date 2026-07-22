// POST /api/delete-account
//
// Two-stage account deletion:
//   1. Calls delete_my_account(p_token) RPC — anonymises player row,
//      detaches from teams, revokes admin grants. Returns auth_user_id.
//   2. If auth_user_id present, deletes auth.users via admin API
//      (only possible with service-role key — runs server-side).
//
// GDPR note (mig 375): both delete_my_account (token path) and
// delete_my_account_auth (auth path) explicitly purge match_health_sessions
// — special-category health data from the watchOS ref workout summary. The
// table also has user_id → auth.users ON DELETE CASCADE as a second safety
// net, so deleting the auth.users row in stage 2 (or via the auth path)
// removes any straggler rows too.
//
// Body:    { token: string }
// Response: { ok: true } | { error: 'last_admin', teamIds: [...] } | { error: '...' }
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env vars: POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, POSTHOG_HOST
//   — when unset, analytics erasure is skipped and logged. It is NEVER allowed
//     to block or fail a deletion; see deletePostHogPerson below.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Erase the person's analytics profile (UK GDPR Art. 17). Until now
// "delete my account" purged Supabase but left the PostHog profile intact,
// so the claim was not literally true.
//
// Both identities are derivable server-side, which is why no extra client
// plumbing is needed: a signed-in user's distinct_id IS their auth.uid, and an
// anonymous player's is the SHA-256 of their player token — the same hash the
// client computes (that hashing is why the raw token no longer leaves the
// device). We attempt both, because one person may have events under each.
//
// FAIL-SAFE BY CONSTRUCTION: this returns a status string and NEVER throws.
// The Supabase purge is the part that legally matters and must complete even
// if PostHog is misconfigured, slow, or down. Today the API key is deliberately
// unset — this ships dormant and starts working the moment it is provided.
async function deletePostHogPerson(distinctIds) {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const host = process.env.POSTHOG_HOST || 'https://eu.posthog.com';
  const ids = (distinctIds || []).filter(Boolean);

  if (!key || !projectId) return 'skipped_not_configured';
  if (!ids.length) return 'skipped_no_identity';

  let deleted = 0;
  for (const distinctId of ids) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const headers = { Authorization: `Bearer ${key}` };
      const lookup = await fetch(
        `${host}/api/projects/${encodeURIComponent(projectId)}/persons/?distinct_id=${encodeURIComponent(distinctId)}`,
        { headers, signal: controller.signal }
      );
      if (!lookup.ok) {
        console.error('[delete-account] posthog lookup failed:', lookup.status);
        continue;
      }
      const found = await lookup.json();
      for (const person of found?.results || []) {
        if (!person?.id) continue;
        const del = await fetch(
          `${host}/api/projects/${encodeURIComponent(projectId)}/persons/${encodeURIComponent(person.id)}/?delete_events=true`,
          { method: 'DELETE', headers, signal: controller.signal }
        );
        if (del.ok) deleted += 1;
        else console.error('[delete-account] posthog delete failed:', del.status);
      }
    } catch (e) {
      // Includes the abort timeout. Log and carry on — never propagate.
      console.error('[delete-account] posthog erasure error:', e?.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return `deleted_${deleted}`;
}

// Erase the person's first-party session rows (app_sessions, mig 618) — the
// operational record has no auth.users FK, so it does not cascade and must be
// deleted explicitly. Service-role client bypasses the table's RLS. Best-effort:
// never blocks the deletion that legally matters.
async function deleteAppSessions(supabase, userId) {
  if (!userId) return 'skipped_no_user';
  try {
    const { error } = await supabase.from('app_sessions').delete().eq('user_id', userId);
    if (error) { console.error('[delete-account] app_sessions delete failed:', error.message); return 'error'; }
    return 'deleted';
  } catch (e) {
    console.error('[delete-account] app_sessions delete threw:', e?.message);
    return 'error';
  }
}

// The anonymous-player analytics identity, mirroring the client's hash.
function hashToken(token) {
  if (!token) return null;
  try {
    return crypto.createHash('sha256').update(token).digest('hex');
  } catch (e) {
    console.error('[delete-account] hash failed:', e?.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const { token, accessToken } = req.body || {};
    if (!token && !accessToken) return res.status(400).json({ error: 'missing_token' });

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[delete-account] Supabase env vars missing');
      return res.status(503).json({ error: 'supabase_not_configured' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Authenticated (no-token) path: the client already anonymised the user's
    // data via the delete_my_account_auth() RPC (auth.uid()-scoped). All that's
    // left is deleting the auth.users row, which needs the service role. We
    // resolve the user id by VERIFYING the caller's own access token (never a
    // client-supplied id), so a caller can only delete their own auth account.
    if (!token && accessToken) {
      const { data: u, error: uErr } = await supabase.auth.getUser(accessToken);
      if (uErr || !u?.user?.id) {
        return res.status(401).json({ error: 'invalid_session' });
      }
      // Delete the auth row FIRST — it is the part that legally matters, and a
      // slow or hung PostHog must never eat the function's time budget before
      // this runs. The id is a captured local, so analytics erasure afterwards
      // still has it.
      // KNOWN GAP (accepted): this erases only the auth-uid analytics person.
      // If this user was previously anonymous (a hashed-token person) and then
      // signed in, sign-in calls reset()+identify() which DE-LINKS rather than
      // merges, leaving that earlier hashed-token person orphaned. The raw token
      // is not available on the auth path by definition, so we cannot hash it
      // here. Narrow trigger (anonymous → fresh auth account with no linked
      // player); closing it would need the client to pass its current hashed
      // token. Noted rather than solved.
      const uid = u.user.id;
      await deleteAppSessions(supabase, uid);
      const { error: aErr } = await supabase.auth.admin.deleteUser(uid);
      if (aErr) {
        console.error('[delete-account] auth deletion failed (auth path):', aErr.message);
        const analytics = await deletePostHogPerson([uid]);
        return res.status(200).json({ ok: true, authDeleted: false, analytics });
      }
      const analytics = await deletePostHogPerson([uid]);
      return res.status(200).json({ ok: true, authDeleted: true, analytics });
    }

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

    // Capture both analytics identities BEFORE any deletion. Erasure itself is
    // deferred to Stage 3 (after the auth row is gone) so a slow/hung PostHog
    // can never delay or starve the Supabase-side deletion that legally matters.
    const analyticsIds = [hashToken(token), data?.auth_user_id];

    // Stage 2 — delete auth.users row if the player had one
    const authUserId = data?.auth_user_id;
    if (authUserId) {
      await deleteAppSessions(supabase, authUserId);
      const { error: authErr } = await supabase.auth.admin.deleteUser(authUserId);
      if (authErr) {
        // RPC already ran — log + return ok with a soft warning so the
        // client UX matches what the user just did (player rows are gone).
        // Orphan auth row can be cleaned up later via admin tooling.
        console.error('[delete-account] auth deletion failed:', authErr.message);
        const analytics = await deletePostHogPerson(analyticsIds);
        return res.status(200).json({ ok: true, authDeleted: false, analytics });
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

    // Stage 3 — erase the analytics profile(s), now that everything that
    // legally matters is already deleted. Covers both identities this person
    // could have events under: the hashed player token (anonymous) and the auth
    // uid (signed in). Fail-safe: never throws, never affects the outcome above.
    const analytics = await deletePostHogPerson(analyticsIds);

    return res.status(200).json({ ok: true, authDeleted: !!authUserId, analytics });
  } catch (e) {
    console.error('[delete-account] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};

// Exposed for the fail-safe test only. Vercel uses the default export as the
// handler; attaching properties to it does not change that.
module.exports.deletePostHogPerson = deletePostHogPerson;
module.exports.hashToken = hashToken;
