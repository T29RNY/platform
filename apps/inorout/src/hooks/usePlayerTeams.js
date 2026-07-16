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
    // BOTH settle before loading clears. In parallel (not serial — no extra latency),
    // but awaited together so a row is never tappable before its door is known: a tap
    // in that window would silently take an admin to the player door, i.e. the very
    // bug this fixes, intermittently. Each degrades to [] on its own, so an anon or
    // failed call leaves rows on the player door rather than breaking the switcher.
    Promise.all([
      getPlayerTeams().catch(() => []),
      getMyAdminTeams().catch(() => []),
    ]).then(([rows, admin]) => {
      if (!alive) return;
      setTeams((rows || []).filter((r) => !r.disabled));
      setAdminTeams(admin || []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [enabled]);

  return { teams, adminTeams, loading };
}
