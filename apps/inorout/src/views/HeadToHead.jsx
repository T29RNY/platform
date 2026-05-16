import { useState, useEffect } from "react";
import { ArrowLeft, UploadSimple, SoccerBall, TShirt, UsersThree, Lightning, Trophy, Star, User } from "@phosphor-icons/react";
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
  console.log('H2H props:', { meId: me?.id, themId: them?.id, teamId });
  const [period,  setPeriod]  = useState("season");
  const [h2hData, setH2hData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!me?.id || !them?.id || !teamId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await getHeadToHead(me.id, them.id, teamId);
      console.log('H2H result:', result);
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
  console.log('H2H state:', { hasData, isEmpty, totalSharedGames: h2hData?.totalSharedGames });

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

        {/* ═══ STAT SECTIONS 1-3 — Part 2 ═══ */}

        {hasData && (() => {
          const t  = h2hData.together;
          const ag = h2hData.against;
          const ch = h2hData.chemistry;
          const meName   = me?.nickname   || me?.name   || "Me";
          const themName = them?.nickname || them?.name || "Them";

          // ── Section 1 — WHEN YOU PLAY TOGETHER ──────────────────────────
          const sec1 = (
            <div key="s1" style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--green)", marginBottom: 12 }}>
                1. WHEN YOU PLAY TOGETHER
              </div>
              {t.games === 0 ? (
                <div style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)", padding: "8px 0" }}>
                  You&apos;ve never been teammates yet.
                </div>
              ) : (
                <>
                  {/* Stat boxes */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    {/* Games together */}
                    <div style={{ flex: 1, minWidth: 0, background: "var(--s3)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--t1)", lineHeight: 1 }}>{t.games}</div>
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
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--t1)", lineHeight: 1 }}>{t.winRate}%</div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, color: "var(--t2)", marginTop: 2 }}>Win rate together</div>
                    </div>
                    {/* Combined goals */}
                    <div style={{ flex: 1, minWidth: 0, background: "var(--s3)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--t1)", lineHeight: 1 }}>{t.combinedGoals}</div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300, color: "var(--t2)", marginTop: 2 }}>Combined goals</div>
                    </div>
                  </div>

                  {/* Goal threat row */}
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
                          <span style={{ color: "var(--t2)" }}> together vs </span>
                          <span style={{ color: "var(--t2)" }}>
                            {t.goalThreatApart != null ? t.goalThreatApart.toFixed(1) : "—"} apart
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "var(--t2)" }}>—</span>
                      )}
                    </span>
                  </div>

                  {/* Bib magnet row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <TShirt size={16} weight="thin" color="var(--t2)" />
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)" }}>Bib magnet</span>
                    </div>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t1)" }}>
                      <span style={{ color: "var(--gold)" }}>{t.bibs}</span>
                      <span style={{ color: "var(--t2)" }}> of {t.games} games</span>
                    </span>
                  </div>
                </>
              )}
            </div>
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
            <div key="s2" style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--red)", marginBottom: 12 }}>
                2. WHEN YOU FACE EACH OTHER
              </div>
              {ag.games === 0 ? (
                <div style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "var(--t2)", padding: "8px 0" }}>
                  You&apos;ve never been on opposite teams yet.
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
                      value: (
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
                        ? <><span style={{ color: "var(--green)" }}>{streakText.winner}</span><span style={{ color: "var(--t1)" }}> has won {streakText.length} in a row</span></>
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
            </div>
          );

          // ── Section 3 — YOU MAKE THEM BETTER ────────────────────────────
          const CHEM_STYLE = {
            good_luck_charm: { border: "var(--goldb)",  color: "var(--gold)" },
            bad_influence:   { border: "var(--redb)",   color: "var(--red)"  },
            no_effect:       { border: "var(--s3)",     color: "var(--t2)"  },
          };
          const CHEM_LABEL = {
            good_luck_charm: "⭐ Good luck charm",
            bad_influence:   "👎 Bad influence",
            no_effect:       "➖ No clear effect",
          };
          const chemV  = h2hData.chemistryVerdict || "no_effect";
          const chemSt = CHEM_STYLE[chemV] || CHEM_STYLE.no_effect;

          const sec3 = h2hData.totalSharedGames >= 3 ? (
            <div key="s3" style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
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

              {/* Chemistry verdict pill */}
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <div style={{
                  background: "rgba(255,255,255,0.08)",
                  backdropFilter: "blur(8px)",
                  border: `0.5px solid ${chemSt.border}`,
                  borderRadius: 20, padding: "6px 16px",
                  fontFamily: "var(--font-display)", fontSize: 12,
                  letterSpacing: "0.08em", color: chemSt.color,
                }}>
                  {CHEM_LABEL[chemV]}
                </div>
              </div>
            </div>
          ) : null;

          return <>{sec1}{sec2}{sec3}</>;
        })()}

        {/* ─── Section 4 — OVERALL COMPARISON ────────────────────────────── */}
        {hasData && (() => {
          const meRow   = (tableData || []).find(p => p.playerId === me?.id);
          const themRow = (tableData || []).find(p => p.playerId === them?.id);
          // Player not in current period tableData
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
            { label: "Reliability",   leftVal: meRow.reliability != null ? `${meRow.reliability}%` : "—", rightVal: themRow.reliability != null ? `${themRow.reliability}%` : "—", leftNum: meRow.reliability || 0, rightNum: themRow.reliability || 0 },
          ];

          return (
            <div style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--gold)", marginBottom: 16 }}>
                4. OVERALL COMPARISON
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rows.map((row, i) => {
                  const lPct = barPct(row.leftNum, row.rightNum);
                  const rPct = 100 - lPct;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {/* Left value */}
                      <div style={{ width: 50, textAlign: "right", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 500, color: "var(--t1)", flexShrink: 0 }}>
                        {row.leftVal}
                      </div>
                      {/* Left bar */}
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
                        <div style={{ width: `${lPct}%`, height: "100%", background: "var(--green)", borderRadius: 4, marginLeft: "auto" }} />
                      </div>
                      {/* Centre label */}
                      <div style={{ width: 100, flexShrink: 0, textAlign: "center", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, color: "var(--t2)" }}>
                        {row.label}
                      </div>
                      {/* Right bar */}
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
                        <div style={{ width: `${rPct}%`, height: "100%", background: "var(--red)", borderRadius: 4 }} />
                      </div>
                      {/* Right value */}
                      <div style={{ width: 50, textAlign: "left", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 500, color: "var(--t1)", flexShrink: 0 }}>
                        {row.rightVal}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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
            <div style={{ background: "var(--s2)", border: "0.5px solid var(--s3)", borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.08em", color: "var(--gold)", marginBottom: 12 }}>
                5. RECENT SHARED MATCHES
              </div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}>
                {h2hData.recentShared.map((r, i) => (
                  <div key={i} style={{ width: 120, flexShrink: 0, background: "var(--s3)", borderRadius: 8, padding: 10, textAlign: "center" }}>
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
                        fontFamily: "var(--font-display)", fontSize: 10, color: "#fff",
                      }}>
                        {(r.myResult || "").toUpperCase()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
