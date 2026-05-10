import { useState } from "react";
import { colors as C, calcStreaks, biggestWins, topSingleGame, payRate, getHatTricks } from "@platform/core";
import { Card, SecTitle } from "@platform/ui";

const StatRow = ({ rank, name, value, color, bar, maxBar, sub }) => (
  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
    <div style={{ width:24, height:24, borderRadius:4, display:"flex", alignItems:"center",
      justifyContent:"center", fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:800,
      flexShrink:0,
      background:rank===1?"#F59E0B":rank===2?"#9ca3af":rank===3?"#b45309":"#1c1c1c",
      color:rank<=3?"#000":"#555" }}>{rank}</div>
    <div style={{ flex:1 }}>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500, color:C.text }}>{name}</div>
      {sub && <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted, marginTop:1 }}>{sub}</div>}
    </div>
    {bar != null && (
      <div style={{ width:55, height:3, background:"#1c1c1c", borderRadius:2 }}>
        <div style={{ height:"100%", borderRadius:2, background:color,
          width:`${maxBar ? Math.min(100,(bar/maxBar)*100) : 0}%` }}/>
      </div>
    )}
    <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:20, color,
      minWidth:30, textAlign:"right" }}>{value}</div>
  </div>
);

export default function StatsView({ squad, bibHistory, matchHistory }) {
  const [tab, setTab] = useState("goals");
  const active  = squad.filter(p => !p.disabled);
  const streaks = calcStreaks(active, matchHistory);
  const biggest = biggestWins(matchHistory);
  const topGame = topSingleGame(matchHistory);
  const hatTricks = getHatTricks(matchHistory);

  const tabs = [
    { id:"goals",   label:"⚽ Goals"  },
    { id:"motm",    label:"🏆 MOTM"   },
    { id:"wld",     label:"📊 W/L/D"  },
    { id:"streaks", label:"🔥 Streaks"},
    { id:"att",     label:"📅 Attend" },
    { id:"bibs",    label:"🟡 Bibs"   },
    { id:"records", label:"📋 Records"},
    { id:"pay",     label:"💰 Pay"    },
  ];

  return (
    <div style={{ padding:18 }}>
      <div style={{ display:"flex", gap:6, marginBottom:20, overflowX:"auto", paddingBottom:4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:"7px 12px", borderRadius:5,
            border:`1.5px solid ${tab===t.id ? C.amber : C.border}`,
            background:tab===t.id ? C.amber+"18" : "transparent",
            color:tab===t.id ? C.amber : C.muted,
            fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
            cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "goals" && <>
        {topGame.goals >= 3 && (
          <Card color={C.amber} style={{ marginBottom:16, textAlign:"center" }}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
              color:C.amber, letterSpacing:1, marginBottom:4 }}>🎩 BEST SINGLE GAME</div>
            <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:24, color:C.text }}>{topGame.name}</div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.amber }}>
              {topGame.goals} goals — {topGame.date}
            </div>
          </Card>
        )}
        <SecTitle color={C.green}>Top Scorers</SecTitle>
        {[...active].sort((a,b) => b.goals-a.goals).slice(0,8).map((p,i) => (
          <StatRow key={p.id} rank={i+1} name={p.name} value={p.goals} color={C.green}
            bar={p.goals} maxBar={Math.max(...active.map(x=>x.goals),1)}/>
        ))}
      </>}

      {tab === "motm" && <>
        <SecTitle color={C.amber}>Man of the Match</SecTitle>
        {[...active].sort((a,b) => b.motm-a.motm).slice(0,8).map((p,i) => (
          <StatRow key={p.id} rank={i+1} name={p.name} value={p.motm} color={C.amber}
            bar={p.motm} maxBar={Math.max(...active.map(x=>x.motm),1)}/>
        ))}
      </>}

      {tab === "wld" && <>
        <SecTitle color={C.blue}>Win / Loss / Draw</SecTitle>
        {[...active].sort((a,b) => (b.w||0)-(a.w||0)).map((p,i) => (
          <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10,
            padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
            <div style={{ width:24, height:24, borderRadius:4, display:"flex", alignItems:"center",
              justifyContent:"center", fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:800,
              flexShrink:0,
              background:i===0?"#F59E0B":i===1?"#9ca3af":i===2?"#b45309":"#1c1c1c",
              color:i<=2?"#000":"#555" }}>{i+1}</div>
            <div style={{ flex:1, fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500, color:C.text }}>{p.name}</div>
            <div style={{ display:"flex", gap:12 }}>
              {[[p.w||0,C.green,"W"],[p.d||0,C.amber,"D"],[p.l||0,C.red,"L"]].map(([val,color,label]) => (
                <div key={label} style={{ textAlign:"center", minWidth:28 }}>
                  <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:18, color, lineHeight:1 }}>{val}</div>
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:9, fontWeight:700, color:C.muted, letterSpacing:1 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </>}

      {tab === "streaks" && <>
        <SecTitle color={C.red}>🔥 Win Streaks</SecTitle>
        {[...active].filter(p => streaks[p.id]?.winStreak > 0)
          .sort((a,b) => streaks[b.id].winStreak - streaks[a.id].winStreak)
          .map((p,i) => (
            <StatRow key={p.id} rank={i+1} name={p.name}
              value={`${streaks[p.id].winStreak}W`} color={C.red}
              bar={streaks[p.id].winStreak} maxBar={5}/>
          ))}
        <SecTitle color={C.green}>📅 Attendance Streaks</SecTitle>
        {[...active].filter(p => streaks[p.id]?.attendStreak > 1)
          .sort((a,b) => streaks[b.id].attendStreak - streaks[a.id].attendStreak)
          .map((p,i) => (
            <StatRow key={p.id} rank={i+1} name={p.name}
              value={`${streaks[p.id].attendStreak}`} color={C.green}
              bar={streaks[p.id].attendStreak} maxBar={10} sub="games in a row"/>
          ))}
      </>}

      {tab === "att" && <>
        <SecTitle color={C.blue}>Attendance</SecTitle>
        {[...active].filter(p => p.type !== "guest")
          .sort((a,b) => (b.attended/Math.max(b.total,1))-(a.attended/Math.max(a.total,1)))
          .map(p => {
            const pct = Math.round((p.attended/Math.max(p.total,1))*100);
            return (
              <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10,
                padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ flex:1, fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500, color:C.text }}>{p.name}</div>
                <div style={{ width:60, height:3, background:"#1c1c1c", borderRadius:2 }}>
                  <div style={{ height:"100%", borderRadius:2,
                    background:pct>=80?C.green:pct>=60?C.amber:C.red, width:`${pct}%` }}/>
                </div>
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, minWidth:42, textAlign:"right" }}>
                  {p.attended}/{p.total}
                </div>
                <div style={{ fontSize:12, minWidth:14 }}>{pct>=80?"🔥":pct<50?"👀":""}</div>
              </div>
            );
          })}
      </>}

      {tab === "bibs" && <>
        <SecTitle color={C.amber}>Bib Duty</SecTitle>
        {[...active].filter(p => p.type !== "guest")
          .sort((a,b) => (b.bibCount||0)-(a.bibCount||0))
          .map((p,i) => (
            <StatRow key={p.id} rank={i+1} name={p.name} value={`${p.bibCount||0}×`}
              color={C.amber} bar={p.bibCount||0}
              maxBar={Math.max(...active.map(x=>x.bibCount||0),1)}/>
          ))}
        <div style={{ marginTop:14 }}>
          {bibHistory.slice(0,6).map((b,i) => (
            <div key={i} style={{ display:"flex", justifyContent:"space-between",
              padding:"6px 0", borderBottom:`1px solid ${C.border}`,
              fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:500 }}>
              <span style={{ color:C.muted }}>{b.date}</span>
              <span style={{ color:b.returned?C.muted:C.amber }}>
                {b.name}{!b.returned?" ← has them":""}
              </span>
            </div>
          ))}
        </div>
      </>}

      {tab === "records" && <>
        <SecTitle color={C.purple}>📋 Biggest Wins</SecTitle>
        {biggest.length === 0 && (
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted }}>Not enough data yet.</div>
        )}
        {biggest.map(m => (
          <div key={m.id} style={{ padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:600, color:C.text }}>
                Team {m.winner} win — {m.dateShort}
              </div>
              <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22, color:C.purple }}>
                {m.scoreA}–{m.scoreB}
              </div>
            </div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted, marginTop:2 }}>
              Margin: {m.diff} goals
            </div>
          </div>
        ))}
        <SecTitle color={C.amber}>🎩 Hat Tricks & More</SecTitle>
        {hatTricks.length === 0 && (
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted }}>No hat tricks yet.</div>
        )}
        {hatTricks.map(h => (
          <div key={h.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:600, color:C.text }}>{h.name}</div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.amber }}>
              {"⚽".repeat(Math.min(h.goals,5))} {h.goals} — {h.date}
            </div>
          </div>
        ))}
      </>}

      {tab === "pay" && <>
        <SecTitle color={C.green}>💰 Payment Reliability</SecTitle>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, color:C.muted, marginBottom:12 }}>
          Based on games played vs payments confirmed.
        </div>
        {[...active].filter(p => p.type !== "guest").sort((a,b) => payRate(b)-payRate(a)).map((p,i) => {
          const rate = payRate(p);
          return (
            <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10,
              padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ width:24, height:24, borderRadius:4, display:"flex", alignItems:"center",
                justifyContent:"center", fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:800,
                flexShrink:0,
                background:i===0?"#F59E0B":i===1?"#9ca3af":i===2?"#b45309":"#1c1c1c",
                color:i<=2?"#000":"#555" }}>{i+1}</div>
              <div style={{ flex:1, fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:500, color:C.text }}>{p.name}</div>
              <div style={{ width:60, height:3, background:"#1c1c1c", borderRadius:2 }}>
                <div style={{ height:"100%", borderRadius:2,
                  background:rate>=90?C.green:rate>=70?C.amber:C.red, width:`${rate}%` }}/>
              </div>
              <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700,
                color:rate>=90?C.green:rate>=70?C.amber:C.red, minWidth:40, textAlign:"right" }}>
                {rate}%
              </div>
              {p.lateDropouts > 0 && (
                <div style={{ fontFamily:"Inter,sans-serif", fontSize:10, color:C.red }}>
                  ⚠️{p.lateDropouts}
                </div>
              )}
            </div>
          );
        })}
      </>}
    </div>
  );
}
