import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, getDisplayState, getDisplayLandingCode } from "@platform/core/storage/supabase.js";
import PinGate from "./components/PinGate.jsx";
import DisplayHeader from "./components/DisplayHeader.jsx";
import Hero from "./components/Hero.jsx";
import MiniTile from "./components/MiniTile.jsx";
import LiveTable from "./components/LiveTable.jsx";
import GoldenBoot from "./components/GoldenBoot.jsx";
import ComingUp from "./components/ComingUp.jsx";
import TallPromo from "./components/TallPromo.jsx";
import GoalsTicker from "./components/GoalsTicker.jsx";
import PanelBoundary from "./components/PanelBoundary.jsx";
import { resolveConfig } from "./lib/format.js";
import { selectFeatured } from "./lib/featured.js";
import { diffPayloads } from "./lib/diff.js";

function readTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("token");
  if (t) return t;
  const m = window.location.pathname.match(/\/display\/([^/?]+)/);
  return m ? m[1] : null;
}

const POLL_MS = 60000; // belt-and-braces fallback if the realtime socket silently drops
const CELEB_MS = 3500; // goal celebration hold
const CELEB_GAP_MS = 5000; // throttle: at most one celebration per 5s, queue extras

export default function App() {
  const token = useMemo(readTokenFromUrl, []);
  const [unlocked, setUnlocked] = useState(false);
  const [state, setState] = useState(null);
  const [landingUrl, setLandingUrl] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [compIndex, setCompIndex] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [heroFading, setHeroFading] = useState(false);
  const serverOffsetRef = useRef(0);
  const prevPayloadRef = useRef(null);
  const celebQueueRef = useRef([]);
  const celebBusyRef = useRef(false);
  const goalLatchRef = useRef({ fixtureId: null, until: 0 });
  const featuredIdRef = useRef(null);
  const canvasRef = useRef(null);

  // Fetch the venue's venue_landing QR url once (rarely changes; off the hot
  // poll/broadcast path). Panel shows only when the venue has provisioned one.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    getDisplayLandingCode(token)
      .then((r) => { if (alive) setLandingUrl(r?.url || null); })
      .catch((e) => { console.error("[display] landing code failed", e); });
    return () => { alive = false; };
  }, [token]);

  // ---- celebration queue: one at a time, ≥5s apart ----
  const pumpCelebrations = useCallback(() => {
    if (celebBusyRef.current) return;
    const next = celebQueueRef.current.shift();
    if (!next) return;
    celebBusyRef.current = true;
    setCelebration(next);
    setTimeout(() => setCelebration(null), CELEB_MS);
    setTimeout(() => {
      celebBusyRef.current = false;
      pumpCelebrations();
    }, CELEB_GAP_MS);
  }, []);

  const load = useCallback(async (t) => {
    try {
      const data = await getDisplayState(t);
      if (data?.server_time) serverOffsetRef.current = new Date(data.server_time).getTime() - Date.now();
      const { celebrations } = diffPayloads(prevPayloadRef.current, data);
      prevPayloadRef.current = data;
      if (celebrations.length) {
        celebQueueRef.current.push(...celebrations);
        pumpCelebrations();
      }
      setState(data);
      setLastSyncAt(Date.now());
      setError(null);
    } catch (err) {
      console.error("[display] load failed", err);
      setError(err?.message || String(err));
    }
  }, [pumpCelebrations]);

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

  // clock tick (server-anchored; also drives live-minute re-render)
  useEffect(() => {
    const id = setInterval(() => setClock(new Date(Date.now() + serverOffsetRef.current)), 1000);
    return () => clearInterval(id);
  }, []);

  // 1920×1080 canvas → scale-to-fit letterbox (HANDOVER §3)
  useEffect(() => {
    const fit = () => {
      if (!canvasRef.current) return;
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      canvasRef.current.style.transform = `translate(-50%, -50%) scale(${scale})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [unlocked, state ? 1 : 0]);

  // venue brand colours → CSS vars
  useEffect(() => {
    const root = document.documentElement;
    const p = state?.venue?.primary_colour;
    const s = state?.venue?.secondary_colour;
    if (p) root.style.setProperty("--venue", p);
    if (s) root.style.setProperty("--venue-2", s);
    return () => { root.style.removeProperty("--venue"); root.style.removeProperty("--venue-2"); };
  }, [state?.venue?.primary_colour, state?.venue?.secondary_colour]);

  const config = useMemo(() => resolveConfig(state?.venue?.display_config), [state?.venue?.display_config]);
  const rawConfig = state?.venue?.display_config || {};
  const competitions = state?.competitions || [];
  const liveFixtures = state?.live_fixtures || [];
  const liveTeamIds = useMemo(
    () => new Set(liveFixtures.flatMap((f) => [f.home_team_id, f.away_team_id]).filter(Boolean)),
    [liveFixtures]
  );

  // rotation pool by mode: smart skips comps with no live fixtures (unless none
  // are live anywhere), fixed pins one, cycle round-robins everything
  const liveCompIds = useMemo(() => new Set(liveFixtures.map((f) => f.competition_id)), [liveFixtures]);
  const rotation = useMemo(() => {
    if (!competitions.length) return [];
    if (config.mode === "fixed") {
      const liveComp = competitions.find((c) => liveCompIds.has(c.competition_id));
      return [liveComp || competitions[0]];
    }
    if (config.mode === "smart" && liveCompIds.size > 0) {
      const livePool = competitions.filter((c) => liveCompIds.has(c.competition_id));
      if (livePool.length) return livePool;
    }
    return competitions;
  }, [competitions, config.mode, liveCompIds]);

  useEffect(() => {
    if (rotation.length <= 1) { setCompIndex(0); return; }
    const id = setInterval(
      () => setCompIndex((i) => (i + 1) % rotation.length),
      (config.interval_secs || 10) * 1000
    );
    return () => clearInterval(id);
  }, [rotation.length, config.interval_secs]);

  const safeIndex = rotation.length ? compIndex % rotation.length : 0;
  const shownComp = rotation[safeIndex] || null;

  // featured match (HANDOVER §8) + crossfade on swap
  const featured = useMemo(
    () => selectFeatured(state, serverOffsetRef.current, goalLatchRef.current, rawConfig),
    // clock dep: re-evaluate roughly once a minute as minutes tick over
    [state, Math.floor(clock.getTime() / 60000)]
  );
  const featuredId = featured.fixture?.fixture_id || featured.mode;
  useEffect(() => {
    if (featuredIdRef.current != null && featuredIdRef.current !== featuredId) {
      setHeroFading(true);
      const t = setTimeout(() => setHeroFading(false), 250);
      return () => clearTimeout(t);
    }
    featuredIdRef.current = featuredId;
  }, [featuredId]);
  useEffect(() => { featuredIdRef.current = featuredId; }, [featuredId]);

  const featuredComp = featured.fixture
    ? competitions.find((c) => c.competition_id === featured.fixture.competition_id)
    : null;
  const sideFixtures = liveFixtures
    .filter((f) => f.fixture_id !== featured.fixture?.fixture_id)
    .slice(0, 2);

  const has = (z) => config.zones.includes(z);

  // ---- gates ----
  if (!token) return <div className="loader">NO DISPLAY TOKEN</div>;
  if (!unlocked) return <PinGate token={token} onUnlock={() => setUnlocked(true)} />;
  if (error && !state) {
    return <div className="loader">{error === "invalid_display_token" ? "INVALID DISPLAY LINK" : "CONNECTING…"}</div>;
  }
  if (!state) return <div className="loader">●</div>;

  // lower-row panels honour the operator's zone toggles; the grid re-weights
  const lowerPanels = [
    has("standings") && {
      key: "table", fr: "1.05fr",
      el: (
        <LiveTable
          comps={rotation}
          activeIdx={safeIndex}
          intervalSecs={config.interval_secs || 10}
          liveTeamIds={liveTeamIds}
          serverTime={state.server_time}
        />
      ),
    },
    has("top_scorers") && { key: "gb", fr: "0.62fr", el: <GoldenBoot competition={shownComp} /> },
    has("upcoming") && {
      key: "upcoming", fr: "0.62fr",
      el: <ComingUp upcoming={state.upcoming_fixtures} bookings={state.bookings} serverOffset={serverOffsetRef.current} />,
    },
    {
      key: "promo", fr: "0.5fr",
      el: (
        <TallPromo
          config={rawConfig}
          venue={state.venue}
          liveFixtures={liveFixtures}
          upcoming={state.upcoming_fixtures}
          landingUrl={landingUrl}
        />
      ),
    },
  ].filter(Boolean);

  return (
    <div className="stage">
      <div className="canvas" ref={canvasRef}>
        <DisplayHeader
          venue={state.venue}
          clock={clock}
          liveCount={liveFixtures.length}
          compLabel={shownComp?.name}
        />

        <main className="main">
          <section className="live-row">
            <PanelBoundary name="hero" resetKey={lastSyncAt} fallback={<article className="hero" />}>
              <Hero
                featured={featured}
                comp={featuredComp}
                serverOffset={serverOffsetRef.current}
                celebration={celebration}
                venue={state.venue}
                customMessage={has("custom_message") ? config.custom_message : ""}
                fading={heroFading}
              />
            </PanelBoundary>
            <div className="side-stack">
              <PanelBoundary name="mini-0" resetKey={lastSyncAt} fallback={<article className="mini empty" />}>
                <MiniTile
                  fixture={sideFixtures[0]}
                  comp={sideFixtures[0] ? competitions.find((c) => c.competition_id === sideFixtures[0].competition_id) : null}
                  serverOffset={serverOffsetRef.current}
                />
              </PanelBoundary>
              <PanelBoundary name="mini-1" resetKey={lastSyncAt} fallback={<article className="mini empty" />}>
                <MiniTile
                  fixture={sideFixtures[1]}
                  comp={sideFixtures[1] ? competitions.find((c) => c.competition_id === sideFixtures[1].competition_id) : null}
                  serverOffset={serverOffsetRef.current}
                />
              </PanelBoundary>
            </div>
          </section>

          <section className="lower" style={{ gridTemplateColumns: lowerPanels.map((p) => p.fr).join(" ") }}>
            {lowerPanels.map((p) => (
              <PanelBoundary name={p.key} resetKey={lastSyncAt} key={p.key} fallback={<article className="panel" />}>
                {p.el}
              </PanelBoundary>
            ))}
          </section>
        </main>

        {has("goals_ticker") && (
          <PanelBoundary name="ticker" resetKey={lastSyncAt} fallback={<footer className="ticker" />}>
            <GoalsTicker goals={state.goals_ticker} lastSyncAt={lastSyncAt} />
          </PanelBoundary>
        )}

        {!connected && state && (
          <div className="offline-toast"><span className="dot" /> Live updates paused — reconnecting</div>
        )}
      </div>
    </div>
  );
}
