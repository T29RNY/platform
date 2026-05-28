import React, { useEffect, useState, useCallback, useRef } from "react";
import { venueGetState, getPitchOccupancy, supabase } from "@platform/core/storage/supabase.js";
import Dashboard from "./views/Dashboard.jsx";
import { todayIso, addDays } from "./bookingUtil.js";

const BOOKING_REASONS = new Set([
  "booking_requested", "booking_confirmed", "booking_declined",
  "booking_cancelled", "booking_superseded",
]);

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
  const [occupancy, setOccupancy] = useState([]);
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

  // Booking occupancy (fixtures + bookings + maintenance) for the inbox + calendar.
  // Window: today .. +90d covers all pending requests and the visible calendar.
  const loadOccupancy = useCallback(async (t) => {
    if (!t) return;
    try {
      const rows = await getPitchOccupancy(t, todayIso(), addDays(todayIso(), 90));
      setOccupancy(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error("get_pitch_occupancy failed", err);
      setOccupancy([]);
    }
  }, []);

  useEffect(() => {
    if (token) { load(token); loadOccupancy(token); }
  }, [token, load, loadOccupancy]);

  // Subscribe to venue-level realtime broadcasts. Every ref RPC publishes
  // on venue_live:<live_channel_key> (mig 121) so the office dashboard
  // updates the moment a goal/card/sub/period/full-time happens at any
  // pitch in this venue. Channel-key UUID is the secret — match the
  // server-side publisher byte-for-byte (CLAUDE.md hard-rule #10).
  const venueChannelKey = state?.venue?.live_channel_key ?? null;
  const reloadRef = useRef(load);
  reloadRef.current = load;
  const reloadOccRef = useRef(loadOccupancy);
  reloadOccRef.current = loadOccupancy;
  useEffect(() => {
    if (!venueChannelKey || !token) return;
    const ch = supabase.channel(`venue_live:${venueChannelKey}`);
    ch.on("broadcast", { event: "broadcast" }, (payload) => {
      const reason = payload?.payload?.reason;
      console.info("[venue] live update", reason);
      // Booking reasons only move occupancy → refetch the calendar/inbox.
      // Everything else (fixtures, refs, settings) can also shift occupancy,
      // so refetch both. Keeps the grid from ever showing a stale slot.
      reloadOccRef.current(token);
      if (!BOOKING_REASONS.has(reason)) reloadRef.current(token);
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
      occupancy={occupancy}
      onRefresh={() => load(token)}
      onRefreshOccupancy={() => loadOccupancy(token)}
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
