import React, { useCallback, useEffect, useRef, useState } from "react";
import { hqGetActivity, supabase } from "@platform/core/storage/supabase.js";

export default function ActivityFeed({ companyId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    try { setData(await hqGetActivity(companyId)); setErr(null); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // 30s poll fallback so live scores stay fresh even if a broadcast is missed
  useEffect(() => {
    if (!companyId) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [companyId, load]);

  // realtime: one subscription per venue channel (mirrors apps/venue, mig 121 publisher);
  // any goal/card/result broadcast → debounced refetch of the whole feed.
  const loadRef = useRef(load);
  loadRef.current = load;
  const channels = data?.channels;
  const channelsKey = JSON.stringify(channels || []);
  useEffect(() => {
    const keys = JSON.parse(channelsKey);
    if (!keys.length) return;
    let timer = null;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(() => loadRef.current(), 800); };
    const chans = keys.map((key) => {
      const ch = supabase.channel(`venue_live:${key}`);
      ch.on("broadcast", { event: "broadcast" }, debounced);
      ch.subscribe();
      return ch;
    });
    return () => { clearTimeout(timer); chans.forEach((c) => supabase.removeChannel(c)); };
  }, [channelsKey]);

  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="muted">Loading live feed…</div>;

  const live = data.live || [];
  const upcoming = data.upcoming || [];
  const goals = data.goals || [];
  const showingLive = live.length > 0;
  const fixtures = showingLive ? live : upcoming;

  return (
    <div>
      <div className="section">
        <h2>{showingLive ? "Live now" : "Upcoming"}</h2>
        {fixtures.length === 0 && <div className="empty">No fixtures scheduled.</div>}
        {fixtures.map((f) => (
          <div className="list-row" key={f.fixture_id}>
            <div className="lr-top">
              <span className="lr-desc">{f.home || "TBC"} v {f.away || "TBC"}</span>
              {showingLive && f.home_score != null
                ? <span className="mono">{f.home_score}–{f.away_score}</span>
                : <span className="badge">{statusLabel(f)}</span>}
            </div>
            <div className="lr-meta">
              {f.venue}
              {f.date ? " · " + fmtDate(f.date) : ""}
              {f.kickoff_time ? " · " + String(f.kickoff_time).slice(0, 5) : ""}
            </div>
          </div>
        ))}
      </div>

      <div className="section">
        <h2>Goals</h2>
        {goals.length === 0 && <div className="empty">No goals recorded yet.</div>}
        {goals.map((g, i) => (
          <div className="fixture-row" key={i}>
            <span className="fr-teams">⚽ {g.player}{g.team ? " (" + g.team + ")" : ""}</span>
            <span className="muted">{g.venue}{g.minute != null ? " · " + g.minute + "'" : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusLabel(f) {
  if (f.status === "in_progress") return "LIVE";
  if (f.kickoff_time) return String(f.kickoff_time).slice(0, 5);
  return f.status || "";
}

function fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch (e) { return d; }
}
