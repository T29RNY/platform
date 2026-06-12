// ============================================================
// App — token routing only. /ref/<TOKEN> or ?token=<TOKEN>.
// No demo switcher, no iOS device frame: the broadcast-dark .app
// fills the viewport. Routes on fixture.status:
//   in_progress → LiveMatch · completed → PostMatch · else → PreMatch
//   (PreMatch renders the non-completed terminal banners itself).
// ============================================================
import React, { useEffect, useState, useCallback } from "react";
import { getFixtureStateByRefToken } from "@platform/core/storage/supabase.js";
import { FlagIcon } from "./components/ui.jsx";
import PreMatch from "./views/PreMatch.jsx";
import LiveMatch from "./views/LiveMatch.jsx";
import PostMatch from "./views/PostMatch.jsx";

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

  useEffect(() => { if (token) load(token); }, [token, load]);

  const refetch = useCallback(() => load(token), [token, load]);

  if (!token) return <TokenEntry onSubmit={(t) => {
    const url = new URL(window.location.href);
    url.searchParams.set("token", t);
    window.history.replaceState({}, "", url.toString());
    setToken(t);
  }} />;

  if (loading && !state) return <Loading />;

  if (error) {
    return <ErrorScreen message={error} onReset={() => { setToken(null); setError(null); }} />;
  }

  if (!state) return <Loading />;

  const status = state.fixture?.status;
  if (status === "in_progress") return <LiveMatch key={token} state={state} refToken={token} onRefresh={refetch} />;
  if (status === "completed") return <PostMatch key={token} state={state} />;
  return <PreMatch key={token} state={state} refToken={token} onRefresh={refetch} />;
}

function Loading() {
  return (
    <div className="app">
      <div className="safetop" />
      <div className="center-screen">
        <div className="loader" />
        <div style={{ color: "var(--txt3)", fontWeight: 600 }}>Loading match…</div>
      </div>
    </div>
  );
}

function TokenEntry({ onSubmit }) {
  const [v, setV] = useState("");
  return (
    <div className="app">
      <div className="safetop" />
      <div className="center-screen">
        <div className="brandmark"><span className="brand-dot"><FlagIcon s={16} c="#04201D" /></span> IoO Ref</div>
        <div className="entry-card" style={{ textAlign: "center" }}>
          <div style={{ color: "var(--txt2)", fontWeight: 600, fontSize: 14.5, marginBottom: 18, lineHeight: 1.5 }}>Enter the referee link or token from the venue admin.</div>
          <input className="field" placeholder="Paste token…" value={v} onChange={(e) => setV(e.target.value)} />
          <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 12 }} disabled={!v.trim()} onClick={() => onSubmit(v.trim())}>Continue</button>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onReset }) {
  const friendly = /invalid_ref_token/.test(message || "");
  return (
    <div className="app">
      <div className="safetop" />
      <div className="center-screen">
        <div className="err-icon"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 6v6M11 16h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg></div>
        <div style={{ textAlign: "center", maxWidth: 280 }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{friendly ? "Link not recognised" : "Something went wrong"}</div>
          <div style={{ color: "var(--txt2)", fontWeight: 500, fontSize: 14, lineHeight: 1.5 }}>{friendly ? "Ask the venue admin to resend your referee link." : (message || "Unexpected error.")}</div>
        </div>
        <button className="btn btn-ghost btn-block" style={{ maxWidth: 280, height: 50 }} onClick={onReset}>Use a different link</button>
      </div>
    </div>
  );
}
