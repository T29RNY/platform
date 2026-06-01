import { useEffect, useState } from "react";
import { getCupBracket } from "@platform/core";
import { X, Trophy } from "@phosphor-icons/react";

// League Mode Phase 11 Cycle 11.3b — read-only cup bracket overlay for the player.
// Opened from the FIXTURES card "Bracket" button. Self-contained fetch via getCupBracket
// (public match data, no token). Mobile-first: rounds stack vertically.
const DECIDER_NOTE = {
  penalties: "on pens",
  extra_time: "after extra time",
  walkover: "walkover",
  forfeit: "forfeit",
};

export default function BracketOverlay({ competitionId, competitionName, onClose }) {
  const [bracket, setBracket] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getCupBracket(competitionId)
      .then((b) => { if (alive) { setBracket(b); setLoading(false); } })
      .catch((e) => { if (alive) { console.error("[bracket] load failed", e); setError(e?.message || String(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [competitionId]);

  const rounds = bracket?.rounds ?? [];
  const champion = bracket?.champion;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
          background: "var(--s1)", borderRadius: "16px 16px 0 0",
          border: "0.5px solid rgba(255,255,255,0.1)", padding: "18px 16px 32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--t1)", letterSpacing: "0.04em" }}>
            {competitionName || "Cup"} · BRACKET
          </span>
          <button onClick={onClose} aria-label="Close bracket"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X weight="thin" size={22} color="var(--t2)" />
          </button>
        </div>

        {loading && <p style={{ color: "var(--t2)", fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Loading…</p>}
        {error && <p style={{ color: "var(--red)", fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>{error}</p>}

        {champion && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 16,
            background: "var(--s2)", borderRadius: 10, border: "0.5px solid rgba(255,255,255,0.08)",
          }}>
            <Trophy weight="thin" size={20} color="var(--t1)" />
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "var(--t1)" }}>
              Champion: <strong>{champion.name}</strong>
            </span>
          </div>
        )}

        {rounds.map((rd) => (
          <div key={rd.round_number} style={{ marginBottom: 18 }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, color: "var(--t2)",
              letterSpacing: "0.08em", marginBottom: 8,
            }}>
              {rd.round_name}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(rd.ties ?? []).map((tie) => <TieRow key={tie.id} tie={tie} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TieRow({ tie }) {
  const winH = tie.winner_team_id && tie.winner_team_id === tie.home_team_id;
  const winA = tie.winner_team_id && tie.winner_team_id === tie.away_team_id;
  const hasScore = tie.home_score != null && tie.away_score != null;
  const note = tie.decided_by && DECIDER_NOTE[tie.decided_by];
  const isBye = tie.away_team_id == null && tie.home_source === "bye";

  const side = (name, src, isWinner) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{
        fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: isWinner ? 700 : 400,
        color: name ? "var(--t1)" : "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {name || (src === "bye" ? "(bye)" : "TBC")}
      </span>
    </div>
  );

  return (
    <div style={{
      background: "var(--s2)", borderRadius: 9, border: "0.5px solid rgba(255,255,255,0.07)",
      padding: "9px 12px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {side(tie.home_team_name, tie.home_source, winH)}
          {isBye ? null : side(tie.away_team_name, tie.away_source, winA)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          {hasScore ? (
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--t1)", letterSpacing: "0.03em" }}>
              {tie.home_score}–{tie.away_score}
            </span>
          ) : (
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: "var(--t2)" }}>
              {tie.status === "ready" ? "To be scheduled" : tie.status === "scheduled" ? "Upcoming" : isBye ? "Bye" : "TBC"}
            </span>
          )}
          {note && (
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: "var(--t2)" }}>{note}</span>
          )}
        </div>
      </div>
    </div>
  );
}
