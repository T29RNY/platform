// RefFixtures.jsx — Referee track, the "My fixtures" list (amber).
//
// The referee's home inside /hub. Reads the EXISTING get_my_assignments(null) (mig
// 372, Swift-locked shape — untouched): one row per league/casual fixture this person
// is the match official for, already filtered server-side to live + upcoming only
// (status IN scheduled|allocated|in_progress, future-or-live). No new backend.
//
// Rows group into "Live now" (is_in_progress) and "Upcoming". Tapping a row hands the
// fixture's ref_token up to the shell, which opens the existing token-driven ref app
// (apps/ref) in a full-screen iframe overlay — the meticulous officiating UI is reused
// unchanged, never re-ported here.

import { useEffect, useState } from "react";
import { getMyAssignments } from "@platform/core";
import MIcon from "../icons.jsx";

// kickoff_at is a timestamp (league = local naive, casual = tz) — format defensively.
function fmtKick(iso) {
  if (!iso) return "Time TBC";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Time TBC";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${time}`;
}

function titleFor(g) {
  if (g.context === "casual") return g.squad_name || "Casual match";
  return `${g.home_team || "Home"}  v  ${g.away_team || "Away"}`;
}

function ContextChip({ context }) {
  const casual = context === "casual";
  return (
    <span style={{
      flex: "none", fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase",
      padding: "3px 8px", borderRadius: "var(--r-pill)",
      background: casual ? "var(--amber-soft)" : "var(--info-soft)",
      color: casual ? "var(--amber)" : "var(--info-ink)",
    }}>
      {casual ? "Casual" : "League"}
    </span>
  );
}

function FixtureRow({ g, onOpen }) {
  const live = g.is_in_progress;
  return (
    <button
      onClick={() => onOpen(g)}
      className="m-card"
      style={{
        width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "var(--m-font)",
        padding: "13px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
        background: live ? "var(--amber-soft)" : "var(--s2)",
        borderColor: live ? "var(--amber-glow)" : "var(--hair)",
      }}>
      <div style={{
        width: 40, height: 40, borderRadius: 11, flex: "none", display: "flex",
        alignItems: "center", justifyContent: "center",
        background: live ? "var(--amber)" : "var(--s4)",
      }}>
        <MIcon name="whistle" size={20} color={live ? "var(--amber-ink)" : "var(--ink2)"} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {titleFor(g)}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {live ? "In progress" : fmtKick(g.kickoff_at)}{g.venue_name ? ` · ${g.venue_name}` : ""}
        </div>
      </div>
      <ContextChip context={g.context} />
      <MIcon name="chevron" size={16} color="var(--ink4)" />
    </button>
  );
}

function Eyebrow({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "20px 2px 10px" }}>
      <div className="m-eyebrow">{children}</div>
      {right && <span style={{ fontSize: 11.5, color: "var(--ink4)", fontWeight: 600 }}>{right}</span>}
    </div>
  );
}

export default function RefFixtures({ onOpenMatch, toast }) {
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [games, setGames] = useState([]);

  const load = () => {
    setStatus("loading");
    getMyAssignments(null)
      .then((res) => { setGames(res?.games || []); setStatus("ok"); })
      .catch((e) => { console.error("[ref] get_my_assignments failed", e); setStatus("error"); });
  };
  useEffect(() => { load(); }, []);

  const open = (g) => {
    if (!g.ref_token) { toast?.({ icon: "alert", text: "No officiating link for this match yet" }); return; }
    onOpenMatch(g);
  };

  if (status === "loading") {
    return (
      <div className="m-view-enter">
        <div className="m-card" style={{ padding: "22px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--ink3)" }}>Loading your fixtures…</div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="m-view-enter">
        <div className="m-card" style={{ padding: "20px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Couldn't load fixtures</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", margin: "5px 0 14px" }}>Check your connection and try again.</div>
          <button onClick={load}
            style={{ border: "none", borderRadius: "var(--r-md)", padding: "10px 18px", fontSize: 14, fontWeight: 700, color: "var(--amber-ink)", background: "var(--amber)", cursor: "pointer", fontFamily: "var(--m-font)" }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const liveGames = games.filter((g) => g.is_in_progress);
  const upcoming = games.filter((g) => !g.is_in_progress);

  if (games.length === 0) {
    return (
      <div className="m-view-enter">
        <div className="m-card" style={{ padding: "26px 18px", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px", background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MIcon name="whistle" size={26} color="var(--amber)" />
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: "var(--ink)" }}>No fixtures assigned</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 6, lineHeight: 1.5 }}>
            When a venue assigns you to officiate a match, it'll show up here — ready to run from your phone.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="m-view-enter">
      {liveGames.length > 0 && (
        <>
          <Eyebrow right={`${liveGames.length} on pitch`}>Live now</Eyebrow>
          {liveGames.map((g) => <FixtureRow key={g.game_id} g={g} onOpen={open} />)}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <Eyebrow right={`${upcoming.length} match${upcoming.length === 1 ? "" : "es"}`}>Upcoming</Eyebrow>
          {upcoming.map((g) => <FixtureRow key={g.game_id} g={g} onOpen={open} />)}
        </>
      )}

      <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "16px 2px 4px", lineHeight: 1.45 }}>
        Tap a match to open the officiating screen — record goals, cards and the clock right here.
      </div>
    </div>
  );
}
