import { useState } from "react";
import { ONBOARDING_CONFIG as CFG } from "../config.js";

// ── Progress bar (shared style with Step 1) ───────────────────────────────────

function ProgressBar({ current, total }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i < current ? "var(--gold)" : "var(--s3)",
          }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--font-body)", fontWeight: 300 }}>
        Step {current} of {total}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AddPlayers({
  playerNames, newName, setNewName,
  addPlayer, removePlayer,
  onSubmit, loading, error,
}) {
  const [inputFocused, setInputFocused] = useState(false);

  const handleKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); addPlayer(); }
  };

  const players   = playerNames.filter(n => n.trim());
  const hasPlayers = players.length > 0;

  return (
    <div style={{ padding: 24, paddingBottom: 48, fontFamily: "var(--font-body)" }}>

      <ProgressBar current={2} total={3} />

      {/* Brand header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 32,
          letterSpacing: "0.06em", lineHeight: 1, marginBottom: 8,
        }}>
          <span style={{ color: "var(--green)" }}>IN</span>
          <span style={{ color: "var(--t1)" }}> OR </span>
          <span style={{ color: "var(--red)" }}>OUT</span>
        </div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 20, color: "var(--t1)",
          letterSpacing: "0.06em", marginBottom: 10,
        }}>
          ADD YOUR SQUAD
        </div>
        <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5 }}>
          Just their names for now. Each player gets a unique personal link.
        </div>
      </div>

      {/* Name input + add button */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder="Player name..."
          style={{
            flex: 1, padding: "12px 14px", borderRadius: 10,
            border: inputFocused ? "1px solid var(--goldb)" : "1px solid var(--s3)",
            background: "var(--s2)", color: "var(--t1)",
            fontFamily: "var(--font-body)", fontWeight: 300, fontSize: 15,
            outline: "none", boxSizing: "border-box",
          }}
        />
        <button
          onClick={addPlayer}
          disabled={!newName.trim()}
          style={{
            padding: "12px 20px", borderRadius: 10, border: "none",
            background: "var(--gold)", color: "#000",
            fontFamily: "var(--font-display)", fontSize: 16, letterSpacing: "0.06em",
            cursor: newName.trim() ? "pointer" : "not-allowed",
            flexShrink: 0, opacity: newName.trim() ? 1 : 0.45,
          }}
        >
          + Add
        </button>
      </div>

      {/* Player list */}
      {hasPlayers && (
        <div style={{ marginBottom: 20 }}>
          {players.map((name, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center",
              justifyContent: "space-between",
              background: "var(--s2)", borderRadius: 10,
              padding: "12px 14px", marginBottom: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  background: "var(--gold)", color: "#000",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-display)", fontSize: 14,
                }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: 15, color: "var(--t1)", fontWeight: 300 }}>
                  {name}
                </span>
              </div>
              <button
                onClick={() => removePlayer(i)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--t2)", fontSize: 20, lineHeight: 1, padding: 0,
                  width: 32, height: 32,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div style={{
            fontSize: 12, color: "var(--t2)", fontWeight: 300,
            marginTop: 4, paddingLeft: 2,
          }}>
            {players.length} player{players.length !== 1 ? "s" : ""} added
          </div>
        </div>
      )}

      {/* Server error */}
      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 16,
          background: "rgba(255,64,64,0.08)", border: "1px solid rgba(255,64,64,0.3)",
          fontSize: 13, color: "var(--red)", fontWeight: 300,
        }}>
          {error}
        </div>
      )}

      {/* Helper */}
      <div style={{
        fontSize: 12, color: "var(--t2)", textAlign: "center",
        marginBottom: 12, fontWeight: 300, lineHeight: 1.5,
      }}>
        You can add, remove and rename players anytime under Admin → Squad
      </div>

      {/* Continue button */}
      <button
        onClick={() => onSubmit(false)}
        disabled={loading || !hasPlayers}
        style={{
          width: "100%", padding: 16, borderRadius: 12, border: "none",
          background: hasPlayers ? "var(--gold)" : "var(--s3)",
          color:      hasPlayers ? "#000"         : "var(--t2)",
          fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "0.06em",
          cursor: loading || !hasPlayers ? "not-allowed" : "pointer",
          marginBottom: 12,
        }}
      >
        {loading ? "Adding players..." : CFG.steps.addPlayers.cta}
      </button>

      {/* Skip link */}
      <button
        onClick={() => onSubmit(true)}
        disabled={loading}
        style={{
          width: "100%", padding: "10px 0", border: "none",
          background: "transparent", color: "var(--t2)",
          fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300,
          cursor: "pointer", textAlign: "center",
        }}
      >
        {CFG.steps.addPlayers.skipCta}
      </button>
    </div>
  );
}
