import { CalendarCheck, MapPinLine, Clock } from "@phosphor-icons/react";
import GaugeArc from "./GaugeArc.jsx";

// Inject blink animation + DM Sans font once
if (typeof document !== "undefined" && !document.getElementById("ioo-ph-styles")) {
  const el = document.createElement("style");
  el.id = "ioo-ph-styles";
  el.textContent = `
    @keyframes ioo-blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
  `;
  document.head.appendChild(el);
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

export default function PageHeader({
  teamName, dayOfWeek, venue, kickoff,
  inCount, squadSize, gameIsLive,
  me = null, onAvatarTap = null,
}) {
  const showAvatar = !!(me && onAvatarTap);

  return (
    <div style={{
      position:"relative",
      padding:"8px 16px 10px",
      display:"flex", justifyContent:"space-between",
      alignItems:"stretch", gap:10,
    }}>

      {/* Avatar overlay — top-left, doesn't push layout */}
      {showAvatar && (
        <div
          onClick={onAvatarTap}
          role="button"
          aria-label="Open profile"
          style={{
            position:"absolute", top:8, left:16, zIndex:5,
            width:40, height:40, borderRadius:"50%",
            background:"rgba(255,255,255,0.06)",
            border:"1px solid rgba(255,255,255,0.18)",
            boxShadow:"0 0 12px rgba(0,0,0,0.45)",
            display:"flex", alignItems:"center", justifyContent:"center",
            cursor:"pointer", WebkitTapHighlightColor:"transparent",
            fontFamily:"'Bebas Neue', sans-serif", fontSize:14,
            letterSpacing:"0.04em", color:"var(--t1)",
            backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)",
          }}
        >
          {initials(me?.nickname || me?.name)}
        </div>
      )}

      {/* Left column — content shifted right to clear the avatar */}
      <div style={{
        flex:1, minWidth:0,
        paddingLeft: showAvatar ? 52 : 0,
        display:"flex", flexDirection:"column",
        justifyContent:"space-between", gap:5,
      }}>

        {/* Team name */}
        <div style={{
          fontSize:11, fontWeight:300,
          letterSpacing:"0.22em", textTransform:"uppercase",
          color:"var(--t2)",
        }}>
          {teamName}
        </div>

        {/* Logo — centred across the header */}
        <div style={{
          fontFamily:"var(--font-display)", fontSize:52,
          lineHeight:0.88, letterSpacing:"0.02em", fontStyle:"italic",
          textAlign:"center",
          // Pull back the avatar offset so logo is centred on the
          // full header, not just the right-of-avatar column.
          marginLeft: showAvatar ? -52 : 0,
        }}>
          <span style={{ color:"var(--green)" }}>IN</span>
          <span style={{ color:"var(--t1)" }}> OR </span>
          <span style={{ color:"var(--red)" }}>OUT</span>
        </div>

        {/* Game meta */}
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          {dayOfWeek && (
            <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:12, color:"var(--t1)", fontWeight:300 }}>
              <CalendarCheck size={14} weight="thin" color="var(--t2)" />
              {dayOfWeek}
            </div>
          )}
          {venue && (
            <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:12, color:"var(--t1)", fontWeight:300 }}>
              <MapPinLine size={14} weight="thin" color="var(--t2)" />
              {venue}
            </div>
          )}
          {kickoff && (
            <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:12, color:"var(--t1)", fontWeight:300 }}>
              <Clock size={14} weight="thin" color="var(--t2)" />
              {kickoff}
            </div>
          )}
        </div>

        {/* Live badge */}
        {gameIsLive && (
          <div style={{
            display:"inline-flex", alignItems:"center", gap:5,
            fontSize:10, fontWeight:400,
            letterSpacing:"0.12em", textTransform:"uppercase",
            color:"var(--green)",
          }}>
            <span style={{
              display:"inline-block",
              width:5, height:5, borderRadius:"50%",
              background:"var(--green)",
              boxShadow:"0 0 6px var(--green)",
              animation:"ioo-blink 2s infinite",
              flexShrink:0,
            }} />
            Game Open
          </div>
        )}
      </div>

      {/* Right: squad gauge */}
      <GaugeArc inCount={inCount} squadSize={squadSize} />
    </div>
  );
}
