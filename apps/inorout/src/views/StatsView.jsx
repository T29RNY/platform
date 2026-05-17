import { useState, useEffect } from "react";
import { /* biggestWins, */ payRate, getPlayerLeagueTable } from "@platform/core";
import {
  SoccerBall, Star, CalendarCheck, /* Hourglass, */ Trophy, CaretRight,
} from "@phosphor-icons/react";
import PlayerLeagueTable from "./PlayerLeagueTable.jsx";
import HeadToHead        from "./HeadToHead.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

// Team-level: longest run of decisive results (winner !== "D")
function calcLongestDecisive(played) {
  let max = 0, cur = 0;
  for (const m of played) {
    if (m.winner && m.winner !== "D") { cur++; max = Math.max(max, cur); }
    else cur = 0;
  }
  return max;
}

// Team-level: longest run of any result (W or D — never "lost" as a squad)
function calcLongestUnbeaten(played) {
  let max = 0, cur = 0;
  for (const m of played) {
    if (m.winner) { cur++; max = Math.max(max, cur); }
    else cur = 0;
  }
  return max;
}


// ── LockedCard ────────────────────────────────────────────────────────────────

function LockedCard({ statName, gamesNeeded, gamesPlayed }) {
  const n = gamesNeeded - gamesPlayed;
  return (
    <div style={{
      clipPath: "polygon(0% 8%, 8% 0%, 92% 0%, 100% 8%, 100% 100%, 0% 100%)",
      background: "linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(10,10,8,0.8) 100%)",
      border: "0.5px solid rgba(255,255,255,0.1)",
      padding: "20px 16px 16px",
      minHeight: 100,
      position: "relative",
      boxShadow: "0 0 12px rgba(232,160,32,0.06)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <svg width="28" height="32" viewBox="0 0 32 32" fill="none">
        <path
          d="M 16 2 L 30 7 L 30 18 C 30 25 16 30 16 30 C 16 30 2 25 2 18 L 2 7 Z"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1.5"
        />
      </svg>
      <div style={{ fontSize: 11, fontWeight: 400, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--t2)", textAlign: "center", marginTop: 8 }}>
        {statName}
      </div>
      <div style={{ fontSize: 12, fontWeight: 300, color: "var(--t2)", textAlign: "center", marginTop: 4 }}>
        Play {n} more {n === 1 ? "game" : "games"} to unlock
      </div>
    </div>
  );
}

// ── Season hero card ──────────────────────────────────────────────────────────

const HERO_IMG = "/io-statbook-hero.png";

function SeasonHeroCard({ groupName, totalGames, avgGoals }) {
  const textShadow = "0 0 20px rgba(0,0,0,0.9)";
  return (
    <div style={{ position: "relative", borderRadius: "var(--r)", overflow: "hidden", marginBottom: 8, height: 104 }}>
      <img
        src={HERO_IMG}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.6) saturate(0.9)" }}
      />
      <div style={{ position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(10,10,8,0.2) 0%, rgba(10,10,8,0.65) 100%)" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          {groupName && (
            <div style={{ fontSize: 10, fontWeight: 300, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "var(--gold)", marginBottom: 2, textShadow }}>
              {groupName}
            </div>
          )}
          <div style={{ fontFamily: "var(--font-display)", fontSize: 32, lineHeight: 1,
            letterSpacing: "0.04em", fontStyle: "italic", textShadow }}>
            <span style={{ color: "var(--green)" }}>I</span>
            <span style={{ color: "var(--red)" }}>O</span>
            <span style={{ color: "var(--t1)" }}> STATBOOK</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1,
            color: "var(--t1)", textShadow }}>{totalGames}</div>
          <div style={{ fontSize: 10, color: "var(--t2)", fontWeight: 300, textShadow }}>games played</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1,
            color: "var(--gold)", marginTop: 4, textShadow }}>{avgGoals}</div>
          <div style={{ fontSize: 10, color: "var(--t2)", fontWeight: 300, textShadow }}>avg goals/game</div>
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const SecLabel = ({ icon: Icon, emoji, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0 10px" }}>
    {Icon  && <Icon size={13} weight="thin" color="var(--t2)" style={{ flexShrink: 0 }} />}
    {emoji && <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>}
    <span style={{ fontSize: 10, fontWeight: 400, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--t2)", flexShrink: 0 }}>
      {label}
    </span>
    <div style={{ flex: 1, height: "0.5px", background: "var(--b2)" }} />
  </div>
);

const LeaderCard = ({ icon: Icon, emoji, label, children }) => (
  <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", overflow: "hidden", marginBottom: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "12px 14px", borderBottom: "0.5px solid var(--b2)" }}>
      {Icon  && <Icon size={14} weight="thin" color="var(--t2)" />}
      {emoji && <span style={{ fontSize: 14, lineHeight: 1 }}>{emoji}</span>}
      <span style={{ fontSize: 10, fontWeight: 400, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--t2)" }}>{label}</span>
    </div>
    {children}
  </div>
);

const RANK_C = ["var(--gold)", "rgba(192,192,192,0.9)", "rgba(205,127,50,0.9)"];

const LeaderRow = ({ rank, name, value, bar, maxBar, barColor, sub, isLast }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: isLast ? "none" : "0.5px solid var(--b2)" }}>
    <div style={{ width: 18, fontSize: 11, fontWeight: 700, color: rank <= 3 ? RANK_C[rank - 1] : "var(--t2)", flexShrink: 0, textAlign: "center" }}>
      {rank}
    </div>
    <div style={{
      width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 9, fontWeight: 600, flexShrink: 0,
      background: "var(--green2)", border: "0.5px solid var(--greenb)", color: "var(--green)",
    }}>
      {initials(name)}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 400, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--t2)", fontWeight: 300, marginTop: 1 }}>{sub}</div>}
    </div>
    <div style={{ width: 56, height: 4, background: "var(--s3)", borderRadius: 2, flexShrink: 0 }}>
      <div style={{ height: "100%", borderRadius: 2, background: barColor, width: `${maxBar > 0 ? Math.min(100, (bar / maxBar) * 100) : 0}%` }} />
    </div>
    <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: barColor, minWidth: 28, textAlign: "right", flexShrink: 0 }}>
      {value}
    </div>
  </div>
);

const InsightTile = ({ label, value, valueFontSize = 32, valueColor, sub }) => (
  <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--rs)", padding: "12px 14px" }}>
    <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--t2)", marginBottom: 4 }}>{label}</div>
    <div style={{ fontFamily: "var(--font-display)", fontSize: valueFontSize, lineHeight: 1, color: valueColor || "var(--t1)" }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: "var(--t2)", fontWeight: 300, marginTop: 4 }}>{sub}</div>}
  </div>
);

const RecordTile = ({ label, value, sub, color }) => (
  <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--rs)", padding: "12px 14px" }}>
    <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--t2)", marginBottom: 6 }}>{label}</div>
    <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1, color: color || "var(--t1)" }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: "var(--t2)", fontWeight: 300, marginTop: 4 }}>{sub}</div>}
  </div>
);

const DOT_C = { w: "var(--green)", l: "var(--red)", d: "var(--amber)" };

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsView({ teamId, squad, bibHistory = [], matchHistory = [], settings, schedule, myId }) {
  const [showPlayerForm,     setShowPlayerForm]     = useState(false);
  const [period,             setPeriod]             = useState("season");
  const [tableData,          setTableData]          = useState([]);
  const [totalGamesInPeriod, setTotalGamesInPeriod] = useState(0);
  const [tableLoading,       setTableLoading]       = useState(true);
  const [h2hPlayer,          setH2hPlayer]          = useState(null);

  useEffect(() => {
    if (!teamId) return;
    setTableLoading(true);
    getPlayerLeagueTable(teamId, period)
      .then(({ players, totalGamesInPeriod: n }) => {
        setTableData(players);
        setTotalGamesInPeriod(n);
        setTableLoading(false);
      })
      .catch(e => {
        console.error("getPlayerLeagueTable error:", e);
        setTableLoading(false);
      });
  }, [teamId, period]);

  // const [tab, setTab] = useState("overview"); // restore when Records tab is re-enabled

  // ── Match data (period-filtered) ──────────────────────────────────────────
  const allMatches = matchHistory || [];
  const now        = new Date();
  const periodCutoff = period === "month"
    ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
    : period === "season"
    ? `${now.getFullYear()}-01-01`
    : null;

  const periodMatches  = periodCutoff
    ? allMatches.filter(m => (m.matchDate || "") >= periodCutoff)
    : allMatches;

  const cancelledCount = periodMatches.filter(m => m.cancelled).length;
  const totalAll       = periodMatches.length;

  const played = periodMatches
    .filter(m => !m.cancelled)
    .sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate));

  const totalGames  = played.length;
  const totalGoals  = played.reduce((s, m) => s + (m.scoreA || 0) + (m.scoreB || 0), 0);
  const avgGoals    = totalGames > 0 ? (totalGoals / totalGames).toFixed(1) : "—";
  const cancRate    = totalAll > 0 ? Math.round(cancelledCount / totalAll * 100) : 0;
  const tightGames  = played.filter(m => Math.abs((m.scoreA || 0) - (m.scoreB || 0)) === 1).length;
  const teamAWins   = played.filter(m => m.winner === "A").length;
  const teamBWins   = played.filter(m => m.winner === "B").length;
  const teamAPct    = totalGames > 0 ? Math.round(teamAWins / totalGames * 100) : 0;
  const teamBPct    = totalGames > 0 ? Math.round(teamBWins / totalGames * 100) : 0;

  // const longestDecisive = calcLongestDecisive(played); // Records tab
  // const longestUnbeaten = calcLongestUnbeaten(played); // Records tab

  // ── Player data ────────────────────────────────────────────────────────────
  const allPlayers    = (squad || []).filter(p => !p.disabled);
  const active        = allPlayers.filter(p => !p.isGuest);
  // The Core — always current squad composition, not period-filtered
  const regularsCount = active.length;
  const guestsCount   = allPlayers.filter(p => p.isGuest).length;

  // Top scorers — player_match derived (period-filtered)
  const topScorers = tableData
    .filter(p => p.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, 5);

  // Clinical: goals per game, min 3 games played
  const clinical = tableData
    .filter(p => p.played >= 3 && p.goals > 0)
    .map(p => ({ ...p, gpg: p.goals / p.played }))
    .sort((a, b) => b.gpg - a.gpg)
    .slice(0, 5);

  // POTM Awards
  const topMotm = tableData
    .filter(p => p.potm > 0)
    .sort((a, b) => b.potm - a.potm)
    .slice(0, 3);

  // Win rate (min 3 games played)
  const withGames3 = tableData.filter(p => p.played >= 3);
  const winLeaders = [...withGames3].sort((a, b) => b.winRate - a.winRate).slice(0, 5);
  const relegation = [...withGames3].sort((a, b) => a.winRate - b.winRate).slice(0, 5);

  // Attendance
  const topAttend = tableData
    .filter(p => p.played > 0)
    .map(p => ({ ...p, attPct: totalGamesInPeriod > 0 ? Math.round(p.played / totalGamesInPeriod * 100) : 0 }))
    .sort((a, b) => b.attPct - a.attPct)
    .slice(0, 5);

  // Bib duty
  const topBibs = tableData
    .filter(p => p.bibCount > 0)
    .sort((a, b) => b.bibCount - a.bibCount)
    .slice(0, 5);

  // Late dropouts — Records tab only
  // const topLate = [...active]
  //   .filter(p => (p.lateDropouts || 0) > 0)
  //   .sort((a, b) => (b.lateDropouts || 0) - (a.lateDropouts || 0))
  //   .slice(0, 3);

  // Payment reliability
  const payers         = active.filter(p => (p.total || 0) > 0);
  const avgReliability = payers.length > 0
    ? Math.round(payers.reduce((s, p) => s + payRate(p), 0) / payers.length) : 0;
  const alwaysPays  = payers.filter(p => payRate(p) >= 90).length;
  const usuallyPays = payers.filter(p => payRate(p) >= 50 && payRate(p) < 90).length;
  const owesMoney   = payers.filter(p => payRate(p) < 50).length;

  // Most Consistent: using goals/played ratio as proxy
  const topConsistent = tableData
    .filter(p => p.goals > 0 && p.played >= 3)
    .sort((a, b) => (b.goals / b.played) - (a.goals / a.played))[0] || null;

  // Records tab data — restore when re-enabling Records tab
  // const byKey          = key => [...active].sort((a, b) => (b[key] || 0) - (a[key] || 0));
  // const topGoalScorer  = byKey("goals")[0];
  // const mostMotm       = byKey("motm")[0];
  // const mostAttended   = byKey("attended")[0];
  // const bibKing        = byKey("bibCount")[0];
  // const mostGoalsGame  = played.reduce((max, m) => Math.max(max, (m.scoreA || 0) + (m.scoreB || 0)), 0);
  // const bigWin         = biggestWins(matchHistory)[0];

  // Player form
  const formPlayers = [...tableData].sort((a, b) => b.played - a.played);

  const groupName = settings?.groupName || "";

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--t1)", fontFamily: "var(--font-body)" }}>

      {/* ── Season hero (sticky) ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--bg)", padding: "0 16px" }}>
        <SeasonHeroCard groupName={groupName} totalGames={totalGames} avgGoals={avgGoals} />
      </div>

      <div style={{ padding: "0 16px 110px" }}>

        {/* ── Tabs pill — hidden until Records tab is restored ── */}
        {/* <div style={{ position: "sticky", top: 0, zIndex: 50, background: "var(--bg)",
          padding: "10px 16px", borderBottom: "0.5px solid var(--b2)", marginBottom: 6 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[["overview", "Overview"], ["records", "Records"]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: "7px 18px", borderRadius: "var(--r-pill)",
                border: `0.5px solid ${tab === id ? "var(--greenb)" : "var(--border-subtle)"}`,
                background: tab === id ? "var(--green2)" : "transparent",
                color: tab === id ? "var(--green)" : "var(--t2)",
                fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 500,
                cursor: "pointer", transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>
        </div> */}

        {/* ── Empty state ── */}
        {totalGames === 0 && (
          <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "32px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⚽</div>
            <div style={{ fontSize: 16, fontWeight: 400, color: "var(--t1)", marginBottom: 6 }}>No games recorded yet</div>
            <div style={{ fontSize: 12, fontWeight: 300, color: "var(--t2)" }}>Stats appear after your first result is saved</div>
          </div>
        )}

        {/* ════════════════════════════ OVERVIEW ════════════════════════════ */}
        {totalGames > 0 && (
          <>
            {/* 0. Player League Table */}
            <PlayerLeagueTable
              data={tableData}
              loading={tableLoading}
              period={period}
              onPeriodChange={setPeriod}
              squad={squad}
              bibHistory={bibHistory}
              myId={myId}
              onPlayerTap={(p) => {
                const them = squad.find(s => s.id === p.playerId);
                if (them) setH2hPlayer(them);
              }}
            />

            {/* 1. Player Form (accordion) */}
            <button onClick={() => setShowPlayerForm(v => !v)} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", background: "none", border: "none", cursor: "pointer",
              padding: "2px 0 8px", WebkitTapHighlightColor: "transparent",
            }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 13,
                letterSpacing: "0.08em", color: "var(--t2)" }}>
                PLAYER FORM
              </span>
              <CaretRight size={14} weight="thin" color="var(--t2)"
                style={{ transform: showPlayerForm ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
            </button>
            {showPlayerForm && (
            <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", overflow: "hidden", marginBottom: 8 }}>
              {formPlayers.length === 0 ? (
                <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--t2)", fontWeight: 300 }}>No player data yet</div>
              ) : formPlayers.map((p, i) => {
                const form = (p.form || []).map(r => r.toLowerCase());
                return (
                  <div key={p.playerId} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderBottom: i < formPlayers.length - 1 ? "0.5px solid var(--b2)" : "none",
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 600,
                      background: "var(--green2)", border: "0.5px solid var(--greenb)", color: "var(--green)",
                    }}>
                      {initials(p.nickname || p.name)}
                    </div>
                    {/* Name */}
                    <div style={{ fontSize: 13, fontWeight: 400, color: "var(--t1)", minWidth: 50, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.nickname || p.name}
                    </div>
                    {/* Form dots */}
                    <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "center" }}>
                      {form.length === 0
                        ? <span style={{ fontSize: 11, color: "var(--t2)" }}>—</span>
                        : form.map((r, j) => (
                          <span key={j} style={{
                            width: 8, height: 8, borderRadius: "50%", display: "inline-block",
                            background: DOT_C[r], boxShadow: `0 0 4px ${DOT_C[r]}80`,
                          }} />
                        ))
                      }
                    </div>
                    {/* Right: W/L/D totals */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--green)", lineHeight: 1 }}>W{p.wins || 0}</span>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--red)", lineHeight: 1 }}>L{p.losses || 0}</span>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--amber)", lineHeight: 1 }}>D{p.draws || 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            )}

            {/* 2. Top Scorers */}
            <SecLabel icon={SoccerBall} label="Top Scorers" />
            {topScorers.length > 0 ? (
              <LeaderCard icon={SoccerBall} label="Goals">
                {topScorers.map((p, i) => (
                  <LeaderRow
                    key={p.playerId} rank={i + 1} name={p.nickname || p.name}
                    value={p.goals}
                    bar={p.goals} maxBar={topScorers[0].goals || 1}
                    barColor="var(--green)"
                    sub={`${p.goals} goals in ${p.played} games`}
                    isLast={i === topScorers.length - 1}
                  />
                ))}
              </LeaderCard>
            ) : (
              <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "16px 14px", marginBottom: 8, fontSize: 12, color: "var(--t2)", fontWeight: 300 }}>
                No goals recorded yet
              </div>
            )}

            {/* 3. Clinical */}
            <SecLabel label="Clinical" />
            {totalGamesInPeriod >= 2 ? (
              clinical.length > 0 ? (
                <LeaderCard label="Goals Per Game">
                  {clinical.map((p, i) => (
                    <LeaderRow
                      key={p.playerId} rank={i + 1} name={p.nickname || p.name}
                      value={p.gpg.toFixed(2)}
                      bar={p.gpg} maxBar={clinical[0].gpg || 1}
                      barColor="var(--gold)"
                      sub="goals per game"
                      isLast={i === clinical.length - 1}
                    />
                  ))}
                </LeaderCard>
              ) : (
                <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "16px 14px", marginBottom: 8, fontSize: 12, color: "var(--t2)", fontWeight: 300 }}>
                  Need goal data to calculate
                </div>
              )
            ) : (
              <div style={{ marginBottom: 8 }}>
                <LockedCard statName="Clinical" gamesNeeded={2} gamesPlayed={totalGamesInPeriod} />
              </div>
            )}

            {/* 4. MOTM Kings */}
            <SecLabel icon={Star} label="Player of the Match" />
            {topMotm.length > 0 ? (
              <LeaderCard icon={Star} label="POTM Awards">
                {topMotm.map((p, i) => {
                  const every = p.played > 0 ? Math.round(p.played / (p.potm || 1)) : 0;
                  return (
                    <LeaderRow
                      key={p.playerId} rank={i + 1} name={p.nickname || p.name}
                      value={p.potm}
                      bar={p.potm} maxBar={topMotm[0].potm || 1}
                      barColor="var(--gold)"
                      sub={every > 0 ? `1 in every ${every} games` : undefined}
                      isLast={i === topMotm.length - 1}
                    />
                  );
                })}
              </LeaderCard>
            ) : (
              <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "16px 14px", marginBottom: 8, fontSize: 12, color: "var(--t2)", fontWeight: 300 }}>
                No POTM awarded yet
              </div>
            )}

            {/* 5. Win % Leaders */}
            <SecLabel icon={Trophy} label="Winners" />
            {totalGamesInPeriod >= 4 ? (
              winLeaders.length > 0 ? (
                <LeaderCard icon={Trophy} label="Win Rate">
                  {winLeaders.map((p, i) => (
                    <LeaderRow
                      key={p.playerId} rank={i + 1} name={p.nickname || p.name}
                      value={`${p.winRate}%`}
                      bar={p.winRate} maxBar={100}
                      barColor="var(--green)"
                      sub={`${p.wins} wins from ${p.played} games`}
                      isLast={i === winLeaders.length - 1}
                    />
                  ))}
                </LeaderCard>
              ) : (
                <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "16px 14px", marginBottom: 8, fontSize: 12, color: "var(--t2)", fontWeight: 300 }}>
                  Need more player game data
                </div>
              )
            ) : (
              <div style={{ marginBottom: 8 }}>
                <LockedCard statName="Win % Leaders" gamesNeeded={4} gamesPlayed={totalGamesInPeriod} />
              </div>
            )}

            {/* 6. Relegation Zone */}
            <SecLabel label="Relegation Zone" />
            {totalGamesInPeriod >= 4 ? (
              relegation.length > 0 && (
                <LeaderCard label="Lowest Win Rate">
                  {relegation.map((p, i) => (
                    <LeaderRow
                      key={p.playerId} rank={i + 1} name={p.nickname || p.name}
                      value={`${p.winRate}%`}
                      bar={100 - p.winRate} maxBar={100}
                      barColor="var(--red)"
                      sub={`${p.wins} wins from ${p.played} games`}
                      isLast={i === relegation.length - 1}
                    />
                  ))}
                </LeaderCard>
              )
            ) : (
              <div style={{ marginBottom: 8 }}>
                <LockedCard statName="Relegation Zone" gamesNeeded={4} gamesPlayed={totalGamesInPeriod} />
              </div>
            )}

            {/* 7. Never Miss — Attendance */}
            <SecLabel icon={CalendarCheck} label="Never Miss" />
            {topAttend.length > 0 && (
              <LeaderCard icon={CalendarCheck} label="Attendance">
                {topAttend.map((p, i) => (
                  <LeaderRow
                    key={p.playerId} rank={i + 1} name={p.nickname || p.name}
                    value={`${p.attPct}%`}
                    bar={p.attPct} maxBar={100}
                    barColor={p.attPct >= 80 ? "var(--green)" : p.attPct >= 60 ? "var(--amber)" : "var(--red)"}
                    sub={`${p.played} of ${totalGamesInPeriod} games`}
                    isLast={i === topAttend.length - 1}
                  />
                ))}
              </LeaderCard>
            )}

            {/* 8. Insight Tiles */}
            <SecLabel label="This Season" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>

              {/* Cancellation Rate — 1+ */}
              <InsightTile
                label="Cancelled"
                value={`${cancRate}%`}
                valueColor="var(--red)"
                sub={`${cancelledCount} of ${totalAll} games`}
              />

              {/* Avg Goals — 1+ */}
              <InsightTile
                label="Avg Goals"
                value={avgGoals}
                valueColor="var(--gold)"
                sub="per game"
              />

              {/* Tight Games — 3+ */}
              {totalGames >= 3
                ? <InsightTile label="Thrillers" value={tightGames} valueColor="var(--green)" sub="decided by 1 goal" />
                : <LockedCard statName="Thrillers" gamesNeeded={3} gamesPlayed={totalGames} />
              }

              {/* Team A vs B — 4+ */}
              {totalGames >= 4
                ? (
                  <InsightTile
                    label="Team A vs Team B"
                    value={`${teamAWins}–${teamBWins}`}
                    valueFontSize={28}
                    sub={`Team A ${teamAPct}% · Team B ${teamBPct}%`}
                  />
                ) : (
                  <LockedCard statName="Team A vs B" gamesNeeded={4} gamesPlayed={totalGames} />
                )
              }

              {/* Regulars vs Guests — 1+ */}
              <InsightTile
                label="The Core"
                value={regularsCount}
                sub={`${guestsCount} guest${guestsCount !== 1 ? "s" : ""} have played`}
              />

              {/* Most Consistent Scorer — 1+ */}
              {topConsistent ? (
                <InsightTile
                  label="Most Consistent"
                  value={(topConsistent.nickname || topConsistent.name).split(" ")[0]}
                  valueFontSize={24}
                  valueColor="var(--gold)"
                  sub={`${topConsistent.goals} goals in ${topConsistent.played} games`}
                />
              ) : (
                <InsightTile label="Most Consistent" value="—" sub="No goals yet" />
              )}

            </div>

            {/* 9. Bib Duty */}
            <SecLabel emoji="🟡" label="Bib Duty" />
            {topBibs.length > 0 ? (
              <LeaderCard emoji="🟡" label="Times Taken Bibs">
                {topBibs.map((p, i) => (
                  <LeaderRow
                    key={p.playerId} rank={i + 1} name={p.nickname || p.name}
                    value={`${p.bibCount}×`}
                    bar={p.bibCount} maxBar={topBibs[0].bibCount || 1}
                    barColor="var(--amber)"
                    isLast={i === topBibs.length - 1}
                  />
                ))}
              </LeaderCard>
            ) : (
              <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", padding: "16px 14px", marginBottom: 8, fontSize: 12, color: "var(--t2)", fontWeight: 300 }}>
                No bib data recorded
              </div>
            )}

            {/* 10. Payment Reliability */}
            <SecLabel label="Payment Reliability" />
            {payers.length > 0 && (
              <div style={{ background: "var(--s1)", border: "0.5px solid var(--border-subtle)", borderRadius: "var(--r)", overflow: "hidden", marginBottom: 8 }}>
                <div style={{ padding: "14px 16px", borderBottom: "0.5px solid var(--b2)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 10, fontWeight: 400, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--t2)" }}>Group Average</div>
                    <div style={{
                      padding: "3px 10px", borderRadius: "var(--r-pill)", fontSize: 10, fontWeight: 500,
                      background: avgReliability >= 80 ? "var(--green2)" : "var(--amber2)",
                      border: `0.5px solid ${avgReliability >= 80 ? "var(--greenb)" : "var(--amberb)"}`,
                      color: avgReliability >= 80 ? "var(--green)" : "var(--amber)",
                    }}>
                      {avgReliability >= 80 ? "Solid Group" : "Needs Work"}
                    </div>
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 32, lineHeight: 1, color: "var(--t1)", marginTop: 6 }}>{avgReliability}%</div>
                  <div style={{ fontSize: 10, fontWeight: 300, color: "var(--t2)", marginTop: 2 }}>group average</div>
                </div>
                {[
                  { label: "Always pays",  count: alwaysPays,  color: "var(--green)" },
                  { label: "Usually pays", count: usuallyPays, color: "var(--amber)" },
                  { label: "Owes money",   count: owesMoney,   color: "var(--red)"   },
                ].map(({ label, count, color }, i, arr) => (
                  <div key={label} style={{
                    padding: "10px 16px", borderBottom: i < arr.length - 1 ? "0.5px solid var(--b2)" : "none",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 400, color: "var(--t1)", minWidth: 100 }}>{label}</div>
                    <div style={{ flex: 1, height: 4, background: "var(--s3)", borderRadius: 2 }}>
                      <div style={{ height: "100%", borderRadius: 2, background: color, width: `${payers.length > 0 ? (count / payers.length) * 100 : 0}%` }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color, minWidth: 20, textAlign: "right" }}>{count}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════ RECORDS (hidden) ═══════════════════ */}
        {/* Restore: uncomment below + re-enable tab state, tab pill, Records data vars, biggestWins/Hourglass imports */}
        {/* {tab === "records" && (
          <>
            {totalGames < 5 ? (
              <div style={{ marginTop: 8 }}>
                <LockedCard statName="All-Time Records" gamesNeeded={5} gamesPlayed={totalGames} />
              </div>
            ) : (
              <>
                <SecLabel label="All-Time Records" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                  <RecordTile label="Most Goals · Game" value={mostGoalsGame > 0 ? mostGoalsGame : "—"}
                    sub={mostGoalsGame > 0 ? "total in one game" : "No data yet"} color="var(--gold)" />
                  <RecordTile label="Biggest Win" value={bigWin ? `${bigWin.scoreA}–${bigWin.scoreB}` : "—"}
                    sub={bigWin ? `${bigWin.diff} goal margin` : "No data yet"} color="var(--green)" />
                  <RecordTile label="Win Streak" value={longestDecisive > 0 ? longestDecisive : "—"}
                    sub={longestDecisive > 0 ? "decisive in a row" : "No streak yet"} color="var(--green)" />
                  <RecordTile label="Unbeaten Run" value={longestUnbeaten > 0 ? longestUnbeaten : "—"}
                    sub={longestUnbeaten > 0 ? "games unbeaten" : "No data yet"} color="var(--amber)" />
                  <RecordTile label="Top Scorer" value={topGoalScorer?.goals > 0 ? topGoalScorer.name.split(" ")[0] : "—"}
                    sub={topGoalScorer?.goals > 0 ? `${topGoalScorer.goals} goals` : "No data yet"} color="var(--gold)" />
                  <RecordTile label="Most POTM" value={mostMotm?.motm > 0 ? mostMotm.name.split(" ")[0] : "—"}
                    sub={mostMotm?.motm > 0 ? `${mostMotm.motm} awards` : "No data yet"} color="var(--gold)" />
                  <RecordTile label="Never Missed" value={mostAttended?.attended > 0 ? mostAttended.name.split(" ")[0] : "—"}
                    sub={mostAttended?.attended > 0 ? `${mostAttended.attended} games` : "No data yet"} color="var(--green)" />
                  <RecordTile label="Bib King" value={bibKing?.bibCount > 0 ? bibKing.name.split(" ")[0] : "—"}
                    sub={bibKing?.bibCount > 0 ? `${bibKing.bibCount} times` : "No data yet"} color="var(--amber)" />
                </div>
                {topLate.length > 0 && (
                  <>
                    <SecLabel icon={Hourglass} label="Late Dropouts" />
                    <LeaderCard icon={Hourglass} label="Late Cancellations">
                      {topLate.map((p, i) => (
                        <LeaderRow key={p.id} rank={i + 1} name={p.name}
                          value={p.lateDropouts || 0}
                          bar={p.lateDropouts || 0} maxBar={topLate[0].lateDropouts || 1}
                          barColor="var(--red)" isLast={i === topLate.length - 1} />
                      ))}
                    </LeaderCard>
                  </>
                )}
                <SecLabel label="Streaks" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                  <div style={{ background: "var(--green2)", border: "0.5px solid var(--greenb)", borderRadius: "var(--rs)", padding: 14, boxShadow: "0 0 12px rgba(61,220,106,0.08)" }}>
                    <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--t2)", marginBottom: 6 }}>Win Streak</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 36, lineHeight: 1, color: "var(--green)" }}>{longestDecisive}</div>
                    <div style={{ fontSize: 10, color: "var(--t2)", fontWeight: 300, marginTop: 4 }}>decisive in a row</div>
                  </div>
                  <div style={{ background: "var(--gold2)", border: "0.5px solid var(--goldb)", borderRadius: "var(--rs)", padding: 14, boxShadow: "0 0 12px rgba(232,160,32,0.08)" }}>
                    <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--t2)", marginBottom: 6 }}>Unbeaten Run</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 36, lineHeight: 1, color: "var(--gold)" }}>{longestUnbeaten}</div>
                    <div style={{ fontSize: 10, color: "var(--t2)", fontWeight: 300, marginTop: 4 }}>games unbeaten</div>
                  </div>
                </div>
              </>
            )}
          </>
        )} */}

      </div>

      {h2hPlayer && (() => {
        const me = squad.find(s => s.id === myId);
        if (!me) return null;
        return (
          <HeadToHead
            me={me}
            them={h2hPlayer}
            teamId={teamId}
            tableData={tableData}
            initialPeriod={period}
            onClose={() => setH2hPlayer(null)}
          />
        );
      })()}
    </div>
  );
}
