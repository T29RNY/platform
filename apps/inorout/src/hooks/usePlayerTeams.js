import { useState, useEffect } from "react";
import { getPlayerTeams } from "@platform/core";

// usePlayerTeams — the ONE source of squad /p/<token> rows (player_get_teams RPC).
// get_my_world() cannot supply the tokens, so BOTH mobile shells need this call
// (handoff KEY FACT). Shared by the profile section registry (PR #4) so the switcher
// + "your squads" rows fetch identically in casual and hub.
//
// Behaviour matches the pre-registry inline fetch in ProfileSheet / App.openSwitcher:
// lazy on mount, filter out disabled squads, and degrade to [] on anon/unlinked
// (the switcher still shows the person's other contexts). Add-only — nothing has to
// consume it, and swapping a call site to it is behaviour-preserving.
export function usePlayerTeams({ enabled = true } = {}) {
  const [teams, setTeams] = useState([]);
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
    return () => { alive = false; };
  }, [enabled]);

  return { teams, loading };
}
