import { useState } from "react";
import { TShirt, CaretDown, CaretUp } from "@phosphor-icons/react";
import { BackBtn } from "@platform/ui";

function daysSince(matchDate) {
  if (!matchDate) return "";
  const days = Math.floor((Date.now() - new Date(matchDate).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const LIMIT = 5;

export default function BibsScreen({ squad, setSquad, bibHistory, setBibHistory, schedule, onBack }) {
  const [bibHolder,    setBibHolder] = useState("");
  const [bibSaved,     setBibSaved]  = useState(false);
  const [showAll,      setShowAll]   = useState(false);
  const [statsOpen,    setStatsOpen] = useState(false);

  // Current holder — most recent unreturned entry
  const currentHolder = bibHistory.find(b => !b.returned) || null;
  const holderPlayer  = currentHolder
    ? (squad || []).find(p => (currentHolder.playerId && p.id === currentHolder.playerId) || (!currentHolder.playerId && p.name === currentHolder.name)) || null
    : null;
  const holderName = holderPlayer
    ? (holderPlayer.nickname || holderPlayer.name)
    : (currentHolder?.name || "");

  // Bib stats computed from bibHistory prop
  const now = new Date();
  const ago = days => new Date(now - days * 86400000);
  const bibStats = (squad || [])
    .filter(p => !p.disabled && !p.isGuest)
    .map(p => {
      const mine  = b => (b.playerId && b.playerId === p.id) || (!b.playerId && b.name === p.name);
      const all   = bibHistory.filter(mine);
      const since = (b, d) => b.matchDate && new Date(b.matchDate) >= ago(d);
      return {
        id:        p.id,
        name:      p.name,
        nickname:  p.nickname,
        allTime:   all.length,
        lastMonth: all.filter(b => since(b, 30)).length,
        last3:     all.filter(b => since(b, 90)).length,
        last6:     all.filter(b => since(b, 180)).length,
        lastYear:  all.filter(b => since(b, 365)).length,
      };
    })
    .filter(p => p.allTime > 0)
    .sort((a, b) => b.allTime - a.allTime);

  const visibleHistory = showAll ? bibHistory : bibHistory.slice(0, LIMIT);
  const hiddenCount    = bibHistory.length - LIMIT;

  // Preserved for hidden dropdown
  const bibCounts = bibHistory.reduce((acc, b) => ({ ...acc, [b.name]: (acc[b.name] || 0) + 1 }), {});
  const saveBibs  = () => {
    if (!bibHolder) return;
    const matchDate = new Date().toISOString().split('T')[0];
    setBibHistory([{ name: bibHolder, matchDate, returned: false }, ...bibHistory]);
    setSquad(squad.map(p => p.name === bibHolder ? { ...p, bibCount: (p.bibCount || 0) + 1 } : p));
    setBibSaved(true);
  };

  return (
    <div style={{ padding: 18 }}>
      <BackBtn onClick={() => { onBack(); setBibSaved(false); setBibHolder(""); }} />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <TShirt size={22} weight="thin" color="var(--gold)" />
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)", letterSpacing: "0.06em", lineHeight: 1 }}>
          BIB TRACKER
        </span>
      </div>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 12, color: "var(--t2)", marginBottom: 20 }}>
        {bibHistory.length} {bibHistory.length === 1 ? "entry" : "entries"} tracked
      </div>

      {/* ── Current holder card ─────────────────────────────────── */}
      {currentHolder ? (
        <div style={{
          background: "linear-gradient(135deg, var(--amber2), transparent) var(--s2)",
          border: "0.5px solid var(--amberb)",
          boxShadow: "0 0 12px var(--amber2)",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 24,
        }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, color: "var(--amber)", letterSpacing: "0.1em", marginBottom: 4 }}>
            HAS THE BIBS 👕
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", letterSpacing: "0.04em" }}>
            {holderName}
          </div>
          {currentHolder.matchDate && (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
              {new Date(currentHolder.matchDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          )}
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 11, color: "var(--t2)", marginTop: 2 }}>
            {daysSince(currentHolder.matchDate)}
          </div>
        </div>
      ) : (
        <div style={{
          background: "linear-gradient(135deg, var(--amber2), transparent) var(--s2)",
          border: "0.5px solid var(--amberb)",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 24,
        }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 13, color: "var(--amber)" }}>
            No bibs assigned yet
          </div>
        </div>
      )}

      {/* ── Hidden dropdown — WHO HAS THEM TONIGHT ──────────────── */}
      <div style={{ display: "none" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, color: "var(--t2)", letterSpacing: "0.08em", marginBottom: 10 }}>
          WHO HAS THEM TONIGHT?
        </div>
        {(squad || []).filter(p => p.status === "in" && !p.disabled && !p.isGuest).map(p => (
          <button key={p.id} onClick={() => { setBibHolder(p.name); setBibSaved(false); }} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
            padding: "13px 14px", borderRadius: 6, marginBottom: 7, cursor: "pointer",
            border: `2px solid ${bibHolder === p.name ? "var(--amber)" : "var(--s3)"}`,
            background: bibHolder === p.name ? "var(--amber2)" : "transparent",
          }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: bibHolder === p.name ? "var(--amber)" : "var(--t1)" }}>
              {p.nickname || p.name}
            </span>
            <span style={{ fontSize: 12, color: "var(--t2)" }}>taken {bibCounts[p.name] || 0}× before</span>
          </button>
        ))}
        {!bibSaved ? (
          <button onClick={saveBibs} disabled={!bibHolder} style={{
            width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
            background: bibHolder ? "var(--amber)" : "var(--s3)",
            color: bibHolder ? "#0A0A08" : "var(--t2)",
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.08em",
            cursor: bibHolder ? "pointer" : "default",
          }}>
            {bibHolder ? `Confirm — ${bibHolder} has the bibs` : "Select a player first"}
          </button>
        ) : (
          <button onClick={onBack} style={{
            width: "100%", padding: "16px 0", borderRadius: 12, border: "none",
            background: "var(--gold)", color: "#0A0A08",
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.1em",
            cursor: "pointer",
          }}>
            DONE
          </button>
        )}
      </div>

      {/* ── History section ──────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, color: "var(--t2)", letterSpacing: "0.1em", marginBottom: 10 }}>
          HISTORY
        </div>
        {bibHistory.length === 0 ? (
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 13, color: "var(--t2)" }}>
            No history yet
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {visibleHistory.map((b, i) => {
                const bPlayer = (squad || []).find(p => (b.playerId && p.id === b.playerId) || (!b.playerId && p.name === b.name));
                const displayName = bPlayer ? (bPlayer.nickname || bPlayer.name) : b.name;
                return (
                  <div key={i} style={{
                    background: "var(--s2)", border: "0.5px solid var(--s3)",
                    borderRadius: 10, padding: "12px 16px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 14, color: "var(--t1)" }}>
                        {displayName}
                      </div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 11, color: "var(--t2)", marginTop: 2 }}>
                        {b.matchDate ? new Date(b.matchDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
                      </div>
                    </div>
                    <div style={{
                      fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: 11,
                      padding: "3px 9px", borderRadius: 20,
                      background: b.returned ? "var(--green2)" : "var(--amber2)",
                      border: `0.5px solid ${b.returned ? "var(--greenb)" : "var(--amberb)"}`,
                      color: b.returned ? "var(--green)" : "var(--amber)",
                    }}>
                      {b.returned ? "Returned" : "Has them"}
                    </div>
                  </div>
                );
              })}
            </div>
            {hiddenCount > 0 && !showAll && (
              <button onClick={() => setShowAll(true)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 12,
                color: "var(--t2)", marginTop: 8, padding: 0,
              }}>
                View {hiddenCount} more
              </button>
            )}
            {showAll && bibHistory.length > LIMIT && (
              <button onClick={() => setShowAll(false)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 12,
                color: "var(--t2)", marginTop: 8, padding: 0,
              }}>
                Show less
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Bib Stats accordion ──────────────────────────────────── */}
      <div>
        <button onClick={() => setStatsOpen(o => !o)} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: 0, marginBottom: statsOpen ? 10 : 0,
        }}>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, color: "var(--t2)", letterSpacing: "0.1em" }}>
            BIB STATS
          </span>
          {statsOpen
            ? <CaretUp   size={14} weight="thin" color="var(--t2)" />
            : <CaretDown size={14} weight="thin" color="var(--t2)" />}
        </button>

        {statsOpen && (
          bibStats.length === 0 ? (
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 13, color: "var(--t2)" }}>
              No data yet
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Player", "All time", "Month", "3M", "6M", "Year"].map(h => (
                      <th key={h} style={{
                        fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, color: "var(--t2)",
                        letterSpacing: "0.08em", fontWeight: 400,
                        textAlign: h === "Player" ? "left" : "center",
                        padding: "4px 6px", paddingBottom: 8,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bibStats.map((p, i) => (
                    <tr key={p.id} style={{ background: i % 2 === 0 ? "var(--s2)" : "var(--s1)" }}>
                      <td style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 13, color: "var(--t1)", padding: "8px 6px" }}>
                        {p.nickname || p.name}
                      </td>
                      {[p.allTime, p.lastMonth, p.last3, p.last6, p.lastYear].map((n, j) => (
                        <td key={j} style={{
                          fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 12,
                          color: "var(--t2)", padding: "8px 6px", textAlign: "center",
                        }}>
                          {n > 0 ? n : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
