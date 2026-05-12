import { useState } from "react";
import { biggestWins, payRate } from "@platform/core";
import {
  SoccerBall, Star, CalendarCheck, Hourglass, TrendUp,
} from "@phosphor-icons/react";

// ── date parser (text field: "6 May 2026") ────────────────────────────────────
const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseMatchDate(d) {
  if (!d) return new Date(0);
  const [day, mon, year] = d.split(" ");
  return new Date(year, MONTHS[mon] ?? 0, parseInt(day) || 1);
}

function getInitials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

// Current decisive run, longest unbeaten, current draw streak
function teamStreaks(played) {
  let decisive = 0, drawStreak = 0, longestUnbeaten = 0, cur = 0;
  for (const m of played) {
    if (m.winner !== "D") decisive++; else break;
  }
  for (const m of played) {
    if (m.winner === "D") drawStreak++; else break;
  }
  for (const m of played) {
    if (m.winner !== "D") { cur++; longestUnbeaten = Math.max(longestUnbeaten, cur); }
    else cur = 0;
  }
  return { decisive, drawStreak, longestUnbeaten };
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SecLabel = ({ icon: Icon, label }) => (
  <div style={{ display:"flex", alignItems:"center", gap:8, margin:"16px 0 10px" }}>
    {Icon && <Icon size={13} weight="thin" color="var(--t2)" style={{ flexShrink:0 }} />}
    <span style={{ fontSize:10, fontWeight:400, letterSpacing:"0.14em", textTransform:"uppercase", color:"var(--t2)", flexShrink:0 }}>
      {label}
    </span>
    <div style={{ flex:1, height:"0.5px", background:"rgba(255,255,255,0.07)" }} />
  </div>
);

const LeaderCard = ({ icon: Icon, iconLabel, label, children }) => (
  <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)", borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>
    <div style={{ display:"flex", alignItems:"center", gap:7, padding:"12px 14px", borderBottom:"0.5px solid var(--b2)" }}>
      {Icon && <Icon size={14} weight="thin" color="var(--t2)" />}
      {iconLabel && <span style={{ fontSize:14 }}>{iconLabel}</span>}
      <span style={{ fontSize:10, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)" }}>{label}</span>
    </div>
    {children}
  </div>
);

const RANK_COLORS = ["var(--gold)", "#C0C0C0", "#CD7F32"];

const LeaderRow = ({ rank, name, value, bar, maxBar, barColor, sub, isLast }) => (
  <div style={{
    display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
    borderBottom: isLast ? "none" : "0.5px solid var(--b2)",
  }}>
    <div style={{ width:18, fontSize:11, fontWeight:700, color: rank <= 3 ? RANK_COLORS[rank-1] : "var(--t2)", flexShrink:0, textAlign:"center" }}>
      {rank}
    </div>
    <div style={{
      width:32, height:32, borderRadius:"50%",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:9, fontWeight:600, flexShrink:0,
      background:"var(--green2)", border:"0.5px solid var(--greenb)", color:"var(--green)",
    }}>
      {getInitials(name)}
    </div>
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontSize:13, fontWeight:400, color:"var(--t1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
      {sub && <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:1 }}>{sub}</div>}
    </div>
    <div style={{ width:56, height:4, background:"var(--s3)", borderRadius:2, flexShrink:0 }}>
      <div style={{ height:"100%", borderRadius:2, background:barColor, width:`${maxBar > 0 ? Math.min(100, (bar / maxBar) * 100) : 0}%` }} />
    </div>
    <div style={{ fontFamily:"var(--font-display)", fontSize:22, color:barColor, minWidth:28, textAlign:"right", flexShrink:0 }}>
      {value}
    </div>
  </div>
);

const StatTile = ({ label, value, sub, color, bg, border }) => (
  <div style={{ background:bg, border:`0.5px solid ${border}`, borderRadius:"var(--rs)", padding:"12px 14px" }}>
    <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)", marginBottom:4 }}>{label}</div>
    <div style={{ fontFamily:"var(--font-display)", fontSize:28, lineHeight:1, color }}>{value}</div>
    {sub && <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:4 }}>{sub}</div>}
  </div>
);

const RecordTile = ({ label, value, sub, color }) => (
  <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)", padding:"12px 14px" }}>
    <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)", marginBottom:6 }}>{label}</div>
    <div style={{ fontFamily:"var(--font-display)", fontSize:26, lineHeight:1, color }}>{value}</div>
    {sub && <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:4 }}>{sub}</div>}
  </div>
);

// Small semicircle gauge for the season card
const SeasonGauge = ({ played, target }) => {
  const arcLen = 110; // ≈ π × 35
  const offset = arcLen * (1 - Math.min(played / Math.max(target, 1), 1));
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
      <div style={{ position:"relative", width:80, height:52 }}>
        <svg width="80" height="52" viewBox="0 0 80 52" style={{ overflow:"visible" }}>
          <defs>
            <linearGradient id="sg-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="var(--red)"   />
              <stop offset="50%"  stopColor="var(--amber)" />
              <stop offset="100%" stopColor="var(--green)" />
            </linearGradient>
            <filter id="sg-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {/* track */}
          <path d="M 5 48 A 35 35 0 0 1 75 48"
            fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" strokeLinecap="round" />
          {/* fill */}
          <path d="M 5 48 A 35 35 0 0 1 75 48"
            fill="none" stroke="url(#sg-grad)"
            strokeWidth="3" strokeLinecap="round"
            strokeDasharray={arcLen} strokeDashoffset={offset}
            filter="url(#sg-glow)" />
        </svg>
        <div style={{
          position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
          fontFamily:"var(--font-display)", fontSize:28, lineHeight:1,
          color:"var(--t1)", textAlign:"center",
          textShadow:"0 0 12px rgba(232,160,32,0.4)",
        }}>
          {played}
        </div>
      </div>
      <div style={{ fontSize:9, fontWeight:300, color:"var(--t2)", textAlign:"center", marginTop:3, letterSpacing:"0.06em" }}>
        of {target}
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsView({ squad, bibHistory = [], matchHistory = [], settings, schedule }) {
  const [tab, setTab] = useState("overview");

  // Data prep
  const active = squad.filter(p => !p.disabled && !p.isGuest);
  const played = [...matchHistory]
    .filter(m => !m.cancelled && m.winner)
    .sort((a, b) => parseMatchDate(b.date) - parseMatchDate(a.date));

  const totalGames = played.length;
  const decisiveGames = played.filter(m => m.winner !== "D");
  const drawGames     = played.filter(m => m.winner === "D");
  const winRate       = totalGames > 0 ? Math.round(decisiveGames.length / totalGames * 100) : 0;
  const totalGoals    = played.reduce((s, m) => s + (m.scoreA || 0) + (m.scoreB || 0), 0);
  const totalMotm     = active.reduce((s, p) => s + (p.motm || 0), 0);
  const form5         = played.slice(0, 5).map(m => m.winner === "D" ? "d" : "w");
  const winsIn5       = form5.filter(r => r === "w").length;
  const { decisive: currentStreak, drawStreak, longestUnbeaten } = teamStreaks(played);

  // Leaderboards
  const topScorers = [...active].filter(p => (p.goals || 0) > 0)
    .sort((a, b) => (b.goals || 0) - (a.goals || 0)).slice(0, 5);
  const topMotm = [...active].filter(p => (p.motm || 0) > 0)
    .sort((a, b) => (b.motm || 0) - (a.motm || 0)).slice(0, 3);
  const topAttend = [...active].filter(p => p.total > 0)
    .sort((a, b) => (b.attended / Math.max(b.total, 1)) - (a.attended / Math.max(a.total, 1))).slice(0, 5);
  const topBibs = [...active].filter(p => (p.bibCount || 0) > 0)
    .sort((a, b) => (b.bibCount || 0) - (a.bibCount || 0)).slice(0, 3);
  const topLate = [...active].filter(p => (p.lateDropouts || 0) > 0)
    .sort((a, b) => (b.lateDropouts || 0) - (a.lateDropouts || 0)).slice(0, 3);

  // Payment reliability
  const payers = active.filter(p => p.total > 0);
  const avgReliability = payers.length > 0
    ? Math.round(payers.reduce((s, p) => s + payRate(p), 0) / payers.length) : 0;
  const alwaysPays  = payers.filter(p => payRate(p) >= 90).length;
  const usuallyPays = payers.filter(p => payRate(p) >= 50 && payRate(p) < 90).length;
  const owesMoney   = payers.filter(p => payRate(p) < 50).length;

  // Records
  const sorted        = (arr, key) => [...arr].sort((a, b) => (b[key] || 0) - (a[key] || 0));
  const topScorerEver = sorted(active, "goals")[0];
  const mostMotmEver  = sorted(active, "motm")[0];
  const mostAttended  = sorted(active, "attended")[0];
  const bibKing       = sorted(active, "bibCount")[0];
  const mostGoalsGame = played.reduce((max, m) => Math.max(max, (m.scoreA || 0) + (m.scoreB || 0)), 0);
  const biggestWin    = biggestWins(matchHistory)[0];

  const dayLabel   = schedule?.dayOfWeek || "Tuesday";
  const groupName  = settings?.groupName || "";

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)", fontFamily:"var(--font-body)" }}>

      {/* ── Sticky header ── */}
      <div style={{ position:"sticky", top:0, zIndex:50, background:"var(--bg)", padding:"14px 16px 10px" }}>
        {groupName && (
          <div style={{ fontSize:11, fontWeight:300, letterSpacing:"0.22em", textTransform:"uppercase", color:"var(--t2)", marginBottom:2 }}>
            {groupName}
          </div>
        )}
        <div style={{ fontFamily:"var(--font-display)", fontSize:44, lineHeight:0.9, letterSpacing:"0.02em", fontStyle:"italic" }}>
          THE <span style={{ color:"var(--green)" }}>NUMBERS</span>
        </div>
        <div style={{ fontSize:12, fontWeight:300, color:"var(--t2)", marginTop:6 }}>
          Season stats · {totalGames} game{totalGames !== 1 ? "s" : ""} played
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:6, marginTop:12 }}>
          {[["overview","Overview"],["records","Records"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding:"7px 18px", borderRadius:"var(--r-pill)",
              border:`0.5px solid ${tab === id ? "var(--greenb)" : "var(--border-subtle)"}`,
              background: tab === id ? "var(--green2)" : "transparent",
              color: tab === id ? "var(--green)" : "var(--t2)",
              fontFamily:"var(--font-body)", fontSize:12, fontWeight:500,
              cursor:"pointer", transition:"all 0.15s",
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding:"8px 16px 110px" }}>

        {/* ═══════════════════════════════════════════ OVERVIEW ═══ */}
        {tab === "overview" && (
          <>
            {/* 1 — Season card */}
            <div style={{
              borderRadius:"var(--r)", overflow:"hidden", marginBottom:8,
              background:"linear-gradient(135deg,rgba(61,220,106,0.22) 0%,rgba(61,220,106,0.06) 45%,rgba(10,10,8,0.6) 100%)",
              border:"0.5px solid rgba(61,220,106,0.35)",
              boxShadow:"0 0 18px rgba(61,220,106,0.1),inset 0 0 30px rgba(61,220,106,0.05)",
              padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
            }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.14em", textTransform:"uppercase", color:"var(--gold)", marginBottom:4 }}>
                  2026 Season
                </div>
                <div style={{ fontFamily:"var(--font-display)", fontSize:24, lineHeight:1, letterSpacing:"0.04em", fontStyle:"italic", color:"var(--t1)" }}>
                  {dayLabel} Night
                </div>
                <div style={{ fontFamily:"var(--font-display)", fontSize:36, lineHeight:1, letterSpacing:"0.04em", fontStyle:"italic", color:"var(--green)", textShadow:"0 0 18px rgba(61,220,106,0.7)" }}>
                  Football
                </div>
                <div style={{ fontSize:11, color:"rgba(242,240,234,0.6)", marginTop:6, fontWeight:300, lineHeight:1.5 }}>
                  {totalGames} games · {winRate}% decisive · {totalGoals} goals
                </div>
              </div>
              <SeasonGauge played={totalGames} target={20} />
            </div>

            {/* 2 — Team form */}
            {form5.length > 0 && (
              <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)", borderRadius:"var(--r)", padding:"14px 16px", marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                  <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)" }}>
                    Last 5 Results
                  </div>
                  <div style={{ fontSize:11, fontWeight:400, color:"var(--green)" }}>
                    {winsIn5} decisive in last {form5.length}
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                  {form5.map((r, i) => (
                    <div key={i} style={{
                      width:38, height:38, borderRadius:"50%",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:11, fontWeight:700,
                      background: r === "w" ? "var(--green2)" : "var(--amber2)",
                      border:`1.5px solid ${r === "w" ? "var(--greenb)" : "var(--amberb)"}`,
                      color: r === "w" ? "var(--green)" : "var(--amber)",
                      boxShadow: r === "w" ? "0 0 8px rgba(61,220,106,0.2)" : "0 0 8px rgba(255,176,32,0.15)",
                    }}>
                      {r === "w" ? "W" : "D"}
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--t2)", fontWeight:300 }}>
                  <TrendUp size={13} weight="thin" color={winsIn5 >= 3 ? "var(--green)" : "var(--amber)"} />
                  {winsIn5 >= 4 ? "Great run — keep the momentum"
                    : winsIn5 >= 3 ? "Good run — keep it going"
                    : winsIn5 >= 2 ? "Mixed bag lately"
                    : "Tough spell — bounce back next week"}
                </div>
              </div>
            )}

            {/* 3 — Key stat tiles */}
            {totalGames > 0 && (
              <>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                  <StatTile
                    label="Wins" value={decisiveGames.length}
                    sub={`of ${totalGames} · ${winRate}%`}
                    color="var(--green)" bg="var(--green2)" border="var(--greenb)"
                  />
                  <StatTile
                    label="Draws" value={drawGames.length}
                    sub={`of ${totalGames} · ${totalGames > 0 ? Math.round(drawGames.length / totalGames * 100) : 0}%`}
                    color="var(--red)" bg="var(--red2)" border="var(--redb)"
                  />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:8 }}>
                  <StatTile label="Goals"  value={totalGoals} color="var(--gold)"   bg="var(--gold2)"   border="var(--goldb)"   />
                  <StatTile label="Played" value={totalGames} color="var(--t1)"     bg="var(--s1)"      border="var(--border-subtle)" />
                  <StatTile label="MOTM"   value={totalMotm}  color="var(--purple)" bg="var(--purple2)" border="var(--purpleb)" />
                </div>
              </>
            )}

            {/* 4 — Top scorers */}
            {topScorers.length > 0 && (
              <LeaderCard icon={SoccerBall} label="Goals">
                {topScorers.map((p, i) => (
                  <LeaderRow key={p.id} rank={i+1} name={p.name} value={p.goals || 0}
                    bar={p.goals || 0} maxBar={topScorers[0].goals || 1}
                    barColor="var(--green)" isLast={i === topScorers.length - 1} />
                ))}
              </LeaderCard>
            )}

            {/* 5 — MOTM */}
            {topMotm.length > 0 && (
              <LeaderCard icon={Star} label="Man of the Match">
                {topMotm.map((p, i) => (
                  <LeaderRow key={p.id} rank={i+1} name={p.name} value={p.motm || 0}
                    bar={p.motm || 0} maxBar={topMotm[0].motm || 1}
                    barColor="var(--gold)" isLast={i === topMotm.length - 1} />
                ))}
              </LeaderCard>
            )}

            {/* 6 — Attendance */}
            {topAttend.length > 0 && (
              <LeaderCard icon={CalendarCheck} label="Attendance">
                {topAttend.map((p, i) => {
                  const pct = Math.round((p.attended / Math.max(p.total, 1)) * 100);
                  return (
                    <LeaderRow key={p.id} rank={i+1} name={p.name} value={`${pct}%`}
                      bar={pct} maxBar={100}
                      barColor={pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--amber)" : "var(--red)"}
                      sub={`${p.attended} of ${p.total} games`}
                      isLast={i === topAttend.length - 1} />
                  );
                })}
              </LeaderCard>
            )}

            {/* 7 — Payment reliability */}
            {payers.length > 0 && (
              <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)", borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>
                <div style={{ padding:"14px 16px", borderBottom:"0.5px solid var(--b2)" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)" }}>
                      Payment Reliability
                    </div>
                    <div style={{
                      padding:"3px 10px", borderRadius:"var(--r-pill)", fontSize:10, fontWeight:500,
                      background: avgReliability >= 80 ? "var(--green2)" : "var(--amber2)",
                      border:`0.5px solid ${avgReliability >= 80 ? "var(--greenb)" : "var(--amberb)"}`,
                      color: avgReliability >= 80 ? "var(--green)" : "var(--amber)",
                    }}>
                      {avgReliability >= 80 ? "Solid Group" : "Needs Work"}
                    </div>
                  </div>
                  <div style={{ fontFamily:"var(--font-display)", fontSize:32, lineHeight:1, color:"var(--t1)", marginTop:6 }}>
                    {avgReliability}%
                  </div>
                  <div style={{ fontSize:10, fontWeight:300, color:"var(--t2)", marginTop:2 }}>group average</div>
                </div>
                {[
                  { label:"Always pays",  count:alwaysPays,  color:"var(--green)" },
                  { label:"Usually pays", count:usuallyPays, color:"var(--amber)" },
                  { label:"Owes money",   count:owesMoney,   color:"var(--red)"   },
                ].map(({ label, count, color }, i, arr) => (
                  <div key={label} style={{
                    padding:"10px 16px", borderBottom: i < arr.length - 1 ? "0.5px solid var(--b2)" : "none",
                    display:"flex", alignItems:"center", gap:10,
                  }}>
                    <div style={{ fontSize:12, fontWeight:400, color:"var(--t1)", minWidth:100 }}>{label}</div>
                    <div style={{ flex:1, height:4, background:"var(--s3)", borderRadius:2 }}>
                      <div style={{ height:"100%", borderRadius:2, background:color, width:`${payers.length > 0 ? (count / payers.length) * 100 : 0}%` }} />
                    </div>
                    <div style={{ fontSize:12, fontWeight:500, color, minWidth:20, textAlign:"right" }}>{count}</div>
                  </div>
                ))}
              </div>
            )}

            {/* 8 — Bib hall of shame */}
            {topBibs.length > 0 && (
              <LeaderCard iconLabel="🟡" label="Bib Hall of Shame">
                {topBibs.map((p, i) => (
                  <LeaderRow key={p.id} rank={i+1} name={p.name} value={`${p.bibCount || 0}×`}
                    bar={p.bibCount || 0} maxBar={topBibs[0].bibCount || 1}
                    barColor="var(--amber)" isLast={i === topBibs.length - 1} />
                ))}
              </LeaderCard>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════ RECORDS ═══ */}
        {tab === "records" && (
          <>
            {/* 1 — All-time records grid */}
            <SecLabel label="All-Time Records" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
              <RecordTile
                label="Most Goals · Game"
                value={mostGoalsGame > 0 ? mostGoalsGame : "—"}
                sub={mostGoalsGame > 0 ? "total in one game" : "No data yet"}
                color="var(--gold)"
              />
              <RecordTile
                label="Biggest Win"
                value={biggestWin ? `${biggestWin.scoreA}–${biggestWin.scoreB}` : "—"}
                sub={biggestWin ? `${biggestWin.diff} goal margin` : "No data yet"}
                color="var(--green)"
              />
              <RecordTile
                label="Win Streak"
                value={currentStreak > 0 ? currentStreak : "—"}
                sub={currentStreak > 0 ? "decisive in a row" : "No streak yet"}
                color="var(--green)"
              />
              <RecordTile
                label="Draw Streak"
                value={drawStreak > 0 ? drawStreak : "—"}
                sub={drawStreak > 0 ? "draws in a row" : "No streak yet"}
                color="var(--amber)"
              />
              <RecordTile
                label="Top Scorer"
                value={topScorerEver?.goals > 0 ? topScorerEver.name.split(" ")[0] : "—"}
                sub={topScorerEver?.goals > 0 ? `${topScorerEver.goals} goals` : "No data yet"}
                color="var(--gold)"
              />
              <RecordTile
                label="Most MOTM"
                value={mostMotmEver?.motm > 0 ? mostMotmEver.name.split(" ")[0] : "—"}
                sub={mostMotmEver?.motm > 0 ? `${mostMotmEver.motm} awards` : "No data yet"}
                color="var(--gold)"
              />
              <RecordTile
                label="Never Missed"
                value={mostAttended?.attended > 0 ? mostAttended.name.split(" ")[0] : "—"}
                sub={mostAttended?.attended > 0 ? `${mostAttended.attended} games` : "No data yet"}
                color="var(--green)"
              />
              <RecordTile
                label="Bib King"
                value={bibKing?.bibCount > 0 ? bibKing.name.split(" ")[0] : "—"}
                sub={bibKing?.bibCount > 0 ? `${bibKing.bibCount} times` : "No data yet"}
                color="var(--amber)"
              />
            </div>

            {/* 2 — Late dropouts */}
            {topLate.length > 0 && (
              <>
                <SecLabel icon={Hourglass} label="Late Dropouts" />
                <LeaderCard label="Late Cancellations">
                  {topLate.map((p, i) => (
                    <LeaderRow key={p.id} rank={i+1} name={p.name} value={p.lateDropouts || 0}
                      bar={p.lateDropouts || 0} maxBar={topLate[0].lateDropouts || 1}
                      barColor="var(--red)" isLast={i === topLate.length - 1} />
                  ))}
                </LeaderCard>
              </>
            )}

            {/* 3 — Streaks tiles */}
            {totalGames > 0 && (
              <>
                <SecLabel label="Streaks" />
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
                  <div style={{
                    background:"var(--green2)", border:"0.5px solid var(--greenb)",
                    borderRadius:"var(--rs)", padding:"14px",
                    boxShadow:"0 0 12px rgba(61,220,106,0.08)",
                  }}>
                    <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)", marginBottom:6 }}>Current Run</div>
                    <div style={{ fontFamily:"var(--font-display)", fontSize:36, lineHeight:1, color:"var(--green)" }}>{currentStreak}</div>
                    <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:4 }}>decisive in a row</div>
                  </div>
                  <div style={{
                    background:"var(--gold2)", border:"0.5px solid var(--goldb)",
                    borderRadius:"var(--rs)", padding:"14px",
                    boxShadow:"0 0 12px rgba(232,160,32,0.08)",
                  }}>
                    <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)", marginBottom:6 }}>Longest Unbeaten</div>
                    <div style={{ fontFamily:"var(--font-display)", fontSize:36, lineHeight:1, color:"var(--gold)" }}>{longestUnbeaten}</div>
                    <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:4 }}>decisive in a row</div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
