import { useState, useEffect } from "react";
import { getPlayerTeams, getMyAdminTeams } from "@platform/core";

// usePlayerTeams — the ONE source of squad /p/<token> rows (player_get_teams RPC).
// get_my_world() cannot supply the tokens, so BOTH mobile shells need this call
// (handoff KEY FACT). Shared by the profile section registry (PR #4) so the switcher
// + "your squads" rows fetch identically in casual and hub.
//
// Behaviour matches the pre-registry inline fetch in ProfileSheet / App.openSwitcher:
// lazy on mount, filter out disabled squads, and degrade to [] on anon/unlinked
// (the switcher still shows the person's other contexts). Add-only — nothing has to
// consume it, and swapping a call site to it is behaviour-preserving.
// Also returns adminTeams (get_my_admin_teams — same `authenticated`-only grant),
// because a squad row is useless without knowing WHICH DOOR it opens: an admin must
// land on /admin/<token> or they silently lose admin (a /p/ route never derives
// isAdmin from team_admins). Pair them here so no consumer has to re-derive it —
// re-deriving it per call site is exactly how the switchers came to strip admin.
// Feed both into squadDestination().
export function usePlayerTeams({ enabled = true } = {}) {
  const [teams, setTeams] = useState([]);
  const [adminTeams, setAdminTeams] = useState([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    getPlayerTeams()
      .then((rows) => {
        if (!alive) return;
        setTeams((rows || []).filter((r) => !r.disabled));
        setLoading(false);
      })
      .catch(() => {
        // anon / not linked — the switcher still shows other contexts. Never throw.
        if (alive) setLoading(false);
      });
    // Best-effort and independent: the wrapper swallows its own error and yields [],
    // so an admin-token miss just leaves every row on the player door (today's
    // behaviour) rather than breaking the switcher.
    getMyAdminTeams()
      .then((rows) => { if (alive) setAdminTeams(rows || []); })
      .catch(() => { /* never throw — rows stay on the player door */ });
    return () => { alive = false; };
  }, [enabled]);

  return { teams, adminTeams, loading };
}
