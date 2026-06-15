import React, { useEffect, useRef, useState } from "react";
import { getTournamentPublic } from "@platform/core/storage/supabase.js";

const STATUS_STYLE = {
  open:      { background: "rgba(255,190,60,0.12)",  color: "var(--amber, #FFBE3C)" },
  live:      { background: "rgba(76,175,80,0.15)",   color: "rgba(76,175,80,1)" },
  closed:    { background: "rgba(255,255,255,0.06)", color: "var(--t2, rgba(255,255,255,0.5))" },
  completed: { background: "rgba(255,255,255,0.06)", color: "var(--t2, rgba(255,255,255,0.5))" },
  draft:     { background: "rgba(255,255,255,0.06)", color: "var(--t2, rgba(255,255,255,0.5))" },
};

const FIXTURE_STATUS_STYLE = {
  scheduled:    { color: "var(--t3, #666)" },
  in_progress:  { color: "rgba(76,175,80,1)" },
  completed:    { color: "var(--t2, rgba(255,255,255,0.5))" },
  postponed:    { color: "var(--amber, #FFBE3C)" },
  voided:       { color: "var(--t3, #666)" },
};

const FIXTURE_STATUS_LABEL = {
  scheduled:   "Upcoming",
  in_progress: "Live",
  completed:   "FT",
  postponed:   "Postponed",
  voided:      "Void",
};

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "long", year: "numeric",
    });
  } catch { return iso; }
}

function fmtShortDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short",
    });
  } catch { return iso; }
}

export default function TournamentScreen({ slug }) {
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [notFound, setNotFound]     = useState(false);
  const pollRef = useRef(null);

  const load = (s) => {
    getTournamentPublic(s)
      .then(data => {
        if (!data?.ok) {
          setNotFound(true);
        } else {
          setTournament(data);
          setNotFound(false);
        }
      })
      .catch(e => {
        console.error("[tournament] public fetch failed", e);
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    setTournament(null);
    getTournamentPublic(slug)
      .then(data => {
        if (!alive) return;
        if (!data?.ok) { setNotFound(true); }
        else           { setTournament(data); }
      })
      .catch(e => { console.error("[tournament] public fetch failed", e); if (alive) setNotFound(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  // 30-second live poll — only when tournament is live
  useEffect(() => {
    if (tournament?.status !== "live") return;
    pollRef.current = setInterval(() => load(slug), 30000);
    return () => clearInterval(pollRef.current);
  }, [tournament?.status, slug]);

  const page = (children) => (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg, #0A0A08)",
      fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
      padding: "24px 16px 48px",
    }}>
      <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return page(
      <div style={{ fontSize: 14, color: "var(--t2, rgba(255,255,255,0.5))", textAlign: "center", paddingTop: 80 }}>
        Loading…
      </div>
    );
  }

  if (notFound) {
    return page(
      <div style={{
        background: "var(--b2, rgba(255,255,255,0.04))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
        borderRadius: 16, padding: "32px 28px",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)", fontSize: 28, color: "var(--t1, #fff)", lineHeight: 1 }}>
          Tournament not found
        </div>
        <div style={{ fontSize: 14, color: "var(--t2, rgba(255,255,255,0.5))", lineHeight: 1.5 }}>
          This tournament doesn't exist or isn't open yet.
        </div>
        <a href="/" style={{ fontSize: 13, color: "var(--t2, rgba(255,255,255,0.5))", textDecoration: "none" }}>
          ← Back to home
        </a>
      </div>
    );
  }

  const statusStyle       = STATUS_STYLE[tournament.status] ?? STATUS_STYLE.draft;
  const fixtures          = tournament.fixtures ?? [];
  const knockoutFixtures  = tournament.knockout_fixtures ?? [];
  const standings         = tournament.standings ?? [];
  const hasFixtures       = fixtures.length > 0;
  const hasKnockout       = knockoutFixtures.length > 0;
  const hasStandings      = standings.some(s => s.rows?.some(r => r.played > 0));

  return page(
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Card noPad>
        <div style={{ padding: "24px 24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontFamily: "var(--font-display, 'Bebas Neue', sans-serif)", fontSize: 34, lineHeight: 1.05, color: "var(--t1, #fff)", flex: 1 }}>
              {tournament.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 4 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                padding: "4px 10px", borderRadius: 20,
                ...statusStyle,
              }}>
                {tournament.status}
              </span>
              <button
                onClick={() => window.print()}
                className="print-hide"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8, padding: "5px 12px",
                  fontSize: 12, color: "var(--t2, rgba(255,255,255,0.5))",
                  cursor: "pointer",
                }}
              >
                Print
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <MetaRow label="Date">
              {fmtDate(tournament.event_date)}
              {tournament.event_end_date && tournament.event_end_date !== tournament.event_date && (
                <> – {fmtDate(tournament.event_end_date)}</>
              )}
            </MetaRow>
            <MetaRow label="Venue">{tournament.venue_name}</MetaRow>
            <MetaRow label="Club">{tournament.club_name}</MetaRow>
          </div>
        </div>
      </Card>

      {/* ── Schedule ───────────────────────────────────────────────────── */}
      {hasFixtures && (
        <section>
          <SectionHeading>Schedule</SectionHeading>
          <Card>
            {groupByDate(fixtures).map((group, gi) => (
              <div key={group.date ?? gi}>
                {group.date && (
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                    color: "var(--t3, #666)", padding: "10px 0 6px",
                    borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
                    marginBottom: 4,
                  }}>
                    {fmtShortDate(group.date)}
                  </div>
                )}
                {group.fixtures.map((fx, i) => (
                  <FixtureRow key={fx.fixture_id} fx={fx} last={i === group.fixtures.length - 1 && gi === groupByDate(fixtures).length - 1} />
                ))}
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* ── Knockout Stage ─────────────────────────────────────────────── */}
      {hasKnockout && (
        <section>
          <SectionHeading>Knockout Stage</SectionHeading>
          <Card>
            {groupByRound(knockoutFixtures).map((group, gi) => (
              <div key={group.round ?? gi}>
                <div style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                  color: "var(--t3, #666)", padding: "10px 0 6px",
                  borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
                  marginBottom: 4,
                }}>
                  {group.round}
                </div>
                {group.fixtures.map((fx, i) => (
                  <FixtureRow key={fx.fixture_id} fx={fx} last={i === group.fixtures.length - 1 && gi === groupByRound(knockoutFixtures).length - 1} />
                ))}
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* ── Standings ──────────────────────────────────────────────────── */}
      {hasStandings && standings.map(comp => {
        const rows = comp.rows ?? [];
        if (!rows.some(r => r.played > 0)) return null;
        // Group rows by group_label
        const byGroup = {};
        rows.forEach(r => { const g = r.group_label ?? "_"; if (!byGroup[g]) byGroup[g] = []; byGroup[g].push(r); });
        const groups = Object.entries(byGroup);
        return (
          <section key={comp.competition_id}>
            <SectionHeading>{comp.competition_name} — Standings</SectionHeading>
            {groups.map(([groupLabel, groupRows]) => (
              <div key={groupLabel} style={{ marginBottom: groups.length > 1 ? 12 : 0 }}>
                {groups.length > 1 && (
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--t3, #666)", textTransform: "uppercase", marginBottom: 6 }}>
                    Group {groupLabel}
                  </div>
                )}
                <Card noPad>
                  <StandingsTable rows={groupRows} showRank={comp.knockout_seeded} />
                </Card>
              </div>
            ))}
          </section>
        );
      })}

      <a href="/" className="print-hide" style={{
        fontSize: 13, color: "var(--t2, rgba(255,255,255,0.5))",
        textDecoration: "none", textAlign: "center",
      }}>
        ← Back to home
      </a>

      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print-hide { display: none !important; }
          [data-card] {
            background: white !important;
            border: 1px solid gainsboro !important;
            box-shadow: none !important;
            break-inside: avoid;
          }
        }
      `}</style>
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function groupByDate(fixtures) {
  const groups = [];
  let current = null;
  for (const fx of fixtures) {
    const d = fx.scheduled_date ?? null;
    if (!current || current.date !== d) {
      current = { date: d, fixtures: [] };
      groups.push(current);
    }
    current.fixtures.push(fx);
  }
  return groups;
}

function groupByRound(fixtures) {
  const groups = [];
  let current = null;
  for (const fx of fixtures) {
    const r = fx.round_name ?? `Round ${fx.round}`;
    if (!current || current.round !== r) {
      current = { round: r, fixtures: [] };
      groups.push(current);
    }
    current.fixtures.push(fx);
  }
  return groups;
}

function FixtureRow({ fx, last }) {
  const statusStyle = FIXTURE_STATUS_STYLE[fx.status] ?? FIXTURE_STATUS_STYLE.scheduled;
  const statusLabel = FIXTURE_STATUS_LABEL[fx.status] ?? fx.status;
  const hasScore    = fx.home_score != null && fx.away_score != null;
  const isLive      = fx.status === "in_progress";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "52px 1fr auto 1fr 56px",
      alignItems: "center",
      gap: 6,
      padding: "9px 0",
      borderBottom: last ? "none" : "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
    }}>
      {/* Time */}
      <div style={{ fontSize: 12, color: "var(--t3, #666)", textAlign: "left" }}>
        {fx.kickoff_time ?? "—"}
      </div>

      {/* Home team */}
      <div style={{ fontSize: 13, color: "var(--t1, #fff)", textAlign: "right", fontWeight: isLive ? 600 : 400 }}>
        {fx.home_team_name ?? "TBD"}
      </div>

      {/* Score / vs */}
      <div style={{ fontSize: 13, fontWeight: 700, color: isLive ? "rgba(76,175,80,1)" : "var(--t1, #fff)", textAlign: "center", minWidth: 36 }}>
        {hasScore ? `${fx.home_score}–${fx.away_score}` : "vs"}
      </div>

      {/* Away team */}
      <div style={{ fontSize: 13, color: "var(--t1, #fff)", textAlign: "left", fontWeight: isLive ? 600 : 400 }}>
        {fx.away_team_name ?? "TBD"}
      </div>

      {/* Status / pitch */}
      <div style={{ fontSize: 11, textAlign: "right", ...statusStyle }}>
        {statusLabel}
        {fx.pitch_name && fx.status === "scheduled" && (
          <div style={{ color: "var(--t3, #666)", marginTop: 1 }}>{fx.pitch_name}</div>
        )}
      </div>
    </div>
  );
}

function StandingsTable({ rows, showRank }) {
  const cols = ["P", "W", "D", "L", "GF", "GA", "GD", "Pts"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left", paddingLeft: 16 }}>#</th>
            <th style={{ ...thStyle, textAlign: "left" }}>Team</th>
            {cols.map(c => (
              <th key={c} style={{ ...thStyle, textAlign: "right", paddingRight: c === "Pts" ? 16 : 6 }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isAdvancing = showRank && r.group_rank != null && r.group_rank <= 2;
            return (
              <tr key={r.team_id} style={{ borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.06))" }}>
                <td style={{ ...tdStyle, paddingLeft: 16, color: "var(--t3, #666)" }}>{i + 1}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>
                  {r.team_name}
                  {isAdvancing && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(76,175,80,0.8)", marginLeft: 6, letterSpacing: 0.4, textTransform: "uppercase" }}>ADV</span>
                  )}
                </td>
                <td style={tdStyle}>{r.played}</td>
                <td style={tdStyle}>{r.won}</td>
                <td style={tdStyle}>{r.drawn}</td>
                <td style={tdStyle}>{r.lost}</td>
                <td style={tdStyle}>{r.gf}</td>
                <td style={tdStyle}>{r.ga}</td>
                <td style={{ ...tdStyle, color: r.gd > 0 ? "rgba(76,175,80,1)" : r.gd < 0 ? "#FF6060" : "var(--t2, rgba(255,255,255,0.5))" }}>
                  {r.gd > 0 ? `+${r.gd}` : r.gd}
                </td>
                <td style={{ ...tdStyle, fontWeight: 700, paddingRight: 16 }}>{r.pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = {
  padding: "8px 6px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  color: "var(--t3, #666)",
  background: "rgba(255,255,255,0.02)",
};

const tdStyle = {
  padding: "9px 6px",
  color: "var(--t1, #fff)",
  textAlign: "right",
};

function Card({ children, noPad }) {
  return (
    <div
      data-card
      style={{
        background: "var(--b2, rgba(255,255,255,0.04))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
        borderRadius: 14,
        ...(noPad ? {} : { padding: "4px 16px" }),
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
      color: "var(--t3, #666)", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function MetaRow({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)",
        textTransform: "uppercase", minWidth: 52, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: "var(--t1, #fff)", lineHeight: 1.4 }}>
        {children}
      </span>
    </div>
  );
}
