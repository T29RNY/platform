import { CalendarCheck, MapPinLine, Clock, WhatsappLogo } from "@phosphor-icons/react";
import { motion } from "framer-motion";
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
  shareUrl = null,
  opponentLabel = null,
}) {
  const showAvatar = !!(me && onAvatarTap);

  return (
    <div style={{
      padding:"10px 16px 12px",
      display:"flex", gap:12, alignItems:"center",
    }}>

      {/* Left column — inline avatar+teamName, then logo, then meta */}
      <div style={{
        flex:1, minWidth:0,
        display:"flex", flexDirection:"column", gap:6,
      }}>

        {/* Row 1 — avatar + team name */}
        <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
          {showAvatar && (
            <motion.div
              layoutId="me-avatar"
              onClick={onAvatarTap}
              role="button"
              aria-label="Open profile"
              whileTap={{ scale: 0.94 }}
              transition={{ type:"spring", stiffness:380, damping:30 }}
              style={{
                width:36, height:36, borderRadius:"50%",
                background:"rgba(255,255,255,0.06)",
                border:"1px solid rgba(255,255,255,0.18)",
                boxShadow:"0 0 12px rgba(0,0,0,0.45)",
                display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", WebkitTapHighlightColor:"transparent",
                fontFamily:"'Bebas Neue', sans-serif", fontSize:13,
                letterSpacing:"0.04em", color:"var(--t1)",
                backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)",
                flexShrink:0,
              }}
            >
              {initials(me?.nickname || me?.name)}
            </motion.div>
          )}
          <div style={{
            fontSize:11, fontWeight:300,
            letterSpacing:"0.22em", textTransform:"uppercase",
            color:"var(--t2)",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>
            {teamName}
          </div>
        </div>

        {/* Row 2 — big IN OR OUT logo, left-aligned to flow under avatar */}
        <div style={{
          fontFamily:"var(--font-display)", fontSize:48,
          lineHeight:0.88, letterSpacing:"0.02em", fontStyle:"italic",
        }}>
          <span style={{ color:"var(--green)" }}>IN</span>
          <span style={{ color:"var(--t1)" }}> OR </span>
          <span style={{ color:"var(--red)" }}>OUT</span>
        </div>

        {/* Row 3 — game meta */}
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          {opponentLabel && (
            <div style={{
              fontSize:13, fontWeight:500, color:"var(--t1)",
              maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            }}>
              {opponentLabel}
            </div>
          )}
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
          {shareUrl && (
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share team sheet to WhatsApp"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center",
                color:"var(--green)",
                WebkitTapHighlightColor:"transparent",
              }}
            >
              <WhatsappLogo size={20} weight="thin" />
            </a>
          )}
        </div>
      </div>

      {/* Right: squad gauge — unchanged */}
      <GaugeArc inCount={inCount} squadSize={squadSize} />
    </div>
  );
}
