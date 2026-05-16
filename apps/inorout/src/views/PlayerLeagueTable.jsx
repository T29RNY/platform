import { Trophy, CaretRight } from "@phosphor-icons/react";

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

const RANK_COLOR = { 1: "#E8A020", 2: "#A0A0A0", 3: "#CD7F32" };
const ROW_BG     = { 1: "rgba(232,160,32,0.15)", 2: "rgba(160,160,160,0.10)", 3: "rgba(205,127,50,0.12)" };
const FORM_S     = {
  W: { bg: "var(--green2)", color: "var(--green)" },
  D: { bg: "var(--amber2)", color: "var(--amber)" },
  L: { bg: "var(--red2)",   color: "var(--red)"   },
};

function reliabilityColor(val) {
  if (val === null) return "var(--t2)";
  if (val >= 80) return "var(--green)";
  if (val >= 60) return "var(--amber)";
  return "var(--red)";
}

const COLS = ["Rank", "Player", "P", "W", "D", "L", "Win%", "Goals", "POTM", "Rely", "Form"];

const PERIODS = [
  { key: "month",  label: "This Month" },
  { key: "season", label: "Season"     },
  { key: "all",    label: "All Time"   },
];

function PlayerRow({ p, bibHolder, squad }) {
  const squadPlayer = (squad || []).find(s => s.id === p.playerId);
  const hasBibs     = bibHolder && bibHolder === p.playerId;
  const rColor      = RANK_COLOR[p.rank] || null;
  const avatarBorder = rColor ? `0.5px solid ${rColor}` : "0.5px solid var(--s3)";

  return (
    <tr style={{ height: 44, background: ROW_BG[p.rank] || "transparent", borderBottom: "0.5px solid var(--s3)" }}>
      {/* Rank — sticky left:0 */}
      <td style={{ position: "sticky", left: 0, background: ROW_BG[p.rank] || "var(--s1)",
        textAlign: "center", padding: "0 8px", whiteSpace: "nowrap", minWidth: 40 }}>
        {p.ranked ? (
          <span style={{ fontFamily: "var(--font-display)", fontSize: p.rank <= 3 ? 16 : 14,
            color: rColor || "var(--t2)", lineHeight: 1 }}>
            {p.rank}
          </span>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 300, color: "var(--t2)" }}>New</span>
        )}
      </td>

      {/* Player — sticky left:40 (offset past Rank column) */}
      <td style={{ position: "sticky", left: 40, background: ROW_BG[p.rank] || "var(--s1)",
        padding: "0 12px 0 8px", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%",
              background: "var(--s3)", border: avatarBorder,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 8, fontWeight: 600, color: rColor || "var(--t2)" }}>
              {p.injured ? "🤕" : initials(p.nickname || p.name)}
            </div>
            {hasBibs && (
              <div style={{ position: "absolute", bottom: 0, right: 0,
                width: 8, height: 8, borderRadius: "50%",
                background: "var(--amber)", border: "1px solid var(--bg)" }} />
            )}
          </div>
          <span style={{ fontSize: 13, fontWeight: 400, color: "var(--t1)",
            maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.nickname || p.name}
          </span>
        </div>
      </td>

      {/* Stats */}
      {[p.played, p.wins, p.draws, p.losses].map((v, i) => (
        <td key={i} style={{ textAlign: "center", padding: "0 8px",
          fontSize: 12, fontWeight: 300, color: "var(--t2)" }}>
          {v}
        </td>
      ))}

      {/* Win% — slightly highlighted */}
      <td style={{ textAlign: "center", padding: "0 8px",
        fontSize: 12, fontWeight: 300, color: "var(--t1)" }}>
        {p.played > 0 ? `${p.winRate}%` : "—"}
      </td>

      {/* Goals */}
      <td style={{ textAlign: "center", padding: "0 8px",
        fontSize: 12, fontWeight: 300, color: "var(--t2)" }}>
        {p.goals}
      </td>

      {/* POTM */}
      <td style={{ textAlign: "center", padding: "0 8px",
        fontSize: 12, fontWeight: 300, color: "var(--t2)" }}>
        {p.potm}
      </td>

      {/* Reliability */}
      <td style={{ textAlign: "center", padding: "0 8px",
        fontSize: 12, fontWeight: 300, color: reliabilityColor(p.reliability) }}>
        {p.reliability !== null ? `${p.reliability}%` : "—"}
      </td>

      {/* Form chips */}
      <td style={{ padding: "0 8px" }}>
        <div style={{ display: "flex", gap: 2, alignItems: "center", justifyContent: "center" }}>
          {p.form.length === 0
            ? <span style={{ fontSize: 10, color: "var(--t2)" }}>—</span>
            : p.form.map((r, i) => {
                const s = FORM_S[r] || {};
                return (
                  <span key={i} style={{ width: 18, height: 18, borderRadius: "50%",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: s.bg, color: s.color,
                    fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                    {r}
                  </span>
                );
              })
          }
        </div>
      </td>
    </tr>
  );
}

export default function PlayerLeagueTable({ data = [], loading, period, onPeriodChange, squad = [], bibHistory = [] }) {
  const currentBibHolder = (bibHistory || []).find(b => !b.returned)?.playerId || null;
  const ranked   = data.filter(p => p.ranked);
  const unranked = data.filter(p => !p.ranked);

  return (
    <div style={{ marginBottom: 16, border: "0.5px solid var(--s3)", borderRadius: 12,
      padding: 16, background: "var(--s1)" }}>
      <style>{`@keyframes ioo-plt-pulse{0%,100%{opacity:0.4}50%{opacity:0.8}}`}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--gold)",
            lineHeight: 1, letterSpacing: "0.04em" }}>
            PLAYER TABLE
          </div>
          <div style={{ fontSize: 11, fontWeight: 300, color: "var(--t2)", marginTop: 3 }}>
            Real games. Real form.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, paddingTop: 2 }}>
          <Trophy size={13} weight="thin" color="var(--t2)" />
          <span style={{ fontSize: 10, fontWeight: 300, color: "var(--t2)" }}>
            Stats update in real time
          </span>
        </div>
      </div>

      {/* Period selector */}
      <div style={{ background: "var(--s2)", borderRadius: 24, padding: 3,
        display: "flex", marginBottom: 12 }}>
        {PERIODS.map(({ key, label }) => (
          <button key={key} onClick={() => onPeriodChange(key)} style={{
            flex: 1, padding: "8px 0", textAlign: "center", cursor: "pointer",
            fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300,
            borderRadius: 20,
            background:  period === key ? "var(--gold2)"                : "transparent",
            border:      period === key ? "0.5px solid var(--goldb)"    : "0.5px solid transparent",
            color:       period === key ? "var(--gold)"                 : "var(--t2)",
            transition:  "all 0.15s",
            WebkitTapHighlightColor: "transparent",
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ height: 44, background: "var(--s2)", borderRadius: "var(--rs)",
              marginBottom: 4, animation: "ioo-plt-pulse 1.4s ease-in-out infinite",
              animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && data.length === 0 && (
        <div style={{ padding: "24px 16px", textAlign: "center",
          fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>
          Play a few more matches to unlock the player table.
        </div>
      )}

      {/* Table */}
      {!loading && data.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ minWidth: 580, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "0.5px solid var(--s3)" }}>
                {COLS.map(col => (
                  <th key={col} style={{
                    fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: "0.08em",
                    color: "var(--t2)", fontWeight: 400,
                    textAlign: col === "Player" ? "left" : "center",
                    padding: "6px 8px 8px", whiteSpace: "nowrap",
                    ...(col === "Rank"   && { position: "sticky", left: 0,  background: "var(--s1)", minWidth: 40 }),
                    ...(col === "Player" && { position: "sticky", left: 40, background: "var(--s1)" }),
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map(p => (
                <PlayerRow key={p.playerId} p={p} bibHolder={currentBibHolder} squad={squad} />
              ))}
              {unranked.length > 0 && (
                <>
                  <tr>
                    <td colSpan={COLS.length} style={{ padding: "10px 8px 4px" }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 10,
                        letterSpacing: "0.1em", color: "var(--t2)" }}>
                        UNRANKED · {unranked.length}
                      </span>
                    </td>
                  </tr>
                  {unranked.map(p => (
                    <PlayerRow key={p.playerId} p={p} bibHolder={currentBibHolder} squad={squad} />
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
