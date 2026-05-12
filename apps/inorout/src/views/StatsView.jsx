import { useState, useEffect, useRef } from "react";
import { biggestWins, payRate } from "@platform/core";
import {
  SoccerBall, Star, CalendarCheck, Hourglass, TrendUp,
  Trophy, X as XIcon, Equals, ChartBarHorizontal,
} from "@phosphor-icons/react";

// ── Date parser ───────────────────────────────────────────────────────────────
const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseMatchDate(d) {
  if (!d) return new Date(0);
  const [day, mon, year] = (d || "").split(" ");
  return new Date(year, MONTHS[mon] ?? 0, parseInt(day) || 1);
}

function getInitials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

// Last 5 W/L/D results for a player (newest first) using name matching
function getPlayerForm(playerName, played) {
  const name = (playerName || "").toLowerCase().trim();
  const results = [];
  for (const m of played) {
    if (results.length >= 5) break;
    const inA = (m.teamA || []).some(n => (n || "").toLowerCase().trim() === name);
    const inB = (m.teamB || []).some(n => (n || "").toLowerCase().trim() === name);
    if (!inA && !inB) continue;
    if (m.winner === "D")      results.push("d");
    else if (inA)              results.push(m.winner === "A" ? "w" : "l");
    else                       results.push(m.winner === "B" ? "w" : "l");
  }
  return results;
}

// Current streak (requires ≥2 identical results to display)
function getStreak(results) {
  if (results.length < 2) return null;
  const first = results[0];
  let count = 0;
  for (const r of results) {
    if (r === first) count++; else break;
  }
  return count >= 2 ? { result: first, count } : null;
}

// Team-level streaks from played matches (newest first)
function teamStreaks(played) {
  let currentDecisive = 0, drawStreak = 0, longestUnbeaten = 0, cur = 0;
  for (const m of played) {
    if (m.winner !== "D") currentDecisive++; else break;
  }
  for (const m of played) {
    if (m.winner === "D") drawStreak++; else break;
  }
  for (const m of played) {
    if (m.winner !== "D") { cur++; longestUnbeaten = Math.max(longestUnbeaten, cur); }
    else cur = 0;
  }
  return { currentDecisive, drawStreak, longestUnbeaten };
}

// ── Canvas pitch (reused from HeroCard pattern) ───────────────────────────────
function PitchCanvas({ canvasRef }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let t = 0, rafId;

    function resize() {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();

    function draw() {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0a1f0a";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i % 2 === 0 ? "rgba(55,150,45,0.28)" : "rgba(35,110,28,0.18)";
        ctx.fillRect(i * (w / 10), 0, w / 10, h);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      const p = 1 + Math.sin(t * 0.4) * 0.015;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 1.2, h * 0.65 * p, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(w, h * 0.5);
      ctx.stroke();
      ctx.strokeRect(w * 0.12, 0, w * 0.76, h * 0.42);
      ctx.strokeRect(w * 0.26, 0, w * 0.48, h * 0.22);
      [0.08, 0.26, 0.5, 0.74, 0.92].forEach((xp, i) => {
        const f = 0.12 + Math.sin(t * 0.7 + i * 1.4) * 0.025;
        const g = ctx.createLinearGradient(w * xp, 0, w * xp + 12, h * 0.8);
        g.addColorStop(0, `rgba(255,255,200,${f})`);
        g.addColorStop(1, "rgba(255,255,200,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(w * xp - 1, 0);
        ctx.lineTo(w * xp + 1, 0);
        ctx.lineTo(w * xp + 30, h * 0.8);
        ctx.lineTo(w * xp - 30, h * 0.8);
        ctx.closePath();
        ctx.fill();
      });
      const pg = ctx.createRadialGradient(w * 0.5, h, 0, w * 0.5, h, w * 0.6);
      pg.addColorStop(0, "rgba(45,140,35,0.26)");
      pg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = pg;
      ctx.fillRect(0, 0, w, h);
      t += 0.016;
      rafId = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef]);

  return null;
}

// ── Stats hero card ───────────────────────────────────────────────────────────
function StatsHeroCard({ groupName, totalGames, winRate, totalGoals }) {
  const canvasRef = useRef(null);
  const statsText = totalGames === 0
    ? "0 games · —% wins · 0 goals"
    : `${totalGames} games · ${winRate}% wins · ${totalGoals} goals`;

  return (
    <div style={{
      position:"relative", borderRadius:"var(--r)", overflow:"hidden",
      marginBottom:8, height:130, background:"#061006",
    }}>
      <canvas ref={canvasRef}
        style={{ position:"absolute", inset:0, width:"100%", height:"100%" }} />
      <PitchCanvas canvasRef={canvasRef} />
      {/* Darker overlay for stats context */}
      <div style={{
        position:"absolute", inset:0,
        background:"linear-gradient(180deg,rgba(4,8,4,0.35) 0%,rgba(4,4,4,0.88) 100%)",
      }} />
      <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"10px 16px 12px" }}>
        {groupName && (
          <div style={{ fontSize:10, fontWeight:300, letterSpacing:"0.18em", textTransform:"uppercase", color:"var(--gold)", marginBottom:2 }}>
            {groupName}
          </div>
        )}
        <div style={{ fontFamily:"var(--font-display)", fontSize:32, lineHeight:1, letterSpacing:"0.04em", fontStyle:"italic", color:"var(--t1)" }}>
          2026 SEASON
        </div>
        <div style={{ fontSize:12, color:"var(--t2)", marginTop:5, fontWeight:300 }}>
          {statsText}
        </div>
      </div>
    </div>
  );
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
      {iconLabel && <span style={{ fontSize:14, lineHeight:1 }}>{iconLabel}</span>}
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

// Gradient tint stat tile with icon bottom-right
const StatTile = ({ label, value, sub, gradient, border, icon: Icon, iconColor }) => (
  <div style={{ position:"relative", background:gradient, border:`0.5px solid ${border}`, borderRadius:"var(--rs)", padding:"12px 14px", overflow:"hidden" }}>
    <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)", marginBottom:4 }}>{label}</div>
    <div style={{ fontFamily:"var(--font-display)", fontSize:36, lineHeight:1, color:"var(--t1)" }}>{value}</div>
    {sub && <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:4 }}>{sub}</div>}
    {Icon && (
      <div style={{ position:"absolute", bottom:10, right:12, opacity:0.5, pointerEvents:"none" }}>
        <Icon size={16} weight="thin" color={iconColor || "var(--t1)"} />
      </div>
    )}
  </div>
);

const RecordTile = ({ label, value, sub, color }) => (
  <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)", borderRadius:"var(--rs)", padding:"12px 14px" }}>
    <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)", marginBottom:6 }}>{label}</div>
    <div style={{ fontFamily:"var(--font-display)", fontSize:26, lineHeight:1, color }}>{value}</div>
    {sub && <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:4 }}>{sub}</div>}
  </div>
);

const DOT_COLOR = { w:"var(--green)", l:"var(--red)", d:"var(--amber)" };
const STREAK_COLOR = { w:"var(--green)", l:"var(--red)", d:"var(--amber)" };

// ── Main component ────────────────────────────────────────────────────────────
export default function StatsView({ squad, bibHistory = [], matchHistory = [], settings, schedule }) {
  console.log('[ioo] StatsView received', {
    matchesProp: matches,
    matchesLength: matches?.length,
    playersProp: players?.length
  });

  const [tab, setTab] = useState("overview");

  const active = squad.filter(p => !p.disabled && !p.isGuest);

  // Played matches — filter out cancelled and matchless entries
  const played = [...matchHistory]
    .filter(m => !m.cancelled && !m.is_cancelled && m.winner)
    .sort((a, b) => parseMatchDate(b.date) - parseMatchDate(a.date));

  const totalGames   = played.length;
  const winsA        = played.filter(m => m.winner === "A").length;
  const winsB        = played.filter(m => m.winner === "B").length;
  const drawGames    = played.filter(m => m.winner === "D").length;
  const decisive     = winsA + winsB;
  const winRate      = totalGames > 0 ? Math.round(decisive / totalGames * 100) : 0;
  const totalGoals   = played.reduce((s, m) => s + (m.scoreA || 0) + (m.scoreB || 0), 0);
  const totalMotm    = active.reduce((s, p) => s + (p.motm || 0), 0);
  const form5        = played.slice(0, 5).map(m => m.winner === "D" ? "d" : "w");
  const winsIn5      = form5.filter(r => r === "w").length;
  const { currentDecisive, drawStreak, longestUnbeaten } = teamStreaks(played);

  // Leaderboards
  const topScorers = [...active].filter(p => (p.goals || 0) > 0)
    .sort((a, b) => (b.goals || 0) - (a.goals || 0)).slice(0, 5);
  const topMotm = [...active].filter(p => (p.motm || 0) > 0)
    .sort((a, b) => (b.motm || 0) - (a.motm || 0)).slice(0, 3);
  const topAttend = [...active].filter(p => (p.total || 0) > 0)
    .sort((a, b) => {
      const pa = b.total > 0 ? b.attended / b.total : 0;
      const pb = a.total > 0 ? a.attended / a.total : 0;
      return pa - pb;
    }).slice(0, 5);
  const topBibs = [...active].filter(p => (p.bibCount || 0) > 0)
    .sort((a, b) => (b.bibCount || 0) - (a.bibCount || 0)).slice(0, 3);
  const topLate = [...active].filter(p => (p.lateDropouts || 0) > 0)
    .sort((a, b) => (b.lateDropouts || 0) - (a.lateDropouts || 0)).slice(0, 3);

  // Players with form (attended > 0, sorted by attendance)
  const formPlayers = [...active]
    .filter(p => (p.attended || 0) > 0)
    .sort((a, b) => (b.attended || 0) - (a.attended || 0));

  // Payment reliability
  const payers = active.filter(p => (p.total || 0) > 0);
  const avgReliability = payers.length > 0
    ? Math.round(payers.reduce((s, p) => s + payRate(p), 0) / payers.length) : 0;
  const alwaysPays  = payers.filter(p => payRate(p) >= 90).length;
  const usuallyPays = payers.filter(p => payRate(p) >= 50 && payRate(p) < 90).length;
  const owesMoney   = payers.filter(p => payRate(p) < 50).length;

  // Records
  const byKey      = (key) => [...active].sort((a, b) => (b[key] || 0) - (a[key] || 0));
  const topScorer  = byKey("goals")[0];
  const mostMotm   = byKey("motm")[0];
  const mostAtt    = byKey("attended")[0];
  const bibKing    = byKey("bibCount")[0];
  const mostGoalsGame = played.reduce((max, m) => Math.max(max, (m.scoreA || 0) + (m.scoreB || 0)), 0);
  const biggestWin = biggestWins(matchHistory)[0];

  const groupName  = settings?.groupName || "";
  const pct        = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)", fontFamily:"var(--font-body)" }}>

      {/* ── Content ── */}
      <div style={{ padding:"0 16px 110px" }}>

        {/* Hero card */}
        <StatsHeroCard
          groupName={groupName}
          totalGames={totalGames}
          winRate={winRate}
          totalGoals={totalGoals}
        />

        {/* Tab pills */}
        <div style={{ display:"flex", gap:6, marginBottom:14 }}>
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

        {/* Empty state */}
        {totalGames === 0 && (
          <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)", borderRadius:"var(--r)", padding:"24px 20px", textAlign:"center", marginBottom:8 }}>
            <div style={{ fontSize:28, marginBottom:10 }}>⚽</div>
            <div style={{ fontSize:14, fontWeight:500, color:"var(--t1)", marginBottom:6 }}>No games recorded yet</div>
            <div style={{ fontSize:12, fontWeight:300, color:"var(--t2)", lineHeight:1.5 }}>Stats will appear after your first result is saved.</div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ OVERVIEW ═══ */}
        {tab === "overview" && totalGames > 0 && (
          <>
            {/* Team form */}
            {form5.length > 0 && (
              <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)", borderRadius:"var(--r)", padding:"14px 16px", marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                  <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)" }}>Last 5 Results</div>
                  <div style={{ fontSize:11, fontWeight:400, color:"var(--green)" }}>{winsIn5} decisive in last {form5.length}</div>
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

            {/* Player form table */}
            {formPlayers.length > 0 && (
              <LeaderCard label="Player Form">
                {formPlayers.map((p, i) => {
                  const pForm   = getPlayerForm(p.name, played);
                  const streak  = getStreak(pForm);
                  const sColor  = streak ? STREAK_COLOR[streak.result] : "var(--t2)";
                  const sLabel  = streak ? `${streak.result.toUpperCase()}${streak.count}` : null;
                  return (
                    <div key={p.id} style={{
                      display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                      borderBottom: i < formPlayers.length - 1 ? "0.5px solid var(--b2)" : "none",
                    }}>
                      {/* Avatar */}
                      <div style={{
                        width:28, height:28, borderRadius:"50%",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:8, fontWeight:600, flexShrink:0,
                        background:"var(--green2)", border:"0.5px solid var(--greenb)", color:"var(--green)",
                      }}>
                        {getInitials(p.name)}
                      </div>
                      {/* Name */}
                      <div style={{ flex:1, fontSize:13, fontWeight:400, color:"var(--t1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {p.name}
                      </div>
                      {/* Form dots */}
                      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                        {pForm.length === 0 ? (
                          <span style={{ fontSize:12, color:"var(--t2)" }}>—</span>
                        ) : (
                          pForm.map((r, j) => (
                            <span key={j} style={{
                              width:8, height:8, borderRadius:"50%", display:"inline-block",
                              background: DOT_COLOR[r],
                              boxShadow: `0 0 4px ${DOT_COLOR[r]}80`,
                            }} />
                          ))
                        )}
                      </div>
                      {/* Streak */}
                      {sLabel && (
                        <div style={{ fontFamily:"var(--font-display)", fontSize:18, color:sColor, minWidth:28, textAlign:"right", flexShrink:0 }}>
                          {sLabel}
                        </div>
                      )}
                    </div>
                  );
                })}
              </LeaderCard>
            )}

            {/* Key stat tiles */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
              <StatTile
                label="Wins" value={winsA}
                sub={`of ${totalGames} games · ${pct(winsA, totalGames)}%`}
                gradient="linear-gradient(135deg,rgba(61,220,106,0.22) 0%,rgba(61,220,106,0.07) 45%,rgba(10,10,8,0.55) 100%)"
                border="var(--greenb)"
                icon={Trophy} iconColor="var(--green)"
              />
              <StatTile
                label="Losses" value={winsB}
                sub={`of ${totalGames} games · ${pct(winsB, totalGames)}%`}
                gradient="linear-gradient(135deg,rgba(255,64,64,0.22) 0%,rgba(255,64,64,0.07) 45%,rgba(10,10,8,0.55) 100%)"
                border="var(--redb)"
                icon={XIcon} iconColor="var(--red)"
              />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:8 }}>
              <StatTile
                label="Goals" value={totalGoals}
                gradient="linear-gradient(135deg,rgba(232,160,32,0.22) 0%,rgba(232,160,32,0.07) 45%,rgba(10,10,8,0.55) 100%)"
                border="var(--goldb)"
                icon={SoccerBall} iconColor="var(--gold)"
              />
              <StatTile
                label="Draws" value={drawGames}
                gradient="var(--s1)"
                border="var(--border-subtle)"
                icon={Equals} iconColor="var(--t2)"
              />
              <StatTile
                label="MOTM" value={totalMotm}
                gradient="linear-gradient(135deg,rgba(176,96,240,0.22) 0%,rgba(176,96,240,0.07) 45%,rgba(10,10,8,0.55) 100%)"
                border="var(--purpleb)"
                icon={Star} iconColor="var(--purple)"
              />
            </div>

            {/* Top scorers */}
            {topScorers.length > 0 && (
              <LeaderCard icon={SoccerBall} label="Goals">
                {topScorers.map((p, i) => (
                  <LeaderRow key={p.id} rank={i+1} name={p.name} value={p.goals || 0}
                    bar={p.goals || 0} maxBar={topScorers[0].goals || 1}
                    barColor="var(--green)" isLast={i === topScorers.length - 1} />
                ))}
              </LeaderCard>
            )}

            {/* MOTM */}
            {topMotm.length > 0 && (
              <LeaderCard icon={Star} label="Man of the Match">
                {topMotm.map((p, i) => (
                  <LeaderRow key={p.id} rank={i+1} name={p.name} value={p.motm || 0}
                    bar={p.motm || 0} maxBar={topMotm[0].motm || 1}
                    barColor="var(--gold)" isLast={i === topMotm.length - 1} />
                ))}
              </LeaderCard>
            )}

            {/* Attendance */}
            {topAttend.length > 0 && (
              <LeaderCard icon={CalendarCheck} label="Attendance">
                {topAttend.map((p, i) => {
                  const attPct = p.total > 0 ? Math.round((p.attended / p.total) * 100) : 0;
                  return (
                    <LeaderRow key={p.id} rank={i+1} name={p.name} value={`${attPct}%`}
                      bar={attPct} maxBar={100}
                      barColor={attPct >= 80 ? "var(--green)" : attPct >= 60 ? "var(--amber)" : "var(--red)"}
                      sub={`${p.attended} of ${p.total} games`}
                      isLast={i === topAttend.length - 1} />
                  );
                })}
              </LeaderCard>
            )}

            {/* Payment reliability */}
            {payers.length > 0 && (
              <div style={{ background:"var(--s1)", border:"0.5px solid var(--border-subtle)", borderRadius:"var(--r)", overflow:"hidden", marginBottom:8 }}>
                <div style={{ padding:"14px 16px", borderBottom:"0.5px solid var(--b2)" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div style={{ fontSize:10, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)" }}>Payment Reliability</div>
                    <div style={{
                      padding:"3px 10px", borderRadius:"var(--r-pill)", fontSize:10, fontWeight:500,
                      background: avgReliability >= 80 ? "var(--green2)" : "var(--amber2)",
                      border:`0.5px solid ${avgReliability >= 80 ? "var(--greenb)" : "var(--amberb)"}`,
                      color: avgReliability >= 80 ? "var(--green)" : "var(--amber)",
                    }}>
                      {avgReliability >= 80 ? "Solid Group" : "Needs Work"}
                    </div>
                  </div>
                  <div style={{ fontFamily:"var(--font-display)", fontSize:32, lineHeight:1, color:"var(--t1)", marginTop:6 }}>{avgReliability}%</div>
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

            {/* Bib hall of shame */}
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
        {tab === "records" && totalGames > 0 && (
          <>
            <SecLabel label="All-Time Records" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
              <RecordTile label="Most Goals · Game"
                value={mostGoalsGame > 0 ? mostGoalsGame : "—"}
                sub={mostGoalsGame > 0 ? "total in one game" : "No data yet"}
                color="var(--gold)" />
              <RecordTile label="Biggest Win"
                value={biggestWin ? `${biggestWin.scoreA}–${biggestWin.scoreB}` : "—"}
                sub={biggestWin ? `${biggestWin.diff} goal margin` : "No data yet"}
                color="var(--green)" />
              <RecordTile label="Win Streak"
                value={currentDecisive > 0 ? currentDecisive : "—"}
                sub={currentDecisive > 0 ? "decisive in a row" : "No streak yet"}
                color="var(--green)" />
              <RecordTile label="Draw Streak"
                value={drawStreak > 0 ? drawStreak : "—"}
                sub={drawStreak > 0 ? "draws in a row" : "No streak yet"}
                color="var(--amber)" />
              <RecordTile label="Top Scorer"
                value={topScorer?.goals > 0 ? topScorer.name.split(" ")[0] : "—"}
                sub={topScorer?.goals > 0 ? `${topScorer.goals} goals` : "No data yet"}
                color="var(--gold)" />
              <RecordTile label="Most MOTM"
                value={mostMotm?.motm > 0 ? mostMotm.name.split(" ")[0] : "—"}
                sub={mostMotm?.motm > 0 ? `${mostMotm.motm} awards` : "No data yet"}
                color="var(--gold)" />
              <RecordTile label="Never Missed"
                value={mostAtt?.attended > 0 ? mostAtt.name.split(" ")[0] : "—"}
                sub={mostAtt?.attended > 0 ? `${mostAtt.attended} games` : "No data yet"}
                color="var(--green)" />
              <RecordTile label="Bib King"
                value={bibKing?.bibCount > 0 ? bibKing.name.split(" ")[0] : "—"}
                sub={bibKing?.bibCount > 0 ? `${bibKing.bibCount} times` : "No data yet"}
                color="var(--amber)" />
            </div>

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

            <SecLabel label="Streaks" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
              <div style={{ background:"var(--green2)", border:"0.5px solid var(--greenb)", borderRadius:"var(--rs)", padding:"14px", boxShadow:"0 0 12px rgba(61,220,106,0.08)" }}>
                <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)", marginBottom:6 }}>Current Run</div>
                <div style={{ fontFamily:"var(--font-display)", fontSize:36, lineHeight:1, color:"var(--green)" }}>{currentDecisive}</div>
                <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:4 }}>decisive in a row</div>
              </div>
              <div style={{ background:"var(--gold2)", border:"0.5px solid var(--goldb)", borderRadius:"var(--rs)", padding:"14px", boxShadow:"0 0 12px rgba(232,160,32,0.08)" }}>
                <div style={{ fontSize:9, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t2)", marginBottom:6 }}>Longest Unbeaten</div>
                <div style={{ fontFamily:"var(--font-display)", fontSize:36, lineHeight:1, color:"var(--gold)" }}>{longestUnbeaten}</div>
                <div style={{ fontSize:10, color:"var(--t2)", fontWeight:300, marginTop:4 }}>decisive in a row</div>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
