import { useState, useEffect } from "react";
import { getPlayerTeams, getPlayerTeamsByToken } from "@platform/core";
import { CaretDown, CaretUp, Plus } from "@phosphor-icons/react";

// Pull a join code out of a pasted invite link (or accept a bare code).
// Invite links look like https://www.in-or-out.com/join/<joinCode>.
function parseJoinCode(raw) {
  if (!raw) return null;
  const m = raw.match(/\/join\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  const bare = raw.trim();
  return /^[a-zA-Z0-9_-]{4,}$/.test(bare) ? bare : null;
}

export default function MySquads({ currentTeamId, currentToken, userId }) {
  const [squads,       setSquads]       = useState([]);
  const [open,         setOpen]         = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [hoveredToken, setHoveredToken] = useState(null);
  const [showJoin,     setShowJoin]     = useState(false);
  const [joinInput,    setJoinInput]    = useState("");

  const joinCode = parseJoinCode(joinInput);
  const goJoin = () => { if (joinCode) window.location.href = `/join/${joinCode}`; };

  // Load the viewer's squads keyed on WHO the viewer is, not the matchday squad.
  // Signed-in viewers (incl. admins on /admin/<token> routes, where no squad row
  // reliably resolves to the viewer, and any route where the matchday squad is
  // empty) get the authoritative list from auth.uid() via player_get_teams — no
  // token fallback, because the matchday-squad-derived token can resolve to the
  // WRONG player (e.g. squad[0] on an admin route) and would list that player's
  // squads. Anonymous token-only viewers use the per-token RPC. Deriving the
  // list from the matchday-squad token was the bug that hid every other squad.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let rows = [];
      try {
        rows = userId
          ? await getPlayerTeams()
          : (currentToken ? await getPlayerTeamsByToken(currentToken) : []);
      } catch (e) { console.error(e); rows = []; }
      if (!cancelled) setSquads(rows || []);
    })().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, currentToken, currentTeamId]);

  return (
    <div style={{ marginTop: 24, paddingBottom: 40 }}>

      {/* Accordion header */}
      <div
        data-tour="my-squads-toggle"
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
            // currentTeamId is reliable on every route; currentToken is not
            // (it's derived from the matchday squad, which can be empty or, on
            // admin routes, resolve to the wrong row). Fall back to token only
            // when no team id is available.
            const isCurrent  = currentTeamId ? squad.team_id === currentTeamId : squad.token === currentToken;
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
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {squad.is_competitive && (
                      <span style={{
                        fontFamily: "'Bebas Neue', sans-serif", fontSize: 10,
                        color: "var(--purple)", background: "var(--purple2)",
                        border: "0.5px solid var(--purpleb)",
                        borderRadius: 4, padding: "2px 6px",
                      }}>
                        LEAGUE
                      </span>
                    )}
                    <span style={{
                      fontFamily: "'Bebas Neue', sans-serif", fontSize: 10,
                      color: "var(--gold)", background: "var(--gold2)",
                      border: "0.5px solid var(--goldb)",
                      borderRadius: 4, padding: "2px 6px",
                    }}>
                      CURRENT
                    </span>
                  </div>
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
                {(squad.is_competitive || squad.is_vice_captain || squad.is_team_admin) && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {squad.is_competitive && (
                      <span style={{
                        fontFamily: "'Bebas Neue', sans-serif", fontSize: 10,
                        color: "var(--purple)", background: "var(--purple2)",
                        border: "0.5px solid var(--purpleb)",
                        borderRadius: 4, padding: "2px 6px",
                      }}>
                        LEAGUE
                      </span>
                    )}
                    {(squad.is_vice_captain || squad.is_team_admin) && (
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
                )}
              </div>
            );
          })}

          {/* Join another team — extracts a join code from a pasted invite
              link and hands off to the existing /join/<code> flow (which
              already gates auth, dedupes existing members, and runs the
              name step). No new join logic here. */}
          {!loading && (
            !showJoin ? (
              <div
                onClick={() => setShowJoin(true)}
                onMouseEnter={() => setHoveredToken("__join__")}
                onMouseLeave={() => setHoveredToken(null)}
                style={{
                  background: hoveredToken === "__join__" ? "var(--s2)" : "transparent",
                  transition: "background 150ms",
                  padding: "12px 16px",
                  display: "flex", alignItems: "center", gap: 8,
                  cursor: "pointer",
                }}
              >
                <Plus weight="thin" size={16} color="var(--t2)" />
                <span style={{
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
                  fontSize: 14, color: "var(--t2)",
                }}>
                  Join another team
                </span>
              </div>
            ) : (
              <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  autoFocus
                  value={joinInput}
                  onChange={e => setJoinInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") goJoin(); }}
                  placeholder="Paste a team invite link"
                  style={{
                    flex: 1, minWidth: 0,
                    padding: "10px 12px", borderRadius: 8,
                    border: `0.5px solid ${joinCode ? "var(--goldb)" : "rgba(255,255,255,0.12)"}`,
                    background: "var(--s2)", color: "var(--t1)",
                    fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 13,
                    outline: "none", boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={goJoin}
                  disabled={!joinCode}
                  style={{
                    flexShrink: 0,
                    padding: "10px 14px", borderRadius: 8,
                    border: `0.5px solid ${joinCode ? "var(--goldb)" : "rgba(255,255,255,0.12)"}`,
                    background: joinCode ? "var(--gold2)" : "var(--s3)",
                    color: joinCode ? "var(--gold)" : "var(--t2)",
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.06em",
                    cursor: joinCode ? "pointer" : "not-allowed",
                  }}
                >
                  JOIN →
                </button>
              </div>
            )
          )}

          {/* Create a new squad — routes to the existing squad-setup wizard
              at /create. That route gates sign-in and create_team (mig 052)
              makes the signed-in creator the team_admin of an independent
              new squad. No new create logic here. */}
          {!loading && (
            <div
              onClick={() => {
                // Carry a returnTo marker so the create-squad wizard shows a
                // Cancel button back to here (onboarded users only — first-time
                // setup navigates to a plain /create with no marker).
                const back = window.location.pathname + window.location.search;
                window.location.href = "/create?returnTo=" + encodeURIComponent(back);
              }}
              onMouseEnter={() => setHoveredToken("__create__")}
              onMouseLeave={() => setHoveredToken(null)}
              style={{
                background: hoveredToken === "__create__" ? "var(--s2)" : "transparent",
                transition: "background 150ms",
                padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 8,
                cursor: "pointer",
              }}
            >
              <Plus weight="thin" size={16} color="var(--t2)" />
              <span style={{
                fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
                fontSize: 14, color: "var(--t2)",
              }}>
                Create a new squad
              </span>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
