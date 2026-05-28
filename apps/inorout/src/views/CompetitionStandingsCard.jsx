import { useState, useEffect } from "react";
import { getLeagueStandingsForPlayer } from "@platform/core";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

// League Mode Phase 5 Cycle 5.2 — read-only competition standings on my-view.
// Self-gating: a casual player's token returns no competitions, so the whole
// card renders null and the casual flow is untouched. Named "Competition*" to
// stay distinct from the intra-squad PlayerLeagueTable in StatsView.
export default function CompetitionStandingsCard({ playerToken, currentTeamId }) {
  const [competitions, setCompetitions] = useState([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!playerToken) return;
    getLeagueStandingsForPlayer(playerToken)
      .then(data => setCompetitions(data?.competitions || []))
      .catch(e => { console.error(e); setCompetitions([]); });
  }, [playerToken]);

  if (!competitions.length) return null;

  const cols = [
    ["P", "played"], ["W", "w"], ["D", "d"], ["L", "l"],
    ["GF", "gf"], ["GA", "ga"], ["GD", "gd"], ["Pts", "pts"],
  ];

  const cellNum = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, textAlign: "center" };
  const headNum = { ...cellNum, color: "var(--t2)", fontSize: 11, letterSpacing: "0.04em" };

  return (
    <div style={{ marginTop: 24 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", background: "var(--s2)",
          borderRadius: open ? "10px 10px 0 0" : 10,
          border: "0.5px solid rgba(255,255,255,0.08)", cursor: "pointer",
        }}
      >
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 15,
          color: "var(--t2)", letterSpacing: "0.08em",
        }}>
          LEAGUE TABLE
        </span>
        {open
          ? <CaretUp   weight="thin" size={16} color="var(--t2)" />
          : <CaretDown weight="thin" size={16} color="var(--t2)" />}
      </div>

      {open && (
        <div style={{
          background: "var(--s1)", border: "0.5px solid rgba(255,255,255,0.08)",
          borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden",
        }}>
          {competitions.map((comp, ci) => (
            <div key={comp.competition_id} style={{
              borderTop: ci > 0 ? "0.5px solid rgba(255,255,255,0.10)" : "none",
            }}>
              <div style={{
                padding: "10px 16px 6px",
                fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 13,
                color: "var(--t1)",
              }}>
                {comp.competition_name}
              </div>

              {!comp.standings_visible ? (
                <div style={{
                  padding: "8px 16px 14px", fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 300, fontSize: 12, color: "var(--t2)",
                }}>
                  The league keeps this table private.
                </div>
              ) : !comp.standings?.length ? (
                <div style={{
                  padding: "8px 16px 14px", fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 300, fontSize: 12, color: "var(--t2)",
                }}>
                  No results yet.
                </div>
              ) : (
                <div style={{ padding: "0 8px 12px" }}>
                  {/* header */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "20px minmax(0,1fr) repeat(8, 24px)",
                    alignItems: "center", gap: 2, padding: "4px 8px",
                  }}>
                    <span style={headNum}>#</span>
                    <span style={{ ...headNum, textAlign: "left" }}>Team</span>
                    {cols.map(([label]) => <span key={label} style={headNum}>{label}</span>)}
                  </div>
                  {/* rows */}
                  {comp.standings.map((row, i) => {
                    const mine = row.team_id === currentTeamId;
                    return (
                      <div key={row.team_id} style={{
                        display: "grid",
                        gridTemplateColumns: "20px minmax(0,1fr) repeat(8, 24px)",
                        alignItems: "center", gap: 2, padding: "6px 8px",
                        background: mine ? "var(--gold2)" : "transparent",
                        borderRadius: 6,
                      }}>
                        <span style={cellNum}>{i + 1}</span>
                        <span style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontWeight: mine ? 600 : 400, fontSize: 13,
                          color: mine ? "var(--gold)" : "var(--t1)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {row.team_name}
                        </span>
                        {cols.map(([label, key]) => (
                          <span key={label} style={{
                            ...cellNum,
                            color: label === "Pts" ? "var(--t1)" : "var(--t2)",
                            fontWeight: label === "Pts" ? 700 : 400,
                          }}>
                            {row[key]}
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
