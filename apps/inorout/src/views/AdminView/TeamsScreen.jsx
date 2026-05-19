import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Shuffle, FloppyDisk, CheckCircle, Trash } from "@phosphor-icons/react";
import { saveTeamsDraft, confirmTeams } from "@platform/core";

const ENABLE_SMART_RANDOM = false;
// V2 — weighted random by IO Intelligence win rate + form
// Set to true when Phase 2 balance algorithm is ready

function PentagonBadge({ number }) {
  return (
    <div style={{ position: "relative", width: 24, height: 28, flexShrink: 0 }}>
      <svg viewBox="0 0 54 60" width={24} height={28}>
        <path d="M27 2L52 12V30C52 43.5 41 54.5 27 58C13 54.5 2 43.5 2 30V12L27 2Z"
          style={{ fill: "var(--s3)" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, color: "var(--t2)",
        paddingBottom: 2,
      }}>
        {number}
      </div>
    </div>
  );
}

export default function TeamsScreen({ teamId, adminToken = null, squad, schedule, matchHistory, onBack }) {
  const matchId = schedule?.activeMatchId ||
    matchHistory?.find(m => !m.cancelled && !m.winner)?.id ||
    matchHistory?.find(m => !m.cancelled)?.id ||
    null;

  const [assignments, setAssignments] = useState({});
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [confirmNudge, setConfirmNudge] = useState(false);
  const [teamsConfirmed, setTeamsConfirmed] = useState(false);
  const [error, setError] = useState(null);

  const hasHydrated = useRef(false);
  const teamsConfirmedRef = useRef(false);

  // On mount — hydrate from existing match data
  useEffect(() => {
    if (!matchId || !matchHistory) return;
    const match = matchHistory.find(m => m.id === matchId);
    if (!match) return;

    if (match.teamsDraft && (match.teamsDraft.a?.length || match.teamsDraft.b?.length)) {
      const built = {};
      (match.teamsDraft.a || [])
        .filter(v => typeof v === 'string' && v.startsWith('p_'))
        .forEach(id => { built[id] = "A"; });
      (match.teamsDraft.b || [])
        .filter(v => typeof v === 'string' && v.startsWith('p_'))
        .forEach(id => { built[id] = "B"; });
      setAssignments(built);
    } else if (match.teamA?.length || match.teamB?.length) {
      const built = {};
      (match.teamA || [])
        .filter(v => typeof v === 'string' && v.startsWith('p_'))
        .forEach(id => { built[id] = "A"; });
      (match.teamB || [])
        .filter(v => typeof v === 'string' && v.startsWith('p_'))
        .forEach(id => { built[id] = "B"; });
      setAssignments(built);
      setTeamsConfirmed(true);
      teamsConfirmedRef.current = true;
    }
    hasHydrated.current = true;
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasHydrated.current) return;
    if (!squad?.length) return;
    const built = {};
    squad.forEach(p => {
      if (p.team === 'A' || p.team === 'B') {
        built[p.id] = p.team;
      }
    });
    const hasTeams = Object.keys(built).length > 0;
    if (hasTeams) {
      setAssignments(built);
      setTeamsConfirmed(true);
      teamsConfirmedRef.current = true;
    } else if (!teamsConfirmedRef.current) {
      setAssignments({});
    }
  }, [squad]); // eslint-disable-line react-hooks/exhaustive-deps

  const inPlayers = useMemo(() => {
    return (squad || [])
      .filter(p =>
        p.status === "in" &&
        !p.injured &&
        !p.disabled
      )
      .sort((a, b) => {
        const na = (a.nickname || a.name).toLowerCase();
        const nb = (b.nickname || b.name).toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
      });
  }, [squad]);

  const countA = Object.values(assignments).filter(v => v === "A").length;
  const countB = Object.values(assignments).filter(v => v === "B").length;
  const allAssigned = inPlayers.length > 0 && inPlayers.every(p => assignments[p.id] === "A" || assignments[p.id] === "B");
  const teamAIds = inPlayers.filter(p => assignments[p.id] === "A").map(p => p.id);
  const teamBIds = inPlayers.filter(p => assignments[p.id] === "B").map(p => p.id);

  const clearError = () => setError(null);

  const handleAssign = useCallback((playerId, team) => {
    clearError();
    setAssignments(prev => ({
      ...prev,
      [playerId]: prev[playerId] === team ? null : team,
    }));
    setDraftSaved(false);
    setTeamsConfirmed(false);
    teamsConfirmedRef.current = false;
  }, []);

  const handleRandom = useCallback(() => {
    clearError();
    const pool = [...inPlayers];
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const half = Math.floor(pool.length / 2);
    // Odd number: extra player goes to A
    const built = {};
    pool.forEach((p, i) => { built[p.id] = i < pool.length - half ? "A" : "B"; });
    setAssignments(built);
    setDraftSaved(false);
    setTeamsConfirmed(false);
    teamsConfirmedRef.current = false;
  }, [inPlayers]);

  const handleSaveDraft = useCallback(async () => {
    if (isSavingDraft) return;
    clearError();
    setIsSavingDraft(true);
    try {
      await saveTeamsDraft(adminToken, matchId, teamAIds, teamBIds);
      setDraftSaved(true);
      setDraftSavedAt(new Date());
    } catch (e) {
      console.error("handleSaveDraft error:", e);
      setError("Failed to save draft — try again");
    }
    setIsSavingDraft(false);
  }, [isSavingDraft, adminToken, matchId, teamAIds, teamBIds]);

  const handleConfirm = useCallback(async () => {
    clearError();
    if (!allAssigned) {
      setConfirmNudge(true);
      setTimeout(() => setConfirmNudge(false), 3000);
      return;
    }
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      await confirmTeams(adminToken, matchId, teamAIds, teamBIds);
      setTeamsConfirmed(true);
      teamsConfirmedRef.current = true;
      setDraftSaved(false);

      // Fire teamsConfirmed push — fire and forget, IN players only
      const inPlayerIds = inPlayers.map(p => p.id);
      if (inPlayerIds.length) {
        fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "teamsConfirmed",
            teamId,
            playerIds: inPlayerIds,
            payload: {
              title: "Teams are in ⚽",
              body: "Check which team you're on for tonight.",
              icon: "/icons/icon-192.png",
            },
          }),
        }).catch(console.error);
      }
    } catch (e) {
      console.error("handleConfirm error:", e);
      setError("Failed to confirm teams — try again");
    }
    setIsConfirming(false);
  }, [allAssigned, isConfirming, adminToken, matchId, teamAIds, teamBIds, inPlayers]);

  const handleClear = useCallback(() => {
    clearError();
    setShowClearConfirm(true);
  }, []);

  const handleClearConfirm = useCallback(async () => {
    setAssignments({});
    setDraftSaved(false);
    setTeamsConfirmed(false);
    teamsConfirmedRef.current = false;
    setShowClearConfirm(false);
    try {
      await confirmTeams(adminToken, matchId, [], []);
    } catch (e) {
      console.error("handleClearConfirm error:", e);
    }
  }, [adminToken, matchId]);

  const handleClearCancel = useCallback(() => {
    setShowClearConfirm(false);
  }, []);

  const formatTime = (date) => {
    if (!date) return "";
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  };

  // Empty state
  if (!matchId) {
    return (
      <div style={{ padding: "20px 16px" }}>
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", cursor: "pointer",
          color: "var(--gold)", fontSize: 13, fontFamily: "DM Sans, sans-serif",
          fontWeight: 400, padding: 0, marginBottom: 24,
        }}>
          <ArrowLeft size={16} weight="thin" />
          Back to Admin
        </button>
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 32,
          color: "var(--t1)", marginBottom: 8,
        }}>
          No active match
        </div>
        <div style={{ fontSize: 14, color: "var(--t2)", fontWeight: 400 }}>
          Go live first before picking teams
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 16px" }}>

      {/* Back link */}
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "none", border: "none", cursor: "pointer",
        color: "var(--gold)", fontSize: 13, fontFamily: "DM Sans, sans-serif",
        fontWeight: 400, padding: 0, marginBottom: 20,
      }}>
        <ArrowLeft size={16} weight="thin" />
        Back to Admin
      </button>

      {/* Heading */}
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 32,
        color: "var(--t1)", marginBottom: 16,
      }}>
        TEAM SELECTION
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>

        {/* Random Generator */}
        <button onClick={handleRandom} style={{
          flex: 1, height: 40, borderRadius: 8, border: "none",
          background: "#5B21B6", color: "white",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 1,
          cursor: "pointer",
        }}>
          <Shuffle size={16} weight="thin" />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, lineHeight: 1 }}>
            RANDOM
          </span>
        </button>

        {/* Save Draft */}
        <button onClick={handleSaveDraft} style={{
          flex: 1, height: 40, borderRadius: 8,
          background: "transparent", border: "0.5px solid var(--gold)",
          color: "var(--gold)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 1,
          cursor: isSavingDraft ? "default" : "pointer",
          opacity: isSavingDraft ? 0.6 : 1,
          pointerEvents: isSavingDraft ? "none" : "auto",
        }}>
          <FloppyDisk size={16} weight="thin" />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, lineHeight: 1 }}>
            SAVE DRAFT
          </span>
        </button>

        {/* Confirm Teams */}
        <button onClick={handleConfirm} style={{
          flex: 1, height: 40, borderRadius: 8, border: "none",
          background: "#16A34A", color: "white",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 1,
          cursor: isConfirming ? "default" : "pointer",
          opacity: isConfirming ? 0.6 : allAssigned ? 1 : 0.4,
          pointerEvents: isConfirming ? "none" : "auto",
        }}>
          <CheckCircle size={16} weight="thin" />
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, lineHeight: 1 }}>
            CONFIRM
          </span>
        </button>
      </div>

      {/* Confirm nudge */}
      {confirmNudge && (
        <div style={{
          textAlign: "center", color: "var(--amber)",
          fontSize: 12, fontWeight: 400, marginTop: 8,
        }}>
          Assign all players before confirming
        </div>
      )}

      {/* Teams confirmed success state */}
      {teamsConfirmed && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--green2)", border: "0.5px solid var(--greenb)",
          borderRadius: 8, padding: 12, marginTop: 8,
        }}>
          <CheckCircle size={16} weight="thin" color="var(--green)" style={{ flexShrink: 0 }} />
          <span style={{
            fontSize: 13, color: "var(--green)", fontWeight: 400,
          }}>
            Teams confirmed and shared with players
          </span>
        </div>
      )}

      {/* Clear Teams / Clear confirm */}
      <div style={{ marginTop: 8 }}>
        {showClearConfirm ? (
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: 12, color: "var(--t2)", fontWeight: 400, marginBottom: 10,
            }}>
              This clears all assignments — are you sure?
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={handleClearConfirm} style={{
                height: 36, padding: "0 20px", borderRadius: 8,
                background: "transparent", border: "0.5px solid var(--red)",
                color: "var(--red)", cursor: "pointer",
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 14,
              }}>
                CONFIRM
              </button>
              <button onClick={handleClearCancel} style={{
                height: 36, padding: "0 20px", borderRadius: 8,
                background: "var(--s3)", border: "none",
                color: "var(--t2)", cursor: "pointer",
                fontFamily: "'Bebas Neue', sans-serif", fontSize: 14,
              }}>
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <button onClick={handleClear} style={{
            width: "100%", height: 40, borderRadius: 8,
            background: "#3B0A0A", border: "1px solid #FF4040",
            color: "#FF4040", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <Trash size={16} weight="thin" />
            <span style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.08em",
            }}>
              CLEAR TEAMS
            </span>
          </button>
        )}
      </div>

      {/* Draft status line */}
      {draftSaved && !teamsConfirmed && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          marginTop: 10,
        }}>
          <CheckCircle size={14} weight="thin" color="var(--green)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "var(--t2)", fontWeight: 400 }}>
            Draft saved at {formatTime(draftSavedAt)} — not shared yet
          </span>
        </div>
      )}

      {/* Error line */}
      {error && (
        <div style={{
          fontSize: 12, color: "var(--red)", fontWeight: 400, marginTop: 8,
        }}>
          {error}
        </div>
      )}

      {/* Team A / VS / Team B split card */}
      <div style={{
        width: "100%", height: 48,
        display: "flex", marginTop: 16, marginBottom: 16,
      }}>
        {/* Team A — left half */}
        <div style={{
          flex: 1,
          background: "rgba(96,160,255,0.12)",
          borderTop: "1px solid #60A0FF",
          borderBottom: "1px solid #60A0FF",
          borderLeft: "1px solid #60A0FF",
          borderRight: "none",
          borderRadius: "6px 0 0 6px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
            color: "#60A0FF", letterSpacing: "0.08em",
          }}>TEAM A</span>
          <span style={{ color: "var(--t2)", opacity: 0.4, fontSize: 16, lineHeight: 1 }}>·</span>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
            color: "#F2F0EA",
          }}>{countA}</span>
        </div>

        {/* VS centre */}
        <div style={{
          width: 40, flexShrink: 0,
          background: "var(--s2)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          borderLeft: "none", borderRight: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
            color: "var(--t2)",
          }}>VS</span>
        </div>

        {/* Team B — right half */}
        <div style={{
          flex: 1,
          background: "rgba(255,96,96,0.12)",
          borderTop: "1px solid #FF6060",
          borderBottom: "1px solid #FF6060",
          borderRight: "1px solid #FF6060",
          borderLeft: "none",
          borderRadius: "0 6px 6px 0",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
            color: "#F2F0EA",
          }}>{countB}</span>
          <span style={{ color: "var(--t2)", opacity: 0.4, fontSize: 16, lineHeight: 1 }}>·</span>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 13,
            color: "#FF6060", letterSpacing: "0.08em",
          }}>TEAM B</span>
        </div>
      </div>

      {/* Player rows section heading */}
      <div style={{
        fontFamily: "DM Sans, sans-serif", fontWeight: 500, fontSize: 11,
        color: "var(--t2)", letterSpacing: "0.1em",
        marginBottom: 8,
      }}>
        PLAYERS ({inPlayers.length})
      </div>

      {/* Player rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {inPlayers.map((p, idx) => {
          const aSelected = assignments[p.id] === "A";
          const bSelected = assignments[p.id] === "B";
          return (
            <div key={p.id} style={{
              background: "var(--s2)", borderRadius: 8, padding: "8px 12px",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              {/* Pentagon badge */}
              <PentagonBadge number={idx + 1} />

              {/* Name */}
              <div style={{
                flex: 1, fontSize: 15, color: "var(--t1)",
                fontFamily: "DM Sans, sans-serif", fontWeight: 500,
              }}>
                {p.nickname || p.name}
              </div>

              {/* A / B buttons */}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => handleAssign(p.id, "A")}
                  style={{
                    width: 36, height: 26, borderRadius: 4,
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, fontWeight: 700,
                    cursor: "pointer",
                    background: aSelected ? "#1E3A5F" : "var(--s3)",
                    color: "#60A0FF",
                    border: aSelected ? "1px solid #60A0FF" : "1px solid rgba(96,160,255,0.3)",
                  }}
                >
                  A
                </button>
                <button
                  onClick={() => handleAssign(p.id, "B")}
                  style={{
                    width: 36, height: 26, borderRadius: 4,
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, fontWeight: 700,
                    cursor: "pointer",
                    background: bSelected ? "#3B0A0A" : "var(--s3)",
                    color: "#FF6060",
                    border: bSelected ? "1px solid #FF6060" : "1px solid rgba(255,96,96,0.3)",
                  }}
                >
                  B
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {inPlayers.length === 0 && (
        <div style={{
          textAlign: "center", fontSize: 13, color: "var(--t2)",
          fontWeight: 400, padding: "24px 0",
        }}>
          No confirmed players yet
        </div>
      )}

      {/* Done button */}
      <div style={{ marginTop: 24, marginBottom: 16 }}>
        <button onClick={onBack} style={{
          width: "100%", height: 48, borderRadius: 8,
          background: "var(--s2)", border: "0.5px solid var(--goldb)",
          color: "var(--gold)", cursor: "pointer",
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.08em",
        }}>
          DONE
        </button>
      </div>

    </div>
  );
}
