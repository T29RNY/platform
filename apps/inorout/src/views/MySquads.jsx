import { useState, useEffect } from "react";
import { getPlayerTeamsByToken } from "@platform/core";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

export default function MySquads({ currentTeamId, currentToken, userId }) {
  const [squads,       setSquads]       = useState([]);
  const [open,         setOpen]         = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [hoveredToken, setHoveredToken] = useState(null);

  useEffect(() => {
    if (!currentToken) return;
    setLoading(true);
    getPlayerTeamsByToken(currentToken)
      .then(data => setSquads(data || []))
      .catch(e => { console.error(e); setSquads([]); })
      .finally(() => setLoading(false));
  }, [currentToken]);

  return (
    <div style={{ marginTop: 24, paddingBottom: 40 }}>

      {/* Accordion header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px",
          background: "var(--s2)",
          borderRadius: open ? "10px 10px 0 0" : 10,
          border: "0.5px solid rgba(255,255,255,0.08)",
          cursor: "pointer",
        }}
      >
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 15,
          color: "var(--t2)", letterSpacing: "0.08em",
        }}>
          MY SQUADS
        </span>
        {open
          ? <CaretUp  weight="thin" size={16} color="var(--t2)" />
          : <CaretDown weight="thin" size={16} color="var(--t2)" />
        }
      </div>

      {/* Accordion body */}
      {open && (
        <div style={{
          background: "var(--s1)",
          border: "0.5px solid rgba(255,255,255,0.08)",
          borderTop: "none",
          borderRadius: "0 0 10px 10px",
          overflow: "hidden",
        }}>

          {loading ? (
            <div style={{
              height: 44, background: "var(--s2)",
              borderRadius: 8, margin: "12px 16px", opacity: 0.5,
            }} />

          ) : squads.length === 0 ? (
            <div style={{
              padding: "16px", textAlign: "center",
              fontFamily: "'DM Sans', sans-serif", fontWeight: 300,
              fontSize: 13, color: "var(--t2)",
            }}>
              Not part of any other squads yet
            </div>

          ) : squads.map(squad => {
            const isCurrent  = squad.token === currentToken;
            const isDisabled = squad.disabled;
            const displayName = squad.player_nickname || squad.player_name;

            if (isCurrent) {
              return (
                <div key={squad.token} style={{
                  background: "var(--gold2)",
                  borderBottom: "0.5px solid rgba(255,255,255,0.06)",
                  padding: "12px 16px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  pointerEvents: "none",
                }}>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 14, color: "var(--t1)" }}>
                      {squad.team_name}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 11, color: "var(--t2)" }}>
                      {displayName}
                    </div>
                  </div>
                  <span style={{
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 10,
                    color: "var(--gold)", background: "var(--gold2)",
                    border: "0.5px solid var(--goldb)",
                    borderRadius: 4, padding: "2px 6px",
                  }}>
                    CURRENT
                  </span>
                </div>
              );
            }

            if (isDisabled) {
              return (
                <div key={squad.token} style={{
                  background: "transparent",
                  borderBottom: "0.5px solid rgba(255,255,255,0.06)",
                  padding: "12px 16px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  opacity: 0.4,
                  pointerEvents: "none",
                }}>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 14, color: "var(--t1)" }}>
                      {squad.team_name}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 11, color: "var(--t2)" }}>
                      {displayName}
                    </div>
                  </div>
                  <span style={{
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 10,
                    color: "var(--t2)", background: "var(--s3)",
                    border: "0.5px solid rgba(255,255,255,0.12)",
                    borderRadius: 4, padding: "2px 6px",
                  }}>
                    NO LONGER ACTIVE
                  </span>
                </div>
              );
            }

            const isHovered = hoveredToken === squad.token;
            return (
              <div
                key={squad.token}
                onClick={() => { window.location.href = `/p/${squad.token}`; }}
                onMouseEnter={() => setHoveredToken(squad.token)}
                onMouseLeave={() => setHoveredToken(null)}
                style={{
                  background: isHovered ? "var(--s2)" : "transparent",
                  transition: "background 150ms",
                  borderBottom: "0.5px solid rgba(255,255,255,0.06)",
                  padding: "12px 16px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer",
                }}
              >
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 14, color: "var(--t1)" }}>
                    {squad.team_name}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 11, color: "var(--t2)" }}>
                    {displayName}
                  </div>
                </div>
                {squad.is_vice_captain && (
                  <span style={{
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 10,
                    color: "var(--t2)", background: "var(--s3)",
                    border: "0.5px solid rgba(255,255,255,0.12)",
                    borderRadius: 4, padding: "2px 6px",
                  }}>
                    ADMIN
                  </span>
                )}
              </div>
            );
          })}

        </div>
      )}

    </div>
  );
}
