import { useState } from "react";
import { closePOTMVoting } from "@platform/core/storage/supabase.js";

export default function POTMTiebreakModal({ match, squad, teamId, adminToken, onDecide }) {
  const [selected,   setSelected]   = useState(null);
  const [phase,      setPhase]      = useState("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);

  const tiedIds    = match.tiedCandidates || [];
  const candidates = tiedIds.map(id => squad.find(p => p.id === id)).filter(Boolean);

  const handleLock = async () => {
    if (!selected) return;
    if (phase === "selected") { setPhase("confirming"); return; }
    setSubmitting(true);
    try {
      await closePOTMVoting(adminToken, match.id, selected.id, true);
      fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "potmResult", teamId,
          playerIds: tiedIds,
          payload: { title: "🏆 POTM Result", body: `${selected.nickname || selected.name} wins POTM tonight!`, winnerId: selected.id, winnerName: selected.nickname || selected.name },
        }),
      }).catch(console.error);
      onDecide();
    } catch(e) {
      setError("Failed to submit. Try again.");
      setPhase("selected");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.9)", backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 380, background: "var(--s1)", borderRadius: 20,
        boxShadow: "0 0 0 1px var(--goldb), 0 0 60px rgba(232,160,32,0.2)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "20px 20px 16px", textAlign: "center", borderBottom: "0.5px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--gold)", letterSpacing: "0.05em" }}>
            POTM TIE — YOUR CALL
          </div>
          <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 6, fontWeight: 300 }}>
            The lads couldn't decide. You pick.
          </div>
        </div>
        <div style={{ padding: "16px 20px 20px" }}>
          {candidates.map(player => {
            const isSel = selected?.id === player.id;
            const isConf = isSel && phase === "confirming";
            return (
              <div key={player.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", borderRadius: 10,
                background: isSel ? "var(--gold2)" : "var(--s2)",
                border: `0.5px solid ${isSel ? "var(--goldb)" : "rgba(255,255,255,0.06)"}`,
                marginBottom: 8,
              }}>
                <span style={{ fontSize: 14, color: "var(--t1)", fontWeight: 400 }}>{player.nickname || player.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {isSel && (
                    <button onClick={() => { setSelected(null); setPhase("idle"); }}
                      style={{ fontSize: 11, color: "var(--red)", background: "none",
                        border: "0.5px solid rgba(255,64,64,0.3)", borderRadius: 6,
                        padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
                      Change
                    </button>
                  )}
                  <button
                    onClick={() => { if (!isSel) { setSelected(player); setPhase("selected"); } else handleLock(); }}
                    disabled={submitting}
                    style={{
                      fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 8,
                      cursor: submitting ? "not-allowed" : "pointer",
                      background: isSel ? (isConf ? "var(--gold)" : "rgba(232,160,32,0.2)") : "transparent",
                      color: isSel ? (isConf ? "var(--bg)" : "var(--gold)") : "var(--t2)",
                      border: isSel
                        ? (isConf ? "none" : "0.5px solid rgba(232,160,32,0.4)")
                        : "0.5px solid rgba(255,255,255,0.1)",
                    }}>
                    {isSel ? (isConf ? "Lock In ✓" : "Confirm →") : "Pick"}
                  </button>
                </div>
              </div>
            );
          })}
          {error && <div style={{ fontSize: 12, color: "var(--red)", textAlign: "center", marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
