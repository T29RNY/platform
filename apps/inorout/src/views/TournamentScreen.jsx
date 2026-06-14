import React, { useEffect, useState } from "react";
import { getTournamentPublic } from "@platform/core/storage/supabase.js";

const STATUS_STYLE = {
  open:      { background: "rgba(255,190,60,0.12)",  color: "var(--amber, #FFBE3C)" },
  live:      { background: "rgba(76,175,80,0.15)",   color: "rgba(76,175,80,1)" },
  closed:    { background: "rgba(255,255,255,0.06)", color: "var(--t2, rgba(255,255,255,0.5))" },
  completed: { background: "rgba(255,255,255,0.06)", color: "var(--t2, rgba(255,255,255,0.5))" },
  draft:     { background: "rgba(255,255,255,0.06)", color: "var(--t2, rgba(255,255,255,0.5))" },
};

const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  } catch { return iso; }
};

export default function TournamentScreen({ slug }) {
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [notFound, setNotFound]     = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    setTournament(null);
    getTournamentPublic(slug)
      .then(data => {
        if (!alive) return;
        if (!data?.ok) {
          setNotFound(true);
        } else {
          setTournament(data);
        }
      })
      .catch(e => {
        console.error("[tournament] public fetch failed", e);
        if (alive) setNotFound(true);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const shell = (children) => (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg, #0A0A08)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 32,
      fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
    }}>
      <div style={{
        maxWidth: 440, width: "100%",
        background: "var(--b2, rgba(255,255,255,0.04))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
        borderRadius: 16, padding: "32px 28px",
        display: "flex", flexDirection: "column", gap: 20,
      }}>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div style={{ fontSize: 14, color: "var(--t2, rgba(255,255,255,0.5))", textAlign: "center" }}>
        Loading…
      </div>
    );
  }

  if (notFound) {
    return shell(
      <>
        <div style={{ fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)", fontSize: 28, color: "var(--t1, #fff)", lineHeight: 1 }}>
          Tournament not found
        </div>
        <div style={{ fontSize: 14, color: "var(--t2, rgba(255,255,255,0.5))", lineHeight: 1.5 }}>
          This tournament doesn't exist or isn't open yet.
        </div>
        <a href="/" style={{ fontSize: 13, color: "var(--t2, rgba(255,255,255,0.5))", textDecoration: "none", textAlign: "center" }}>
          ← Back to home
        </a>
      </>
    );
  }

  const statusStyle = STATUS_STYLE[tournament.status] ?? STATUS_STYLE.draft;

  return shell(
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)", fontSize: 32, lineHeight: 1.1, color: "var(--t1, #fff)", flex: 1 }}>
          {tournament.name}
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
          padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0, marginTop: 4,
          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          ...statusStyle,
        }}>
          {tournament.status}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Row label="Date">
          {fmtDate(tournament.event_date)}
          {tournament.event_end_date && tournament.event_end_date !== tournament.event_date && (
            <> – {fmtDate(tournament.event_end_date)}</>
          )}
        </Row>
        <Row label="Venue">{tournament.venue_name}</Row>
        <Row label="Club">{tournament.club_name}</Row>
      </div>

      {tournament.competitions && tournament.competitions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ height: 1, background: "var(--border-subtle, rgba(255,255,255,0.08))" }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body, 'DM Sans', sans-serif)", textTransform: "uppercase" }}>
            Competitions
          </span>
          {tournament.competitions.map(comp => (
            <div key={comp.competition_id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--t1, #fff)", fontFamily: "var(--font-body, 'DM Sans', sans-serif)" }}>
                  {comp.name}
                </span>
                <span style={{ fontSize: 11, color: "var(--t3, #666)", fontFamily: "var(--font-body, 'DM Sans', sans-serif)" }}>
                  {comp.type}{comp.format ? ` · ${comp.format}` : ""}
                </span>
              </div>
              {comp.teams && comp.teams.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {comp.teams.map(tm => (
                    <span key={tm.competition_team_id} style={{ fontSize: 12, color: "var(--t2, rgba(255,255,255,0.5))", background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "3px 10px", fontFamily: "var(--font-body, 'DM Sans', sans-serif)" }}>
                      {tm.team_name}
                    </span>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: "var(--t3, #666)", fontFamily: "var(--font-body, 'DM Sans', sans-serif)" }}>
                  No teams registered yet.
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <a href="/" style={{ fontSize: 13, color: "var(--t2, rgba(255,255,255,0.5))", textDecoration: "none", textAlign: "center", marginTop: 4 }}>
        ← Back to home
      </a>
    </>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body, 'DM Sans', sans-serif)", textTransform: "uppercase", minWidth: 52, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: "var(--t1, #fff)", fontFamily: "var(--font-body, 'DM Sans', sans-serif)", lineHeight: 1.4 }}>
        {children}
      </span>
    </div>
  );
}
