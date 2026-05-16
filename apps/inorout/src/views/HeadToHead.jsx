import { useState, useEffect } from "react";
import { ArrowLeft, UploadSimple } from "@phosphor-icons/react";
import { getHeadToHead } from "@platform/core";

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

const STATUS_BORDER = {
  in:      "var(--green)",
  out:     "var(--red)",
  maybe:   "var(--amber)",
  reserve: "var(--purple)",
};

const STATUS_LABEL = {
  in:      "IN",
  out:     "OUT",
  maybe:   "MAYBE",
  reserve: "RESERVE",
};

const STATUS_COLOR = {
  in:      { bg: "var(--green2)",  border: "var(--greenb)",  color: "var(--green)"  },
  out:     { bg: "var(--red2)",    border: "var(--redb)",    color: "var(--red)"    },
  maybe:   { bg: "var(--amber2)",  border: "var(--amberb)",  color: "var(--amber)"  },
  reserve: { bg: "var(--purple2)", border: "var(--purpleb)", color: "var(--purple)" },
};

const VERDICT_STYLE = {
  better_together: { border: "var(--greenb)", color: "var(--green)" },
  nemesis:         { border: "var(--redb)",   color: "var(--red)"   },
  you_own_them:    { border: "var(--greenb)", color: "var(--green)" },
  dead_even:       { border: "var(--goldb)",  color: "var(--gold)"  },
  early_days:      { border: "var(--s3)",     color: "var(--t2)"    },
};

const VERDICT_LABEL = {
  better_together: "BETTER TOGETHER ⚡",
  nemesis:         "NEMESIS 💀",
  you_own_them:    "YOU OWN THEM 👑",
  dead_even:       "DEAD EVEN ⚖️",
  early_days:      "EARLY DAYS 🌱",
};

const VERDICT_SUB = {
  better_together: "Win rate spikes when you're on the same side.",
  nemesis:         "They have your number. Find a way to beat them.",
  you_own_them:    "You consistently get the better of this one.",
  dead_even:       "Nothing between you. Every game is a coin flip.",
  early_days:      "Too early to call. Play more together to find out.",
};

const PERIODS = [
  { key: "month",  label: "MONTH"    },
  { key: "season", label: "SEASON"   },
  { key: "all",    label: "ALL TIME" },
];

function PlayerColumn({ player }) {
  const borderColor = STATUS_BORDER[player?.status] || "var(--s3)";
  const sc = STATUS_COLOR[player?.status];
  const name = player?.nickname || player?.name || "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
      <div style={{
        width: 72, height: 72, borderRadius: "50%",
        background: "var(--s3)",
        border: `3px solid ${borderColor}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-display)", fontSize: 28, color: "var(--t1)",
      }}>
        {initials(name)}
      </div>
      <span style={{
        fontFamily: "var(--font-display)", fontSize: 18,
        color: "var(--t1)", letterSpacing: "0.03em",
        maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", textAlign: "center",
      }}>
        {name}
      </span>
      {sc && (
        <span style={{
          fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: "0.08em",
          background: sc.bg, border: `0.5px solid ${sc.border}`, color: sc.color,
          borderRadius: 20, padding: "3px 10px",
        }}>
          {STATUS_LABEL[player.status]}
        </span>
      )}
    </div>
  );
}

function SkeletonBars() {
  return (
    <div>
      <style>{`@keyframes h2h-pulse{0%,100%{opacity:0.4}50%{opacity:0.8}}`}</style>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          height: 44, background: "var(--s2)", borderRadius: 8,
          marginBottom: 8,
          animation: "h2h-pulse 1.4s ease-in-out infinite",
          animationDelay: `${i * 0.15}s`,
        }} />
      ))}
    </div>
  );
}

export default function HeadToHead({ me, them, teamId, tableData, onClose }) {
  const [period,  setPeriod]  = useState("season");
  const [h2hData, setH2hData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!me?.id || !them?.id || !teamId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await getHeadToHead(me.id, them.id, teamId);
      if (!cancelled) {
        setH2hData(result);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [me?.id, them?.id, teamId]);

  const verdict     = h2hData?.mainVerdict || "early_days";
  const vs          = VERDICT_STYLE[verdict] || VERDICT_STYLE.early_days;
  const hasData     = !loading && h2hData && h2hData.totalSharedGames > 0;
  const isEmpty     = !loading && (!h2hData || h2hData.totalSharedGames === 0);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "var(--bg)",
      overflowY: "auto", WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 100px" }}>

        {/* Top bar */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "var(--bg)", padding: "12px 0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: 4, display: "flex", alignItems: "center",
            WebkitTapHighlightColor: "transparent",
          }}>
            <ArrowLeft size={24} weight="thin" color="var(--t1)" />
          </button>

          <button style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "0.5px solid var(--s3)",
            borderRadius: 8, padding: "6px 12px", cursor: "pointer",
            fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300,
            color: "var(--t2)",
            WebkitTapHighlightColor: "transparent",
          }}>
            <UploadSimple size={16} weight="thin" />
            Share
          </button>
        </div>

        {/* Hero title */}
        <div style={{ marginTop: 8 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 42,
            fontStyle: "italic", letterSpacing: "0.04em", lineHeight: 1,
          }}>
            <span style={{
              color: "var(--green)",
              textShadow: "0 0 18px rgba(61,220,106,0.45)",
            }}>HEAD </span>
            <span style={{ color: "var(--t1)" }}>TO </span>
            <span style={{
              color: "var(--red)",
              textShadow: "0 0 18px rgba(255,64,64,0.45)",
            }}>HEAD</span>
          </div>
          <div style={{
            fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300,
            color: "var(--t2)", marginTop: 4,
          }}>
            Compare two players together and against each other.
          </div>
        </div>

        {/* Period selector */}
        <div style={{
          background: "var(--s2)", borderRadius: 24, padding: 3,
          display: "flex", marginTop: 16,
        }}>
          {PERIODS.map(({ key, label }) => (
            <button key={key} onClick={() => setPeriod(key)} style={{
              flex: 1, padding: "8px 0", textAlign: "center", cursor: "pointer",
              fontFamily: "var(--font-display)", fontSize: 14,
              letterSpacing: "0.05em", borderRadius: 20,
              background: period === key ? "var(--gold2)"             : "transparent",
              border:     period === key ? "0.5px solid var(--goldb)" : "0.5px solid transparent",
              color:      period === key ? "var(--gold)"              : "var(--t2)",
              transition: "all 0.15s",
              WebkitTapHighlightColor: "transparent",
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* VS card */}
        <div style={{
          marginTop: 16,
          background: "linear-gradient(135deg, rgba(6,16,6,0.9), var(--s2))",
          border: "0.5px solid var(--s3)", borderRadius: 12, padding: 20,
          position: "relative", overflow: "hidden",
        }}>
          {/* Players row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <PlayerColumn player={me} />
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 24,
              color: "var(--gold)", opacity: 0.8, flexShrink: 0,
              padding: "0 8px",
            }}>
              VS
            </div>
            <PlayerColumn player={them} />
          </div>

          {/* Verdict pill — only shown when data exists */}
          {hasData && (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{
                background: "rgba(255,255,255,0.08)",
                backdropFilter: "blur(8px)",
                border: `0.5px solid ${vs.border}`,
                borderRadius: 20, padding: "6px 16px",
                fontFamily: "var(--font-display)", fontSize: 12,
                letterSpacing: "0.08em", color: vs.color,
              }}>
                {VERDICT_LABEL[verdict]}
              </div>
              <div style={{
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                color: "var(--t2)", textAlign: "center",
              }}>
                {VERDICT_SUB[verdict]}
              </div>
            </div>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ marginTop: 16 }}>
            <SkeletonBars />
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div style={{
            padding: "24px 16px", textAlign: "center",
            fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 300,
            color: "var(--t2)", lineHeight: 1.5,
          }}>
            You haven&apos;t played in the same game yet. Get on the pitch
            together to unlock your Head to Head.
          </div>
        )}

        {/* ═══ STAT SECTIONS — Parts 2 and 3 ═══ */}

      </div>
    </div>
  );
}
