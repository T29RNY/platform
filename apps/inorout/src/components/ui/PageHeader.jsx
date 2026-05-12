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

export default function PageHeader({ teamName, dayOfWeek, venue, kickoff, inCount, squadSize, gameIsLive }) {
  return (
    <div style={{
      padding:"8px 16px 10px",
      display:"flex", justifyContent:"space-between",
      alignItems:"stretch", gap:10,
    }}>

      {/* Left column */}
      <div style={{
        flex:1, minWidth:0,
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

        {/* Logo */}
        <div style={{
          fontFamily:"var(--font-display)", fontSize:52,
          lineHeight:0.88, letterSpacing:"0.02em", fontStyle:"italic",
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
