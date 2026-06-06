const CIRCLE = {
  you:     { bg:"var(--gold2)",               border:"0.5px solid var(--goldb)",              color:"var(--gold)",   shadow:"0 0 10px rgba(232,160,32,0.28)"  },
  green:   { bg:"rgba(61,220,106,0.14)",       border:"0.5px solid rgba(61,220,106,0.45)",     color:"var(--green)", shadow:"0 0 8px rgba(61,220,106,0.22)"   },
  red:     { bg:"rgba(255,64,64,0.14)",        border:"0.5px solid rgba(255,64,64,0.45)",      color:"var(--red)",   shadow:"0 0 8px rgba(255,64,64,0.22)"    },
  amber:   { bg:"rgba(255,176,32,0.14)",       border:"0.5px solid rgba(255,176,32,0.45)",     color:"var(--amber)", shadow:"0 0 8px rgba(255,176,32,0.22)"   },
  purple:  { bg:"rgba(176,96,240,0.14)",       border:"0.5px solid rgba(176,96,240,0.45)",     color:"var(--purple)",shadow:"0 0 8px rgba(176,96,240,0.22)"  },
  injured: { bg:"rgba(255,255,255,0.04)",      border:"0.5px solid rgba(255,255,255,0.1)",     color:"var(--t2)",    shadow:"none"                            },
};

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (name || "?").slice(0, 2).toUpperCase();
}

// tileColour: 'green'|'red'|'amber'|'purple' — determines circle variant
// isMe:       true → gold circle
// player:     { id, name, injured?, isGuest? }
// reserveIndex: 1-based queue position, shown as "#N" below name
// hasGuest:   show "+1" below name
// hasBibs:    true → amber dot badge bottom-right of circle
// hasMotm:    true → trophy badge top-right of circle (last match's POTM)
export default function Avatar({ player, isMe, tileColour, reserveIndex, hasGuest, isInjured, hasBibs = false, hasMotm = false }) {
  const variant = player?.injured ? "injured" : isMe ? "you" : (tileColour || "green");
  const c       = CIRCLE[variant] ?? CIRCLE.green;

  return (
    <div style={{
      display:"flex", flexDirection:"column",
      alignItems:"center", gap:3, width:34,
    }}>
      {/* Initials circle */}
      <div style={{ position:"relative", width:32, height:32, flexShrink:0 }}>
        <div style={{
          width:32, height:32, borderRadius:"50%",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:9, fontWeight:500,
          background: isInjured ? "rgba(120,20,20,0.3)" : c.bg,
          border:     isInjured ? "0.5px solid rgba(255,80,80,0.3)" : c.border,
          color:      isInjured ? "rgba(255,100,100,0.8)" : c.color,
          boxShadow:  c.shadow,
        }}>
          {initials(player?.nickname || player?.name)}
        </div>
        {isInjured && (
          <span style={{ position:"absolute", bottom:-2, right:-2, fontSize:10, lineHeight:1 }}>🤕</span>
        )}
        {hasBibs && !isInjured && (
          <div style={{
            position:"absolute", bottom:0, right:0,
            width:10, height:10, borderRadius:"50%",
            background:"var(--amber)",
          }}/>
        )}
        {hasMotm && !isInjured && (
          <span style={{
            position:"absolute", bottom:-4, right:-4, fontSize:11, lineHeight:1,
          }}>🏆</span>
        )}
      </div>

      {/* Name */}
      <span style={{
        fontSize:9, fontWeight:300, color:"var(--t2)",
        width:34, textAlign:"center",
        overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis",
      }}>
        {player?.nickname || player?.name}
      </span>

      {/* +1 badge */}
      {hasGuest && (
        <span style={{ fontSize:8, color:"var(--gold)", marginTop:-2 }}>+1</span>
      )}

      {/* Reserve queue position */}
      {reserveIndex != null && (
        <span style={{ fontSize:8, color:"var(--purple)", marginTop:-2 }}>#{reserveIndex}</span>
      )}
    </div>
  );
}
