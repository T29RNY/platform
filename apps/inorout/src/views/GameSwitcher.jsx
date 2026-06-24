import { colors as C } from "@platform/core";

// GameSwitcher — shown when a player is in multiple games
// For now shows one game (Finbar's Tuesdays), ready to expand
export default function GameSwitcher({ games, onSelect, playerName }) {
  return (
    <div style={{ padding:24, fontFamily:"'DM Sans', sans-serif" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28, color:C.amber,
          letterSpacing:2, lineHeight:1 }}>YOUR GAMES</div>
        {playerName && (
          <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13, color:C.muted, marginTop:4 }}>
            Welcome back, {playerName}
          </div>
        )}
      </div>

      {games.map(game => {
        const inCount = game.squad.filter(p => p.status==="in" && !p.disabled).length;
        const needed  = game.schedule.squadSize || 14;
        const full    = inCount >= needed;
        const me      = game.squad.find(p => p.id === game.myId);

        return (
          <div key={game.id} onClick={() => onSelect(game.id)}
            style={{ background:C.surface, border:`1px solid ${C.border}`,
              borderRadius:12, padding:20, marginBottom:14, cursor:"pointer",
              transition:"border-color 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor=C.amber}
            onMouseLeave={e => e.currentTarget.style.borderColor=C.border}>

            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
              <div>
                <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
                  color:C.amber, letterSpacing:2, lineHeight:1 }}>
                  {game.settings.groupName}
                </div>
                <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12,
                  color:C.muted, marginTop:3 }}>
                  {game.schedule.dayOfWeek} · {game.schedule.venue} · {game.schedule.kickoff}
                </div>
              </div>
              <div style={{ textAlign:"center", background:full?C.green+"20":C.amber+"20",
                border:`2px solid ${full?C.green:C.amber}`, borderRadius:6,
                padding:"6px 10px", minWidth:46 }}>
                <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:26,
                  color:full?C.green:C.amber, lineHeight:1 }}>{inCount}</div>
                <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:9,
                  color:C.muted }}>/{needed}</div>
              </div>
            </div>

            {/* Status */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12, fontWeight:600,
                color: game.schedule.gameIsLive ? C.green : C.muted }}>
                {game.schedule.isCancelled ? "❌ Cancelled"
                 : game.schedule.isDraft    ? "📋 Coming soon"
                 : game.schedule.gameIsLive ? "🟢 Game is open"
                 : "⏸ Not yet open"}
              </div>
              {me && (
                <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11, fontWeight:700,
                  padding:"3px 10px", borderRadius:4,
                  background: me.status==="in"  ? C.green+"20"
                            : me.status==="out"  ? C.red+"20"
                            : me.status==="maybe"? C.amber+"20"
                            : C.surface,
                  color: me.status==="in"  ? C.green
                       : me.status==="out"  ? C.red
                       : me.status==="maybe"? C.amber
                       : C.muted }}>
                  {me.status==="in"    ? "✅ You're in"
                   : me.status==="out"  ? "❌ You're out"
                   : me.status==="maybe"? "❓ Maybe"
                   : "⏳ Not responded"}
                </div>
              )}
            </div>

            {/* Balance */}
            {me?.owes > 0 && (
              <div style={{ marginTop:10, padding:"8px 12px", borderRadius:6,
                background:C.red+"12", fontFamily:"'DM Sans', sans-serif",
                fontSize:12, color:C.red }}>
                💰 You owe £{me.owes}
              </div>
            )}

            <div style={{ marginTop:14, fontFamily:"'DM Sans', sans-serif", fontSize:12,
              color:C.amber, fontWeight:600, textAlign:"right" }}>
              Open →
            </div>
          </div>
        );
      })}
    </div>
  );
}
