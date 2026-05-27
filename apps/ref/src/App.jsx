import React, { useEffect, useState, useCallback } from "react";
import { getFixtureStateByRefToken } from "@platform/core/storage/supabase.js";
import PreMatch from "./views/PreMatch.jsx";
import LiveMatch from "./views/LiveMatch.jsx";

function readTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("token");
  if (t) return t;
  const m = window.location.pathname.match(/\/ref\/([^/?]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const [token, setToken] = useState(() => readTokenFromUrl());
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (t) => {
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getFixtureStateByRefToken(t);
      setState(data);
    } catch (err) {
      console.error("get_fixture_state_by_ref_token failed", err);
      setError(err?.message || String(err));
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  if (!token) {
    return (
      <div className="center">
        <div className="card">
          <h1>Referee</h1>
          <p className="muted">Open the link you were sent by the venue. It looks like <code>app/ref/&lt;your-token&gt;</code>.</p>
          <TokenForm onSubmit={(t) => setToken(t)} />
        </div>
      </div>
    );
  }

  if (loading && !state) {
    return (
      <div className="center">
        <div className="muted">Loading match…</div>
      </div>
    );
  }

  if (error) {
    const friendly = /invalid_ref_token/.test(error)
      ? "This referee link is not recognised. Check the link or ask the venue admin to resend."
      : error;
    return (
      <div className="center">
        <div className="card">
          <h1>Could not load</h1>
          <p className="muted">{friendly}</p>
          <button onClick={() => { setToken(null); setError(null); }}>Use a different link</button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  // Match in progress → live screen. Anything else (scheduled / allocated
  // / completed / void / postponed / walkover / forfeit) → pre-match,
  // which handles terminal banners itself.
  const status = state.fixture?.status;
  if (status === "in_progress") {
    return (
      <LiveMatch
        state={state}
        refToken={token}
        onRefresh={() => load(token)}
      />
    );
  }

  return (
    <PreMatch
      state={state}
      refToken={token}
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
      <input
        type="text"
        placeholder="referee token"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        autoFocus
      />
      <button type="submit">Open match</button>
    </form>
  );
}
