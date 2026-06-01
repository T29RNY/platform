import React, { useEffect, useState, useCallback } from "react";
import { leagueGetState, leagueListTeams } from "@platform/core/storage/supabase.js";
import Dashboard from "./views/Dashboard.jsx";

function readTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("token");
  if (t) return t;
  const m = window.location.pathname.match(/\/league\/([^/?]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const [token, setToken] = useState(() => readTokenFromUrl());
  const [state, setState] = useState(null);
  const [teams, setTeams] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (t) => {
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const [data, teamRes] = await Promise.all([
        leagueGetState(t),
        leagueListTeams(t).catch(() => ({ teams: [] })),
      ]);
      setState(data);
      const map = {};
      for (const tm of (teamRes?.teams || [])) map[tm.id] = tm;
      setTeams(map);
    } catch (err) {
      console.error("league_get_state failed", err);
      setError(err?.message || String(err));
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (token) load(token); }, [token, load]);

  if (!token) {
    return (
      <div className="center">
        <div className="card">
          <h1>League dashboard</h1>
          <p className="muted">Enter your league admin token to view the dashboard.</p>
          <TokenForm onSubmit={(t) => setToken(t)} />
        </div>
      </div>
    );
  }

  if (loading && !state) {
    return <div className="center"><div className="muted">Loading dashboard…</div></div>;
  }

  if (error) {
    return (
      <div className="center">
        <div className="card">
          <h1>Could not load</h1>
          <p className="muted">{error}</p>
          <button onClick={() => { setToken(null); setError(null); }}>Use a different token</button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  if (state.requires_league_pick) {
    return (
      <div className="center">
        <div className="card">
          <h1>Pick a league</h1>
          <p className="muted">This token belongs to a venue with several leagues. Open a specific league’s admin link.</p>
          <ul className="sidebar-list" style={{ marginTop: 16 }}>
            {(state.leagues || []).map((l) => <li key={l.id}><span className="sb-name">{l.name}</span></li>)}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <Dashboard
      state={state}
      teams={teams}
      leagueToken={token}
      onRefresh={() => load(token)}
      refreshing={loading}
    />
  );
}

function TokenForm({ onSubmit }) {
  const [val, setVal] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = val.trim();
        if (t) {
          const url = new URL(window.location.href);
          url.searchParams.set("token", t);
          window.history.replaceState({}, "", url.toString());
          onSubmit(t);
        }
      }}
    >
      <input type="text" placeholder="league_admin_token" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
      <button type="submit">Open dashboard</button>
    </form>
  );
}
