import { useState } from "react";
import { ShareNetwork, CaretRight } from "@phosphor-icons/react";
import { resolveMotm, resolveBibHolder } from "@platform/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function getResult(m) {
  if (m.cancelled) return "cancelled";
  if (!m.winner || m.winner === "D") return "draw";
  return m.winner === "A" ? "win" : "loss";
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HERO_IMG = "https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=800&q=80";

const RESULT_STYLES = {
  win:       { border: "0.5px solid rgba(61,220,106,0.35)",  shadow: "0 0 14px rgba(61,220,106,0.08)"  },
  loss:      { border: "0.5px solid rgba(255,64,64,0.35)",   shadow: "0 0 14px rgba(255,64,64,0.08)"   },
  draw:      { border: "0.5px solid rgba(255,176,32,0.35)",  shadow: "0 0 14px rgba(255,176,32,0.08)"  },
  cancelled: { border: "0.5px solid rgba(255,64,64,0.2)",    shadow: "none"                            },
};

const BADGE = {
  win:  { bg: "var(--green2)", border: "var(--greenb)", color: "var(--green)", label: "WIN"  },
  loss: { bg: "var(--red2)",   border: "var(--redb)",   color: "var(--red)",   label: "LOSS" },
  draw: { bg: "var(--amber2)", border: "var(--amberb)", color: "var(--amber)", label: "DRAW" },
};

const SCORE_C = {
  win:  { A: "var(--green)", B: "var(--red)"   },
  loss: { A: "var(--red)",   B: "var(--green)" },
  draw: { A: "var(--amber)", B: "var(--amber)" },
};

const SCORE_TYPE_PILL = {
  margin:   { label: "WON BY",   color: "var(--amber)", bg: "var(--amber2)", border: "0.5px solid var(--amberb)" },
  declared: { label: "DECLARED", color: "var(--amber)", bg: "var(--amber2)", border: "0.5px solid var(--amberb)" },
};

// ── Score type pill ───────────────────────────────────────────────────────────

function ScoreTypePill({ type }) {
  const p = SCORE_TYPE_PILL[type];
  if (!p) return null;
  return (
    <span style={{
      fontFamily: "'Bebas Neue', sans-serif", fontSize: 10,
      borderRadius: 4, padding: "2px 6px", letterSpacing: "0.05em",
      color: p.color, background: p.bg, border: p.border, flexShrink: 0,
    }}>{p.label}</span>
  );
}

// ── Avatar chip (22px, initials only) ────────────────────────────────────────

function AvatarChip({ name, isGuest, team }) {
  const isTeamA = team === "A";
  const bg    = isGuest ? "rgba(232,160,32,0.2)"  : isTeamA ? "rgba(96,160,255,0.2)"  : "rgba(255,96,96,0.2)";
  const color = isGuest ? "var(--gold)"            : isTeamA ? "#60A0FF"               : "#FF6060";
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div style={{
        width: 22, height: 22, borderRadius: "50%",
        background: bg, color,
        fontSize: 7, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-body)",
      }}>
        {initials(name)}
      </div>
      {isGuest && (
        <div style={{
          position: "absolute", bottom: -1, right: -1,
          width: 8, height: 8, borderRadius: "50%",
          background: "var(--gold)", border: "1px solid var(--bg)",
          fontSize: 5, color: "#000",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, lineHeight: 1,
        }}>+</div>
      )}
    </div>
  );
}

// ── Match card ────────────────────────────────────────────────────────────────

function MatchCard({ m, players, schedule, groupName, expanded, onToggle }) {
  const [copied, setCopied] = useState(false);

  const motmName = resolveMotm(m.motm, players);
  const result   = getResult(m);
  const rs       = RESULT_STYLES[result];
  const scoreType = m.scoreType || null;
  const lastGoalScorerPlayer = m.lastGoalScorer
    ? (players || []).find(p => p.id === m.lastGoalScorer) || null
    : null;
  const d        = m.matchDate ? new Date(m.matchDate) : null;
  const dayOfWeek = d ? d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase() : "—";
  const dateNum   = d ? d.getDate() : "—";
  const monthStr  = d ? d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase() : "—";

  const findPlayer = name =>
    (players || []).find(p => (p.name || "").toLowerCase().trim() === (name || "").toLowerCase().trim());

  const teamAObjs = (m.teamA || []).map(n => ({ name: n, ...(findPlayer(n) || {}) }));
  const teamBObjs = (m.teamB || []).map(n => ({ name: n, ...(findPlayer(n) || {}) }));

  const venue       = m.venue        || schedule?.venue   || null;
  const kickoffTime = m.kickoff_time || schedule?.kickoff || null;

  const scorersList = Object.entries(m.scorers || {})
    .filter(([, g]) => g > 0)
    .sort(([, a], [, b]) => b - a);

  const buildShareText = () => {
    const resEmoji   = result === "win" ? "🟢" : result === "draw" ? "🟡" : result === "loss" ? "🔴" : "❌";
    const scorersStr = scorersList.map(([n, g]) => `${n} (${g})`).join(", ");
    return [
      `⚽ ${groupName || "Match"} · ${dayOfWeek} ${m.matchDate ? new Date(m.matchDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : ""}`,
      `${resEmoji} Team A ${m.scoreA ?? "?"} – ${m.scoreB ?? "?"} Team B`,
      "",
      `🔵 Team A: ${(m.teamA || []).join(", ") || "—"}`,
      `🔴 Team B: ${(m.teamB || []).join(", ") || "—"}`,
      "",
      scorersStr           ? `⚽ Scorers: ${scorersStr}` : null,
      m.motm               ? `🏆 POTM: ${motmName}`      : null,
      m.bibHolder          ? `🟡 Bibs: ${resolveBibHolder(m.bibHolder, players)}`   : null,
      (venue||kickoffTime) ? `📍 ${[venue, kickoffTime].filter(Boolean).join(" · ")}` : null,
    ].filter(l => l !== null).join("\n");
  };

  const handleShare = async (e) => {
    e.stopPropagation();
    const text = buildShareText();
    if (navigator.share) {
      try { await navigator.share({ text }); } catch {}
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Cancelled card ──────────────────────────────────────────────────────────
  if (m.cancelled) {
    return (
      <div style={{
        background: "var(--s1)", borderRadius: "var(--r)",
        margin: "0 0 8px", border: rs.border,
      }}>
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            minWidth: 52, borderRight: "0.5px solid var(--b2)", padding: "12px 10px",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--t2)" }}>{dayOfWeek}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--t1)", lineHeight: 1 }}>{dateNum}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--t2)" }}>{monthStr}</div>
          </div>
          <div style={{ flex: 1, padding: "14px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--red)" }}>❌ Cancelled</div>
            {m.cancelReason && (
              <div style={{ fontSize: 11, fontWeight: 300, color: "var(--t2)", marginTop: 4 }}>{m.cancelReason}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const badge = BADGE[result];
  const scoreC = SCORE_C[result] || { A: "var(--t1)", B: "var(--t1)" };

  // ── Result card ─────────────────────────────────────────────────────────────
  return (
    <div
      onClick={onToggle}
      style={{
        background: "var(--s1)", borderRadius: "var(--r)",
        margin: "0 0 8px", border: rs.border,
        boxShadow: rs.shadow, cursor: "pointer",
      }}
    >
      {/* Row 1 — date · teams · result */}
      <div style={{ display: "flex", alignItems: "stretch" }}>

        {/* Date column */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minWidth: 52, borderRight: "0.5px solid var(--b2)", padding: "12px 10px",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--t2)" }}>{dayOfWeek}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "var(--t1)", lineHeight: 1 }}>{dateNum}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--t2)" }}>{monthStr}</div>
        </div>

        {/* Teams + scores */}
        <div style={{ flex: 1, padding: "10px 12px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, position: "relative" }}>
          {[
            { team: "A", label: "Team A", score: m.scoreA, color: scoreC.A, weight: result === "win" ? 500 : 400 },
            { team: "B", label: "Team B", score: m.scoreB, color: scoreC.B, weight: result === "loss" ? 500 : 400 },
          ].map(({ team, label, score, color, weight }) => {
            const isWinner = m.winner === team;
            let right = null;
            if (scoreType === "declared") {
              if (result === "draw") right = <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color, lineHeight: 1 }}>D</span>;
              else if (isWinner)    right = <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color, lineHeight: 1 }}>W</span>;
              else                  right = <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t2)", lineHeight: 1 }}>L</span>;
            } else if (scoreType === "margin") {
              if (result === "draw") {
                right = <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color, lineHeight: 1 }}>D</span>;
              } else if (isWinner) {
                const marginVal = team === "A" ? m.scoreA : m.scoreB;
                right = (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <ScoreTypePill type="margin" />
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color, lineHeight: 1 }}>
                      {marginVal}
                    </span>
                  </div>
                );
              }
            } else {
              right = (
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color, lineHeight: 1, flexShrink: 0 }}>
                  {score ?? "?"}
                </div>
              );
            }
            return (
              <div key={team} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 16, fontWeight: weight, color }}>{label}</span>
                {right}
              </div>
            );
          })}
        </div>

        {/* Meta + chevron — no badge */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center",
          padding: "10px 10px 10px 0", minWidth: 48, gap: 4,
        }}>
          {venue && (
            <div style={{ fontSize: 9, color: "var(--t2)", fontWeight: 300, textAlign: "right" }}>{venue}</div>
          )}
          {kickoffTime && (
            <div style={{ fontSize: 9, color: "var(--t2)", fontWeight: 300 }}>{kickoffTime}</div>
          )}
          <CaretRight
            size={14} weight="thin" color="var(--t2)"
            style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", marginTop: 2 }}
          />
        </div>
      </div>

      {/* Row 2 — POTM · bibs · last goal (hidden entirely when all absent) */}
      {(m.motm || m.bibHolder || lastGoalScorerPlayer) && (
        <div style={{
          borderTop: "0.5px solid var(--b2)", padding: "7px 12px 7px 14px",
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 11, color: "var(--t2)", fontWeight: 300,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {m.motm && <span>🏆 {motmName}</span>}
          {m.motm && (m.bibHolder || lastGoalScorerPlayer) && <span style={{ opacity: 0.4 }}>·</span>}
          {m.bibHolder && <span>🟡 {resolveBibHolder(m.bibHolder, players)} has bibs</span>}
          {m.bibHolder && lastGoalScorerPlayer && <span style={{ opacity: 0.4 }}>·</span>}
          {lastGoalScorerPlayer && <span>⚽ Last: {lastGoalScorerPlayer.nickname || lastGoalScorerPlayer.name}</span>}
        </div>
      )}

      {/* Expanded drill-down */}
      {expanded && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            borderTop: "0.5px solid var(--b2)",
            padding: "12px 14px",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          {/* Score display + last goal scorer */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 14, paddingBottom: 12, borderBottom: "0.5px solid var(--b2)" }}>
            {scoreType === "margin" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ScoreTypePill type="margin" />
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--green)", lineHeight: 1 }}>
                  {m.winner === "A" ? m.scoreA : m.winner === "B" ? m.scoreB : "?"}
                </span>
              </div>
            ) : scoreType === "declared" ? (
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, lineHeight: 1,
                color: result === "win" ? "var(--green)" : result === "loss" ? "var(--red)" : "var(--amber)" }}>
                {result === "win" ? "W" : result === "loss" ? "L" : "D"}
              </span>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: scoreC.A, lineHeight: 1 }}>{m.scoreA ?? "?"}</span>
                <span style={{ fontSize: 18, color: "var(--t2)", fontWeight: 300 }}>—</span>
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: scoreC.B, lineHeight: 1 }}>{m.scoreB ?? "?"}</span>
              </div>
            )}
            {lastGoalScorerPlayer && (
              <div style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, marginTop: 6 }}>
                ⚽ Last: {lastGoalScorerPlayer.nickname || lastGoalScorerPlayer.name}
              </div>
            )}
          </div>

          {/* Team lineups */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              { label: "🔵 TEAM A", objs: teamAObjs, color: "#60A0FF" },
              { label: "🔴 TEAM B", objs: teamBObjs, color: "#FF6060" },
            ].map(({ label, objs, color }) => (
              <div key={label}>
                <div style={{
                  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
                  color, fontWeight: 600, marginBottom: 7,
                }}>{label}</div>
                {objs.map((p, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 5,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: p.isGuest ? "rgba(232,160,32,0.2)" : `${color}22`,
                      color: p.isGuest ? "var(--gold)" : color,
                      fontSize: 8, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {initials(p.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, color: "var(--t1)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {p.nickname || p.name}{m.motm && p.id === m.motm ? " 🏆" : ""}
                      </div>
                      {p.isGuest && p.guestOf && (
                        <div style={{ fontSize: 9, color: "var(--gold)", marginTop: 1 }}>+1 {p.guestOf}</div>
                      )}
                    </div>
                    {(m.scorers || {})[p.name] > 0 && (
                      <div style={{ fontSize: 11, color: "var(--t2)", flexShrink: 0 }}>
                        ⚽ {m.scorers[p.name]}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Share button */}
          <button
            onClick={handleShare}
            style={{
              width: "100%",
              background: "linear-gradient(135deg, rgba(232,160,32,0.9) 0%, rgba(232,160,32,0.7) 100%)",
              border: "0.5px solid rgba(232,160,32,0.6)",
              boxShadow: "0 0 20px rgba(232,160,32,0.35), 0 0 40px rgba(232,160,32,0.15)",
              borderRadius: "var(--r)",
              padding: "13px 16px",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              cursor: "pointer",
            }}
          >
            <ShareNetwork size={18} color="white" weight="thin" />
            <span style={{ fontSize: 14, fontWeight: 500, color: "white" }}>
              {copied ? "Copied!" : "Share Result"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Month section (header + cards) ────────────────────────────────────────────

function MonthSection({ monthKey, label, matches, isOpen, onToggle, players, schedule, groupName, expandedCards, onCardToggle }) {
  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: isOpen ? "0.5px solid var(--b2)" : "none",
          cursor: "pointer",
        }}
      >
        <span style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.1em",
          textTransform: "uppercase", color: "var(--t2)",
        }}>
          {label} · {matches.length} {matches.length === 1 ? "game" : "games"}
        </span>
        <CaretRight
          size={13} weight="thin" color="var(--t2)"
          style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}
        />
      </div>
      {isOpen && (
        <div style={{ padding: "8px 16px 4px" }}>
          {matches.map(m => (
            <MatchCard
              key={m.id}
              m={m}
              players={players}
              schedule={schedule}
              groupName={groupName}
              expanded={expandedCards.has(m.id)}
              onToggle={() => onCardToggle(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HistoryView({ matchHistory = [], players = [], settings, schedule }) {
  // const [filter, setFilter] = useState("all"); // restore with filter pills

  const now = new Date();
  const [openMonths, setOpenMonths] = useState(() => {
    const s = new Set();
    s.add(`${now.getFullYear()}-${now.getMonth()}`);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    s.add(`${prev.getFullYear()}-${prev.getMonth()}`);
    return s;
  });
  const [openYears,    setOpenYears]    = useState(new Set());
  const [expandedCards, setExpandedCards] = useState(new Set());

  const groupName    = settings?.groupName || "";
  const currentYear  = now.getFullYear();
  const totalPlayed  = matchHistory.filter(m => !m.cancelled).length;

  // Sort DESC — filter disabled while pills are hidden
  const filtered = matchHistory
    // .filter(m => { // restore with filter pills
    //   if (filter === "all")    return true;
    //   const r = getResult(m);
    //   if (filter === "wins")   return r === "win";
    //   if (filter === "draws")  return r === "draw";
    //   if (filter === "losses") return r === "loss";
    //   return true;
    // })
    .sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate));

  // Group by year → month
  const grouped = {};
  for (const m of filtered) {
    const d  = new Date(m.matchDate);
    const y  = d.getFullYear();
    const mo = d.getMonth();
    if (!grouped[y])     grouped[y]     = {};
    if (!grouped[y][mo]) grouped[y][mo] = [];
    grouped[y][mo].push(m);
  }

  const thisYearMonths = Object.entries(grouped[currentYear] || {}).sort(([a], [b]) => +b - +a);
  const pastYears      = Object.entries(grouped).filter(([y]) => +y < currentYear).sort(([a], [b]) => +b - +a);

  const toggleMonth = key => setOpenMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleYear  = year => setOpenYears(prev  => { const n = new Set(prev); n.has(year) ? n.delete(year) : n.add(year); return n; });
  const toggleCard  = id   => setExpandedCards(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Filter pills — hidden, restore when re-enabling
  // const FILTERS = [
  //   { id: "all",    label: "All"    },
  //   { id: "wins",   label: "Wins"   },
  //   { id: "draws",  label: "Draws"  },
  //   { id: "losses", label: "Losses" },
  // ];
  // const pillStyle = (id) => {
  //   const base = { borderRadius: "var(--r-pill)", padding: "6px 14px", fontSize: 12, fontWeight: 400, cursor: "pointer", fontFamily: "var(--font-body)", transition: "all 0.15s" };
  //   if (id !== filter) return { ...base, background: "var(--s2)", border: "0.5px solid var(--border-subtle)", color: "var(--t2)" };
  //   if (id === "all")    return { ...base, background: "var(--s3)", border: "0.5px solid var(--border-subtle)", color: "var(--t1)" };
  //   if (id === "wins")   return { ...base, background: "var(--green2)", border: "0.5px solid var(--greenb)", color: "var(--green)" };
  //   if (id === "draws")  return { ...base, background: "var(--amber2)", border: "0.5px solid var(--amberb)", color: "var(--amber)" };
  //   if (id === "losses") return { ...base, background: "var(--red2)",   border: "0.5px solid var(--redb)",   color: "var(--red)"   };
  //   return base;
  // };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--t1)", fontFamily: "var(--font-body)", paddingBottom: 110 }}>

      {/* ── Hero (sticky) ── */}
      <style>{`
        .heroGlassStatTile{position:absolute;top:50%;right:16px;transform:translateY(-50%);width:80px;height:56px;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(255,255,255,0.24) 0%,rgba(255,255,255,0.10) 38%,rgba(255,255,255,0.05) 100%);backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%);border:0.5px solid rgba(255,255,255,0.25);box-shadow:0 18px 45px rgba(0,0,0,0.32),inset 0 1px 0 rgba(255,255,255,0.28),inset 0 -1px 0 rgba(255,255,255,0.08);overflow:hidden;z-index:2}
        .heroGlassStatTile::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 24% 12%,rgba(255,255,255,0.34),rgba(255,255,255,0.08) 34%,transparent 58%);pointer-events:none}
        .heroGlassStatTile::after{content:"";position:absolute;inset:1px;border-radius:inherit;border:1px solid rgba(255,255,255,0.08);pointer-events:none}
        .heroGlassStatValue{position:relative;z-index:1;font-size:26px;line-height:0.9;font-weight:700;letter-spacing:-0.04em;color:rgba(255,255,255,0.96);text-shadow:0 2px 10px rgba(0,0,0,0.28),0 0 24px rgba(255,255,255,0.08)}
        .heroGlassStatLabel{position:relative;z-index:1;margin-top:4px;font-size:9px;line-height:1;font-weight:400;letter-spacing:-0.01em;color:rgba(255,255,255,0.72);white-space:nowrap}
      `}</style>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--bg)", padding: "0 16px" }}>
        <div style={{ position: "relative", borderRadius: "var(--r)", overflow: "hidden", height: 110 }}>
          <img
            src={HERO_IMG} alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover", filter: "brightness(0.55) saturate(0.8)" }}
          />
          <div style={{ position: "absolute", inset: 0,
            background: "linear-gradient(180deg, rgba(10,10,8,0.15) 0%, rgba(10,10,8,0.7) 100%)" }} />
          {/* Left text — anchored bottom */}
          <div style={{ position: "absolute", bottom: 0, left: 0, padding: "10px 16px" }}>
            {groupName && (
              <div style={{ fontSize: 10, fontWeight: 300, letterSpacing: "0.18em",
                textTransform: "uppercase", color: "var(--gold)", marginBottom: 2,
                textShadow: "0 0 20px rgba(0,0,0,0.9)" }}>
                {groupName}
              </div>
            )}
            <div style={{ fontFamily: "var(--font-display)", fontSize: 38, lineHeight: 1,
              letterSpacing: "0.04em", fontStyle: "italic", color: "var(--green)",
              textShadow: "0 0 20px rgba(0,0,0,0.9)" }}>
              RESULTS
            </div>
            <div style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, marginTop: 3,
              textShadow: "0 0 20px rgba(0,0,0,0.9)" }}>
              Every game. Every moment.
            </div>
          </div>
          {/* Games played glass tile — inside overflow:hidden so border-radius clips correctly */}
          <div className="heroGlassStatTile">
            <span className="heroGlassStatValue">{totalPlayed}</span>
            <span className="heroGlassStatLabel">games played</span>
          </div>
        </div>
      </div>

      {/* ── Filter pills — hidden, restore when re-enabling ── */}
      {/* <div style={{ padding: "10px 16px", display: "flex", gap: 6 }}>
        {FILTERS.map(({ id, label }) => (
          <button key={id} onClick={() => setFilter(id)} style={pillStyle(id)}>{label}</button>
        ))}
      </div> */}

      {/* ── Empty state ── */}
      {matchHistory.length === 0 && (
        <div style={{
          background: "var(--s1)", border: "0.5px solid var(--border-subtle)",
          borderRadius: "var(--r)", margin: "8px 16px",
          padding: "32px 16px", textAlign: "center",
        }}>
          <div style={{ fontSize: 36 }}>⚽</div>
          <div style={{ fontSize: 16, fontWeight: 400, color: "var(--t1)", marginTop: 8 }}>No results yet.</div>
          <div style={{ fontSize: 12, fontWeight: 300, color: "var(--t2)", marginTop: 4 }}>
            Get out there and play some football.
          </div>
        </div>
      )}

      {/* ── Current year months ── */}
      {thisYearMonths.map(([mo, matches]) => {
        const key   = `${currentYear}-${mo}`;
        const label = `${MONTH_ABBR[+mo]} ${currentYear}`;
        return (
          <div key={key} style={{
            background: "var(--s1)", border: "0.5px solid var(--border-subtle)",
            borderRadius: "var(--r)", margin: "0 16px 8px", overflow: "hidden",
          }}>
            <MonthSection
              monthKey={key} label={label} matches={matches}
              isOpen={openMonths.has(key)} onToggle={() => toggleMonth(key)}
              players={players} schedule={schedule} groupName={groupName}
              expandedCards={expandedCards} onCardToggle={toggleCard}
            />
          </div>
        );
      })}

      {/* ── Past years ── */}
      {pastYears.map(([year, months]) => {
        const yearTotal  = Object.values(months).flat().length;
        const isYearOpen = openYears.has(year);
        return (
          <div key={year} style={{
            background: "var(--s1)", border: "0.5px solid var(--border-subtle)",
            borderRadius: "var(--r)", margin: "0 16px 8px", overflow: "hidden",
          }}>
            {/* Year header */}
            <div
              onClick={() => toggleYear(year)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: isYearOpen ? "0.5px solid var(--b2)" : "none",
                cursor: "pointer",
              }}
            >
              <span style={{
                fontSize: 13, fontWeight: 600, letterSpacing: "0.1em",
                textTransform: "uppercase", color: "var(--t2)",
              }}>
                {year} · {yearTotal} {yearTotal === 1 ? "game" : "games"}
              </span>
              <CaretRight
                size={13} weight="thin" color="var(--t2)"
                style={{ transform: isYearOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}
              />
            </div>

            {/* Month sub-accordions */}
            {isYearOpen && Object.entries(months).sort(([a], [b]) => +b - +a).map(([mo, matches]) => {
              const key   = `${year}-${mo}`;
              const label = `${MONTH_ABBR[+mo]} ${year}`;
              return (
                <div key={key} style={{ borderTop: "0.5px solid var(--b2)" }}>
                  <MonthSection
                    monthKey={key} label={label} matches={matches}
                    isOpen={openMonths.has(key)} onToggle={() => toggleMonth(key)}
                    players={players} schedule={schedule} groupName={groupName}
                    expandedCards={expandedCards} onCardToggle={toggleCard}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

    </div>
  );
}
