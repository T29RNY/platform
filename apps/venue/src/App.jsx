import React, { useEffect, useState, useCallback, useRef } from "react";
import { venueGetState, supabase } from "@platform/core/storage/supabase.js";
import Dashboard from "./views/Dashboard.jsx";

function readTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("token");
  if (t) return t;
  const m = window.location.pathname.match(/\/venue\/([^/?]+)/);
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
      const data = await venueGetState(t);
      setState(data);
    } catch (err) {
      console.error("venue_get_state failed", err);
      setError(err?.message || String(err));
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  // Subscribe to venue-level realtime broadcasts. Every ref RPC publishes
  // on venue_live:<live_channel_key> (mig 121) so the office dashboard
  // updates the moment a goal/card/sub/period/full-time happens at any
  // pitch in this venue. Channel-key UUID is the secret — match the
  // server-side publisher byte-for-byte (CLAUDE.md hard-rule #10).
  const venueChannelKey = state?.venue?.live_channel_key ?? null;
  const reloadRef = useRef(load);
  reloadRef.current = load;
  useEffect(() => {
    if (!venueChannelKey || !token) return;
    const ch = supabase.channel(`venue_live:${venueChannelKey}`);
    ch.on("broadcast", { event: "broadcast" }, (payload) => {
      // Re-fetch the full venue state. We could be smarter (e.g. only
      // re-fetch fixtures), but venue_get_state is cheap and a single
      // round-trip is fine for a dashboard.
      console.info("[venue] live update", payload?.payload?.reason);
      reloadRef.current(token);
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") console.info("[venue] subscribed to", `venue_live:${venueChannelKey.slice(0, 8)}…`);
    });
    return () => { supabase.removeChannel(ch); };
  }, [venueChannelKey, token]);

  if (!token) {
    return (
      <div className="center">
        <div className="card">
          <h1>Venue dashboard</h1>
          <p className="muted">Enter your venue admin token to view the dashboard.</p>
          <TokenForm onSubmit={(t) => setToken(t)} />
        </div>
      </div>
    );
  }

  if (loading && !state) {
    return (
      <div className="center">
        <div className="muted">Loading dashboard…</div>
      </div>
    );
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

  return (
    <Dashboard
      state={state}
      venueToken={token}
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
        placeholder="venue_admin_token"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        autoFocus
      />
      <button type="submit">Open dashboard</button>
    </form>
  );
}
