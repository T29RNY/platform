import { useEffect, useRef } from "react";
import {
  Trophy, SoccerBall, ChartBar, Lock, Star, Lightning,
  UsersThree, Crosshair, ChartLineUp, Users,
} from "@phosphor-icons/react";
import useIOIntelligence from "../hooks/useIOIntelligence.js";

// ── Inject once at module load ────────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("io-intel-styles")) {
  const s = document.createElement("style");
  s.id = "io-intel-styles";
  s.textContent = `
    .io-section { opacity:0; transform:translateY(14px); transition:opacity 400ms ease,transform 400ms ease; }
    .io-visible  { opacity:1; transform:translateY(0); }
    .io-unlocking { animation:io-unlock 400ms ease-out forwards; }
    @keyframes io-unlock {
      from { transform:rotate(-10deg) scale(0.6); opacity:0.4; }
      to   { transform:rotate(0deg)   scale(1);   opacity:1;   }
    }
  `;
  document.head.appendChild(s);
}

// ── Constants ─────────────────────────────────────────────────────────────────
const UNLOCK_STEPS = [
  { at:2,  name:"Win Rate"                  },
  { at:3,  name:"Current Run"               },
  { at:6,  name:"Most Played With"          },
  { at:7,  name:"Team Impact"               },
  { at:8,  name:"Nemesis + Best Partnership"},
  { at:16, name:"Legacy Insights"           },
];

const INSIGHTS = [
  { id:"winRate",         label:"Win Rate",           rgb:"232,160,32",  hex:"#E8A020", unlockAt:2,  dataKey:"winRate",         gradFrom:"rgba(232,160,32,0.18)",  gradTo:"rgba(232,160,32,0.06)"  },
  { id:"currentRun",      label:"Current Run",        rgb:"61,220,106",  hex:"#3DDC6A", unlockAt:3,  dataKey:"currentRun",      gradFrom:"rgba(61,220,106,0.18)",  gradTo:"rgba(61,220,106,0.06)"  },
  { id:"mostPlayedWith",  label:"Most Played With",   rgb:"96,160,255",  hex:"#60A0FF", unlockAt:6,  dataKey:"mostPlayedWith",  gradFrom:"rgba(96,160,255,0.18)",  gradTo:"rgba(96,160,255,0.06)"  },
  { id:"impact",          label:"Team Impact",        rgb:"176,96,240",  hex:"#B060F0", unlockAt:7,  dataKey:"impact",          gradFrom:"rgba(176,96,240,0.18)",  gradTo:"rgba(176,96,240,0.06)"  },
  { id:"nemesis",         label:"Nemesis",            rgb:"255,64,64",   hex:"#FF4040", unlockAt:8,  dataKey:"nemesis",         gradFrom:"rgba(255,64,64,0.18)",   gradTo:"rgba(255,64,64,0.06)"   },
  { id:"bestPartnership", label:"Best Partnership",   rgb:"61,220,106",  hex:"#3DDC6A", unlockAt:8,  dataKey:"bestPartnership", gradFrom:"rgba(61,220,106,0.18)",  gradTo:"rgba(61,220,106,0.06)"  },
  { id:"advancedChem",    label:"Advanced Chemistry", rgb:"255,176,32",  hex:"#FFB020", unlockAt:8,  dataKey:null,              gradFrom:"rgba(255,176,32,0.18)",  gradTo:"rgba(255,176,32,0.06)"  },
  { id:"legacy",          label:"Legacy Insights",    rgb:"232,160,32",  hex:"#E8A020", unlockAt:16, dataKey:null,              gradFrom:"rgba(232,160,32,0.18)",  gradTo:"rgba(232,160,32,0.06)"  },
];

// ── Ghost shield (locked / empty) ─────────────────────────────────────────────
function GhostShield({ size = 48, opacity = 0.07 }) {
  const w = Math.round(size * 54 / 60);
  return (
    <svg width={w} height={size} viewBox="0 0 54 60" style={{ opacity, display:"block" }}>
      <path d="M27 2L52 12V30C52 43.5 41 54.5 27 58C13 54.5 2 43.5 2 30V12L27 2Z"
        fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" />
    </svg>
  );
}

// ── Badge crest SVG ───────────────────────────────────────────────────────────
function BadgeCrest({ hex, gradId, gradFrom, gradTo, size = 54, children }) {
  const h = Math.round(size * 60 / 54);
  return (
    <svg width={size} height={h} viewBox="0 0 54 60"
      style={{ filter:`drop-shadow(0 0 16px ${hex}66) drop-shadow(0 4px 10px rgba(0,0,0,0.8))`, display:"block" }}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor={gradFrom} />
          <stop offset="100%" stopColor={gradTo}   />
        </linearGradient>
      </defs>
      <path d="M27 2L52 12V30C52 43.5 41 54.5 27 58C13 54.5 2 43.5 2 30V12L27 2Z"
        fill={`url(#${gradId})`} stroke={hex} strokeWidth="0.8" />
      <path d="M27 9L46 17.5V30C46 40 37 49 27 51.5C17 49 8 40 8 30V17.5L27 9Z"
        fill="none" stroke={`${hex}80`} strokeWidth="0.5" />
      {children}
    </svg>
  );
}

// ── Avatar stack ──────────────────────────────────────────────────────────────
function AvatarStack({ players, rgb }) {
  if (!players?.length) return null;
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", marginTop:8 }}>
      {players.slice(0, 3).map((p, i) => (
        <div key={p.playerId} style={{
          width:34, height:34, borderRadius:"50%", flexShrink:0,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:12, fontWeight:600, color:"#fff",
          background:`rgba(${rgb},0.25)`, border:`2px solid rgba(${rgb},0.5)`,
          boxShadow:`0 0 10px rgba(${rgb},0.28)`,
          marginLeft: i === 0 ? 0 : -8, zIndex: 3 - i,
          fontFamily:"var(--font-body)",
        }}>
          {(p.name || "?")[0].toUpperCase()}
        </div>
      ))}
    </div>
  );
}

// ── IO Brand Header ───────────────────────────────────────────────────────────
function IOBrandHeader() {
  return (
    <div style={{ fontStyle:"italic", transform:"skewX(-8deg)", display:"inline-flex", alignItems:"baseline", gap:5 }}>
      <span style={{ color:"var(--green)", fontFamily:"var(--font-display)", fontSize:24, lineHeight:1 }}>I</span>
      <span style={{ color:"var(--red)",   fontFamily:"var(--font-display)", fontSize:24, lineHeight:1 }}>O</span>
      <span style={{ color:"var(--t1)", fontFamily:"var(--font-display)", fontSize:24, lineHeight:1, letterSpacing:"0.03em" }}>
        Intelligence
      </span>
    </div>
  );
}

// ── Tactics board hero card ───────────────────────────────────────────────────
function TacticsBoardHero({ player, gamesPlayed, total, stats }) {
  const attended  = gamesPlayed;
  const safeTotal = Math.max(total, attended, 1);
  const progress  = attended / safeTotal;
  const R = 16;
  const circ   = 2 * Math.PI * R;
  const offset = circ * (1 - progress);
  const goals  = stats?.matchStats?.goals ?? player?.goals ?? 0;
  const motm   = stats?.matchStats?.motm  ?? player?.motm  ?? 0;
  const winPct = stats?.winRate?.winRate ?? null;

  return (
    <div style={{
      position:"relative", borderRadius:16, overflow:"hidden",
      height:112, marginBottom:12,
      boxShadow:"0 2px 24px rgba(0,0,0,0.5)",
    }}>
      {/* SVG tactics board — viewBox height reduced 40% (160→96), all y-coords ×0.6 */}
      <svg viewBox="0 0 340 96" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"
        style={{ position:"absolute", inset:0, width:"100%", height:"100%", display:"block" }}>
        <rect width="340" height="96" fill="#0e1a12" />
        <rect width="340" height="96" fill="rgba(0,0,0,0.55)" />
        <rect x="6" y="5" width="328" height="86" rx="3" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" />
        <line x1="170" y1="5" x2="170" y2="91"  stroke="rgba(255,255,255,0.14)" strokeWidth="0.7" />
        <circle cx="170" cy="48" r="13" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.7" />
        <rect x="6"   y="24" width="48" height="48" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
        <rect x="286" y="24" width="48" height="48" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
        <rect x="6"   y="35" width="18" height="26" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="0.5" />
        <rect x="316" y="35" width="18" height="26" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="0.5" />
        {/* Green (left) 4-3-3 — cy×0.6 */}
        {[[20,48],[55,13],[55,31],[55,65],[55,83],[98,23],[98,48],[98,73],[135,17],[135,48],[135,79]].map(([cx,cy],i) => (
          <circle key={`g${i}`} cx={cx} cy={cy} r="3" fill="rgba(61,220,106,0.6)" stroke="rgba(61,220,106,0.9)" strokeWidth="0.8" />
        ))}
        {/* Red (right) 4-3-3 mirror — cy×0.6 */}
        {[[320,48],[285,13],[285,31],[285,65],[285,83],[242,23],[242,48],[242,73],[205,17],[205,48],[205,79]].map(([cx,cy],i) => (
          <circle key={`r${i}`} cx={cx} cy={cy} r="3" fill="rgba(255,96,96,0.5)" stroke="rgba(255,96,96,0.8)" strokeWidth="0.8" />
        ))}
        {/* Tactical arrows — y×0.6 */}
        <path d="M98,48 L128,48"        stroke="rgba(255,220,80,0.5)" strokeWidth="0.9" strokeDasharray="3,2" fill="none" />
        <path d="M98,23 Q115,15 128,17"  stroke="rgba(255,220,80,0.5)" strokeWidth="0.9" strokeDasharray="3,2" fill="none" />
        <path d="M242,48 L212,48"        stroke="rgba(255,220,80,0.5)" strokeWidth="0.9" strokeDasharray="3,2" fill="none" />
        {/* Stat overlay — top right, y×0.6 */}
        <text x="330" y="11" textAnchor="end" fontSize="6" fill="rgba(255,255,255,0.38)" fontFamily="DM Sans,sans-serif">⚽ {goals} goals</text>
        <text x="330" y="19" textAnchor="end" fontSize="6" fill="rgba(255,255,255,0.38)" fontFamily="DM Sans,sans-serif">🏆 {motm} POTM</text>
        {winPct !== null && (
          <text x="330" y="27" textAnchor="end" fontSize="6" fill="rgba(255,255,255,0.38)" fontFamily="DM Sans,sans-serif">{winPct}% win</text>
        )}
      </svg>

      {/* Dark gradient overlay */}
      <div style={{
        position:"absolute", inset:0,
        background:"linear-gradient(135deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.1) 100%)",
        pointerEvents:"none",
      }} />

      {/* Text overlay */}
      <div style={{ position:"absolute", inset:0, padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        {/* Left: heading + season label */}
        <div>
          <div style={{ fontFamily:"var(--font-display)", fontStyle:"italic", fontSize:40, lineHeight:1.1 }}>
            <div style={{ color:"var(--t1)", letterSpacing:"0.04em" }}>YOUR GAME</div>
            <div style={{ color:"var(--green)", letterSpacing:"0.04em" }}>YOUR STORY</div>
          </div>
        </div>

        {/* Right: compact progress ring with glass tile */}
        <div style={{
          display:"flex", flexDirection:"column", alignItems:"center",
          background:"rgba(255,255,255,0.08)",
          backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
          border:"0.5px solid rgba(255,255,255,0.15)",
          borderRadius:12, padding:10,
        }}>
          <div style={{ position:"relative", width:38, height:38 }}>
            <svg width="38" height="38" viewBox="0 0 38 38" style={{ display:"block" }}>
              <circle cx="19" cy="19" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
              <circle cx="19" cy="19" r={R} fill="none" stroke="#3DDC6A" strokeWidth="3"
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round" transform="rotate(-90 19 19)" />
            </svg>
            <div style={{
              position:"absolute", inset:0, display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center", gap:0,
            }}>
              <span style={{ fontFamily:"var(--font-display)", fontSize:22, fontWeight:500, lineHeight:1.1, color:"var(--t1)" }}>{attended}</span>
              <span style={{ fontSize:11, color:"var(--t1)", lineHeight:1.1 }}>/ {safeTotal}</span>
              <span style={{ fontSize:9, color:"var(--t2)", lineHeight:1.1 }}>games</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Stats row (3 tiles) ───────────────────────────────────────────────────────
function StatsRow({ player, stats }) {
  const goals  = stats?.matchStats?.goals  ?? player?.goals ?? 0;
  const motm   = stats?.matchStats?.motm   ?? player?.motm  ?? 0;
  const wins   = stats?.matchStats?.wins   ?? player?.w     ?? 0;
  const losses = stats?.matchStats?.losses ?? player?.l     ?? 0;
  const draws  = stats?.matchStats?.draws  ?? player?.d     ?? 0;
  const attended = stats?.matchStats?.attended ?? player?.attended ?? 0;
  const run    = stats?.currentRun;

  const tileBase = {
    background:"var(--s2)", border:"0.5px solid rgba(255,255,255,0.12)",
    borderRadius:10, padding:"12px 8px", flex:1, minHeight:104,
    display:"flex", flexDirection:"column", alignItems:"center", gap:4,
  };
  const numStyle = { fontFamily:"var(--font-display)", fontSize:28, lineHeight:1, height:28 };
  const lbl = { fontSize:9, fontWeight:400, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--t2)" };
  const sub = { fontSize:9, color:"rgba(255,255,255,0.3)", fontWeight:300 };

  const totalGames = wins + draws + losses;
  const winRatePct = totalGames > 0 ? Math.round((wins / totalGames) * 100) : null;
  const wdlSub = winRatePct !== null ? `${winRatePct}% win rate this season` : "no games yet";

  const potmOfWins = motm > 0 ? `${Math.round((motm / Math.max(wins, 1)) * 100)}% of wins` : "yet to win one";
  const goalsPerGame = attended > 0 ? (goals / attended).toFixed(1) : "0.0";

  return (
    <div style={{ display:"flex", gap:8, marginBottom:12 }}>
      {/* POTM tile */}
      <div style={tileBase}>
        <Trophy size={18} weight="thin" color="var(--gold)" />
        <div style={{ ...numStyle, color:"var(--gold)" }}>{motm}</div>
        <div style={lbl}>POTM</div>
        <div style={sub}>{potmOfWins}</div>
      </div>

      {/* Goals / current run tile */}
      <div style={tileBase}>
        <SoccerBall size={18} weight="thin" color="var(--green)" />
        {goals > 0 || !run ? (
          <>
            <div style={{ ...numStyle, color:"var(--green)" }}>{goals}</div>
            <div style={lbl}>Goals</div>
            <div style={sub}>{goalsPerGame} per game</div>
          </>
        ) : (
          <>
            <div style={{ ...numStyle, color: run.type === "unbeaten" ? "var(--green)" : "var(--red)" }}>
              {run.length}
            </div>
            <div style={lbl}>{run.type === "unbeaten" ? "Unbeaten" : "Losing"}</div>
            <div style={sub}>game run</div>
          </>
        )}
      </div>

      {/* W/D/L tile */}
      <div style={tileBase}>
        <ChartBar size={18} weight="thin" color="var(--t2)" />
        {/* Fixed-height row matching numStyle height so all tiles align */}
        <div style={{ display:"flex", justifyContent:"space-around", alignItems:"center", height:28, width:"100%" }}>
          <span style={{ fontFamily:"var(--font-display)", fontSize:22, color:"var(--green)", lineHeight:1 }}>{wins}</span>
          <span style={{ fontFamily:"var(--font-display)", fontSize:22, color:"var(--amber)", lineHeight:1 }}>{draws}</span>
          <span style={{ fontFamily:"var(--font-display)", fontSize:22, color:"var(--red)",   lineHeight:1 }}>{losses}</span>
        </div>
        <div style={lbl}>W / D / L</div>
        <div style={sub}>{wdlSub}</div>
      </div>
    </div>
  );
}

// ── Insight card (unlocked) ───────────────────────────────────────────────────
function InsightCard({ insight, data, gamesPlayed }) {
  let { id, label, rgb, hex, gradFrom, gradTo, unlockAt } = insight;

  // Current Run uses dynamic colour based on run type
  if (id === "currentRun" && data) {
    if (data.type === "losing") {
      rgb = "255,64,64"; hex = "#FF4040";
      gradFrom = "rgba(255,64,64,0.18)"; gradTo = "rgba(255,64,64,0.06)";
    } else {
      rgb = "61,220,106"; hex = "#3DDC6A";
      gradFrom = "rgba(61,220,106,0.18)"; gradTo = "rgba(61,220,106,0.06)";
    }
  }

  const locked = gamesPlayed < unlockAt;

  if (locked) {
    const needed = unlockAt - gamesPlayed;
    return (
      <div style={{
        background:"rgba(20,20,18,0.8)",
        border:"0.5px solid rgba(255,255,255,0.06)", borderRadius:14,
        padding:"16px 10px", display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center", gap:6, minHeight:140,
        boxShadow:"0 0 0 0.5px rgba(255,255,255,0.03),0 0 12px rgba(255,255,255,0.02)",
      }}>
        <GhostShield size={48} opacity={0.15} />
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", textAlign:"center", fontWeight:400, letterSpacing:"0.06em" }}>
          {label}
        </div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.22)", textAlign:"center", fontWeight:300, lineHeight:1.4 }}>
          Play {needed} more {needed === 1 ? "game" : "games"} to unlock
        </div>
      </div>
    );
  }

  // Render unlocked card
  const gradId = `badge-${id}`;
  let badgeContent = null;
  let title = label;
  let body = null;
  let avatars = null;

  if (id === "bestPartnership" && data) {
    const best = Array.isArray(data) ? data[0] : null;
    badgeContent = best ? (
      <>
        <text x="27" y="32" textAnchor="middle" fontSize="9" fontWeight="700" fill="white" fontFamily="Bebas Neue,sans-serif">{best.winRate}%</text>
        <text x="27" y="43" textAnchor="middle" fontSize="5.5" fill={`${hex}cc`} fontFamily="DM Sans,sans-serif" letterSpacing="0.5">WIN RATE</text>
      </>
    ) : (
      <text x="27" y="36" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.5)" fontFamily="DM Sans,sans-serif">—</text>
    );
    title = best ? `${best.name}` : "Best Partnership";
    body = best ? <><em>{best.winRate}%</em> win rate together ({best.games} games)</> : "Not enough data yet";
    avatars = data;
  } else if (id === "nemesis" && data) {
    const top = Array.isArray(data) ? data[0] : null;
    badgeContent = (
      <>
        <line x1="18" y1="22" x2="36" y2="40" stroke={hex} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="36" y1="22" x2="18" y2="40" stroke={hex} strokeWidth="1.5" strokeLinecap="round" />
      </>
    );
    title = top ? `${top.name}` : "Nemesis";
    body = top ? <>You lose <em>{top.lossRate}%</em> when facing them ({top.games} games)</> : "Not enough data yet";
    avatars = data;
  } else if (id === "impact" && data) {
    badgeContent = data.diff !== null ? (
      <>
        <text x="27" y="30" textAnchor="middle" fontSize="9" fontWeight="700" fill="white" fontFamily="Bebas Neue,sans-serif">
          {data.diff >= 0 ? "+" : ""}{data.diff ?? "—"}%
        </text>
        <text x="27" y="42" textAnchor="middle" fontSize="5.5" fill={`${hex}cc`} fontFamily="DM Sans,sans-serif" letterSpacing="0.5">IMPACT</text>
      </>
    ) : (
      <text x="27" y="36" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.5)" fontFamily="DM Sans,sans-serif">—</text>
    );
    title = "Team Impact";
    body = data.diff !== null
      ? <><em>{data.withRate}%</em> with you vs <em>{data.withoutRate}%</em> without</>
      : "More data needed";
  } else if (id === "mostPlayedWith" && data) {
    const top = Array.isArray(data) ? data[0] : null;
    badgeContent = top ? (
      <>
        <text x="27" y="30" textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="Bebas Neue,sans-serif">{top.games}</text>
        <text x="27" y="42" textAnchor="middle" fontSize="5.5" fill={`${hex}cc`} fontFamily="DM Sans,sans-serif" letterSpacing="0.5">GAMES</text>
      </>
    ) : (
      <text x="27" y="36" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.5)" fontFamily="DM Sans,sans-serif">—</text>
    );
    title = top ? `${top.name}` : "Most Played With";
    body = top ? <>Shared the pitch <em>{top.games} times</em></> : "Not enough data yet";
    avatars = data;
  } else if (id === "winRate" && data) {
    const total = (data.wins ?? 0) + (data.draws ?? 0) + (data.losses ?? 0);
    badgeContent = (
      <>
        <text x="27" y="32" textAnchor="middle" fontSize="9" fontWeight="700" fill="white" fontFamily="Bebas Neue,sans-serif">{data.winRate}%</text>
        <text x="27" y="43" textAnchor="middle" fontSize="5.5" fill={`${hex}cc`} fontFamily="DM Sans,sans-serif" letterSpacing="0.5">WIN RATE</text>
      </>
    );
    title = `${data.winRate}% win rate this season`;
    body = `${data.wins} wins from ${total} games`;
  } else if (id === "currentRun" && data) {
    const isUnbeaten = data.type === "unbeaten";
    badgeContent = (
      <>
        <text x="27" y="32" textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="Bebas Neue,sans-serif">{data.length}</text>
        <text x="27" y="43" textAnchor="middle" fontSize="5" fill={`${hex}cc`} fontFamily="DM Sans,sans-serif" letterSpacing="0.5">{isUnbeaten ? "UNBEATEN" : "W/O WIN"}</text>
      </>
    );
    title = isUnbeaten
      ? `${data.length} game unbeaten run`
      : `${data.length} games without a win`;
  } else if (id === "advancedChem") {
    badgeContent = <text x="27" y="36" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.4)" fontFamily="DM Sans,sans-serif">Soon</text>;
    title = "Advanced Chemistry";
    body = "Coming soon";
  }

  return (
    <div style={{
      background:"var(--s1)", borderRadius:14,
      border:`0.5px solid rgba(${rgb},0.35)`,
      boxShadow:`0 0 0 0.5px rgba(${rgb},0.15),0 0 16px rgba(${rgb},0.08),inset 0 0 20px rgba(${rgb},0.03)`,
      padding:"14px 10px", display:"flex", flexDirection:"column", alignItems:"center",
      gap:6, minHeight:140, position:"relative", overflow:"hidden",
    }}>
      {/* Top glow */}
      <div style={{
        position:"absolute", top:0, left:"50%", transform:"translateX(-50%)",
        width:"80%", height:40, pointerEvents:"none",
        background:`radial-gradient(ellipse at top, rgba(${rgb},0.18) 0%, transparent 70%)`,
      }} />

      {/* Type label */}
      <div style={{ fontSize:8, letterSpacing:"0.14em", textTransform:"uppercase", color:`rgba(${rgb},0.85)`, display:"flex", alignItems:"center", gap:4 }}>
        <svg width="7" height="7" viewBox="0 0 8 8" style={{ flexShrink:0 }}>
          <circle cx="4" cy="4" r="3" fill={`rgba(${rgb},0.7)`} />
        </svg>
        {label}
      </div>

      {/* Badge */}
      <BadgeCrest hex={hex} gradId={gradId} gradFrom={gradFrom} gradTo={gradTo} size={50}>
        {badgeContent}
      </BadgeCrest>

      {/* Title */}
      <div style={{ fontSize:13, fontWeight:500, color:"var(--t1)", textAlign:"center", lineHeight:1.2 }}>
        {title}
      </div>

      {/* Body */}
      {body && (
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", textAlign:"center", lineHeight:1.4, fontWeight:300 }}>
          {typeof body === "string" ? body : (
            <span>
              {body.props?.children?.map?.((child, i) =>
                typeof child === "string" ? child
                  : <em key={i} style={{ color:"rgba(255,255,255,0.55)", fontStyle:"normal" }}>{child.props.children}</em>
              ) ?? body}
            </span>
          )}
        </div>
      )}

      {/* Avatars */}
      {Array.isArray(avatars) && avatars.length > 0 && (
        <AvatarStack players={avatars} rgb={rgb} />
      )}
    </div>
  );
}

// ── IO Insights grid ──────────────────────────────────────────────────────────
function InsightsGrid({ stats, gamesPlayed, playerId }) {
  return (
    <div style={{ marginBottom:12 }}>
      <SecHead label="IO Insights" />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9 }}>
        {INSIGHTS.map(ins => (
          <InsightCard
            key={ins.id}
            insight={ins}
            data={stats?.[ins.dataKey]}
            gamesPlayed={gamesPlayed}
          />
        ))}
      </div>
    </div>
  );
}

// ── Unlock bar ────────────────────────────────────────────────────────────────
function UnlockBar({ gamesPlayed, total }) {
  const next = UNLOCK_STEPS.find(s => s.at > gamesPlayed);
  if (!next) return null;
  const needed = next.at - gamesPlayed;
  return (
    <div style={{
      background:"var(--s1)", border:"0.5px solid rgba(232,160,32,0.15)",
      borderRadius:11, padding:"12px 14px",
      display:"flex", alignItems:"center", gap:10, marginBottom:12,
    }}>
      <Lock size={16} weight="thin" color="var(--gold)" style={{ opacity:0.45, flexShrink:0 }} />
      <div style={{ flex:1, fontSize:12, fontWeight:300, color:"var(--t2)", lineHeight:1.4 }}>
        Play{" "}
        <span style={{ color:"var(--gold)", fontWeight:600 }}>{needed} more {needed === 1 ? "match" : "matches"}</span>
        {" "}to unlock <span style={{ color:"var(--t1)" }}>{next.name}</span>
      </div>
      <div style={{ fontSize:11, color:"var(--gold)", fontWeight:500, flexShrink:0 }}>
        {gamesPlayed} / {next.at}
      </div>
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────
function SecHead({ label, icon: Icon }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, margin:"16px 0 10px" }}>
      {Icon && <Icon size={13} weight="thin" color="var(--t2)" style={{ flexShrink:0 }} />}
      <span style={{ fontSize:10, fontWeight:400, letterSpacing:"0.14em", textTransform:"uppercase", color:"var(--t2)", flexShrink:0 }}>
        {label}
      </span>
      <div style={{ flex:1, height:"0.5px", background:"rgba(255,255,255,0.05)" }} />
    </div>
  );
}

// ── Deeper Intel ranked row ───────────────────────────────────────────────────
function RankedRow({ rank, name, stat, rgb }) {
  const isGold = rank === 1;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px" }}>
      <div style={{ fontSize:11, fontWeight:700, color: isGold ? "var(--gold)" : "rgba(255,255,255,0.28)", width:14, textAlign:"center", flexShrink:0 }}>
        {rank}
      </div>
      <div style={{
        width:22, height:22, borderRadius:"50%", flexShrink:0,
        background:`rgba(${rgb},0.2)`, border:`1.5px solid rgba(${rgb},0.4)`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:10, fontWeight:600, color:"#fff",
      }}>
        {(name || "?")[0].toUpperCase()}
      </div>
      <div style={{ flex:1, fontSize:12, color:"var(--t1)", fontWeight:300, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {name}
      </div>
      <div style={{ fontSize:12, color:`rgba(${rgb},0.9)`, fontWeight:600, flexShrink:0 }}>
        {stat}
      </div>
    </div>
  );
}

function DeeperBlock({ label, Icon, rgb, hex, children }) {
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:8 }}>
        {Icon && <Icon size={10} weight="thin" color={`rgba(${rgb},0.8)`} />}
        <span style={{ fontSize:9, fontWeight:400, letterSpacing:"0.14em", textTransform:"uppercase", color:`rgba(${rgb},0.8)` }}>
          {label}
        </span>
      </div>
      <div style={{
        background:"var(--s1)", border:"0.5px solid rgba(255,255,255,0.07)",
        borderRadius:11, overflow:"hidden",
      }}>
        {children}
      </div>
    </div>
  );
}

function DeeperIntelSection({ stats, gamesPlayed }) {
  const partnerships = stats?.bestPartnership;
  const nemeses      = stats?.nemesis;
  const playedWith   = stats?.mostPlayedWith;
  const impact       = stats?.impact;

  if (gamesPlayed < 6) return null;

  return (
    <div style={{ marginBottom:12 }}>
      <SecHead label="Deeper Intel" />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9 }}>

        {/* Partnerships */}
        <DeeperBlock label="Partnerships" Icon={UsersThree} rgb="61,220,106">
          {(partnerships ?? []).length > 0 ? (
            partnerships.map((p, i) => (
              <RankedRow key={p.playerId} rank={i+1} name={p.name} stat={`${p.winRate}%`} rgb="61,220,106" />
            ))
          ) : (
            <div style={{ padding:"12px", fontSize:11, color:"rgba(255,255,255,0.25)", fontWeight:300 }}>Not enough data yet</div>
          )}
        </DeeperBlock>

        {/* Nemeses */}
        <DeeperBlock label="Nemeses" Icon={Crosshair} rgb="255,64,64">
          {(nemeses ?? []).length > 0 ? (
            nemeses.map((p, i) => (
              <RankedRow key={p.playerId} rank={i+1} name={p.name} stat={`${p.lossRate}% L`} rgb="255,64,64" />
            ))
          ) : (
            <div style={{ padding:"12px", fontSize:11, color:"rgba(255,255,255,0.25)", fontWeight:300 }}>
              {gamesPlayed >= 8 ? "Not enough data" : `Unlocks at 8 games`}
            </div>
          )}
        </DeeperBlock>

        {/* Most played with */}
        <DeeperBlock label="Most Played With" Icon={Users} rgb="96,160,255">
          {(playedWith ?? []).length > 0 ? (
            playedWith.map((p, i) => (
              <RankedRow key={p.playerId} rank={i+1} name={p.name} stat={`${p.games}`} rgb="96,160,255" />
            ))
          ) : (
            <div style={{ padding:"12px", fontSize:11, color:"rgba(255,255,255,0.25)", fontWeight:300 }}>Not enough data yet</div>
          )}
        </DeeperBlock>

        {/* Team Impact */}
        <DeeperBlock label="Team Impact" Icon={ChartLineUp} rgb="176,96,240">
          {impact ? (
            <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontWeight:300 }}>With you</span>
                <span style={{ fontSize:11, color:"var(--green)", fontWeight:600 }}>{impact.withRate}%</span>
              </div>
              {impact.withoutRate !== null && (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontWeight:300 }}>Without you</span>
                    <span style={{ fontSize:11, color:"rgba(255,255,255,0.6)", fontWeight:500 }}>{impact.withoutRate}%</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", borderTop:"0.5px solid rgba(255,255,255,0.07)", paddingTop:6 }}>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontWeight:300 }}>Difference</span>
                    <span style={{ fontSize:12, color: impact.diff >= 0 ? "var(--green)" : "var(--red)", fontWeight:700 }}>
                      {impact.diff >= 0 ? "+" : ""}{impact.diff}%
                    </span>
                  </div>
                </>
              )}
              {impact.withoutRate === null && (
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontWeight:300 }}>Need more missed games</div>
              )}
            </div>
          ) : (
            <div style={{ padding:"12px", fontSize:11, color:"rgba(255,255,255,0.25)", fontWeight:300 }}>
              {gamesPlayed >= 7 ? "Not enough data" : `Unlocks at 7 games`}
            </div>
          )}
        </DeeperBlock>

      </div>
    </div>
  );
}

// ── Legacy section ────────────────────────────────────────────────────────────
function LegacySection({ player }) {
  const cards = [
    { id:"legend", label:"CLUB LEGACY", title:"Club Legend", sub:`${player?.attended || 0} games played`, icon:"star" },
    { id:"record", label:"RECORD",      title:"All-Time Stats",  sub:`${player?.goals || 0} goals · ${player?.motm || 0} POTM`, icon:"bolt" },
  ];
  return (
    <div style={{ marginBottom:12 }}>
      <SecHead label="Legacy" />
      {cards.map(c => (
        <div key={c.id} style={{
          display:"flex", alignItems:"center", gap:14,
          background:"linear-gradient(135deg, rgba(232,160,32,0.06) 0%, var(--s1) 100%)",
          border:"0.5px solid rgba(232,160,32,0.12)", borderRadius:14, padding:"14px 16px", marginBottom:8,
        }}>
          <svg width="44" height="49" viewBox="0 0 54 60"
            style={{ filter:"drop-shadow(0 0 10px rgba(232,160,32,0.2)) drop-shadow(0 3px 8px rgba(0,0,0,0.7))", flexShrink:0 }}>
            <defs>
              <linearGradient id={`leg-${c.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="rgba(232,160,32,0.4)" />
                <stop offset="100%" stopColor="rgba(232,160,32,0.15)" />
              </linearGradient>
            </defs>
            <path d="M27 2L52 12V30C52 43.5 41 54.5 27 58C13 54.5 2 43.5 2 30V12L27 2Z"
              fill={`url(#leg-${c.id})`} stroke="#E8A020" strokeWidth="0.8" />
            <path d="M27 9L46 17.5V30C46 40 37 49 27 51.5C17 49 8 40 8 30V17.5L27 9Z"
              fill="none" stroke="rgba(232,160,32,0.4)" strokeWidth="0.5" />
            {c.icon === "star" ? (
              <text x="27" y="36" textAnchor="middle" fontSize="14" fill="#E8A020" fontFamily="sans-serif">★</text>
            ) : (
              <text x="27" y="37" textAnchor="middle" fontSize="16" fill="#E8A020" fontFamily="sans-serif">⚡</text>
            )}
          </svg>
          <div>
            <div style={{ fontSize:8.5, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(232,160,32,0.6)", marginBottom:3 }}>
              {c.label}
            </div>
            <div style={{ fontSize:15, fontWeight:500, color:"var(--t1)", marginBottom:2 }}>{c.title}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontWeight:300 }}>{c.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty state (0 games) ─────────────────────────────────────────────────────
function JourneyStartsHere() {
  return (
    <div style={{
      background:"var(--s2)", border:"0.5px solid rgba(255,255,255,0.08)",
      borderRadius:14, padding:"28px 24px", textAlign:"center",
    }}>
      <div style={{ fontFamily:"var(--font-display)", fontSize:22, color:"var(--t1)", letterSpacing:"0.04em", lineHeight:1.1 }}>
        YOUR IO JOURNEY
      </div>
      <div style={{ fontFamily:"var(--font-display)", fontSize:22, color:"var(--green)", letterSpacing:"0.04em", lineHeight:1.1, marginBottom:12 }}>
        STARTS HERE
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:300, lineHeight:1.6, marginBottom:18 }}>
        Play your first game to unlock your IO Intelligence
      </div>
      <div style={{ display:"flex", justifyContent:"center" }}>
        <GhostShield size={48} opacity={0.08} />
      </div>
    </div>
  );
}

// ── Guest state ───────────────────────────────────────────────────────────────
function GuestCard() {
  return (
    <div style={{
      background:"var(--s2)", border:"0.5px solid rgba(255,255,255,0.08)",
      borderRadius:14, padding:"24px", textAlign:"center",
      fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:300, lineHeight:1.6,
    }}>
      Join the squad properly to unlock IO Intelligence
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MyIOView({ player, teamId, teamName }) {
  const gamesPlayed = player?.attended || 0;
  const isGuest     = player?.isGuest || false;
  const total       = player?.total   || 0;

  const sectionRefs = useRef([]);
  const secRef = (i) => (el) => { sectionRefs.current[i] = el; };

  // Scroll reveal
  useEffect(() => {
    const observers = [];
    sectionRefs.current.forEach((el, i) => {
      if (!el) return;
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => el.classList.add("io-visible"), i * 40);
          obs.disconnect();
        }
      }, { threshold: 0.05 });
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [gamesPlayed]); // re-run when sections change

  // Unlock animation
  useEffect(() => {
    if (!player?.id || isGuest) return;
    const key = `io_unlock_seen_${player.id}`;
    const seen = parseInt(localStorage.getItem(key) || "0", 10);
    if (gamesPlayed > seen) {
      document.querySelectorAll(".io-insight-card").forEach(el => {
        const threshold = parseInt(el.dataset.unlockAt || "0", 10);
        if (threshold > seen && threshold <= gamesPlayed) {
          el.classList.add("io-unlocking");
          el.addEventListener("animationend", () => el.classList.remove("io-unlocking"), { once: true });
        }
      });
      localStorage.setItem(key, String(gamesPlayed));
    }
  }, [player?.id, gamesPlayed, isGuest]); // eslint-disable-line react-hooks/exhaustive-deps

  const { stats, loading } = useIOIntelligence({
    playerId: player?.id,
    teamId,
    gamesPlayed: isGuest ? 0 : gamesPlayed,
    skip: isGuest || !player?.id || !teamId,
  });

  if (isGuest) {
    return (
      <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)", fontFamily:"var(--font-body)", padding:"0 0 110px" }}>
        <div style={{ position:"sticky", top:0, zIndex:20, background:"var(--bg)", padding:"12px 16px" }}>
          <IOBrandHeader />
        </div>
        <div style={{ padding:"0 16px" }}>
          <TacticsBoardHero player={player} gamesPlayed={0} total={0} stats={null} />
          <GuestCard />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100dvh", background:"var(--bg)", color:"var(--t1)", fontFamily:"var(--font-body)", padding:"0 0 110px" }}>

      {/* IO brand header — sticky, always visible as content scrolls beneath */}
      <div style={{ position:"sticky", top:0, zIndex:20, background:"var(--bg)", padding:"12px 16px" }}>
        <IOBrandHeader />
      </div>

      <div style={{ padding:"0 16px" }}>
      <TacticsBoardHero player={player} gamesPlayed={gamesPlayed} total={total} stats={loading ? null : stats} />

      {gamesPlayed === 0 ? (
        <div ref={secRef(2)} className="io-section">
          <JourneyStartsHere />
        </div>
      ) : (
        <>
          <div ref={secRef(2)} className="io-section">
            <StatsRow player={player} stats={loading ? null : stats} />
          </div>

          <div ref={secRef(3)} className="io-section">
            <InsightsGrid stats={loading ? null : stats} gamesPlayed={gamesPlayed} playerId={player?.id} />
          </div>

          <div ref={secRef(4)} className="io-section">
            <UnlockBar gamesPlayed={gamesPlayed} total={total} />
          </div>

          <div ref={secRef(5)} className="io-section">
            <DeeperIntelSection stats={loading ? null : stats} gamesPlayed={gamesPlayed} />
          </div>

          {gamesPlayed >= 16 && (
            <div ref={secRef(6)} className="io-section">
              <LegacySection player={player} />
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
