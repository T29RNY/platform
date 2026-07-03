import { useState, useEffect, useRef } from "react";
import { ArrowLeft, UploadSimple, SoccerBall, TShirt, UsersThree, Lightning, Trophy, Star, User } from "@phosphor-icons/react";
import { motion, AnimatePresence, animate } from "framer-motion";
import { getHeadToHead, getPlayerLeagueTable, getH2hMatchFitness } from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";
import { formatDistance } from "../lib/formatDistance.js";

// Number that ramps from 0 → value over duration. Writes textContent directly
// to dodge per-frame React re-renders. Suffix is appended raw (e.g. "%").
function Counter({ value, duration = 0.7, suffix = "", decimals = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const controls = animate(0, value || 0, {
      duration, ease: "easeOut",
      onUpdate: (v) => {
        node.textContent = decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, duration, decimals]);
  return <><span ref={ref}>0</span>{suffix}</>;
}

// Section wrapper — every numbered stat section uses the same entry rhythm
// so the five chapters read as a unified scroll story.
const sectionMotion = (index = 0) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", stiffness: 260, damping: 26, delay: 0.15 + index * 0.08 },
});

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

function PlayerColumn({ player, side = "left" }) {
  const borderColor = STATUS_BORDER[player?.status] || "var(--s3)";
  const sc = STATUS_COLOR[player?.status];
  const name = player?.nickname || player?.name || "—";
  const fromX = side === "left" ? -40 : 40;

  return (
    <motion.div
      initial={{ opacity: 0, x: fromX }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 24, delay: 0.35 }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}
    >
      <motion.div
        initial={{ scale: 0.5, rotate: side === "left" ? -8 : 8 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 16, delay: 0.4 }}
        style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "var(--s3)",
          border: `3px solid ${borderColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-display)", fontSize: 28, color: "var(--t1)",
        }}
      >
        {initials(name)}
      </motion.div>
      <span style={{
        fontFamily: "var(--font-display)", fontSize: 18,
        color: "var(--t1)", letterSpacing: "0.03em",
        maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", textAlign: "center",
      }}>
        {name}
      </span>
      {sc && (
        <motion.span
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 18, delay: 0.6 }}
          style={{
            fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: "0.08em",
            background: sc.bg, border: `0.5px solid ${sc.border}`, color: sc.color,
            borderRadius: 20, padding: "3px 10px",
          }}
        >
          {STATUS_LABEL[player.status]}
        </motion.span>
      )}
    </motion.div>
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

export default function HeadToHead({ me, them, teamId, adminToken = null, playerToken = null, tableData, onClose, initialPeriod = 'season' }) {
  const [period,         setPeriod]         = useState(initialPeriod);
  const [h2hData,        setH2hData]        = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [modalTableData, setModalTableData] = useState(tableData);
  const [fitData,        setFitData]        = useState(null);

  useEffect(() => {
    if (!me?.id || !them?.id || !teamId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await getHeadToHead(me.id, them.id, teamId, period, adminToken, playerToken);
      if (!cancelled) {
        setH2hData(result);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [me?.id, them?.id, teamId, period]);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      const { players } = await getPlayerLeagueTable(teamId, period, adminToken, playerToken);
      if (!cancelled) setModalTableData(players);
    })();
    return () => { cancelled = true; };
  }, [teamId, period]);

  // Match-fitness compare (PR #7). Authenticated-only RPC (auth.uid()); token-only viewers skip it
  // and the section self-hides. Display gates on has-data (not the flag), so it lights up
  // automatically once VITE_HEALTH_KIT_ENABLED flips and real attaches land.
  useEffect(() => {
    if (!them?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (!session) { if (!cancelled) setFitData(null); return; }
        const res = await getH2hMatchFitness(them.id, period);
        if (!cancelled) setFitData(res || null);
      } catch (e) {
        console.error("[health] get_h2h_match_fitness failed", e);
        if (!cancelled) setFitData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [them?.id, period]);

  const verdict     = h2hData?.mainVerdict || "early_days";
  const vs          = VERDICT_STYLE[verdict] || VERDICT_STYLE.early_days;
  const hasData     = !loading && h2hData && h2hData.totalSharedGames > 0;
  const isEmpty     = !loading && (!h2hData || h2hData.totalSharedGames === 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "var(--bg)",
        overflowY: "auto", WebkitOverflowScrolling: "touch",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 100px" }}>

        {/* Top bar */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "var(--bg)",
          // Clear the status bar / notch so the back arrow isn't tucked under it.
          padding: "calc(12px + env(safe-area-inset-top)) 0 12px",
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

        {/* Hero title — the two HEADs literally clash at TO */}
        <div style={{ marginTop: 8 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 42,
            fontStyle: "italic", letterSpacing: "0.04em", lineHeight: 1,
          }}>
            <motion.span
              initial={{ opacity: 0, x: -28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 22, delay: 0.05 }}
              style={{
                display: "inline-block",
                color: "var(--green)",
                textShadow: "0 0 18px rgba(61,220,106,0.45)",
              }}
            >HEAD </motion.span>
            <motion.span
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 14, delay: 0.22 }}
              style={{ display: "inline-block", color: "var(--t1)" }}
            >TO </motion.span>
            <motion.span
              initial={{ opacity: 0, x: 28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 240, damping: 22, delay: 0.05 }}
              style={{
                display: "inline-block",
                color: "var(--red)",
                textShadow: "0 0 18px rgba(255,64,64,0.45)",
              }}
            >HEAD</motion.span>
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.3 }}
            style={{
              fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300,
              color: "var(--t2)", marginTop: 4,
            }}
          >
            Compare two players together and against each other.
          </motion.div>
        </div>

        {/* Period selector — active pill morphs across via shared layoutId */}
        <div style={{
          background: "var(--s2)", borderRadius: 24, padding: 3,
          display: "flex", marginTop: 16, position: "relative",
        }}>
          {PERIODS.map(({ key, label }) => {
            const active = period === key;
            return (
              <button key={key} onClick={() => setPeriod(key)} style={{
                flex: 1, padding: "8px 0", textAlign: "center", cursor: "pointer",
                fontFamily: "var(--font-display)", fontSize: 14,
                letterSpacing: "0.05em", borderRadius: 20,
                background: "transparent",
                border: "0.5px solid transparent",
                color: active ? "var(--gold)" : "var(--t2)",
                position: "relative", zIndex: 1,
                WebkitTapHighlightColor: "transparent",
                transition: "color 0.18s",
              }}>
                {active && (
                  <motion.div
                    layoutId="period-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    style={{
                      position: "absolute", inset: 0,
                      background: "var(--gold2)",
                      border: "0.5px solid var(--goldb)",
                      borderRadius: 20, zIndex: -1,
                    }}
                  />
                )}
                {label}
              </button>
            );
          })}
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

          {/* Verdict pill — the emotional verdict, springs in after the
              avatars have landed */}
          {hasData && (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <motion.div
                key={`verdict-${verdict}-${period}`}
                initial={{ opacity: 0, scale: 0.6, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.85 }}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  backdropFilter: "blur(8px)",
                  border: `0.5px solid ${vs.border}`,
                  borderRadius: 20, padding: "6px 16px",
                  fontFamily: "var(--font-display)", fontSize: 12,
                  letterSpacing: "0.08em", color: vs.color,
                }}
              >
                {VERDICT_LABEL[verdict]}
              </motion.div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.05, duration: 0.3 }}
                style={{
                  fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                  color: "var(--t2)", textAlign: "center",
                }}
              >
                {VERDICT_SUB[verdict]}
              </motion.div>
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

        {/* ═══ STAT SECTIONS 1-3 — Part 2 ═══ */}

        {hasData && (() => {
          const t  = h2hData.together;
          const ag = h2hData.against;
          const ch = h2hData.chemistry;
          const meName   = me?.nickname   || me?.name   || "Me";
          const themName = them?.nickname || them?.name || "Them";

          // ── Section 1 — WHEN YOU PLAY TOGETHER ──────────────────────────
          const sec1 = (
            <motion.div key={`s1-${period}`} {...sectionMotion(0)} style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--green)", marginBottom: 12 }}>
                1. WHEN YOU PLAY TOGETHER
              </div>
              {t.games === 0 ? (
                <div style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)", padding: "8px 0" }}>
                  {period === 'month'  ? "You haven't been on the same team this month"
                 : period === 'season' ? "You haven't been on the same team this season"
                 : "You've never been teammates yet."}
                </div>
              ) : (
                <>
                  {/* Stat boxes */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    {/* Games together */}
                    <div style={{ flex: 1, minWidth: 0, background: "var(--s3)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--t1)", lineHeight: 1 }}>
                        <Counter value={t.games} />
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, color: "var(--t2)", marginTop: 2 }}>Games together</div>
                    </div>
                    {/* W/D/L */}
                    <div style={{ flex: 1, minWidth: 0, background: "var(--s3)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, lineHeight: 1 }}>
                        <span style={{ color: "var(--green)" }}>{t.wins}W</span>
                        <span style={{ color: "var(--t2)", fontSize: 14 }}> / </span>
                        <span style={{ color: "var(--t2)" }}>{t.draws}D</span>
                        <span style={{ color: "var(--t2)", fontSize: 14 }}> / </span>
                        <span style={{ color: "var(--red)" }}>{t.losses}L</span>
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, color: "var(--t2)", marginTop: 2 }}>Record together</div>
                    </div>
                    {/* Win rate */}
                    <div style={{ flex: 1, minWidth: 0, background: "var(--s3)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--t1)", lineHeight: 1 }}>
                        <Counter value={t.winRate} suffix="%" />
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, color: "var(--t2)", marginTop: 2 }}>Win rate together</div>
                    </div>
                    {/* Together ratio */}
                    <div style={{ flex: 1, minWidth: 0, background: "var(--s3)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--t1)", lineHeight: 1 }}>{t.games} / {t.gamesBothPlayed}</div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, color: "var(--t2)", marginTop: 2 }}>Together ratio</div>
                    </div>
                  </div>

                  {/* Row 1 — adaptive by dominantType */}
                  {h2hData.dominantType === 'exact' ? (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "0.5px solid var(--s3)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <SoccerBall size={16} weight="thin" color="var(--t2)" />
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>Goal threat</span>
                      </div>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300 }}>
                        {t.goalThreatTogether != null ? (
                          <>
                            <span style={{ color: t.goalThreatTogether > (t.goalThreatApart ?? 0) ? "var(--green)" : "var(--red)" }}>
                              {t.goalThreatTogether.toFixed(1)}
                            </span>
                            <span style={{ color: "var(--t2)" }}>{` together (${t.goalThreatTogetherCount} game${t.goalThreatTogetherCount === 1 ? '' : 's'}) vs `}</span>
                            {t.goalThreatApart != null ? (
                              <>
                                <span style={{ color: "var(--t2)" }}>{t.goalThreatApart.toFixed(1)}</span>
                                <span style={{ color: "var(--t2)" }}>{` apart (${t.goalThreatApartCount} game${t.goalThreatApartCount === 1 ? '' : 's'})`}</span>
                              </>
                            ) : (
                              <span style={{ color: "var(--t2)" }}>— apart</span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: "var(--t2)" }}>—</span>
                        )}
                      </span>
                    </div>
                  ) : h2hData.dominantType === 'margin' ? (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "0.5px solid var(--s3)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Lightning size={16} weight="thin" color="var(--t2)" />
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>Match outcome</span>
                      </div>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300 }}>
                        {t.outcomeAvg === null ? (
                          <span style={{ color: "var(--t2)" }}>—</span>
                        ) : (
                          <>
                            <span style={{ color: t.outcomeAvg > 0 ? "var(--green)" : t.outcomeAvg < 0 ? "var(--red)" : "var(--t1)" }}>
                              {t.outcomeAvg > 0 ? `+${t.outcomeAvg.toFixed(1)}` : t.outcomeAvg.toFixed(1)}
                            </span>
                            <span style={{ color: "var(--t2)" }}> average</span>
                          </>
                        )}
                      </span>
                    </div>
                  ) : null}

                  {/* Combined POTM row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Trophy size={16} weight="thin" color="var(--t2)" />
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>Combined POTM</span>
                    </div>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300 }}>
                      {t.potmMe + t.potmThem === 0 ? (
                        <span style={{ color: "var(--t2)" }}>0 — no POTMs together yet</span>
                      ) : (
                        <>
                          <span style={{ color: "var(--gold)" }}>{t.potmMe + t.potmThem}</span>
                          <span style={{ color: "var(--t2)" }}> ({meName} {t.potmMe}, {themName} {t.potmThem})</span>
                        </>
                      )}
                    </span>
                  </div>
                </>
              )}
            </motion.div>
          );

          // ── Section 2 — WHEN YOU FACE EACH OTHER ────────────────────────
          const streakText = (() => {
            const s = ag.streak;
            if (!s || s.length === 0) return null;
            const winner = s.player === "me" ? meName : themName;
            return { winner, length: s.length };
          })();

          const insightText = (() => {
            if (ag.games === 0) return null;
            if (ag.meWins > ag.theirWins * 2) return `${meName} dominates this matchup`;
            if (ag.theirWins > ag.meWins * 2) return `${themName} owns this matchup`;
            if (ag.meWins > ag.theirWins) return `${meName} has the edge`;
            if (ag.theirWins > ag.meWins) return `${themName} has the edge`;
            return "Dead even — this rivalry is perfectly balanced";
          })();

          const sec2 = (
            <motion.div key={`s2-${period}`} {...sectionMotion(1)} style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--red)", marginBottom: 12 }}>
                2. WHEN YOU FACE EACH OTHER
              </div>
              {ag.games === 0 ? (
                <div style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)", padding: "8px 0" }}>
                  {period === 'month'  ? "You haven't been on opposite teams this month"
                 : period === 'season' ? "You haven't been on opposite teams this season"
                 : "You've never been on opposite teams yet."}
                </div>
              ) : (
                <>
                  {[
                    {
                      icon: <UsersThree size={16} weight="thin" color="var(--t2)" />,
                      label: "Games against each other",
                      value: <span style={{ color: "var(--t1)" }}>{ag.games}</span>,
                      border: true,
                    },
                    {
                      icon: <Trophy size={16} weight="thin" color="var(--t2)" />,
                      label: "Results",
                      value: (
                        <>
                          <span style={{ color: "var(--green)" }}>{meName}</span>
                          <span style={{ color: "var(--t1)" }}> {ag.meWins} wins · {ag.draws} draws · </span>
                          <span style={{ color: "var(--red)" }}>{themName}</span>
                          <span style={{ color: "var(--t1)" }}> {ag.theirWins} wins</span>
                        </>
                      ),
                      border: true,
                    },
                    {
                      icon: <SoccerBall size={16} weight="thin" color="var(--t2)" />,
                      label: "Goals scored",
                      value: ag.goalsCount === 0 ? (
                        <span style={{ color: "var(--t2)" }}>—</span>
                      ) : ag.goalsCount < ag.games ? (
                        <>
                          <span style={{ color: "var(--green)" }}>{meName}</span>
                          <span style={{ color: "var(--t1)" }}> {ag.myGoals} vs </span>
                          <span style={{ color: "var(--red)" }}>{themName}</span>
                          <span style={{ color: "var(--t1)" }}> {ag.theirGoals}</span>
                          <span style={{ color: "var(--t2)" }}>{` (in ${ag.goalsCount} tracked game${ag.goalsCount === 1 ? '' : 's'})`}</span>
                        </>
                      ) : (
                        <>
                          <span style={{ color: "var(--green)" }}>{meName}</span>
                          <span style={{ color: "var(--t1)" }}> {ag.myGoals} vs </span>
                          <span style={{ color: "var(--red)" }}>{themName}</span>
                          <span style={{ color: "var(--t1)" }}> {ag.theirGoals}</span>
                        </>
                      ),
                      border: true,
                    },
                    {
                      icon: <Lightning size={16} weight="thin" color="var(--t2)" />,
                      label: "Current streak",
                      value: streakText
                        ? streakText.length === 1
                          ? <><span style={{ color: "var(--green)" }}>{streakText.winner}</span><span style={{ color: "var(--t1)" }}> won the last meeting</span></>
                          : <><span style={{ color: "var(--green)" }}>{streakText.winner}</span><span style={{ color: "var(--t1)" }}> has won {streakText.length} in a row</span></>
                        : <span style={{ color: "var(--t2)" }}>No active streak</span>,
                      border: false,
                    },
                  ].map((row, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: row.border ? "0.5px solid var(--s3)" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {row.icon}
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>{row.label}</span>
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, textAlign: "right", marginLeft: 12 }}>
                        {row.value}
                      </div>
                    </div>
                  ))}

                  {insightText && (
                    <div style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300, color: "var(--gold)", marginTop: 8 }}>
                      💡 Insight: {insightText}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          );

          // ── Section 3 — YOU MAKE THEM BETTER ────────────────────────────
          const CHEM_STYLE = {
            good_luck_charm: { border: "var(--goldb)",  color: "var(--gold)"  },
            bad_influence:   { border: "var(--redb)",   color: "var(--red)"   },
            asymmetric:      { border: "var(--amberb)", color: "var(--amber)" },
            no_effect:       { border: "var(--s3)",     color: "var(--t2)"   },
            building:        { border: "var(--s3)",     color: "var(--t2)"   },
          };
          const CHEM_LABEL = {
            good_luck_charm: "⭐ Good luck charm",
            bad_influence:   "👎 Bad influence",
            asymmetric:      "↕ Asymmetric",
            no_effect:       "➖ No clear effect",
            building:        "🌱 Building",
          };
          const chemV  = h2hData.chemistryVerdict || "no_effect";
          const chemSt = CHEM_STYLE[chemV] || CHEM_STYLE.no_effect;

          const sec3 = h2hData.totalSharedGames >= 3 ? (
            <motion.div key={`s3-${period}`} {...sectionMotion(2)} style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--purple)", marginBottom: 12 }}>
                3. YOU MAKE THEM BETTER
              </div>

              {/* Their win rate */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "0.5px solid var(--s3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <User size={16} weight="thin" color="var(--red)" />
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>
                    {themName} win rate with {meName}:
                  </span>
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13, textAlign: "right", marginLeft: 12 }}>
                  <span style={{ fontWeight: 400, color: "var(--t1)" }}>
                    {ch.theirWinRateWithMe != null ? `${ch.theirWinRateWithMe}%` : "—"}
                  </span>
                  <span style={{ fontWeight: 300, color: "var(--t2)" }}>
                    {" "}|{"  without "}
                    {meName}: {ch.theirWinRateWithoutMe != null ? `${ch.theirWinRateWithoutMe}%` : "—"}
                  </span>
                </div>
              </div>

              {/* My win rate */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "0.5px solid var(--s3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <User size={16} weight="thin" color="var(--green)" />
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>
                    {meName} win rate with {themName}:
                  </span>
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13, textAlign: "right", marginLeft: 12 }}>
                  <span style={{ fontWeight: 400, color: "var(--t1)" }}>
                    {ch.myWinRateWithThem != null ? `${ch.myWinRateWithThem}%` : "—"}
                  </span>
                  <span style={{ fontWeight: 300, color: "var(--t2)" }}>
                    {" "}|{"  without "}
                    {themName}: {ch.myWinRateWithoutThem != null ? `${ch.myWinRateWithoutThem}%` : "—"}
                  </span>
                </div>
              </div>

              {/* Delta rows */}
              {(() => {
                function fmtDelta(d) {
                  if (d == null) return <span style={{ color: "var(--t2)" }}>—</span>;
                  const sign = d > 0 ? "+" : "";
                  return (
                    <span style={{ color: d > 0 ? "var(--green)" : d < 0 ? "var(--red)" : "var(--t1)" }}>
                      {sign}{d}pp
                    </span>
                  );
                }
                return (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "0.5px solid var(--s3)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <Lightning size={16} weight="thin" color="var(--t2)" />
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>
                          {meName}&apos;s effect on {themName}
                        </span>
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 13, textAlign: "right", marginLeft: 12 }}>
                        {fmtDelta(ch.myEffectDelta)}
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "0.5px solid var(--s3)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <Lightning size={16} weight="thin" color="var(--t2)" />
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>
                          {themName}&apos;s effect on {meName}
                        </span>
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 13, textAlign: "right", marginLeft: 12 }}>
                        {fmtDelta(ch.themEffectDelta)}
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* POTM rivalry */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <Star size={16} weight="thin" color="var(--t2)" />
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>
                    POTM rivalry in shared games:
                  </span>
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, textAlign: "right", marginLeft: 12 }}>
                  <span style={{ color: "var(--green)" }}>{meName}</span>
                  <span style={{ color: "var(--gold)" }}> {ch.myPotm} </span>
                  <span style={{ color: "var(--t2)" }}>vs </span>
                  <span style={{ color: "var(--red)" }}>{themName}</span>
                  <span style={{ color: "var(--gold)" }}> {ch.theirPotm}</span>
                </div>
              </div>

              {/* Chemistry verdict pill — same spring as the main verdict */}
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <motion.div
                  key={`chem-${chemV}-${period}`}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.5 }}
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    backdropFilter: "blur(8px)",
                    border: `0.5px solid ${chemSt.border}`,
                    borderRadius: 20, padding: "6px 16px",
                    fontFamily: "var(--font-display)", fontSize: 12,
                    letterSpacing: "0.08em", color: chemSt.color,
                  }}
                >
                  {CHEM_LABEL[chemV]}
                </motion.div>
              </div>
            </motion.div>
          ) : null;

          return <>{sec1}{sec2}{sec3}</>;
        })()}

        {/* ─── Section 4 — OVERALL COMPARISON ────────────────────────────── */}
        {hasData && (() => {
          const meRow   = (modalTableData || []).find(p => p.playerId === me?.id);
          const themRow = (modalTableData || []).find(p => p.playerId === them?.id);
          // Player not in current period modalTableData
          if (!meRow || !themRow) return null;

          const meGoalsPG   = meRow.played   > 0 ? (meRow.goals   / meRow.played).toFixed(2)   : "0.00";
          const themGoalsPG = themRow.played > 0 ? (themRow.goals / themRow.played).toFixed(2) : "0.00";

          function barPct(left, right) {
            const l = parseFloat(left)  || 0;
            const r = parseFloat(right) || 0;
            if (l + r === 0) return 50;
            return Math.round((l / (l + r)) * 100);
          }

          const rows = [
            { label: "Win rate",      leftVal: `${meRow.winRate}%`,   rightVal: `${themRow.winRate}%`,   leftNum: meRow.winRate,   rightNum: themRow.winRate   },
            { label: "Goals per game",leftVal: meGoalsPG,             rightVal: themGoalsPG,             leftNum: parseFloat(meGoalsPG), rightNum: parseFloat(themGoalsPG) },
            { label: "POTM total",    leftVal: meRow.potm,            rightVal: themRow.potm,            leftNum: meRow.potm,      rightNum: themRow.potm      },
            { label: "Reliability",   leftVal: meRow.reliability != null ? `${meRow.reliability}%` : "—", rightVal: themRow.reliability != null ? `${themRow.reliability}%` : "—", leftNum: meRow.reliability || 0, rightNum: themRow.reliability || 0, noBar: meRow.reliability == null || themRow.reliability == null },
          ];

          return (
            <motion.div key={`s4-${period}`} {...sectionMotion(3)} style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--gold)", marginBottom: 16 }}>
                4. OVERALL COMPARISON
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rows.map((row, i) => {
                  const lPct = barPct(row.leftNum, row.rightNum);
                  const rPct = 100 - lPct;
                  // Bars fill in sequence — each row delayed 180ms after the
                  // previous so dominance reveals itself like an awards tally.
                  const barDelay = 0.45 + i * 0.18;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {/* Left value */}
                      <div style={{ width: 50, textAlign: "right", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 500, color: "var(--t1)", flexShrink: 0 }}>
                        {row.leftVal}
                      </div>
                      {/* Left bar — fills right-to-left toward centre */}
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden", display: "flex", justifyContent: "flex-end" }}>
                        {!row.noBar && (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${lPct}%` }}
                            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: barDelay }}
                            style={{ height: "100%", background: "var(--green)", borderRadius: 4 }}
                          />
                        )}
                      </div>
                      {/* Centre label */}
                      <div style={{ width: 100, flexShrink: 0, textAlign: "center", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, color: "var(--t2)" }}>
                        {row.label}
                      </div>
                      {/* Right bar — fills left-to-right outward */}
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
                        {!row.noBar && (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${rPct}%` }}
                            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: barDelay }}
                            style={{ height: "100%", background: "var(--red)", borderRadius: 4 }}
                          />
                        )}
                      </div>
                      {/* Right value */}
                      <div style={{ width: 50, textAlign: "left", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 500, color: "var(--t1)", flexShrink: 0 }}>
                        {row.rightVal}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })()}

        {/* ─── Section 5 — RECENT SHARED MATCHES ──────────────────────────── */}
        {hasData && h2hData.recentShared.length > 0 && (() => {
          function fmtDate(iso) {
            if (!iso) return "—";
            const d = new Date(iso);
            return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
          }
          const RESULT_COLOR = { w: "var(--green)", d: "var(--amber)", l: "var(--red)" };

          return (
            <motion.div key={`s5-${period}`} {...sectionMotion(4)} style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--gold)", marginBottom: 12 }}>
                5. RECENT SHARED MATCHES
              </div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}>
                {h2hData.recentShared.map((r, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 20, scale: 0.9 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.55 + i * 0.07 }}
                    style={{ width: 120, flexShrink: 0, background: "var(--s3)", borderRadius: 8, padding: 10, textAlign: "center" }}
                  >
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, color: "var(--t2)" }}>
                      {fmtDate(r.matchDate)}
                    </div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--t1)", marginTop: 4, letterSpacing: "0.04em" }}>
                      {r.scoreA != null && r.scoreB != null ? `${r.scoreA}-${r.scoreB}` : "—"}
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, marginTop: 6, color: r.type === "together" ? "var(--green)" : "var(--red)" }}>
                      {r.type === "together" ? "👥 Together" : "⚔️ Opposed"}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: "50%",
                        background: RESULT_COLOR[r.myResult] || "var(--s3)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--font-display)", fontSize: 10, color: "var(--bg)",
                      }}>
                        {(r.myResult || "").toUpperCase()}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          );
        })()}

        {/* ─── Section 6 — WHO WORKS HARDER (match fitness) ────────────────── */}
        {/* Self-hides unless I have match-fitness across games we've both played. Distance/Calories
            are effort dominance bars (more = harder); Avg HR is informational only — never a winner
            (LOCKED DEC #5: HR is a hedged trend, not a per-comparison verdict). */}
        {fitData?.me?.games > 0 && (() => {
          const meF = fitData.me;
          const themF = fitData.them;      // null when the opponent isn't sharing
          const consented = !!themF;

          function barPct(l, r) {
            const a = Number(l) || 0, b = Number(r) || 0;
            if (a + b === 0) return 50;
            return Math.round((a / (a + b)) * 100);
          }

          const rows = [
            { label: "Distance", leftVal: formatDistance(meF.total_distance_m), rightVal: consented ? formatDistance(themF.total_distance_m) : "—", leftNum: meF.total_distance_m, rightNum: consented ? themF.total_distance_m : 0, noBar: !consented },
            { label: "Calories", leftVal: String(meF.total_kcal || 0),          rightVal: consented ? String(themF.total_kcal || 0) : "—",         leftNum: meF.total_kcal,      rightNum: consented ? themF.total_kcal : 0,      noBar: !consented },
            { label: "Avg HR",   leftVal: meF.avg_hr ? String(meF.avg_hr) : "—", rightVal: consented && themF.avg_hr ? String(themF.avg_hr) : "—",  leftNum: 0,                   rightNum: 0,                                     noBar: true },
          ];

          return (
            <motion.div key={`s6-${period}`} {...sectionMotion(5)} style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: consented ? 16 : 10 }}>
                <Lightning size={16} weight="thin" color="var(--gold)" />
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--gold)" }}>
                  6. WHO WORKS HARDER
                </div>
              </div>
              {!consented && (
                <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 300, color: "var(--t2)", marginBottom: 14 }}>
                  {(them?.name || "They")}&rsquo;s not sharing their match fitness yet — turn on sharing to compare.
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rows.map((row, i) => {
                  const lPct = barPct(row.leftNum, row.rightNum);
                  const rPct = 100 - lPct;
                  const barDelay = 0.3 + i * 0.15;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 50, textAlign: "right", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 500, color: "var(--t1)", flexShrink: 0 }}>{row.leftVal}</div>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden", display: "flex", justifyContent: "flex-end" }}>
                        {!row.noBar && (
                          <motion.div initial={{ width: 0 }} animate={{ width: `${lPct}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: barDelay }} style={{ height: "100%", background: "var(--green)", borderRadius: 4 }} />
                        )}
                      </div>
                      <div style={{ width: 100, flexShrink: 0, textAlign: "center", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, color: "var(--t2)" }}>{row.label}</div>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
                        {!row.noBar && (
                          <motion.div initial={{ width: 0 }} animate={{ width: `${rPct}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: barDelay }} style={{ height: "100%", background: "var(--red)", borderRadius: 4 }} />
                        )}
                      </div>
                      <div style={{ width: 50, textAlign: "left", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 500, color: "var(--t1)", flexShrink: 0 }}>{row.rightVal}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, color: "var(--t2)", marginTop: 12, textAlign: "center" }}>
                Casual games you&rsquo;ve both played{fitData.shared_games ? ` · ${fitData.shared_games} shared` : ""}. Avg HR is shown for context, not ranked.
              </div>
            </motion.div>
          );
        })()}

      </div>
    </motion.div>
  );
}
