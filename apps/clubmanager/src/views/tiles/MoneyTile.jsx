import React, { useCallback, useEffect, useMemo, useState } from "react";
import { clubManagerTeamPayments } from "@platform/core/storage/supabase.js";

// Money tile — outstanding subs. PR #1 surfaces the auth.uid-native coach view
// (club_manager_team_payments over the teams the signed-in person manages). The
// full club-wide payments/enrolment dashboard is PR #6; an admin who coaches no
// team sees the honest "arrives later" empty state, not a fabricated figure.
function gbp(pence) {
  const p = Number(pence) || 0;
  return "£" + (p / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function MoneyTile({ coaching }) {
  // Stable reference — a fresh [] literal each render would give load()'s
  // useCallback a new identity every render and spin the effect into a loop
  // when `coaching` is undefined (the tolerated world===null path).
  const teams = useMemo(() => (Array.isArray(coaching) ? coaching : []), [coaching]);
  const [state, setState] = useState({ loading: true, error: false, owing: 0, pence: 0 });

  const load = useCallback(async () => {
    if (teams.length === 0) { setState({ loading: false, error: false, owing: 0, pence: 0 }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const results = await Promise.all(
        teams.map((t) => clubManagerTeamPayments(t.club_team_id).catch(() => null))
      );
      let owing = 0, pence = 0;
      results.forEach((r) => {
        (r?.members || []).forEach((m) => {
          if (m.owes) { owing += 1; pence += Number(m.amount_pence) || 0; }
        });
      });
      setState({ loading: false, error: false, owing, pence });
    } catch {
      setState({ loading: false, error: true, owing: 0, pence: 0 });
    }
  }, [teams]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, owing, pence } = state;

  if (teams.length === 0) {
    return (
      <div className="tile">
        <h3>Money</h3>
        <div className="stat-row"><span className="stat">—</span></div>
        <div className="state" style={{ marginTop: 8 }}>
          Club-wide payments dashboard arrives in a later release.
        </div>
      </div>
    );
  }
  if (loading) {
    return (<div className="tile"><h3>Money</h3><div className="state">Adding up subs…</div></div>);
  }
  if (error) {
    return (
      <div className="tile">
        <h3>Money</h3>
        <div className="state err">Couldn't load payments.</div>
        <button className="retry" onClick={load}>Try again</button>
      </div>
    );
  }

  return (
    <div className="tile">
      <h3>Money — your teams</h3>
      {owing === 0 ? (
        <>
          <div className="stat-row"><span className="stat">0</span>
            <span className="rag rag--good"><span className="dot" />all paid</span></div>
          <div className="state" style={{ marginTop: 8 }}>No outstanding subs across your teams.</div>
        </>
      ) : (
        <>
          <div className="stat-row">
            <span className="stat">{owing}</span>
            <span className="stat-label">unpaid · {gbp(pence)} outstanding</span>
          </div>
          <div className="state" style={{ marginTop: 8 }}>Across {teams.length} team{teams.length === 1 ? "" : "s"} you manage.</div>
        </>
      )}
    </div>
  );
}
