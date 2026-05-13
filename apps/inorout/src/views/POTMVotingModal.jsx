import { useState, useEffect } from "react";
import { Trophy } from "@phosphor-icons/react";
import { submitPOTMVote } from "@platform/supabase";

if (typeof document !== "undefined" && !document.getElementById("potm-styles")) {
  const el = document.createElement("style");
  el.id = "potm-styles";
  el.textContent = `
    @keyframes potm-pulse{0%{box-shadow:0 0 0 0 rgba(232,160,32,0.7)}70%{box-shadow:0 0 0 10px rgba(232,160,32,0)}100%{box-shadow:0 0 0 0 rgba(232,160,32,0)}}
    @keyframes potm-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes potm-fade-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  `;
  document.head.appendChild(el);
}

function countdown(closesAt) {
  if (!closesAt) return "";
  const diff = Math.max(0, new Date(closesAt) - Date.now());
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (m <= 0 && s <= 0) return "Closed";
  return `${m}m ${s}s`;
}

export default function POTMVotingModal({
  matchId, teamId, voterId, voterName,
  eligiblePlayers, hasVoted, existingVote,
  votingOpen, votingClosesAt, motm, onClose,
}) {
  // State machine: idle → selected → confirming → locked | counting
  const [selected,    setSelected]    = useState(null);
  const [phase,       setPhase]       = useState("idle"); // idle|selected|confirming|locked|counting
  const [timeLeft,    setTimeLeft]    = useState(countdown(votingClosesAt));
  const [error,       setError]       = useState(null);
  const [submitting,  setSubmitting]  = useState(false);

  // Show result only when voting is closed AND a winner has been set
  const isResult = !votingOpen && !!motm;

  // Tick countdown
  useEffect(() => {
    if (!votingClosesAt) return;
    const t = setInterval(() => setTimeLeft(countdown(votingClosesAt)), 10000);
    return () => clearInterval(t);
  }, [votingClosesAt]);

  // Auto-dismiss after locked state
  useEffect(() => {
    if (phase === "locked") {
      const t = setTimeout(onClose, 3000);
      return () => clearTimeout(t);
    }
  }, [phase, onClose]);

  const teamA = eligiblePlayers.filter(p => p.team === "A");
  const teamB = eligiblePlayers.filter(p => p.team === "B");

  const handleSelect = (player) => {
    if (hasVoted || isResult || submitting) return;
    if (phase === "confirming" && selected?.id === player.id) return;
    setSelected(player);
    setPhase("selected");
    setError(null);
  };

  const handleConfirm = () => {
    if (phase === "selected") { setPhase("confirming"); return; }
    if (phase === "confirming") submitVote();
  };

  const handleChange = () => {
    setPhase("idle");
    setSelected(null);
  };

  const submitVote = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      const result = await submitPOTMVote(matchId, teamId, voterId, selected.id);
      if (result?.error === "already_voted") {
        setPhase("locked");
        return;
      }
      setPhase("locked");
    } catch(e) {
      setError("Failed to submit. Try again.");
      setPhase("selected");
    } finally {
      setSubmitting(false);
    }
  };

  const votedPlayer = existingVote
    ? eligiblePlayers.find(p => p.id === existingVote)
    : null;

  const winnerPlayer = motm
    ? eligiblePlayers.find(p => p.id === motm)
    : null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.75)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px",
    }}>
      <div style={{
        width: "100%", maxWidth: 380,
        background: "var(--s1)",
        borderRadius: 20,
        border: "1px solid var(--gold)",
        boxShadow: "0 0 24px rgba(232,160,32,0.4)",
        overflow: "hidden",
        animation: "potm-fade-in 0.25s ease",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 20px 16px",
          borderBottom: "0.5px solid rgba(255,255,255,0.08)",
          textAlign: "center",
        }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 28, color: "var(--gold)",
            letterSpacing: "0.05em", lineHeight: 1,
          }}>
            {isResult ? "POTM RESULT" : "VOTE FOR POTM"}
          </div>
          {!isResult && votingClosesAt && (
            <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 6, fontWeight: 300 }}>
              Closes in {timeLeft}
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: "16px 20px", maxHeight: "60vh", overflowY: "auto" }}>

          {/* Already voted — read only */}
          {hasVoted && !isResult && (
            <div style={{
              textAlign: "center", padding: "20px 0",
              fontSize: 14, color: "var(--t2)", fontWeight: 300,
            }}>
              You voted for{" "}
              <span style={{ color: "var(--gold)", fontWeight: 600 }}>
                {votedPlayer?.name || "Unknown"}
              </span>
            </div>
          )}

          {/* Result / counting */}
          {isResult && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <Trophy size={40} weight="fill" color="var(--gold)" />
              <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--t1)", marginTop: 12 }}>
                {winnerPlayer?.name || "Unknown"}
              </div>
              <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 6, fontWeight: 300 }}>
                wins POTM tonight!
              </div>
            </div>
          )}

          {/* Counting state */}
          {!isResult && !hasVoted && phase === "locked" && (
            <div style={{ textAlign: "center", padding: "12px 0 8px" }}>
              <Trophy size={28} weight="fill" color="var(--gold)" />
              <div style={{
                fontFamily: "var(--font-display)", fontSize: 20,
                color: "var(--gold)", marginTop: 6, letterSpacing: "0.05em",
              }}>
                VOTE LOCKED IN
              </div>
              <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 4, fontWeight: 300 }}>
                You voted for{" "}
                <span style={{ color: "var(--t1)", fontWeight: 600 }}>{selected?.name}</span>
              </div>
            </div>
          )}

          {/* Voting UI */}
          {!hasVoted && !isResult && phase !== "locked" && (() => {
            const renderSection = (players, label) => (
              <div style={{ marginBottom: 16 }}>
                {players.length > 0 && (
                  <div style={{
                    fontSize: 10, color: "var(--t2)", fontWeight: 700,
                    letterSpacing: "0.14em", textTransform: "uppercase",
                    marginBottom: 8,
                  }}>
                    {label}
                  </div>
                )}
                {players.map(player => {
                  const isMe = player.id === voterId;
                  const isSel = selected?.id === player.id;
                  const isConfirming = isSel && phase === "confirming";
                  return (
                    <div key={player.id} style={{
                      display: "flex", alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px", borderRadius: 10,
                      background: isSel ? "rgba(232,160,32,0.08)" : "var(--s2)",
                      border: `0.5px solid ${isSel ? "rgba(232,160,32,0.4)" : "rgba(255,255,255,0.06)"}`,
                      marginBottom: 8,
                      opacity: isMe ? 0.5 : 1,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14, color: "var(--t1)", fontWeight: 400 }}>
                          {player.name}
                        </span>
                        {isMe && (
                          <span style={{
                            fontSize: 10, color: "var(--t2)",
                            background: "var(--s3)", borderRadius: 4,
                            padding: "2px 6px", fontWeight: 600,
                          }}>
                            You
                          </span>
                        )}
                      </div>
                      {!isMe && (
                        <div style={{ display: "flex", gap: 6 }}>
                          {isSel && (
                            <button
                              onClick={handleChange}
                              style={{
                                fontSize: 11, color: "var(--red)", background: "none",
                                border: "0.5px solid rgba(255,64,64,0.3)", borderRadius: 6,
                                padding: "4px 10px", cursor: "pointer", fontWeight: 600,
                              }}
                            >
                              Change
                            </button>
                          )}
                          <button
                            onClick={() => isSel ? handleConfirm() : handleSelect(player)}
                            disabled={submitting}
                            style={{
                              fontSize: 12, fontWeight: 700,
                              padding: "6px 14px", borderRadius: 8,
                              cursor: submitting ? "not-allowed" : "pointer",
                              background: isSel
                                ? (isConfirming ? "var(--gold)" : "rgba(232,160,32,0.2)")
                                : "transparent",
                              color: isSel ? (isConfirming ? "var(--bg)" : "var(--gold)") : "var(--t2)",
                              border: isSel
                                ? (isConfirming ? "none" : "0.5px solid rgba(232,160,32,0.4)")
                                : "0.5px solid rgba(255,255,255,0.1)",
                              animation: (!isSel && phase === "idle") ? "potm-pulse 1.5s infinite" : "none",
                            }}
                          >
                            {isSel
                              ? (isConfirming ? "Lock In ✓" : "Confirm →")
                              : "Vote"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
            return (
              <>
                {renderSection(teamA, "Team A")}
                {renderSection(teamB, "Team B")}
                {teamA.length === 0 && teamB.length === 0 && renderSection(eligiblePlayers, "Players")}
              </>
            );
          })()}

          {error && (
            <div style={{ fontSize: 12, color: "var(--red)", textAlign: "center", marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isResult && phase !== "locked" && (
          <div style={{
            padding: "12px 20px 20px",
            borderTop: "0.5px solid rgba(255,255,255,0.06)",
            textAlign: "center",
          }}>
            {!hasVoted && (
              <button
                onClick={onClose}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, color: "var(--t2)", opacity: 0.5,
                  fontFamily: "var(--font-body)",
                }}
              >
                skip — I'll decide later
              </button>
            )}
            {hasVoted && (
              <button
                onClick={onClose}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, color: "var(--t2)",
                  fontFamily: "var(--font-body)",
                }}
              >
                Close
              </button>
            )}
          </div>
        )}
        {isResult && (
          <div style={{ padding: "12px 20px 20px", textAlign: "center" }}>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12, color: "var(--t2)",
                fontFamily: "var(--font-body)",
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
