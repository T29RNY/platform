import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, getDisplayState } from "@platform/core/storage/supabase.js";
import PinGate from "./components/PinGate.jsx";
import DisplayHeader from "./components/DisplayHeader.jsx";
import LiveScoresZone from "./components/LiveScoresZone.jsx";
import StandingsZone from "./components/StandingsZone.jsx";
import BracketZone from "./components/BracketZone.jsx";
import TopScorersZone from "./components/TopScorersZone.jsx";
import UpcomingRecentZone from "./components/UpcomingRecentZone.jsx";
import GoalsTicker from "./components/GoalsTicker.jsx";
import PoweredBy from "./components/PoweredBy.jsx";
import SponsorBug from "./components/SponsorBug.jsx";
import { resolveConfig } from "./lib/format.js";

function readTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("token");
  if (t) return t;
  const m = window.location.pathname.match(/\/display\/([^/?]+)/);
  return m ? m[1] : null;
}

const POLL_MS = 60000; // belt-and-braces fallback if the realtime socket silently drops

export default function App() {
  const token = useMemo(readTokenFromUrl, []);
  const [unlocked, setUnlocked] = useState(false);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [compIndex, setCompIndex] = useState(0);
  const serverOffsetRef = useRef(0);

  const load = useCallback(async (t) => {
    try {
      const data = await getDisplayState(t);
      if (data?.server_time) serverOffsetRef.current = new Date(data.server_time).getTime() - Date.now();
      setState(data);
      setError(null);
    } catch (err) {
      console.error("[display] load failed", err);
      setError(err?.message || String(err));
    }
  }, []);

  // initial + poll fallback
  useEffect(() => {
    if (!unlocked || !token) return;
    load(token);
    const id = setInterval(() => load(token), POLL_MS);
    const onFocus = () => load(token);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [unlocked, token, load]);

  // realtime: subscribe to the venue broadcast channel; auto-resubscribe on error
  const channelKey = state?.venue?.live_channel_key ?? null;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!channelKey || !token) return;
    let retry;
    let ch;
    const subscribe = () => {
      ch = supabase.channel(`venue_live:${channelKey}`);
      ch.on("broadcast", { event: "broadcast" }, (payload) => {
        console.info("[display] live update", payload?.payload?.reason);
        loadRef.current(token);
      });
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") setConnected(true);
        else if (["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          setConnected(false);
          clearTimeout(retry);
          retry = setTimeout(() => { supabase.removeChannel(ch); subscribe(); }, 3000);
        }
      });
    };
    subscribe();
    return () => { clearTimeout(retry); if (ch) supabase.removeChannel(ch); };
  }, [channelKey, token]);

  // wake lock — keep the TV awake; re-acquire when the tab regains focus
  useEffect(() => {
    if (!unlocked) return;
    let lock = null;
    const acquire = async () => {
      try { if ("wakeLock" in navigator) lock = await navigator.wakeLock.request("screen"); } catch {}
    };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); try { lock?.release(); } catch {} };
  }, [unlocked]);

  // clock tick (also drives live-minute re-render)
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // white-label accents
  useEffect(() => {
    const root = document.documentElement;
    const p = state?.venue?.primary_colour;
    const s = state?.venue?.secondary_colour;
    if (p) root.style.setProperty("--accent", p);
    if (s) root.style.setProperty("--accent-2", s);
    return () => { root.style.removeProperty("--accent"); root.style.removeProperty("--accent-2"); };
  }, [state?.venue?.primary_colour, state?.venue?.secondary_colour]);

  const config = useMemo(() => resolveConfig(state?.venue?.display_config), [state?.venue?.display_config]);
  const rawConfig = state?.venue?.display_config || {};
  const competitions = state?.competitions || [];
  const liveFixtures = state?.live_fixtures || [];
  const liveCompIds = useMemo(() => new Set(liveFixtures.map((f) => f.competition_id)), [liveFixtures]);

  // rotate which competition the standings + scorers show
  useEffect(() => {
    if (competitions.length <= 1) { setCompIndex(0); return; }
    const id = setInterval(
      () => setCompIndex((i) => (i + 1) % competitions.length),
      (config.interval_secs || 15) * 1000
    );
    return () => clearInterval(id);
  }, [competitions.length, config.interval_secs]);

  const safeIndex = competitions.length ? compIndex % competitions.length : 0;
  const shownComp = competitions[safeIndex] || null;
  const shownCompIsLive = shownComp ? liveCompIds.has(shownComp.competition_id) : false;

  const has = (z) => config.zones.includes(z);

  // ---- gates ----
  if (!token) {
    return <div className="loader">NO DISPLAY TOKEN</div>;
  }
  if (!unlocked) {
    return <PinGate token={token} onUnlock={() => setUnlocked(true)} />;
  }
  if (error && !state) {
    return <div className="loader">{error === "invalid_display_token" ? "INVALID DISPLAY LINK" : "CONNECTING…"}</div>;
  }
  if (!state) {
    return <div className="loader">●</div>;
  }

  const showLiveHero = has("live_scores") && liveFixtures.length > 0;

  return (
    <div className="stage">
      <div className="floodsweep" />
      <div className="pitch" />
      <DisplayHeader venue={state.venue} clock={clock} liveCount={liveFixtures.length} connected={connected} />

      <div className="grid">
        <div className="col-left">
          {showLiveHero ? (
            <LiveScoresZone fixtures={liveFixtures} serverOffset={serverOffsetRef.current} />
          ) : (
            <UpcomingRecentZone
              upcoming={has("upcoming") ? state.upcoming_fixtures : []}
              recent={has("recent") ? state.recent_results : []}
              customMessage={has("custom_message") ? config.custom_message : ""}
              leaders={shownComp?.standings_confirmed || []}
              venue={state.venue}
            />
          )}
          {has("top_scorers") && <TopScorersZone competition={shownComp} />}
        </div>

        <div className="col-right">
          {has("standings") && (
            shownComp?.type === "cup"
              ? <BracketZone competition={shownComp} version={state.server_time} />
              : <StandingsZone competition={shownComp} isLive={shownCompIsLive} />
          )}
        </div>

        <div className="botbar">
          <SponsorBug
            sponsorUrl={rawConfig.sponsor_image_url}
            sponsorLabel={rawConfig.sponsor_label}
            venueLogo={state.venue?.logo_url}
          />
          {has("goals_ticker") && (
            <GoalsTicker goals={state.goals_ticker} customMessage={has("custom_message") ? config.custom_message : ""} />
          )}
        </div>
      </div>

      <PoweredBy />
    </div>
  );
}
